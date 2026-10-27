// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-task-completion-notify.test.ts

import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { writeLog } from './log.js'
import { enqueueVoiceIncomingCallIntent } from './voice-incoming-call-intent.js'

export type VoiceTaskCompletionNotifyMode = 'message' | 'call'

const LEASE_MS = 60_000
const MAX_ATTEMPTS = 5
const DEFAULT_BATCH_SIZE = 20

type CompletionCandidate = {
  id: string
  userId: string
  sessionId: string
  reason: string | null
  initialPrompt: string | null
  projectHint: string | null
  callId: string | null
  attempts: number
  session: {
    status: string
    title: string
    lastMessagePreview: string | null
    bodyRevision: number
    lastAttentionId: string | null
  }
}

export type VoiceTaskCompletionDrainResult = {
  claimed: number
  sent: number
  retried: number
  terminal: number
}

let activeDrain: Promise<VoiceTaskCompletionDrainResult> | null = null

function compactText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 6))
}

function stableCallId(id: string): string {
  return `call_completion_${id}`.slice(0, 191)
}

function terminalRunId(candidate: CompletionCandidate): string {
  return compactText(candidate.session.lastAttentionId, 191)
    ?? `terminal:${candidate.session.bodyRevision}`
}

export async function registerVoiceTaskCompletionNotify(input: {
  userId: string
  sessionId: string
  mode: VoiceTaskCompletionNotifyMode
  reason?: string | null
  initialPrompt?: string | null
  projectHint?: string | null
  sourceConversationId?: string | null
  sourceCallId?: string | null
}): Promise<void> {
  if (input.mode !== 'call') return
  await prisma.voiceTaskCompletionNotify.updateMany({
    where: { userId: input.userId, sessionId: input.sessionId, status: 'pending', mode: 'call' },
    data: { status: 'superseded' },
  })
  await prisma.voiceTaskCompletionNotify.create({
    data: {
      userId: input.userId,
      sessionId: input.sessionId,
      mode: input.mode,
      reason: compactText(input.reason, 191),
      initialPrompt: compactText(input.initialPrompt, 1000),
      projectHint: compactText(input.projectHint, 191),
      sourceConversationId: compactText(input.sourceConversationId, 191),
      sourceCallId: compactText(input.sourceCallId, 191),
      availableAt: new Date(),
    },
  })
}

async function claimCandidate(candidate: CompletionCandidate, workerId: string, now: Date): Promise<string | null> {
  const callId = candidate.callId ?? stableCallId(candidate.id)
  const claimed = await prisma.voiceTaskCompletionNotify.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ],
      session: { status: { in: ['completed', 'failed'] }, deletedAt: null },
    },
    data: {
      status: 'processing',
      attempts: { increment: 1 },
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      workerId,
      callId,
      completedRunId: terminalRunId(candidate),
      completedAt: now,
      errorMessage: null,
    },
  })
  return claimed.count === 1 ? callId : null
}

async function finishCandidate(input: {
  candidate: CompletionCandidate
  workerId: string
  callId: string
}): Promise<'sent' | 'retried' | 'terminal'> {
  const { candidate, workerId, callId } = input
  const title = candidate.session.title.trim() || '任务'
  const preview = candidate.session.lastMessagePreview?.trim()
  const reason = compactText(candidate.reason, 120) ?? `${title} 已完成`
  const initialPrompt = compactText(candidate.initialPrompt, 800)
    ?? `接通后先告诉用户：${title} 已完成。${preview ? `最新结果是：${preview}` : '请询问用户是否需要继续处理。'}`

  const result = await enqueueVoiceIncomingCallIntent({
    userId: candidate.userId,
    callId,
    reason,
    initialPrompt,
    projectHint: candidate.projectHint ?? undefined,
  })
  const attempt = candidate.attempts + 1

  await prisma.voiceTaskCompletionNotify.updateMany({
    where: { id: candidate.id, status: 'processing', workerId },
    data: {
      status: 'sent',
      callId,
      leaseUntil: null,
      workerId: null,
      availableAt: new Date(),
      errorMessage: null,
    },
  })

  void writeLog({
    traceId: candidate.id.slice(0, 32),
    userId: candidate.userId,
    sessionId: candidate.sessionId,
    source: 'server',
    type: 'internal',
    level: 'info',
    path: 'voice.task_completion_notify',
    metadata: {
      status: 'sent',
      deliveryStatus: result.status,
      platform: null,
      callId,
      runId: terminalRunId(candidate),
      attempt,
    },
  })

  return 'sent'
}

async function runDrain(limit: number, workerId: string, sessionId?: string): Promise<VoiceTaskCompletionDrainResult> {
  const summary: VoiceTaskCompletionDrainResult = { claimed: 0, sent: 0, retried: 0, terminal: 0 }
  const now = new Date()
  const candidates = await prisma.voiceTaskCompletionNotify.findMany({
    where: {
      ...(sessionId ? { sessionId } : {}),
      mode: 'call',
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ],
      session: {
        status: { in: ['completed', 'failed'] },
        deletedAt: null,
        agentIdentityId: null,
        roomBinding: { is: null },
        roomNativeSources: { none: { sourceMode: 'room_hook' } },
      },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      userId: true,
      sessionId: true,
      reason: true,
      initialPrompt: true,
      projectHint: true,
      callId: true,
      attempts: true,
      session: {
        select: {
          status: true,
          title: true,
          lastMessagePreview: true,
          bodyRevision: true,
          lastAttentionId: true,
        },
      },
    },
  })

  for (const candidate of candidates) {
    const callId = await claimCandidate(candidate, workerId, now)
    if (!callId) continue
    summary.claimed += 1
    try {
      const outcome = await finishCandidate({ candidate, workerId, callId })
      summary[outcome] += 1
    } catch (error) {
      const attempt = candidate.attempts + 1
      const exhausted = attempt >= MAX_ATTEMPTS
      await prisma.voiceTaskCompletionNotify.updateMany({
        where: { id: candidate.id, status: 'processing', workerId },
        data: {
          status: exhausted ? 'failed' : 'pending',
          leaseUntil: null,
          workerId: null,
          availableAt: exhausted ? new Date() : new Date(Date.now() + retryDelayMs(attempt)),
          errorMessage: compactText(error instanceof Error ? error.message : String(error), 2000),
        },
      })
      summary[exhausted ? 'terminal' : 'retried'] += 1
    }
  }
  return summary
}

export function processPendingVoiceTaskCompletionNotifies(options: {
  limit?: number
  workerId?: string
  sessionId?: string
} = {}): Promise<VoiceTaskCompletionDrainResult> {
  if (activeDrain) return activeDrain
  activeDrain = runDrain(
    options.limit ?? DEFAULT_BATCH_SIZE,
    options.workerId ?? `voice-completion-${randomUUID()}`,
    options.sessionId,
  ).finally(() => { activeDrain = null })
  return activeDrain
}

/** Compatibility entry point; production delivery is owned by the Worker polling job. */
export async function triggerVoiceTaskCompletionNotify(input: {
  sessionId: string
  runId: string
}): Promise<{ status: 'none' | 'ringing' | 'unavailable' | 'failed' }> {
  const result = await processPendingVoiceTaskCompletionNotifies({ sessionId: input.sessionId, limit: 1 })
  if (!result.claimed) return { status: 'none' }
  if (result.sent) return { status: 'ringing' }
  return result.terminal ? { status: 'failed' } : { status: 'unavailable' }
}
