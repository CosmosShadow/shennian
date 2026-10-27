// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-title-generator.test.ts

import { PLATFORM_TEXT_MODEL, platformTextBaseUrl } from './platform-model.js'

import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  sanitizeSessionPreview,
  type SessionTitleGenerateParams,
  type SessionTitleGenerateResponse,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { broadcastSessionUpdate } from './sessions.js'
import { rejectSessionSync } from './session-sync-rejection.js'

const MAX_SEED_LENGTH = 240
const MAX_TITLE_LENGTH = 30
const TITLE_GRACE_MS = 2 * 60_000
const pending = new Set<string>()

type GeneratorOptions = {
  fetchImpl?: typeof fetch
  now?: Date
  apiKey?: string
}

function validateParams(params: SessionTitleGenerateParams): void {
  if (!params || typeof params !== 'object') throw new Error('invalid title generation request')
  if (params.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION) {
    rejectSessionSync('upgrade_required', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (params.dataEpoch !== SESSION_SYNC_DATA_EPOCH) {
    rejectSessionSync('epoch_mismatch', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (!params.daemonInstallationId || params.daemonInstallationId.length > 191) {
    rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (!params.sessionId || params.sessionId.length > 191
    || !params.requestId || params.requestId.length > 100
    || !Number.isSafeInteger(params.baseTitleRevision) || params.baseTitleRevision < 0
    || !['agent_native_unavailable', 'terminal', 'grace_elapsed'].includes(params.eligibility)) {
    throw new Error('invalid title generation request')
  }
  if (typeof params.titleSeed !== 'string' || params.titleSeed.length > MAX_SEED_LENGTH
    || sanitizeSessionPreview(params.titleSeed, MAX_SEED_LENGTH) !== params.titleSeed) {
    throw new Error('unsafe titleSeed')
  }
}

function isEligible(
  session: {
    agentType: string
    status: string
    createdAt: Date
    titleSource: string
    titleRevision: number
    titleLockedByUser: boolean
  },
  params: SessionTitleGenerateParams,
  now: Date,
): boolean {
  if (session.titleSource !== 'first_user_fallback' || session.titleLockedByUser
    || session.titleRevision !== params.baseTitleRevision) return false
  if (params.eligibility === 'agent_native_unavailable') return session.agentType === 'claude'
  if (params.eligibility === 'terminal') {
    return session.status === 'completed' || session.status === 'failed'
  }
  return now.getTime() - session.createdAt.getTime() >= TITLE_GRACE_MS
}

function cleanGeneratedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value
    .replace(/^\s*["'「『]|["'」』]\s*$/g, '')
    .replace(/[。！？.!?，,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
  if (!title || sanitizeSessionPreview(title, MAX_TITLE_LENGTH) !== title) return null
  return title
}

async function callGenerator(
  titleSeed: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${platformTextBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PLATFORM_TEXT_MODEL,
        enable_thinking: false,
        messages: [{
          role: 'user',
          content: `根据下面这条受限主题 seed 生成简洁对话标题。保持原语言，不超过${MAX_TITLE_LENGTH}个字；只输出标题，不加引号或解释。\n\nseed：${titleSeed}`,
        }],
        max_tokens: 60,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
    return cleanGeneratedTitle(data.choices?.[0]?.message?.content)
  } catch {
    return null
  }
}

export async function generateSessionTitleFromSeed(
  machineId: string,
  ownerId: string,
  params: SessionTitleGenerateParams,
  options: GeneratorOptions = {},
): Promise<SessionTitleGenerateResponse> {
  validateParams(params)
  const requestKey = `${machineId}:${params.requestId}`
  if (pending.has(requestKey)) return { generated: false, reason: 'superseded' }
  pending.add(requestKey)
  try {
    const session = await prisma.nianSession.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        machineId: true,
        userId: true,
        agentType: true,
        status: true,
        createdAt: true,
        titleSource: true,
        titleRevision: true,
        titleLockedByUser: true,
        dataEpoch: true,
        deletedAt: true,
        machine: { select: { daemonInstallationId: true } },
      },
    })
    if (!session || session.machineId !== machineId || session.userId !== ownerId || session.deletedAt) {
      return { generated: false, reason: 'not_eligible' }
    }
    if (session.dataEpoch !== SESSION_SYNC_DATA_EPOCH
      || session.machine.daemonInstallationId !== params.daemonInstallationId) {
      rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
    }
    const now = options.now ?? new Date()
    if (!isEligible(session, params, now)) return { generated: false, reason: 'superseded' }
    const apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY
    if (!apiKey) return { generated: false, reason: 'generator_unavailable' }

    const title = await callGenerator(params.titleSeed, apiKey, options.fetchImpl ?? fetch)
    if (!title) return { generated: false, reason: 'generation_failed' }
    const titleRevision = session.titleRevision + 1
    const titleOriginEventId = `shennian-generated:${params.requestId}`
    const updated = await prisma.nianSession.updateMany({
      where: {
        id: session.id,
        machineId,
        userId: ownerId,
        deletedAt: null,
        titleSource: 'first_user_fallback',
        titleRevision: params.baseTitleRevision,
        titleLockedByUser: false,
      },
      data: {
        title,
        titleSource: 'shennian_generated',
        titleRevision,
        titleLockedByUser: false,
        titleOriginEventId,
      },
    })
    if (updated.count !== 1) return { generated: false, reason: 'superseded' }
    broadcastSessionUpdate(machineId, ownerId, {
      id: session.id,
      updatedAt: now,
      title,
      titleSource: 'shennian_generated',
      titleRevision,
      titleLockedByUser: false,
      titleOriginEventId,
    })
    return {
      generated: true,
      title,
      titleSource: 'shennian_generated',
      titleRevision,
      titleOriginEventId,
    }
  } finally {
    pending.delete(requestKey)
  }
}
