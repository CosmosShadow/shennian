// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-session.test.ts

import { createHash, randomUUID } from 'node:crypto'
import {
  buildStewardSayPayload, parseStewardSayPayload, STEWARD_FAILOVER_USER_MESSAGE_ID_PREFIX, STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX,
} from '@shennian/wire'
import { DaemonIpcError } from '../../daemon-ipc/protocol.js'
import { STEWARD_SAY_MAX_CHARS, isStewardSessionId } from '../../steward/session.js'
import { requestSessionIndexPublish } from '../index-publisher.js'
import { appendMessage, getDaemonInstallationId, listSessionRecords, readMessages, recordSession } from '../store.js'
import { pinStewardWorkDir } from '../../steward/session.js'
import {
  buildHandoverNote, carryStewardChain, classifyStewardFailure, clearStewardSwitched, lastStewardUserText, markStewardSwitched, pickFailoverAgent,
  setStewardHandover, wasStewardJustSwitched, stewardFailureLabel, stewardTriedAgents,
} from '../../steward/failover.js'
import type { ActiveSession, SessionManagerRuntime } from '../types.js'

/** A DaemonIpcError so the stable code reaches the `steward say` caller. */
export class StewardSayError extends DaemonIpcError {}

/** Commits one user-visible steward message; never touches the Agent's own transcript text. */
export function commitStewardSay(
  runtime: SessionManagerRuntime,
  sessionId: string,
  rawText: string,
  source: 'say' | 'fallback' = 'say',
  messageId?: string,
  worker?: import('@shennian/wire').StewardSayPayload['worker'],
): { messageId: string } {
  if (!isStewardSessionId(sessionId)) {
    throw new StewardSayError('steward_session_required', 'This session is not a Shennian steward session.')
  }
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) throw new StewardSayError('steward_say_empty', 'There is nothing to say.')
  if (text.length > STEWARD_SAY_MAX_CHARS) {
    throw new StewardSayError('steward_say_too_long', `A message may hold at most ${STEWARD_SAY_MAX_CHARS} characters.`)
  }
  const runId = runtime.sessions.get(sessionId)?.currentRunId
  const id = messageId ?? `${source === 'say' && runId ? sayRunPrefix(runId) : 'steward-say-'}${randomUUID()}`
  appendMessage(sessionId, {
    id,
    sessionId,
    role: 'agent',
    ts: Date.now(),
    payload: buildStewardSayPayload(text, source, worker),
  })
  const active = runtime.sessions.get(sessionId)
  if (active && source === 'say' && !worker) {
    active.stewardSay = { count: (active.stewardSay?.count ?? 0) + 1 }
  }
  requestSessionIndexPublish(runtime.client)
  return { messageId: id }
}

/** Bind persisted say receipts to a Provider Run, not the last human message:
 * background continuations have no new human envelope and must not inherit its say. */
function sayRunPrefix(runId: string): string {
  return `steward-say-run-${createHash('sha256').update(runId).digest('hex').slice(0, 32)}-`
}
function saidInRun(sessionId: string, runId: string): boolean {
  if (!runId) return false
  const prefix = sayRunPrefix(runId)
  let legacySayInTurn = false
  for (const message of readMessages(sessionId, { limit: 80 })) {
    if (message.role === 'user' || /^(manager-inbox:|project-result:|project-progress:|schedule:)/.test(message.id)) return legacySayInTurn
    const say = parseStewardSayPayload(String(message.payload))
    if (say?.source !== 'say' || say.worker) continue
    if (message.id.startsWith(prefix)) return true
    // Keep old same-turn restart receipts compatible, but never carry one past
    // a trusted background trigger or a new user envelope.
    if (!message.id.startsWith('steward-say-run-')) legacySayInTurn = true
  }
  return legacySayInTurn
}

/**
 * The user always gets an answer per turn: when the run finished (or failed)
 * without a single `say`, its last output is shown instead, marked as fallback.
 */
export function commitStewardFallback(
  runtime: SessionManagerRuntime,
  sessionId: string,
  active: ActiveSession,
  event: { state: string; runId: string; message?: string },
): void {
  if (!isStewardSessionId(sessionId)) return
  const failed = event.state === 'error' || event.state === 'aborted'
  if (!failed && (active.stewardSay?.count ?? 0) > 0) return
  if (wasStewardJustSwitched(sessionId) || (!failed && saidInRun(sessionId, event.runId))) return
  const lastText = active.stewardLastText?.trim() ?? ''
  const text = failed
    ? event.message?.trim() || '这次处理没有完成，请检查任务状态后再试。'
    : lastText
    || (event.state === 'final'
      ? '已处理，但没有可显示的回复。'
      : event.message?.trim() || '这次处理没有完成。')
  try {
    commitStewardSay(runtime, sessionId, text.slice(0, STEWARD_SAY_MAX_CHARS), 'fallback',
      `steward-fallback-${event.runId || 'run'}`)
  } catch {
    // A fallback must never break terminal bookkeeping.
  }
}

/** Title and opening line of the conversation that collects `say` calls made from a terminal. */
export const STEWARD_TERMINAL_TITLE = '来自终端'

const NON_STEWARD_RUNTIMES = new Set(['manager', 'pi'])

/** One stable id per daemon: repeated terminal calls keep landing in the same conversation. */
export function stewardTerminalSessionId(daemonInstallationId: string): string {
  const hex = createHash('sha256').update(`${daemonInstallationId}\0steward-terminal`).digest('hex')
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `sess_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * `say` from the user's own AI in a terminal has no steward session of its own. It lands in a
 * conversation the daemon opens once ("来自终端"): it starts no Agent, only collects these
 * messages, and a reply from the phone is handled by the phone-side steward as usual.
 */
export function commitTerminalStewardSay(
  runtime: SessionManagerRuntime,
  rawText: string,
): { messageId: string; sessionId: string } {
  const sessionId = stewardTerminalSessionId(getDaemonInstallationId())
  const existing = listSessionRecords().find((record) => record.sessionId === sessionId)
  if (existing && existing.sessionScope !== 'steward') {
    throw new StewardSayError('steward_scope_conflict', 'The terminal conversation id is already in use.')
  }
  if (!existing) {
    const runtimes = runtime.getAgentSnapshot?.() ?? []
    const agentType = runtimes.find((agent) =>
      agent.supportsStandardSession !== false && !NON_STEWARD_RUNTIMES.has(agent.type))?.type ?? 'codex'
    recordSession({
      sessionId, agentType, workDir: pinStewardWorkDir(), sessionScope: 'steward', sessionMode: 'standard',
    })
    // The server needs a user-authored opening line to accept the conversation.
    appendMessage(sessionId, {
      id: `${STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX}${sessionId}`, sessionId, role: 'user', ts: Date.now(),
      payload: STEWARD_TERMINAL_TITLE,
    })
  }
  return { ...commitStewardSay(runtime, sessionId, rawText), sessionId }
}

const AGENT_LABELS: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' }
const agentLabel = (type: string): string => AGENT_LABELS[type] ?? type.replace(/^acp:/, '')

/**
 * The steward's AI became unavailable before it answered: continue the same user message in a new
 * steward session backed by the next AI tool on this machine. A machine that is offline never
 * reaches here (no daemon), so it is never silently replaced by another machine.
 * Returns false when there is nothing to switch to, and the caller falls back to an error notice.
 */
export async function tryStewardFailover(
  runtime: SessionManagerRuntime,
  sessionId: string,
  active: Pick<ActiveSession, 'agentType' | 'stewardSay'>,
  event: { state: string; runId: string; message?: string },
  userTextOverride?: string,
): Promise<boolean> {
  if (active.agentType === 'shennian' || event.state !== 'error' || !isStewardSessionId(sessionId)) return false
  if ((active.stewardSay?.count ?? 0) > 0 || !runtime.chatQueue) return false
  const userText = userTextOverride || lastStewardUserText(sessionId)
  if (!userText) return false
  const tried = stewardTriedAgents(sessionId, active.agentType)
  const next = pickFailoverAgent(runtime.getAgentSnapshot?.() ?? [], tried)
  if (!next) return false
  const reason = classifyStewardFailure(event.message)
  // Marked before the async hand-over so this session's own failure notice cannot slip in meanwhile.
  markStewardSwitched(sessionId)
  const newSessionId = `sess_${randomUUID()}`
  const workDir = pinStewardWorkDir()
  recordSession({ sessionId: newSessionId, agentType: next, workDir, sessionScope: 'steward', sessionMode: 'standard' })
  carryStewardChain(sessionId, newSessionId, [...tried, next])
  setStewardHandover(newSessionId, buildHandoverNote(agentLabel(active.agentType), reason))
  try {
    const accepted = await runtime.chatQueue.handleEnqueue({
      type: 'req',
      id: `steward-failover-${newSessionId}`,
      method: 'chat.enqueue',
      params: {
        sessionId: newSessionId, text: userText, agentType: next, workDir, sessionMode: 'standard',
        sessionScope: 'steward', clientMessageId: `${STEWARD_FAILOVER_USER_MESSAGE_ID_PREFIX}${newSessionId}`,
      },
    } as never)
    if (!accepted) { clearStewardSwitched(sessionId); return false }
  } catch {
    clearStewardSwitched(sessionId)
    return false
  }
  commitStewardSay(
    runtime, newSessionId,
    `已自动切换到 ${agentLabel(next)}（原因：${agentLabel(active.agentType)}${stewardFailureLabel(reason)}）`,
    'say', `steward-failover-note-${newSessionId}`,
  )
  return true
}
