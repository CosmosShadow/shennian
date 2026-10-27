// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import type { ChatMessage } from '@shennian/shared'
import { STEWARD_FAILOVER_USER_MESSAGE_ID_PREFIX, STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX } from '@shennian/wire'
import type { AgentType, Machine, NianSession, SessionReadWatermark } from '@shennian/wire'

/** Placeholder only: the steward's daemon pins the real fixed workspace itself. */
export const STEWARD_WORKDIR = '~/shennian-agent'

/** First Client that understands steward sessions; keep equal to the Relay's STEWARD_MIN_CLI_VERSION. */
export const STEWARD_MIN_CLI_VERSION = '0.5.15'

function versionParts(version: string): number[] {
  return version.split('-')[0]!.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

/** A Client older than the steward release cannot host it; unknown versions are given the benefit of the doubt. */
export function machineSupportsSteward(machine: Pick<Machine, 'cliVersion'> | null | undefined): boolean {
  const version = machine?.cliVersion
  if (!version) return true
  const have = versionParts(version)
  const need = versionParts(STEWARD_MIN_CLI_VERSION)
  for (let index = 0; index < Math.max(have.length, need.length); index += 1) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

/** Missing capabilities on a current Client indicate discovery/connection failure, not an update. */
export function machineNeedsBuiltinUpgrade(machine: Pick<Machine, 'cliVersion'> | null | undefined): boolean {
  if (!machine?.cliVersion || !/^\d+\.\d+\.\d+/.test(machine.cliVersion)) return false
  const have = versionParts(machine.cliVersion), need = [0, 5, 40]
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i]! < need[i]!
  }
  return false
}

const TITLE_MACHINE_MAX = 14

/**
 * The steward conversation is message-style: the user's own messages and what the
 * steward deliberately said. Approval cards stay because they need the user's action.
 * Working text, tool calls and errors are kept in the local transcript only.
 */
export function visibleStewardMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (message) =>
      !message.id.startsWith(STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX)
      && !message.id.startsWith(STEWARD_FAILOVER_USER_MESSAGE_ID_PREFIX)
      && (message.role === 'user' || message.steward !== undefined || Boolean(message.approval)),
  )
}

/** While nothing has been said yet, the steward "opens" with its introduction (display only). */
export function withStewardIntro(
  messages: ChatMessage[],
  intro: string | undefined,
  ts: number = Date.now(),
): ChatMessage[] {
  if (messages.length > 0 || !intro) return messages
  return [{ id: 'steward-intro', role: 'agent', ts, content: intro, steward: 'say' }]
}

/**
 * Only the Owner's own machines can host a steward; shared machines never do.
 * The order is fixed (online first, then by name) so the switcher never reshuffles
 * under the user's finger when a machine's heartbeat or activity changes.
 */
export function stewardMachines(machines: readonly Machine[]): Machine[] {
  return machines
    .filter((machine) => machine.paired && machine.role !== 'granted')
    .sort((left, right) => {
      if (left.online !== right.online) return left.online ? -1 : 1
      const byName = (left.name ?? '').localeCompare(right.name ?? '')
      return byName !== 0 ? byName : left.id.localeCompare(right.id)
    })
}

export function resolveStewardMachine(
  machines: readonly Machine[],
  preferredId?: string | null,
): Machine | null {
  const owned = stewardMachines(machines)
  return (
    owned.find((machine) => machine.id === preferredId)
    ?? owned.find((machine) => machine.online && machineSupportsSteward(machine))
    ?? owned.find((machine) => machine.online)
    ?? owned[0]
    ?? null
  )
}

/** AI tools the machine actually reports, minus runtimes that cannot back a plain session. */
export function stewardAgentChoices(machine: Machine | null | undefined): AgentType[] {
  if (!machine) return []
  // New personal conversations never depend on a separately installed AI tool.
  return machine.agentList.includes('shennian') || machine.agents?.some(agent => agent.type === 'shennian' && agent.supportsStandardSession !== false) ? ['shennian'] : []
}

export function resolveStewardAgent(
  machine: Machine | null | undefined,
  preferred?: string | null,
): AgentType | null {
  const choices = stewardAgentChoices(machine)
  return (choices.find((type) => type === preferred) ?? choices[0] ?? null) as AgentType | null
}

function truncateMiddle(value: string, max: number): string {
  const chars = [...value]
  if (chars.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`
}

/** `神念管家（机器名）`, with a long machine name shortened in the middle. */
export function stewardTitle(baseTitle: string, machineName: string | null | undefined): string {
  const name = machineName?.trim()
  return name ? `${baseTitle}（${truncateMiddle(name, TITLE_MACHINE_MAX)}）` : baseTitle
}

export function isStewardSession(session: Pick<NianSession, 'sessionScope'>): boolean {
  return session.sessionScope === 'steward'
}

/** Newest first, steward sessions only; scoped to one machine when a machine is given. */
export function stewardHistory(
  sessions: readonly NianSession[],
  machineId?: string | null,
): NianSession[] {
  return sessions
    .filter((session) => isStewardSession(session) && !session.deletedAt
      && (!machineId || session.machineId === machineId))
    .sort((left, right) => Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))
}

/**
 * A steward Session is marked `nativeSessionVisibility=internal`, so the shared
 * `hasSessionUnread()` deliberately always reports it as read (internal sessions
 * must not affect the app's general unread badge). Here unread is a dot shown only
 * inside the steward's own UI (switch-machine list, entry row), computed from the
 * same raw fields without that exclusion.
 */
export function hasStewardSessionUnread(session: Pick<NianSession, 'attentionCount' | 'userState'>): boolean {
  return (session.attentionCount ?? 0) > (session.userState?.lastReadAttentionCount ?? 0)
}

/**
 * The read watermark to submit for a steward conversation: its own index, as shown.
 * `undefined` when there is nothing new to read (or nothing the Server knows about yet),
 * so viewing a quiet conversation never writes.
 */
export function stewardReadWatermark(session: Pick<NianSession,
  'bodyRevision' | 'visibleMessageCount' | 'lastVisibleMessageId'
  | 'attentionCount' | 'lastAttentionId' | 'userState' | 'localCreationState'
> | undefined): SessionReadWatermark | undefined {
  if (!session || session.localCreationState === 'draft') return undefined
  const attentionCount = session.attentionCount ?? 0
  if (attentionCount <= (session.userState?.lastReadAttentionCount ?? 0)) return undefined
  return {
    bodyRevision: session.bodyRevision ?? 0,
    visibleMessageCount: session.visibleMessageCount ?? 0,
    lastVisibleMessageId: session.lastVisibleMessageId ?? null,
    attentionCount,
    lastAttentionId: session.lastAttentionId ?? null,
  }
}

/**
 * A server refresh can advance the attention index without adding a new body
 * message (for example when a run finishes). The already-painted body covers
 * that index, so acknowledge the fresh attention count instead of the stale
 * session captured before the refresh. Never advance across an unpainted body
 * revision; that would mark a newly arrived message read too early.
 */
export function paintedStewardReadSession(
  presented: NianSession,
  latest: NianSession,
): NianSession {
  return latest.id === presented.id
    && (latest.bodyRevision ?? 0) <= (presented.bodyRevision ?? 0)
    ? latest
    : presented
}

/** Any not-yet-read activity on this machine's steward session(s), for the machine switcher's dot. */
export function machineHasStewardUnread(sessions: readonly NianSession[], machineId: string): boolean {
  return sessions.some((session) => session.machineId === machineId && isStewardSession(session) && !session.deletedAt && hasStewardSessionUnread(session))
}

/** Only machines the owner can still open may contribute to the steward inbox dot. */
export function stewardUnreadMachineIds(sessions: readonly NianSession[], machines: readonly Machine[]): string[] {
  return stewardMachines(machines)
    .filter((machine) => machineHasStewardUnread(sessions, machine.id))
    .map((machine) => machine.id)
}

/** The machine's steward page is one conversation assembled from its historical sessions. */
export function unreadStewardSessionsOnMachine(sessions: readonly NianSession[], machineId: string): NianSession[] {
  return sessions.filter((session) => session.machineId === machineId && isStewardSession(session)
    && !session.deletedAt && hasStewardSessionUnread(session))
}

/** Title of the conversation that only collects `say` calls made from a terminal (never followed). */
export const STEWARD_TERMINAL_TITLE = '来自终端'

/**
 * One conversation per machine. The remembered conversation wins while it still belongs to the
 * selected machine (the user may have opened an earlier one from the history list); otherwise the
 * machine's most recently active conversation is the one that opens. The terminal-only collector
 * is never opened this way — it is a log, not a conversation the user talks in.
 */
export function currentStewardSession(
  sessions: readonly NianSession[],
  machineId: string | null | undefined,
  preferredId?: string | null,
): NianSession | undefined {
  if (!machineId) return undefined
  const onMachine = sessions.filter((session) =>
    isStewardSession(session) && !session.deletedAt && session.machineId === machineId
    && session.title !== STEWARD_TERMINAL_TITLE)
  return onMachine.find((session) => session.id === preferredId)
    ?? [...onMachine].sort((left, right) =>
      Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt))[0]
}

/**
 * When the machine moves the steward to another AI tool it opens a newer steward conversation on the
 * same machine; the page follows it. A local draft is the user's own fresh choice and is never left.
 */
export function newerStewardSession(
  sessions: readonly NianSession[],
  current: Pick<NianSession, 'id' | 'machineId' | 'createdAt' | 'localCreationState'> | undefined,
): NianSession | undefined {
  if (!current || current.localCreationState === 'draft') return undefined
  const since = Date.parse(current.createdAt)
  return sessions
    .filter((session) =>
      isStewardSession(session) && !session.deletedAt && session.id !== current.id
      && session.machineId === current.machineId && session.localCreationState !== 'draft'
      && session.title !== STEWARD_TERMINAL_TITLE && Date.parse(session.createdAt) > since)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
}

/**
 * A tool or model switch inside one conversation. It changes nothing about the conversation's
 * history, so it is remembered on this device only and drawn as a rule where it happened.
 */
export type StewardSwitchMark = {
  sessionId: string
  ts: number
  /** Present when the AI tool changed, naming the tool switched to. */
  agentType?: string
  /** Present when the model changed, naming the model switched to. */
  modelId?: string
  /** The model changed to the tool's own default (which has no id). */
  defaultModel?: boolean
}

export type StewardDividerNames = {
  machine: (session: NianSession) => string
  agent: (session: NianSession) => string
  model: (session: NianSession) => string
  newConversation: string
  switchTo: (name: string) => string
}

/**
 * What changed between two neighbouring conversations, in the user's words. Every dimension that
 * actually changed is named — a machine switch never silently swallows a tool or model switch that
 * happened in the same move, and vice versa.
 */
export function stewardDividerLabel(
  previous: NianSession,
  current: NianSession,
  names: StewardDividerNames,
): string {
  const changed: string[] = []
  if (previous.machineId !== current.machineId) changed.push(names.machine(current))
  if (previous.agentType !== current.agentType) changed.push(names.agent(current))
  if ((previous.modelId ?? null) !== (current.modelId ?? null)) changed.push(names.model(current))
  if (changed.length === 0) return names.newConversation
  return names.switchTo(changed.join('、'))
}

/**
 * The steward shows one continuous timeline made of several conversations, oldest first,
 * with a rule between them saying what changed. Earlier conversations without a visible
 * message are skipped entirely, so repeated "new conversation" taps never stack empty rules.
 * The current conversation always gets its rule (unless nothing came before it) so the
 * switch is visible at once, before the first message.
 */
export function buildStewardPrelude(input: {
  sessions: readonly NianSession[]
  currentId: string | null | undefined
  earlierMessages: ReadonlyMap<string, ChatMessage[]>
  names: StewardDividerNames
}): ChatMessage[] {
  const ordered = [...input.sessions]
    .filter((session) => isStewardSession(session) && !session.deletedAt)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  const out: ChatMessage[] = []
  let previous: NianSession | undefined
  for (const session of ordered) {
    const isCurrent = session.id === input.currentId
    const earlier = isCurrent ? [] : input.earlierMessages.get(session.id) ?? []
    if (!isCurrent && earlier.length === 0) continue
    if (previous) {
      out.push({
        id: `steward-divider-${session.id}`,
        role: 'agent',
        ts: (Date.parse(session.createdAt) || 0) - 1,
        content: '',
        divider: stewardDividerLabel(previous, session, input.names),
      })
    }
    out.push(...earlier)
    previous = session
    if (isCurrent) break
  }
  return out
}

/**
 * Rules for the switches made inside the open conversation, merged into its messages by time.
 * A mark whose session is not the open one is ignored.
 */
export function withStewardSwitchMarks(
  messages: readonly ChatMessage[],
  marks: readonly ChatMessage[],
): ChatMessage[] {
  if (marks.length === 0) return [...messages]
  // Array.prototype.sort is stable, so a mark made after a message with the same
  // timestamp still lands after it.
  return [...messages, ...marks].sort((left, right) => left.ts - right.ts)
}

/** Turns the switches remembered for the open conversation into divider messages. */
export function stewardSwitchMessages(input: {
  marks: readonly StewardSwitchMark[]
  sessionId: string | null | undefined
  switchTo: (name: string) => string
  agentName: (agentType: string) => string
  modelName: (modelId: string | undefined) => string
}): ChatMessage[] {
  if (!input.sessionId) return []
  return input.marks
    .filter((mark) => mark.sessionId === input.sessionId)
    .sort((left, right) => left.ts - right.ts)
    .map((mark) => ({
      mark,
      changed: [
        ...(mark.agentType ? [input.agentName(mark.agentType)] : []),
        ...(mark.modelId || mark.defaultModel ? [input.modelName(mark.modelId)] : []),
      ],
    }))
    // A mark that names no change (an older build, a no-op) draws no rule.
    .filter((item) => item.changed.length > 0)
    .map(({ mark, changed }) => ({
      id: `steward-switch-${mark.sessionId}-${mark.ts}`,
      role: 'agent' as const,
      ts: mark.ts,
      content: '',
      divider: input.switchTo(changed.join('、')),
    }))
}

export type StewardPreferences = {
  machineId?: string
  agentType?: string
  /** Model of the steward AI; absent means the tool's default. */
  modelId?: string
  sessionId?: string
  /** Composer controls; shown unless the user turned them off. */
  showModel?: boolean
  showEffort?: boolean
  /** The title's "(machine name)"; shown unless the user turned it off. */
  showMachineName?: boolean
}
