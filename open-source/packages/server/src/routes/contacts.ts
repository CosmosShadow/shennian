// @arch open-source/docs/server-runtime.md

import type { FastifyInstance, FastifyReply } from 'fastify'
import { registerAuthDecorators, requireAuth, requireActivePlan } from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { ContactError, listContacts, removeContact, saveContact } from '../services/contacts.js'
import { getAgentContactRequestStatus, requestAgentContact } from '../services/agent-contact-requests.js'

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ContactError)) throw error
  return reply.code(error.code === 'invalid' ? 400
    : error.code === 'not_found' ? 404 : 409)
    .send({ error: `contact_${error.code}` })
}

export async function contactRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const auth = { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] }
  app.get<{ Querystring: { q?: string } }>('/', auth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try { return await listContacts({ ownerUserId: request.userId, query: request.query.q }) }
    catch (error) { return sendError(reply, error) }
  })
  app.post<{ Body: { targetUserId?: unknown; publicAgentId?: unknown } }>(
    '/', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        const contact = await saveContact({
          ownerUserId: request.userId,
          targetUserId: request.body?.targetUserId,
          publicAgentId: request.body?.publicAgentId,
        })
        return reply.code(201).send({ contactId: contact.id })
      } catch (error) { return sendError(reply, error) }
    },
  )
  app.post<{ Body: { publicAgentId?: unknown } }>(
    '/agent-requests', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        const result = await requestAgentContact({ requesterUserId: request.userId,
          publicId: String(request.body?.publicAgentId ?? '') })
        return reply.code(result.outcome === 'pending_approval' ? 202 : 200).send(result)
      } catch (error) { return sendError(reply, error) }
    },
  )
  app.get<{ Params: { publicId: string } }>(
    '/agent-requests/:publicId', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try { return await getAgentContactRequestStatus({ requesterUserId: request.userId,
        publicId: request.params.publicId }) }
      catch (error) { return sendError(reply, error) }
    },
  )
  app.delete<{ Params: { contactId: string } }>(
    '/:contactId', auth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        await removeContact({ ownerUserId: request.userId, contactId: request.params.contactId })
        return { removed: true }
      } catch (error) { return sendError(reply, error) }
    },
  )
}
