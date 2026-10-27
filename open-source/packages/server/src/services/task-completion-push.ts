// @arch open-source/docs/server-runtime.md
// @test src/__tests__/task-completion-push.test.ts

import { sanitizeSessionPreview } from '@shennian/wire'
import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { writeLog } from './log.js'
import { sendPushNotification } from './push.js'
import { countUnreadVisibleMessages } from './unread-badge.js'

const DEFAULT_POLL_INTERVAL_MS = 5_000
const LEASE_MS = 60_000
const MAX_PREVIEW_LENGTH = 100
const DEFAULT_BATCH_SIZE = 20
export const TASK_COMPLETION_PUSH_SUPPRESSION_MS = 5_000

type TerminalState = 'final' | 'error'
type OutboxCandidate = {
  id: string
  sessionId: string
  userId: string
  terminalBodyRevision: number
  terminalAttentionId: string
  terminalAttentionCount: number | null
  terminalState: string
  notificationTitle: string | null
  notificationBody: string | null
  notificationPreviewMessageId: string | null
  notificationPreviewAt: Date | null
  attempts: number
}

let workerStarted = false
let workerTimer: ReturnType<typeof setInterval> | null = null
let activeDrain: Promise<TaskCompletionPushDrainResult> | null = null

export type TaskCompletionPushDrainResult = {
  claimed: number
  sent: number
  failed: number
  skipped: number
}

export function buildCompletionTitle(title: string): string {
  return title.trim() || '未命名任务'
}

function stripMarkdownForNotification(text: string): string {
  return text
    .replace(/```(?:[\w-]+\n)?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
}

function buildFallbackBody(title: string, terminalState: TerminalState): string {
  return terminalState === 'error'
    ? `${buildCompletionTitle(title)} 出错了`
    : `${buildCompletionTitle(title)} 已完成`
}

function compactPreview(preview: string | null | undefined): string | null {
  const safe = sanitizeSessionPreview(preview, 200)
  if (!safe) return null
  const text = stripMarkdownForNotification(preview ?? '').replace(/\s+/g, ' ').trim()
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…` : text || null
}

export function buildTerminalNotificationSnapshot(input: {
  title: string
  preview: string | null
  previewMessageId: string | null
  previewAt: Date | null
  terminalAt: Date
  terminalState: TerminalState
}): {
  notificationTitle: string
  notificationBody: string
  notificationPreviewMessageId: string | null
  notificationPreviewAt: Date
} {
  const notificationTitle = buildCompletionTitle(input.title)
  const preview = compactPreview(input.preview)
  return {
    notificationTitle,
    notificationBody: preview ?? buildFallbackBody(notificationTitle, input.terminalState),
    notificationPreviewMessageId: preview ? input.previewMessageId : null,
    notificationPreviewAt: preview && input.previewAt ? input.previewAt : input.terminalAt,
  }
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 6))
}

async function claimCandidate(candidate: OutboxCandidate, now: Date): Promise<boolean> {
  const claimed = await prisma.sessionTerminalNotification.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ],
    },
    data: {
      status: 'processing',
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 },
      lastErrorCode: null,
    },
  })
  return claimed.count === 1
}

async function dispatchCandidate(candidate: OutboxCandidate): Promise<'sent' | 'skipped'> {
  // Also filter at dispatch so rows produced by an older server/daemon cannot
  // leak an internal Worker completion after an upgrade.
  if (candidate.sessionId.startsWith('sess_worker_')) return 'skipped'
  // Rows created before terminal snapshots were introduced cannot safely use
  // the mutable session preview: it may already belong to the next turn.
  if (
    candidate.terminalAttentionCount == null ||
    !candidate.notificationTitle ||
    !candidate.notificationBody ||
    !candidate.notificationPreviewAt
  ) return 'skipped'

  const session = await prisma.nianSession.findUnique({
    where: { id: candidate.sessionId },
    select: {
      deletedAt: true,
      status: true,
      sessionMode: true,
      nativeSessionVisibility: true,
      agentIdentityId: true,
      agentType: true,
      bodyRevision: true,
      attentionCount: true,
      userStates: {
        where: { userId: candidate.userId },
        select: {
          lastReadAttentionCount: true,
          lastReadAttentionId: true,
        },
      },
    },
  })
  if (!session || session.deletedAt || session.sessionMode === 'manager'
    || session.agentType === 'manager' || session.agentIdentityId
    || session.nativeSessionVisibility === 'internal') return 'skipped'

  const readState = session.userStates[0]
  const alreadyRead = Boolean(readState && (
    readState.lastReadAttentionCount >= candidate.terminalAttentionCount ||
    readState.lastReadAttentionId === candidate.terminalAttentionId
  ))
  const supersededByTerminal = session.attentionCount > candidate.terminalAttentionCount
  const nextTurnStarted = session.status === 'active' &&
    session.bodyRevision > candidate.terminalBodyRevision
  if (alreadyRead || supersededByTerminal || nextTurnStarted) return 'skipped'

  const terminalState: TerminalState = candidate.terminalState === 'error' ? 'error' : 'final'
  const badge = await countUnreadVisibleMessages(candidate.userId).catch(() => 0)
  const notificationKey = `${candidate.sessionId}:${candidate.terminalAttentionId}`
  const traceId = randomBytes(8).toString('hex')

  void writeLog({
    traceId,
    userId: candidate.userId,
    sessionId: candidate.sessionId,
    source: 'server',
    type: 'internal',
    level: 'info',
    path: 'push.task-complete',
    metadata: {
      terminalBodyRevision: candidate.terminalBodyRevision,
      terminalState,
      notificationKey,
      previewIncluded: Boolean(candidate.notificationPreviewMessageId),
      badge,
    },
  })

  await sendPushNotification(
    candidate.userId,
    candidate.notificationTitle,
    candidate.notificationBody,
    {
      sessionId: candidate.sessionId,
      terminalBodyRevision: candidate.terminalBodyRevision,
      notificationKey,
      preview: candidate.notificationBody,
      previewAt: candidate.notificationPreviewAt.toISOString(),
    },
    { audience: 'mobile', traceId, badge, requireDelivery: true },
  )
  return 'sent'
}

async function runDrain(limit: number): Promise<TaskCompletionPushDrainResult> {
  const result: TaskCompletionPushDrainResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 }
  const now = new Date()
  const candidates = await prisma.sessionTerminalNotification.findMany({
    where: {
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ],
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      sessionId: true,
      userId: true,
      terminalBodyRevision: true,
      terminalAttentionId: true,
      terminalAttentionCount: true,
      terminalState: true,
      notificationTitle: true,
      notificationBody: true,
      notificationPreviewMessageId: true,
      notificationPreviewAt: true,
      attempts: true,
    },
  })

  for (const candidate of candidates) {
    if (!await claimCandidate(candidate, now)) continue
    result.claimed += 1
    try {
      const outcome = await dispatchCandidate(candidate)
      await prisma.sessionTerminalNotification.updateMany({
        where: { id: candidate.id, status: 'processing' },
        data: { status: 'sent', sentAt: new Date(), leaseUntil: null },
      })
      result[outcome] += 1
    } catch (error) {
      const errorCode = error instanceof Error ? error.name.slice(0, 191) : 'push_failed'
      await prisma.sessionTerminalNotification.updateMany({
        where: { id: candidate.id, status: 'processing' },
        data: {
          status: 'pending',
          availableAt: new Date(Date.now() + retryDelayMs(candidate.attempts + 1)),
          leaseUntil: null,
          lastErrorCode: errorCode,
        },
      })
      result.failed += 1
    }
  }
  return result
}

export function processPendingTaskCompletionPushes(
  limit = DEFAULT_BATCH_SIZE,
): Promise<TaskCompletionPushDrainResult> {
  if (activeDrain) return activeDrain
  activeDrain = runDrain(limit).finally(() => { activeDrain = null })
  return activeDrain
}

/** Wake an already-running worker after the enclosing index transaction commits. */
export function kickTaskCompletionPushWorker(): void {
  if (!workerStarted) return
  queueMicrotask(() => {
    void processPendingTaskCompletionPushes().catch((error) => {
      console.error('[task-completion-push] drain failed', error)
    })
  })
}

export function startTaskCompletionPushWorker(): void {
  if (workerStarted) return
  workerStarted = true
  workerTimer = setInterval(kickTaskCompletionPushWorker, DEFAULT_POLL_INTERVAL_MS)
  workerTimer.unref?.()
  kickTaskCompletionPushWorker()
}

export async function stopTaskCompletionPushWorker(): Promise<void> {
  workerStarted = false
  if (workerTimer) clearInterval(workerTimer)
  workerTimer = null
  await activeDrain
}
