// @arch open-source/docs/server-runtime.md
// @test src/__tests__/english-cli.test.ts
import type { FastifyInstance } from 'fastify'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { ownedMachine } from '../services/local-apps/gateway.js'
import { englishItems } from '../services/personal-modules/english.js'

/** Read-only account vocabulary; never accepts a user ID or enables recording. */
export async function englishCliRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })
  app.addHook('preHandler', requireUserOrMachineAuth)
  app.addHook('preHandler', requireActivePlan)
  app.addHook('preHandler', requireNonReviewMachineAccess)
  app.addHook('preHandler', async (request, reply) => {
    if (!request.machineId) return reply.code(403).send({ error: 'machine_owner_required' })
    try {
      await ownedMachine(request.userId, request.machineId)
    } catch {
      return reply.code(403).send({ error: 'machine_owner_required' })
    }
  })
  app.get('/progress', async (request, reply) => {
    try {
      const { items } = await englishItems(request.userId)
      const mastered = items.filter((item) => item.state === 'mastered').length
      return {
        source: 'cloud',
        fetchedAt: new Date().toISOString(),
        total: items.length,
        mastered,
        learning: items.length - mastered,
        items,
      }
    } catch {
      return reply.code(503).send({ error: 'english_progress_unavailable' })
    }
  })
}
