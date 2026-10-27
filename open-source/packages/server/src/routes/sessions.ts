import { registerPersonalCloudHistoryRoute } from './personal-cloud-history.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sessions-messages.test.ts

import type { FastifyInstance } from 'fastify'
import {
  SESSION_SYNC_DATA_EPOCH,
  type NativeCleanupPolicy,
  type SessionReadWatermark,
  type SessionScope,
  type SessionSyncRejection,
} from '@shennian/wire'
import { registerAuthDecorators, requireActivePlan, requireAuth } from '../middleware/auth.js'
import {
  createSessionForUser,
  deleteSessionForUser,
  getUserSessionIndex,
  listMachineSessions,
  listStewardSessions,
  listUserSessionActivities,
  listUserSessions,
  renameSessionForUser,
  updateSessionUserState,
} from '../services/sessions.js'
import { requirePersonalSyncHttpEpoch } from '../middleware/personal-sync-http.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'

function mapSessionError(
  reply: {
    code: (statusCode: number) => {
      send: (payload: { error: string; rejection?: SessionSyncRejection }) => unknown
    }
  },
  error: Error,
) {
  if (error.message === 'Machine not found' || error.message === 'Session not found') {
    return reply.code(404).send({ error: error.message })
  }
  if (error.message === 'Steward session must be a standard personal session') {
    return reply.code(400).send({ error: error.message })
  }
  if (error.message === 'Not authorized') {
    return reply.code(403).send({ error: error.message })
  }
  if (error.message === 'Enterprise entitlement required') {
    return reply.code(403).send({ error: error.message })
  }
  if (error.message === 'Agent model follow is unavailable') {
    return reply.code(400).send({ error: error.message })
  }
  if (error.message === 'Manager mode is unavailable for this Agent') {
    return reply.code(400).send({ error: error.message })
  }
  if (error.message === 'machine_offline') {
    return reply.code(503).send({
      error: 'machine_offline',
      rejection: {
        code: 'machine_offline',
        retryable: true,
        requiredAction: 'retry',
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      },
    })
  }
  if (error.message === 'upgrade_required') {
    return reply.code(426).send({
      error: 'upgrade_required',
      rejection: {
        code: 'upgrade_required',
        retryable: false,
        requiredAction: 'upgrade_client',
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      },
    })
  }
  throw error
}

export async function sessionRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineUserAuth = [requireAuth, requireActivePlan, requireNonReviewMachineAccess]

  // Old OTA bundles share the native shell build, so headers are the gate.
  app.addHook('preHandler', requirePersonalSyncHttpEpoch)
  registerPersonalCloudHistoryRoute(app, machineUserAuth)

  for (const url of ['/', '/local/:localId']) app.post<{
    Params: { localId?: string }
    Body: {
      title?: string
      machineId: string
      agentType: string
      sessionMode?: 'standard' | 'manager'
      sessionScope?: SessionScope
      managerConfig?: {
        defaultWorkerAgentType?: string | null
        defaultWorkerModelId?: string | null
      } | null
      workDir: string
      modelId?: string
      managerDefaultWorkerAgentType?: string | null
      managerDefaultWorkerModelId?: string | null
    }
  }>(url, { preHandler: machineUserAuth }, async (request, reply) => {
    const localId = request.params.localId
    if (localId && !/^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localId)) {
      return reply.code(400).send({ error: 'Invalid local session ID' })
    }
    if (request.body.title !== undefined && (typeof request.body.title !== 'string' || request.body.title.length > 500)) {
      return reply.code(400).send({ error: 'Invalid session title' })
    }
    const {
      machineId,
      agentType,
      sessionMode,
      sessionScope,
      managerConfig,
      workDir,
      modelId,
      managerDefaultWorkerAgentType,
      managerDefaultWorkerModelId,
    } = request.body
    if (!machineId || !agentType) {
      return reply.code(400).send({ error: 'machineId and agentType are required' })
    }
    if (sessionScope !== undefined && sessionScope !== 'personal' && sessionScope !== 'steward') {
      return reply.code(400).send({ error: 'Invalid session scope' })
    }
    if (sessionScope === 'steward' && !localId) {
      return reply.code(400).send({ error: 'Steward sessions require a local session ID' })
    }
    if (agentType === 'pi') {
      return reply.code(410).send({
        error: 'feature_retired',
        message:
          'The built-in Nian agent has been retired. Choose an Agent installed on the target machine.',
      })
    }

    try {
      const session = await createSessionForUser({
        id: localId,
        title: localId ? request.body.title : undefined,
        creationKey: localId ? `local:${request.userId}:${localId}` : undefined,
        machineId,
        userId: request.userId,
        agentType,
        sessionMode,
        sessionScope,
        managerConfig,
        workDir,
        modelId,
        managerDefaultWorkerAgentType,
        managerDefaultWorkerModelId,
      })

      return {
        session: {
          id: session.id,
          machineId: session.machineId,
          machineName: session.machineName ?? null,
          userId: session.userId,
          agentType: session.agentType,
          sessionMode: session.agentType === 'manager' ? 'manager' : session.sessionMode,
          sessionScope: session.sessionScope === 'steward' ? 'steward' : 'personal',
          managerConfig: session.managerConfig,
          agentSessionId: session.agentSessionId,
          sourceMode: null,
          modelId: session.modelId,
          managerDefaultWorkerAgentType: session.managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId: session.managerDefaultWorkerModelId,
          title: session.title,
          status: session.status,
          workDir: session.workDir ?? '',
          lastActivityAt: session.lastActivityAt.toISOString(),
          bodyStorageMode: 'machine_local',
          localReady: session.localReadyAt != null,
          bodyRevision: session.bodyRevision ?? 0,
          indexRevision: session.indexRevision ?? 0,
          firstAvailableSeq: session.firstAvailableSeq ?? null,
          visibleMessageCount: session.visibleMessageCount ?? 0,
          lastVisibleMessageId: session.lastVisibleMessageId ?? null,
          attentionCount: session.attentionCount ?? 0,
          lastAttentionId: session.lastAttentionId ?? null,
          lastBodyCommittedAt: session.lastBodyCommittedAt?.toISOString() ?? null,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
          deletedAt: session.deletedAt?.toISOString() ?? null,
          ownerName: null,
          ownerPhone: null,
          ownerEmail: null,
          canManage: true,
          sharedMachineSession: false,
          userState: {
            userId: request.userId,
            sessionId: session.id,
            pinnedAt: null,
            lastReadAt: null,
            lastReadBodyRevision: 0,
            lastReadVisibleMessageCount: 0,
            lastReadVisibleMessageId: null,
            lastReadAttentionCount: 0,
            lastReadAttentionId: null,
            manualUnread: false,
            updatedAt: session.updatedAt.toISOString(),
          },
          activity: null,
        },
      }
    } catch (error) {
      return mapSessionError(reply, error as Error)
    }
  })

  app.get<{
    Querystring: { limit?: string; before?: string; updatedAfter?: string }
  }>('/', { preHandler: machineUserAuth }, async (request) => {
    const limit = Math.min(Number(request.query.limit) || 20, 100)
    const before = request.query.before ? new Date(Number(request.query.before)) : undefined
    const updatedAfter = request.query.updatedAfter
      ? new Date(Number(request.query.updatedAfter))
      : undefined

    return {
      sessions: await listUserSessions({
        userId: request.userId,
        limit,
        before,
        updatedAfter,
      }),
    }
  })

  app.get<{
    Querystring: { machineId?: string; limit?: string; before?: string }
  }>('/steward', { preHandler: machineUserAuth }, async (request) => {
    const limit = Math.min(Number(request.query.limit) || 20, 100)
    const before = request.query.before ? new Date(Number(request.query.before)) : undefined
    return {
      sessions: await listStewardSessions({
        userId: request.userId,
        machineId: request.query.machineId || undefined,
        limit,
        before,
      }),
    }
  })

  app.get('/activities', { preHandler: machineUserAuth }, async (request) => {
    return {
      activities: await listUserSessionActivities(request.userId),
    }
  })

  app.get<{
    Params: { sessionId: string }
  }>('/index/:sessionId', { preHandler: machineUserAuth }, async (request, reply) => {
    const session = await getUserSessionIndex(request.params.sessionId, request.userId)
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    return { session }
  })

  app.get<{
    Params: { machineId: string }
    Querystring: { limit?: string; before?: string }
  }>('/:machineId', { preHandler: machineUserAuth }, async (request, reply) => {
    const limit = Math.min(Number(request.query.limit) || 20, 100)
    const before = request.query.before ? new Date(Number(request.query.before)) : undefined

    try {
      return {
        sessions: await listMachineSessions({
          machineId: request.params.machineId,
          userId: request.userId,
          limit,
          before,
        }),
      }
    } catch (error) {
      return mapSessionError(reply, error as Error)
    }
  })

  app.delete<{
    Params: { id: string }
    Body: { nativeCleanupPolicy?: NativeCleanupPolicy }
  }>('/:id', { preHandler: machineUserAuth }, async (request, reply) => {
    try {
      const nativeCleanupPolicy = request.body?.nativeCleanupPolicy ?? 'none'
      if (nativeCleanupPolicy !== 'none' && nativeCleanupPolicy !== 'auto') {
        return reply.code(400).send({ error: 'invalid nativeCleanupPolicy' })
      }
      const result = await deleteSessionForUser(request.params.id, request.userId, {
        nativeCleanupPolicy,
      })
      return { ok: true, ...result }
    } catch (error) {
      return mapSessionError(reply, error as Error)
    }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      title?: string
      modelId?: string | null
      modelSource?: 'agent' | 'session'
      agentType?: string
      managerDefaultWorkerAgentType?: string | null
      managerDefaultWorkerModelId?: string | null
    }
  }>('/:id', { preHandler: machineUserAuth }, async (request, reply) => {
    const {
      title,
      modelId,
      modelSource,
      agentType,
      managerDefaultWorkerAgentType,
      managerDefaultWorkerModelId,
    } = request.body
    if (
      !title?.trim() &&
      modelId === undefined &&
      modelSource === undefined &&
      agentType === undefined &&
      managerDefaultWorkerAgentType === undefined &&
      managerDefaultWorkerModelId === undefined
    ) {
      return reply
        .code(400)
        .send({ error: 'title, modelId, agentType or manager worker defaults are required' })
    }

    try {
      await renameSessionForUser({
        sessionId: request.params.id,
        userId: request.userId,
        title,
        modelId,
        modelSource,
        agentType,
        managerDefaultWorkerAgentType,
        managerDefaultWorkerModelId,
      })
      return { ok: true }
    } catch (error) {
      return mapSessionError(reply, error as Error)
    }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      pinned?: boolean
      manualUnread?: boolean
      lastReadAt?: string | null
      readWatermark?: SessionReadWatermark
    }
  }>(
    '/:id/user-state',
    { preHandler: machineUserAuth },
    async (request, reply) => {
      const { pinned, manualUnread, lastReadAt, readWatermark } = request.body
      if (pinned === undefined && manualUnread === undefined && lastReadAt === undefined) {
        return reply.code(400).send({ error: 'pinned, manualUnread or lastReadAt is required' })
      }

      try {
        const userState = await updateSessionUserState({
          sessionId: request.params.id,
          userId: request.userId,
          pinned,
          manualUnread,
          readWatermark,
          lastReadAt:
            lastReadAt === undefined
              ? undefined
              : lastReadAt === null
                ? null
                : new Date(lastReadAt),
        })
        return { ok: true, userState }
      } catch (error) {
        return mapSessionError(reply, error as Error)
      }
    },
  )
}
