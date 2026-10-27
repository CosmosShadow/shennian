// @arch open-source/docs/server-runtime.md

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { registerAuthDecorators, requireAuth, requireActivePlan } from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { publicWebAppBaseUrl } from '../services/public-web-url.js'
import { getPerson, PeopleError, updateOwnIntroduction } from '../services/people.js'

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof PeopleError)) throw error
  return reply.code(error.code === 'invalid' ? 400 : 404)
    .send({ error: `person_${error.code}` })
}

function identityUrl(request: FastifyRequest, userId: string) {
  return `${publicWebAppBaseUrl(request)}/contacts/users/${encodeURIComponent(userId)}`
}

export async function peopleRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const auth = { preHandler: [requireAuth, requireActivePlan, requireNonReviewMachineAccess] }
  app.get('/me', auth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const person = await getPerson(request.userId, request.userId)
    const shareUrl = identityUrl(request, request.userId)
    return { person, shareUrl, qrPayload: shareUrl }
  })
  app.patch<{ Body: { description?: unknown } }>('/me', auth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      const person = await updateOwnIntroduction(request.userId, request.body?.description)
      const shareUrl = identityUrl(request, request.userId)
      return { person, shareUrl, qrPayload: shareUrl }
    } catch (error) { return sendError(reply, error) }
  })
  app.get<{ Params: { userId: string } }>('/:userId', auth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      const person = await getPerson(request.params.userId, request.userId)
      const shareUrl = identityUrl(request, person.userId)
      return { person, shareUrl, qrPayload: shareUrl }
    } catch (error) { return sendError(reply, error) }
  })
}
