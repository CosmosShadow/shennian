// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-incoming-call-intent.test.ts

import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { createVoiceIncomingCall } from './voice-incoming-call.js'

const LEASE_MS = 60_000
const MAX_ATTEMPTS = 5
const DEFAULT_BATCH_SIZE = 20

type IntentCandidate = {
  id: string
  userId: string
  callId: string
  reason: string | null
  initialPrompt: string | null
  projectHint: string | null
  targetPlatform: string | null
  attempts: number
}

export type VoiceIncomingCallIntentContext = {
  callId: string
  reason: string | null
  initialPrompt: string | null
  projectHint: string | null
}

export type VoiceIncomingCallIntentDrainResult = {
  claimed: number
  sent: number
  retried: number
  terminal: number
}

let activeDrain: Promise<VoiceIncomingCallIntentDrainResult> | null = null

function compactText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text) return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 6))
}

export async function enqueueVoiceIncomingCallIntent(input: {
  userId: string
  callId?: string
  reason?: string | null
  initialPrompt?: string | null
  projectHint?: string | null
  targetPlatform?: 'ios' | 'android' | null
}): Promise<{ callId: string; status: 'queued' }> {
  const callId = compactText(input.callId, 191) ?? `call_${randomUUID()}`
  const context = {
    reason: compactText(input.reason, 191),
    initialPrompt: compactText(input.initialPrompt, 1000),
    projectHint: compactText(input.projectHint, 191),
    targetPlatform: input.targetPlatform ?? null,
  }
  await prisma.voiceIncomingCallIntent.upsert({
    where: { userId_callId: { userId: input.userId, callId } },
    create: {
      userId: input.userId,
      callId,
      ...context,
      availableAt: new Date(),
    },
    // Context may be refined by a completion event, but delivery state is never reset.
    update: context,
  })
  return { callId, status: 'queued' }
}

export async function loadVoiceIncomingCallIntentContext(
  userId: string,
  callId: string,
): Promise<VoiceIncomingCallIntentContext | null> {
  const normalizedCallId = compactText(callId, 191)
  if (!normalizedCallId) return null
  return prisma.voiceIncomingCallIntent.findUnique({
    where: { userId_callId: { userId, callId: normalizedCallId } },
    select: { callId: true, reason: true, initialPrompt: true, projectHint: true },
  })
}

async function claimCandidate(candidate: IntentCandidate, workerId: string, now: Date): Promise<boolean> {
  const result = await prisma.voiceIncomingCallIntent.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'pending', availableAt: { lte: now } },
        { status: 'processing', leaseUntil: { lte: now } },
      ],
    },
    data: {
      status: 'processing',
      attempts: { increment: 1 },
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      workerId,
      errorMessage: null,
    },
  })
  return result.count === 1
}

async function finishCandidate(candidate: IntentCandidate, workerId: string): Promise<'sent' | 'retried' | 'terminal'> {
  const result = await createVoiceIncomingCall({
    userId: candidate.userId,
    callId: candidate.callId,
    reason: candidate.reason ?? undefined,
    initialPrompt: candidate.initialPrompt ?? undefined,
    projectHint: candidate.projectHint ?? undefined,
    targetPlatform: candidate.targetPlatform === 'ios' || candidate.targetPlatform === 'android'
      ? candidate.targetPlatform
      : undefined,
  })
  const attempt = candidate.attempts + 1
  const sent = result.status === 'ringing'
  const exhausted = attempt >= MAX_ATTEMPTS
  const status = sent ? 'sent' : exhausted ? result.status : 'pending'
  await prisma.voiceIncomingCallIntent.updateMany({
    where: { id: candidate.id, status: 'processing', workerId },
    data: {
      status,
      leaseUntil: null,
      workerId: null,
      deliveredAt: sent ? new Date() : null,
      availableAt: sent || exhausted ? new Date() : new Date(Date.now() + retryDelayMs(attempt)),
      errorMessage: result.message ?? null,
    },
  })
  return sent ? 'sent' : exhausted ? 'terminal' : 'retried'
}

async function runDrain(limit: number, workerId: string): Promise<VoiceIncomingCallIntentDrainResult> {
  const summary: VoiceIncomingCallIntentDrainResult = { claimed: 0, sent: 0, retried: 0, terminal: 0 }
  const now = new Date()
  const candidates = await prisma.voiceIncomingCallIntent.findMany({
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
      userId: true,
      callId: true,
      reason: true,
      initialPrompt: true,
      projectHint: true,
      targetPlatform: true,
      attempts: true,
    },
  })

  for (const candidate of candidates) {
    if (!await claimCandidate(candidate, workerId, now)) continue
    summary.claimed += 1
    try {
      summary[await finishCandidate(candidate, workerId)] += 1
    } catch (error) {
      const attempt = candidate.attempts + 1
      const exhausted = attempt >= MAX_ATTEMPTS
      await prisma.voiceIncomingCallIntent.updateMany({
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

export function processPendingVoiceIncomingCallIntents(options: {
  limit?: number
  workerId?: string
} = {}): Promise<VoiceIncomingCallIntentDrainResult> {
  if (activeDrain) return activeDrain
  activeDrain = runDrain(
    options.limit ?? DEFAULT_BATCH_SIZE,
    options.workerId ?? `voice-call-${randomUUID()}`,
  ).finally(() => { activeDrain = null })
  return activeDrain
}
