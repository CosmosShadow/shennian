// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-cloud-history.test.ts
import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { SESSION_HISTORY_LIMITS, SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION, type SessionHistorySyncParams } from '@shennian/wire'
import { cloudPersonalHistoryEnabled, readPersonalCloudHistory } from '../services/personal-cloud-history.js'
export function registerPersonalCloudHistoryRoute(app: FastifyInstance, preHandler: preHandlerHookHandler[]) {
  app.post<{ Params: { id: string }; Body: Omit<SessionHistorySyncParams, 'sessionId'> }>('/:id/cloud-history/sync', {
    preHandler, bodyLimit: 4096,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 191 } } },
      body: { type: 'object', additionalProperties: false,
        required: ['protocolVersion', 'dataEpoch', 'daemonInstallationId', 'syncId', 'afterRevision'],
        properties: {
          protocolVersion: { const: SESSION_SYNC_PROTOCOL_VERSION }, dataEpoch: { const: SESSION_SYNC_DATA_EPOCH },
          daemonInstallationId: { type: 'string', minLength: 1, maxLength: 191 },
          syncId: { type: 'string', minLength: 1, maxLength: 191 },
          afterRevision: { type: 'integer', minimum: 0, maximum: 2147483647 },
          limit: { type: 'integer', minimum: 1, maximum: SESSION_HISTORY_LIMITS.maxDeltaMutations },
        },
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!cloudPersonalHistoryEnabled()) return reply.code(501).send({ error: 'cloud_history_disabled' })
    try {
      return await readPersonalCloudHistory(request.userId, { ...request.body, sessionId: request.params.id })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'cloud_history_not_found') return reply.code(404).send({ error: code })
      if (code === 'cloud_history_behind') return reply.code(409).send({ error: code })
      if (code === 'cloud_history_pending') return reply.code(503).send({ error: code })
      // Never serialize database errors or any part of a message payload.
      return reply.code(503).send({ error: 'cloud_history_unavailable' })
    }
  })
}
