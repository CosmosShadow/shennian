// @arch open-source/docs/server-runtime.md

import type { FastifyInstance, FastifyReply } from 'fastify'
import { registerAuthDecorators, requireAuth, requireActivePlan } from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import {
  AgentDiscoveryError, getPlazaAgent, listPlazaAgents, setPlazaListing,
} from '../services/agent-discovery.js'

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AgentDiscoveryError)) throw error
  return reply.code(error.code === 'invalid' ? 400
    : error.code === 'not_found' ? 404 : 409)
    .send({ error: `agent_discovery_${error.code}` })
}

export async function agentDiscoveryRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const auth = { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] }
  app.get<{ Querystring: { q?: string; limit?: string; cursor?: string } }>(
    '/', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        return await listPlazaAgents({
          query: request.query.q, limit: request.query.limit, cursor: request.query.cursor,
        })
      } catch (error) { return sendError(reply, error) }
    },
  )
  app.get<{ Params: { publicId: string } }>(
    '/:publicId', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try { return { agent: await getPlazaAgent(request.params.publicId) } }
      catch (error) { return sendError(reply, error) }
    },
  )
}

export async function agentDiscoveryOwnerRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const auth = { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] }
  app.put<{
    Params: { agentId: string }
    Body: { listed?: unknown; expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/plaza', auth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      return { listing: await setPlazaListing({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        listed: request.body?.listed,
        expectedGeneration: request.body?.expectedGeneration,
        expectedPolicyVersion: request.body?.expectedPolicyVersion,
      }) }
    } catch (error) { return sendError(reply, error) }
  })
}
