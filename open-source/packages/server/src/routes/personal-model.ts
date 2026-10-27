import { readPersonalModelQuota } from '../services/personal-model-quota.js'
import { builtinPersonalAgentEnabled } from '../services/personal-model-feature.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-model-gateway.test.ts
import type { FastifyInstance } from 'fastify'
import { registerAuthDecorators } from '../middleware/auth.js'
import { requireMachineOrUserAuth } from '../services/agent-proxy.js'
import { issueModelCredential, requireModelCredential, revokeModelCredential, OFFICIAL_PERSONAL_MODEL } from '../services/personal-model-credentials.js'
import { streamPersonalModel } from '../services/personal-model-gateway.js'
export async function personalModelRoutes(app: FastifyInstance) {
  if (!builtinPersonalAgentEnabled()) return
  registerAuthDecorators(app)
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store') })
  app.get('/quota', { preHandler: requireMachineOrUserAuth }, async request => readPersonalModelQuota(request.userId))
  app.post('/credential', { preHandler: requireMachineOrUserAuth, bodyLimit: 1000 }, issueModelCredential)
  app.delete('/credential', { preHandler: requireModelCredential }, revokeModelCredential)
  app.get('/v1/models', { preHandler: requireModelCredential }, async () => ({ object: 'list', data: [{ id: OFFICIAL_PERSONAL_MODEL, object: 'model', owned_by: 'shennian' }] }))
  app.post('/v1/chat/completions', { preHandler: requireModelCredential, bodyLimit: 8 * 1024 * 1024 }, streamPersonalModel)
}

/** Edge strips /api; retain the direct-server alias like the other personal routes. */
export async function registerPersonalModelRoutes(app: FastifyInstance) {
  await app.register(personalModelRoutes, { prefix: '/personal-model' })
  await app.register(personalModelRoutes, { prefix: '/api/personal-model' })
}
