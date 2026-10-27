// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-failover.test.ts

import type { AgentInfo, AgentType } from '@shennian/wire'

/**
 * Only a clear "this AI cannot serve the steward right now" moves the steward to another
 * AI tool: not installed, not signed in, quota used up, failed to start or crashed. A slow
 * turn is not a failure, and a user stop never switches.
 */
export type StewardFailureReason = 'not_installed' | 'not_logged_in' | 'quota' | 'crashed'

const REASON_LABEL: Record<StewardFailureReason, string> = {
  not_installed: '没有安装或找不到程序',
  not_logged_in: '没有登录或授权失效',
  quota: '额度用完或被限流',
  crashed: '启动失败或运行中断',
}

export function stewardFailureLabel(reason: StewardFailureReason): string {
  return REASON_LABEL[reason]
}

/** Best-effort text classification; anything else that ended a turn in error counts as a crash. */
export function classifyStewardFailure(message: string | undefined): StewardFailureReason {
  const text = (message ?? '').toLowerCase()
  if (/enoent|command not found|not installed|command_unavailable|runtime_unavailable|no such file|未找到|未安装/.test(text)) {
    return 'not_installed'
  }
  if (/log ?in|logged in|sign in|unauthori[sz]ed|\b401\b|\b403\b|auth(?:entication|_required)?\b|api key|credential|未登录|登录/.test(text)) {
    return 'not_logged_in'
  }
  if (/quota|usage limit|rate limit|too many requests|\b429\b|insufficient|credit|billing|exceeded|额度|用完|限流/.test(text)) {
    return 'quota'
  }
  return 'crashed'
}

const NOT_A_STEWARD_RUNTIME = new Set(['manager', 'pi', 'pi-coding-agent'])

/** The next AI tool on the same machine, in discovery order, skipping ones already tried. */
export function pickFailoverAgent(agents: readonly AgentInfo[], tried: readonly string[]): AgentType | null {
  const skip = new Set(tried)
  const next = agents.find((agent) =>
    agent.supportsStandardSession !== false
    && !NOT_A_STEWARD_RUNTIME.has(agent.type)
    && agent.authState !== 'required'
    && agent.authState !== 'error'
    && !skip.has(agent.type))
  return next?.type ?? null
}

/** Shown to the next AI only; the user never sees it as a message. */
export function buildHandoverNote(fromName: string, reason: StewardFailureReason): string {
  return [
    `这段对话是从「${fromName}」自动切换过来的（原因：${REASON_LABEL[reason]}）。`,
    '上一个 AI 可能已经做了一部分操作：动手前先核对现状（例如 shennian project task list 看已建的任务），',
    '不要重复执行有副作用的操作，也不要重复创建已存在的任务；核对后再继续回应用户的这条消息。',
  ].join('')
}

// Per-daemon memory: what each steward session's current turn asked, which AI tools this chain
// already tried, and a handover note waiting for the new session's first turn. Losing it on a
// restart only costs the note (and possibly one extra switch), never a message.
const lastUserText = new Map<string, string>()
const triedByChain = new Map<string, string[]>()
const handoverNotes = new Map<string, string>()
const MAX_TRACKED = 200

function bounded<K, V>(map: Map<K, V>): Map<K, V> {
  while (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K)
  return map
}

export function rememberStewardTurn(sessionId: string, text: string): void {
  bounded(lastUserText).set(sessionId, text)
}

export function lastStewardUserText(sessionId: string): string {
  return lastUserText.get(sessionId) ?? ''
}

export function stewardTriedAgents(sessionId: string, current: string): string[] {
  const tried = triedByChain.get(sessionId) ?? []
  return tried.includes(current) ? tried : [...tried, current]
}

export function carryStewardChain(fromSessionId: string, toSessionId: string, tried: readonly string[]): void {
  bounded(triedByChain).set(toSessionId, [...tried])
  triedByChain.delete(fromSessionId)
}

export function setStewardHandover(sessionId: string, note: string): void {
  bounded(handoverNotes).set(sessionId, note)
}

/** Consumed once, by the first turn of the switched-to session. */
export function takeStewardHandover(sessionId: string): string {
  const note = handoverNotes.get(sessionId) ?? ''
  handoverNotes.delete(sessionId)
  return note
}

/** A turn that finished cleanly ends the chain: the next failure starts from a fresh list. */
export function resetStewardChain(sessionId: string): void {
  triedByChain.delete(sessionId)
}

// A session whose turn just moved to another AI tool must not also show its own failure notice.
const switchedAt = new Map<string, number>()
const SWITCHED_QUIET_MS = 60_000

export function markStewardSwitched(sessionId: string): void {
  bounded(switchedAt).set(sessionId, Date.now())
}

export function wasStewardJustSwitched(sessionId: string): boolean {
  const at = switchedAt.get(sessionId)
  return at !== undefined && Date.now() - at < SWITCHED_QUIET_MS
}

/** A new turn on this session starts with a clean slate. */
export function clearStewardSwitched(sessionId: string): void {
  switchedAt.delete(sessionId)
}
