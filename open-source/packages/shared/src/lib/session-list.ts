// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/session-list.test.ts
import type { AgentType, NianSession, SessionActivitySnapshot } from '@shennian/wire'
import { isInternalSession } from '@shennian/wire'
import { formatSessionPreviewForDisplay } from './session-preview'

export const EXTERNAL_CHANNEL_AGENT_TYPES = ['manager', 'codex', 'claude', 'pi', 'nian', 'gemini', 'cursor', 'opencode', 'openclaw'] as const

export function canSessionUseExternalChannelAgent(agentType: AgentType | string | null | undefined): boolean {
  if (typeof agentType === 'string' && agentType.startsWith('custom:')) return true
  return EXTERNAL_CHANNEL_AGENT_TYPES.includes(agentType as (typeof EXTERNAL_CHANNEL_AGENT_TYPES)[number])
}

export function hasSessionExternalChannel(
  session: Pick<NianSession, 'agentType' | 'externalChannel'> | null | undefined,
): boolean {
  return Boolean(
    session &&
    canSessionUseExternalChannelAgent(session.agentType) &&
    (session.externalChannel?.configured ?? session.externalChannel?.connected),
  )
}

function toMillis(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export const SESSION_ACTIVITY_STALE_MS = 5 * 60 * 1000

export function getLiveSessionActivitySnapshot(
  activity: SessionActivitySnapshot | null | undefined,
  opts?: { now?: number; staleAfterMs?: number },
): SessionActivitySnapshot | null {
  if (!activity) return null

  const now = opts?.now ?? Date.now()
  const staleAfterMs = opts?.staleAfterMs ?? SESSION_ACTIVITY_STALE_MS
  const updatedAt = toMillis(activity.updatedAt)

  if (updatedAt > 0 && now - updatedAt > staleAfterMs) {
    return null
  }

  return activity
}

export function getSessionSortActivityAt(session: NianSession): number {
  return toMillis(session.lastUserMessageAt) || toMillis(session.createdAt)
}

export function isSessionPinned(session: NianSession): boolean {
  return Boolean(session.userState?.pinnedAt)
}

export function hasSessionUnread(session: NianSession): boolean {
  if (isInternalSession(session)) return false
  if (session.userState?.manualUnread) return true
  if (!session.userState) return false

  const attentionCount = session.attentionCount ?? 0
  const readAttentionCount = session.userState.lastReadAttentionCount ?? 0
  if (attentionCount > readAttentionCount) return true

  // A compacted/rebuilt projection can replace the visible tail without
  // increasing its count. Treat that identity change as one unread item, but
  // ignore tool/thinking mutations that only advance bodyRevision.
  const lastAttentionId = session.lastAttentionId ?? null
  const readAttentionId = session.userState.lastReadAttentionId ?? null
  return (
    attentionCount > 0 &&
    lastAttentionId !== readAttentionId
  )
}

export function isSessionWorking(session: NianSession): boolean {
  return Boolean(session.activity)
}

export function getSessionLiveActivity(
  session: NianSession,
  opts?: { now?: number; staleAfterMs?: number },
): SessionActivitySnapshot | null {
  return getLiveSessionActivitySnapshot(session.activity, opts)
}

export function getSessionListSummary(
  session: NianSession,
  opts?: {
    preview?: string | null
    draft?: string | null
    sendingPreview?: string | null
    isTyping?: boolean
    now?: number
    staleAfterMs?: number
    workingLabel?: string
    toolRunningLabel?: string
    toolRunningCountLabel?: string
    imageLabel?: string
    imagesLabel?: (count: number) => string
    fileLabel?: string
    filesLabel?: (count: number) => string
  },
): {
  text: string
  isDraft: boolean
  isSending: boolean
  showPulse: boolean
  useActiveColor: boolean
  liveActivity: SessionActivitySnapshot | null
} {
  const liveActivity = getSessionLiveActivity(session, opts)
  const showPulse = Boolean(liveActivity || opts?.isTyping)
  const draftText = (opts?.draft ?? '').trim()
  const rawSendingText = (opts?.sendingPreview ?? '').trim()
  const rawPreviewText = (opts?.preview ?? session.lastMessagePreview ?? '').trim()
  const previewText = formatSessionPreviewForDisplay(rawPreviewText, {
    image: opts?.imageLabel ?? 'Image',
    images: opts?.imagesLabel ?? ((count) => `${count} Images`),
    file: opts?.fileLabel ?? 'File',
    files: opts?.filesLabel ?? ((count) => `${count} Files`),
  })
  const sendingText = formatSessionPreviewForDisplay(rawSendingText, {
    image: opts?.imageLabel ?? 'Image',
    images: opts?.imagesLabel ?? ((count) => `${count} Images`),
    file: opts?.fileLabel ?? 'File',
    files: opts?.filesLabel ?? ((count) => `${count} Files`),
  })
  const isDraft = draftText.length > 0
  const isSending = !isDraft && sendingText.length > 0
  const toolRunningText =
    liveActivity?.runPhase === 'tool_running'
      ? ((liveActivity.toolCallCount ?? 0) > 0
          ? opts?.toolRunningCountLabel
          : opts?.toolRunningLabel ?? opts?.workingLabel ?? ''
        )?.trim() || (opts?.toolRunningLabel ?? opts?.workingLabel ?? '').trim()
      : ''
  return {
    text: draftText || sendingText || toolRunningText || previewText || (showPulse ? (opts?.workingLabel ?? '') : ''),
    isDraft,
    isSending,
    showPulse,
    useActiveColor: (showPulse || isSending) && !isDraft,
    liveActivity,
  }
}

export function getSessionListMetaLabel(opts: {
  machineName?: string | null
  agentLabel?: string | null
}): string {
  const machineName = opts.machineName?.trim()
  const agentLabel = opts.agentLabel?.trim()
  return [machineName, agentLabel].filter(Boolean).join(' · ')
}

export function sortSessions(sessions: NianSession[]): NianSession[] {
  return [...sessions].sort((left, right) => {
    const leftPinned = isSessionPinned(left) ? 1 : 0
    const rightPinned = isSessionPinned(right) ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned

    const byActivity = getSessionSortActivityAt(right) - getSessionSortActivityAt(left)
    if (byActivity !== 0) return byActivity

    const byCreatedAt = toMillis(right.createdAt) - toMillis(left.createdAt)
    if (byCreatedAt !== 0) return byCreatedAt
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

export function filterManagerSubstrateSessions(sessions: NianSession[]): NianSession[] {
  const managerAgentSessionIds = new Set(
    sessions
      .filter((session) => isInternalSession(session) && session.agentSessionId)
      .map((session) => session.agentSessionId as string),
  )
  return sessions.filter((session) => (
    isOrdinaryVisibleSession(session) &&
    (
      session.agentType === 'manager' ||
      !session.agentSessionId ||
      !managerAgentSessionIds.has(session.agentSessionId)
    )
  ))
}

export function isManagerWorkerSession(session: Pick<NianSession, 'id'>): boolean {
  return session.id.startsWith('sess_worker_')
}

export function isOrdinaryVisibleSession(session: Pick<NianSession, 'id'> & Partial<NianSession>): boolean {
  return !isInternalSession(session)
}

/**
 * Sessions retained by the account projection that backs Projects.
 *
 * Workers remain internal for global-list, unread and Push semantics. Once a
 * project page has explicitly fetched one, however, the local projection must
 * retain it so the existing project rows can render and receive live updates.
 */
export function isProjectVisibleSession(session: Pick<NianSession, 'id'> & Partial<NianSession>): boolean {
  return isOrdinaryVisibleSession(session)
    || (session.agentIdentityId == null && isManagerWorkerSession(session))
}
