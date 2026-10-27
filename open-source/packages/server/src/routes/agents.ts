// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts
// @test src/__tests__/agent-routes.test.ts

import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireAuth,
} from '../middleware/auth.js'
import {
  AgentWorkspaceError,
  createAgentWorkspace,
  createAgentWorkspaceSession,
  deleteAgentWorkspace,
  getAgentWorkspace,
  listAgentWorkspaces,
  updateAgentWorkspace,
} from '../services/agent-workspaces.js'
import { removeAgentAvatar, updateAgentAvatar } from '../services/agent-avatar.js'
import { UserAvatarError } from '../services/user-avatar.js'
import { requirePersonalSyncHttpEpoch } from '../middleware/personal-sync-http.js'
import {
  AgentVoiceConfigurationError,
  configureAgentDraftFromVoice,
} from '../services/agent-voice-configuration.js'
import { isDiagnosticUserId } from '../services/log-policy.js'
import { requestAgentRoomRecovery } from '../services/agent-room-recovery.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { broadcastRoomIdentityUpdated } from '../services/room-events.js'

function mapError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AgentWorkspaceError)) throw error
  const status = error.code === 'invalid' ? 400 : error.code === 'forbidden' ? 403 : 404
  return reply.code(status).send({ error: error.message, code: error.code })
}

export async function agentRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  )
  const userAuth = {
    preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess],
  }
  app.get('/', userAuth, async (request) => ({
    agents: await listAgentWorkspaces(request.userId),
  }))
  app.post<{ Body: Record<string, unknown> }>(
    '/configure-draft',
    userAuth,
    async (request, reply) => {
      const startedAt = Date.now()
      try {
        const result = await configureAgentDraftFromVoice(request.body ?? {})
        if (isDiagnosticUserId(request.userId)) {
          request.log.info(
            {
              userId: request.userId,
              transcriptLength: result.transcript.length,
              changedFields: result.changedFields,
              model: result.model,
              durationMs: Date.now() - startedAt,
            },
            'agent voice draft configured',
          )
        }
        return result
      } catch (error) {
        if (!(error instanceof AgentVoiceConfigurationError)) throw error
        request.log.warn(
          {
            userId: request.userId,
            code: error.code,
            durationMs: Date.now() - startedAt,
          },
          'agent voice draft configuration failed',
        )
        return reply
          .code(error.code === 'invalid' ? 400 : 502)
          .send({ error: error.message, code: error.code })
      }
    },
  )
  app.post<{ Body: Record<string, unknown> }>('/', userAuth, async (request, reply) => {
    try {
      return {
        agent: await createAgentWorkspace(request.userId, request.body ?? {}),
      }
    } catch (error) {
      return mapError(reply, error)
    }
  })
  app.get<{ Params: { agentId: string } }>('/:agentId', userAuth, async (request, reply) => {
    try {
      return {
        agent: await getAgentWorkspace(request.userId, request.params.agentId),
      }
    } catch (error) {
      return mapError(reply, error)
    }
  })
  app.patch<{ Params: { agentId: string }; Body: Record<string, unknown> }>(
    '/:agentId',
    userAuth,
    async (request, reply) => {
      try {
        return {
          agent: await updateAgentWorkspace(
            request.userId,
            request.params.agentId,
            request.body ?? {},
          ),
        }
      } catch (error) {
        return mapError(reply, error)
      }
    },
  )
  app.put<{ Params: { agentId: string }; Body: Buffer }>(
    '/:agentId/avatar',
    userAuth,
    async (request, reply) => {
      try {
        const result = await updateAgentAvatar({
          userId: request.userId,
          agentId: request.params.agentId,
          contentType: request.headers['content-type'],
          buffer: request.body,
        })
        await broadcastRoomIdentityUpdated({ agentIdentityId: request.params.agentId })
        return { avatar: result.avatar }
      } catch (error) {
        if (!(error instanceof UserAvatarError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )
  app.delete<{ Params: { agentId: string } }>('/:agentId', userAuth, async (request, reply) => {
    try {
      return await deleteAgentWorkspace(request.userId, request.params.agentId)
    } catch (error) {
      return mapError(reply, error)
    }
  })
  app.delete<{ Params: { agentId: string } }>(
    '/:agentId/avatar',
    userAuth,
    async (request, reply) => {
      try {
        await removeAgentAvatar(request.userId, request.params.agentId)
        await broadcastRoomIdentityUpdated({ agentIdentityId: request.params.agentId })
        return { avatar: null }
      } catch (error) {
        if (!(error instanceof UserAvatarError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )
  app.post<{ Params: { agentId: string }; Body: Record<string, unknown> }>(
    '/:agentId/sessions',
    { preHandler: [...userAuth.preHandler, requirePersonalSyncHttpEpoch] },
    async (request, reply) => {
      try {
        return {
          session: await createAgentWorkspaceSession(
            request.userId,
            request.params.agentId,
            request.body ?? {},
          ),
        }
      } catch (error) {
        return mapError(reply, error)
      }
    },
  )
  app.post<{ Params: { agentId: string } }>(
    '/:agentId/recover',
    userAuth,
    async (request, reply) => {
      try {
        await getAgentWorkspace(request.userId, request.params.agentId)
        await requestAgentRoomRecovery(request.params.agentId, request.userId)
        return {
          agent: await getAgentWorkspace(request.userId, request.params.agentId),
        }
      } catch (error) {
        return mapError(reply, error)
      }
    },
  )
}
