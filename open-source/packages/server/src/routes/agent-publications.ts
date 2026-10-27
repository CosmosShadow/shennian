import { readOwnerDirectUnread } from '../services/agent-direct-unread.js'
// @arch open-source/docs/server-runtime.md

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isIP } from 'node:net'
import { prisma } from '../lib/prisma.js'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireAuth,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'
import { verifyPhoneIdentity, AuthRouteError } from '../services/auth-session.js'
import { offerScopedNicknameSetup } from '../services/nickname-setup.js'
import { trustedRoomBrowserRequest } from '../services/room-browser-identity.js'
import {
  AgentPublicationBrowserError,
  authenticateAgentPublicationBrowser,
  createAgentPublicationBrowserSession,
  createAnonymousAgentPublicationBrowserSession,
  revokeAgentPublicationBrowserSession,
  serializeAgentPublicationBrowserCookie,
} from '../services/agent-publication-browser-session.js'
import { consumeAnonymousAgentRateLimit } from '../services/anonymous-agent-rate-limit.js'
import { initDirectAttachment, completeDirectAttachment,
  downloadDirectAttachmentForVisitor, downloadDirectAttachmentForParticipant } from '../services/agent-direct-attachments.js'
import {
  AgentPublicationError,
  activateAgentPublication,
  createAgentPublicationDraft,
  getOwnedAgentPublication,
  getOwnedAgentPublicationReadiness,
  getPublicAgentPublication,
  pauseAgentPublication,
  revokeAgentPublication,
  updateAgentPublicationDetails,
  setAgentCardContactAdding,
  setAgentCardContactApproval,
  setAgentPublicationAnonymousAccess,
} from '../services/agent-publications.js'
import { ContactError } from '../services/contacts.js'
import { getAgentContactRequestStatus, listAgentContactRequests,
  requestAgentContact, reviewAgentContactRequest } from '../services/agent-contact-requests.js'
import {
  AgentDirectConversationError,
  enqueueVisitorAgentMessage,
  listOwnedAgentDirectConversations,
  listVisitorAgentDirectConversations,
  readAgentDirectConversationById,
  readVisitorAgentConversationByAgent,
  readVisitorAgentConversation,
  resumeVisitorAgentConversation,
} from '../services/agent-direct-conversations.js'
import { listOwnerAgentDirectConversations, sendOwnerAgentDirectMessage } from '../services/agent-direct-owner.js'

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AgentPublicationError)) throw error
  const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400
  return reply.code(status).send({ error: `agent_publication_${error.code}` })
}

function privateBrowserHeaders(reply: FastifyReply) {
  reply.header('cache-control', 'no-store, max-age=0')
  reply.header('pragma', 'no-cache')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('x-robots-tag', 'noindex, nofollow, noarchive')
  reply.header('vary', 'Cookie')
}

// Nginx appends its observed peer to X-Forwarded-For. Fastify's request.ip
// trusts the leftmost value, which an internet client can prepend itself.
function anonymousRateLimitIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  const lastHop = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined
  return lastHop && isIP(lastHop) ? lastHop : request.raw.socket.remoteAddress ?? request.ip
}

function sendBrowserError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AgentPublicationBrowserError)) throw error
  return reply.code(error.code === 'origin_forbidden' ? 403
    : error.code === 'not_found' ? 404 : 401)
    .send({ error: `agent_publication_browser_${error.code}` })
}

async function requirePublishedAgentAuth(request: FastifyRequest, reply: FastifyReply) {
  await requireUserOrMachineAuth(request, reply)
  if (reply.sent || !request.machineId) return
  const machine = await prisma.machine.findFirst({
    where: { id: request.machineId, userId: request.userId, paired: true },
    select: { id: true },
  })
  if (!machine) return reply.code(401).send({ error: 'machine_unavailable' })
}

export async function agentPublicationOwnerRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const ownerAuth = {
    preHandler: [requirePublishedAgentAuth, requireActivePlan, requireNonReviewMachineAccess],
  }
  app.get<{ Params: { agentId: string } }>(
    '/:agentId/publication', ownerAuth, async (request, reply) => {
      try {
        return {
          publication: await getOwnedAgentPublication(request.userId, request.params.agentId),
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
  app.put<{
    Params: { agentId: string }
    Body: { allowed?: unknown; expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/contact-adding', ownerAuth, async (request, reply) => {
    try {
      return { publication: await setAgentCardContactAdding({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        allowed: request.body?.allowed,
        expectedGeneration: request.body?.expectedGeneration,
        expectedPolicyVersion: request.body?.expectedPolicyVersion,
      }) }
    } catch (error) { return sendError(reply, error) }
  })
  app.put<{
    Params: { agentId: string }
    Body: { required?: unknown; expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/contact-approval', ownerAuth, async (request, reply) => {
    try { return { publication: await setAgentCardContactApproval({
      ownerUserId: request.userId, agentIdentityId: request.params.agentId,
      required: request.body?.required, expectedGeneration: request.body?.expectedGeneration,
      expectedPolicyVersion: request.body?.expectedPolicyVersion,
    }) } } catch (error) { return sendError(reply, error) }
  })
  app.put<{
    Params: { agentId: string }
    Body: { allowed?: unknown; expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/anonymous-access', ownerAuth, async (request, reply) => {
    try { return { publication: await setAgentPublicationAnonymousAccess({
      ownerUserId: request.userId, agentIdentityId: request.params.agentId,
      allowed: request.body?.allowed, expectedGeneration: request.body?.expectedGeneration,
      expectedPolicyVersion: request.body?.expectedPolicyVersion,
    }) } } catch (error) { return sendError(reply, error) }
  })
  app.get<{ Params: { agentId: string } }>(
    '/:agentId/publication/contact-requests', ownerAuth, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try { return { requests: await listAgentContactRequests({ ownerUserId: request.userId,
        agentIdentityId: request.params.agentId }) } }
      catch (error) {
        if (error instanceof ContactError) return reply.code(error.code === 'not_found' ? 404 : 400)
          .send({ error: `contact_${error.code}` })
        throw error
      }
    },
  )
  app.post<{
    Params: { agentId: string; requestId: string }
    Body: { approved?: unknown }
  }>('/:agentId/publication/contact-requests/:requestId/review', ownerAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try { return await reviewAgentContactRequest({ ownerUserId: request.userId,
      agentIdentityId: request.params.agentId, requestId: request.params.requestId,
      approved: request.body?.approved }) }
    catch (error) {
      if (error instanceof ContactError) return reply.code(error.code === 'invalid' ? 400
        : error.code === 'not_found' ? 404 : 409).send({ error: `contact_${error.code}` })
      throw error
    }
  })
  app.get<{ Params: { agentId: string } }>(
    '/:agentId/publication/readiness', ownerAuth, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try {
        return { readiness: await getOwnedAgentPublicationReadiness(
          request.userId, request.params.agentId) }
      } catch (error) { return sendError(reply, error) }
    },
  )
  app.post<{
    Params: { agentId: string }
    Body: { displayName?: unknown; description?: unknown; suggestedQuestions?: unknown; dailyMessageLimit?: unknown }
  }>('/:agentId/publication/draft', ownerAuth, async (request, reply) => {
    try {
      const publication = await createAgentPublicationDraft({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        displayName: request.body?.displayName,
        description: request.body?.description,
        suggestedQuestions: request.body?.suggestedQuestions,
        dailyMessageLimit: request.body?.dailyMessageLimit,
      })
      return reply.code(201).send({ publication })
    } catch (error) {
      return sendError(reply, error)
    }
  })
  app.get<{
    Params: { agentId: string }
    Querystring: { cursor?: string }
  }>('/:agentId/publication/conversations', ownerAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await listOwnedAgentDirectConversations({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        cursor: request.query.cursor,
      })
    } catch (error) {
      if (!(error instanceof AgentDirectConversationError)) throw error
      return reply.code(error.code === 'invalid' ? 400 : 404)
        .send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
  app.put<{
    Params: { agentId: string }
    Body: { expectedGeneration?: unknown; expectedPolicyVersion?: unknown; displayName?: unknown; description?: unknown; suggestedQuestions?: unknown; dailyMessageLimit?: unknown }
  }>('/:agentId/publication', ownerAuth, async (request, reply) => {
    try {
      const publication = await updateAgentPublicationDetails({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        expectedGeneration: request.body?.expectedGeneration as number,
        expectedPolicyVersion: request.body?.expectedPolicyVersion as number,
        displayName: request.body?.displayName,
        description: request.body?.description,
        suggestedQuestions: request.body?.suggestedQuestions,
        dailyMessageLimit: request.body?.dailyMessageLimit,
      })
      return { publication }
    } catch (error) {
      return sendError(reply, error)
    }
  })
  app.post<{
    Params: { agentId: string }
    Body: { expectedGeneration?: unknown }
  }>('/:agentId/publication/revoke', ownerAuth, async (request, reply) => {
    try {
      const publication = await revokeAgentPublication({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        expectedGeneration: request.body?.expectedGeneration as number,
      })
      return { publication }
    } catch (error) {
      return sendError(reply, error)
    }
  })
  app.post<{
    Params: { agentId: string }
    Body: { expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/activate', ownerAuth, async (request, reply) => {
    try {
      return { publication: await activateAgentPublication({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        expectedGeneration: request.body?.expectedGeneration as number,
        expectedPolicyVersion: request.body?.expectedPolicyVersion as number,
      }) }
    } catch (error) { return sendError(reply, error) }
  })
  app.post<{
    Params: { agentId: string }
    Body: { expectedGeneration?: unknown; expectedPolicyVersion?: unknown }
  }>('/:agentId/publication/pause', ownerAuth, async (request, reply) => {
    try {
      const publication = await pauseAgentPublication({
        ownerUserId: request.userId,
        agentIdentityId: request.params.agentId,
        expectedGeneration: request.body?.expectedGeneration as number,
        expectedPolicyVersion: request.body?.expectedPolicyVersion as number,
      })
      return { publication }
    } catch (error) {
      return sendError(reply, error)
    }
  })
}

export async function agentPublicationPublicRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.post<{ Params: { publicId: string } }>(
    '/:publicId/browser/anonymous', async (request, reply) => {
      privateBrowserHeaders(reply)
      if (!trustedRoomBrowserRequest(request)) {
        return reply.code(403).send({ error: 'agent_publication_browser_origin_forbidden' })
      }
      try {
        const current = await authenticateAgentPublicationBrowser(request, request.params.publicId)
        if (current.accessKind === 'anonymous') {
          return { scopedPath: `/p/${request.params.publicId}`, userId: current.userId,
            accessKind: 'anonymous' }
        }
        return reply.code(409).send({ error: 'agent_publication_browser_account_scoped' })
      } catch (error) {
        if (!(error instanceof AgentPublicationBrowserError)) throw error
        if (error.code !== 'unauthorized') return sendBrowserError(reply, error)
      }
      try {
        if (!await consumeAnonymousAgentRateLimit({ publicId: request.params.publicId,
          ip: anonymousRateLimitIp(request), action: 'start' })) {
          return reply.code(429).send({ error: 'agent_publication_anonymous_rate_limited' })
        }
      } catch {
        return reply.code(503).send({ error: 'agent_publication_anonymous_rate_unavailable' })
      }
      try {
        const session = await createAnonymousAgentPublicationBrowserSession({ publicId: request.params.publicId })
        reply.header('set-cookie', [
          serializeAgentPublicationBrowserCookie(request, request.params.publicId, '', new Date(0)),
          serializeAgentPublicationBrowserCookie(
            request, request.params.publicId, session.token, session.expiresAt, true),
        ])
        return { scopedPath: `/p/${request.params.publicId}`, userId: session.userId,
          accessKind: 'anonymous' }
      } catch (error) { return sendBrowserError(reply, error) }
    },
  )
  app.post<{ Params: { publicId: string } }>(
    '/:publicId/browser/use-account', { preHandler: requireAuth }, async (request, reply) => {
      privateBrowserHeaders(reply)
      if (!trustedRoomBrowserRequest(request)) {
        return reply.code(403).send({ error: 'agent_publication_browser_origin_forbidden' })
      }
      try {
        await revokeAgentPublicationBrowserSession(request, request.params.publicId)
        const session = await createAgentPublicationBrowserSession({
          publicId: request.params.publicId, userId: request.userId,
        })
        reply.header('set-cookie', [
          serializeAgentPublicationBrowserCookie(request, request.params.publicId, '', new Date(0), true),
          serializeAgentPublicationBrowserCookie(
            request, request.params.publicId, session.token, session.expiresAt),
        ])
        return { scopedPath: `/p/${request.params.publicId}`,
          userId: request.userId, expiresAt: session.expiresAt.toISOString() }
      } catch (error) { return sendBrowserError(reply, error) }
    },
  )
  app.post<{
    Params: { publicId: string }
    Body: { phone?: string; code?: string; name?: string }
  }>('/:publicId/browser/verify-phone', async (request, reply) => {
    privateBrowserHeaders(reply)
    if (!trustedRoomBrowserRequest(request)) {
      return reply.code(403).send({ error: 'agent_publication_browser_origin_forbidden' })
    }
    try {
      const publication = await getPublicAgentPublication(request.params.publicId)
      if (!publication) return reply.code(404).send({ error: 'agent_publication_not_found' })
      const user = await verifyPhoneIdentity({
        phone: request.body?.phone ?? '', code: request.body?.code ?? '',
        name: request.body?.name,
      })
      await revokeAgentPublicationBrowserSession(request, request.params.publicId)
      const session = await createAgentPublicationBrowserSession({
        publicId: request.params.publicId, userId: user.id,
      })
      reply.header('set-cookie', [
        serializeAgentPublicationBrowserCookie(request, request.params.publicId, '', new Date(0), true),
        serializeAgentPublicationBrowserCookie(
          request, request.params.publicId, session.token, session.expiresAt),
      ])
      return { scopedPath: `/p/${request.params.publicId}`,
        userId: user.id,
        expiresAt: session.expiresAt.toISOString(),
        nicknameSetup: await offerScopedNicknameSetup(user) }
    } catch (error) {
      if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
      if (error instanceof AuthRouteError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      throw error
    }
  })
  app.get<{ Params: { publicId: string } }>(
    '/:publicId/browser/session', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        const session = await authenticateAgentPublicationBrowser(request, request.params.publicId,
          new Date(), true)
        return { authenticated: true, userId: session.userId, accessKind: session.accessKind }
      } catch (error) { return sendBrowserError(reply, error) }
    },
  )
  app.get<{ Params: { publicId: string } }>(
    '/:publicId/browser/contact-request', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
        if (session.accessKind === 'anonymous') {
          return reply.code(403).send({ error: 'agent_publication_anonymous_contact_forbidden' })
        }
        return await getAgentContactRequestStatus({ requesterUserId: session.userId,
          publicId: request.params.publicId })
      } catch (error) {
        if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
        if (error instanceof ContactError) return reply.code(error.code === 'invalid' ? 400 : 404)
          .send({ error: `contact_${error.code}` })
        throw error
      }
    },
  )
  app.post<{ Params: { publicId: string } }>(
    '/:publicId/browser/contact-request', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
        if (session.accessKind === 'anonymous') {
          return reply.code(403).send({ error: 'agent_publication_anonymous_contact_forbidden' })
        }
        const result = await requestAgentContact({ requesterUserId: session.userId,
          publicId: request.params.publicId })
        return reply.code(result.outcome === 'pending_approval' ? 202 : 200).send(result)
      } catch (error) {
        if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
        if (error instanceof ContactError) return reply.code(error.code === 'invalid' ? 400
          : error.code === 'not_found' ? 404 : 409).send({ error: `contact_${error.code}` })
        throw error
      }
    },
  )
  app.get<{
    Params: { publicId: string }; Querystring: { after?: string; before?: string }
  }>('/:publicId/browser/conversation', async (request, reply) => {
    privateBrowserHeaders(reply)
    try {
      const session = await authenticateAgentPublicationBrowser(request, request.params.publicId,
        new Date(), true)
      return await readVisitorAgentConversationByAgent({
        agentIdentityId: session.agentIdentityId,
        visitorUserId: session.userId,
        after: request.query.after,
        before: request.query.before,
      })
    } catch (error) {
      if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
      if (!(error instanceof AgentDirectConversationError)) throw error
      return reply.code(error.code === 'invalid' ? 400 : 404)
        .send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
  app.post<{
    Params: { publicId: string }
    Body: { text?: unknown; clientMessageId?: unknown; attachmentIds?: unknown }
  }>('/:publicId/browser/messages', async (request, reply) => {
    privateBrowserHeaders(reply)
    try {
      const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
      if (session.accessKind === 'anonymous') {
        try {
          if (!await consumeAnonymousAgentRateLimit({ publicId: request.params.publicId,
            ip: anonymousRateLimitIp(request), userId: session.userId, action: 'send' })) {
            return reply.code(429).send({ error: 'agent_publication_anonymous_rate_limited' })
          }
        } catch {
          return reply.code(503).send({ error: 'agent_publication_anonymous_rate_unavailable' })
        }
      }
      const result = await enqueueVisitorAgentMessage({
        publicId: request.params.publicId,
        visitorUserId: session.userId,
        text: request.body?.text,
        clientMessageId: request.body?.clientMessageId,
        attachmentIds: request.body?.attachmentIds,
      })
      return reply.code(result.idempotent ? 200 : 202).send(result)
    } catch (error) {
      if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
      if (!(error instanceof AgentDirectConversationError)) throw error
      const status = error.code === 'invalid' ? 400
        : error.code === 'not_found' ? 404
          : error.code === 'limit_reached' ? 429 : 409
      return reply.code(status).send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
  app.post<{ Params: { publicId: string }; Body: { clientUploadId?: unknown;
    name?: unknown; mimeType?: unknown; mediaKind?: unknown; byteSize?: unknown;
    sha256?: unknown } }>('/:publicId/browser/attachments/init', async (request, reply) => {
    privateBrowserHeaders(reply)
    try {
      const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
      if (session.accessKind === 'anonymous') {
        try {
          if (!await consumeAnonymousAgentRateLimit({ publicId: request.params.publicId,
            ip: anonymousRateLimitIp(request), userId: session.userId, action: 'send' })) {
            return reply.code(429).send({ error: 'agent_publication_anonymous_rate_limited' })
          }
        } catch {
          return reply.code(503).send({ error: 'agent_publication_anonymous_rate_unavailable' })
        }
      }
      return await initDirectAttachment({ publicId: request.params.publicId,
        visitorUserId: session.userId, clientUploadId: request.body?.clientUploadId,
        name: request.body?.name, mimeType: request.body?.mimeType,
        mediaKind: request.body?.mediaKind, byteSize: request.body?.byteSize,
        sha256: request.body?.sha256 })
    } catch (error) {
      if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
      if (!(error instanceof AgentDirectConversationError)) throw error
      return reply.code(error.code === 'invalid' ? 400 : error.code === 'limit_reached' ? 429 : 409)
        .send({ error: `agent_direct_attachment_${error.code}` })
    }
  })
  app.post<{ Params: { publicId: string; attachmentId: string } }>(
    '/:publicId/browser/attachments/:attachmentId/complete', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
        return await completeDirectAttachment({ publicId: request.params.publicId,
          visitorUserId: session.userId, attachmentId: request.params.attachmentId })
      } catch (error) {
        if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : 404)
          .send({ error: `agent_direct_attachment_${error.code}` })
      }
    },
  )
  app.get<{ Params: { publicId: string; attachmentId: string } }>(
    '/:publicId/browser/attachments/:attachmentId/download', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        const session = await authenticateAgentPublicationBrowser(request, request.params.publicId)
        return await downloadDirectAttachmentForVisitor({ publicId: request.params.publicId,
          visitorUserId: session.userId, attachmentId: request.params.attachmentId })
      } catch (error) {
        if (error instanceof AgentPublicationBrowserError) return sendBrowserError(reply, error)
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(404).send({ error: 'agent_direct_attachment_not_found' })
      }
    },
  )
  app.post<{ Params: { publicId: string } }>(
    '/:publicId/browser/logout', async (request, reply) => {
      privateBrowserHeaders(reply)
      try {
        await revokeAgentPublicationBrowserSession(request, request.params.publicId)
        reply.header('set-cookie', [
          serializeAgentPublicationBrowserCookie(request, request.params.publicId, '', new Date(0)),
          serializeAgentPublicationBrowserCookie(request, request.params.publicId, '', new Date(0), true),
        ])
        return { ok: true }
      } catch (error) { return sendBrowserError(reply, error) }
    },
  )
  app.get<{ Params: { publicId: string } }>('/:publicId', async (request, reply) => {
    privateBrowserHeaders(reply)
    const publication = await getPublicAgentPublication(request.params.publicId)
    if (!publication) return reply.code(404).send({ error: 'agent_publication_not_found' })
    return { publication }
  })
  app.get<{
    Params: { publicId: string }
    Querystring: { after?: string; before?: string }
  }>('/:publicId/conversation', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await readVisitorAgentConversation({
        publicId: request.params.publicId,
        visitorUserId: request.userId,
        after: request.query.after,
        before: request.query.before,
      })
    } catch (error) {
      if (!(error instanceof AgentDirectConversationError)) throw error
      return reply.code(error.code === 'invalid' ? 400 : 404)
        .send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
  app.post<{
    Params: { publicId: string }
    Body: { text?: unknown; clientMessageId?: unknown; attachmentIds?: unknown }
  }>('/:publicId/messages', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      const result = await enqueueVisitorAgentMessage({
        publicId: request.params.publicId,
        visitorUserId: request.userId,
        text: request.body?.text,
        clientMessageId: request.body?.clientMessageId,
        attachmentIds: request.body?.attachmentIds,
      })
      return reply.code(result.idempotent ? 200 : 202).send(result)
    } catch (error) {
      if (!(error instanceof AgentDirectConversationError)) throw error
      const status = error.code === 'invalid' ? 400
        : error.code === 'not_found' ? 404
          : error.code === 'limit_reached' ? 429 : 409
      return reply.code(status).send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
}

export async function agentDirectConversationRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.get('/owned-unread', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    return { agents: await readOwnerDirectUnread(request.userId) }
  })
  app.get<{ Querystring: { cursor?: string } }>('/owned',
    { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try { return await listOwnerAgentDirectConversations({
        ownerUserId: request.userId, cursor: request.query.cursor,
      }) } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : 404)
          .send({ error: `agent_direct_conversation_${error.code}` })
      }
    })
  app.post<{ Params: { conversationId: string }; Body: { clientUploadId?: unknown;
    name?: unknown; mimeType?: unknown; mediaKind?: unknown; byteSize?: unknown; sha256?: unknown } }>(
    '/:conversationId/attachments/init', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try { return await initDirectAttachment({
        publicId: '', conversationId: request.params.conversationId, visitorUserId: request.userId,
        clientUploadId: request.body?.clientUploadId, name: request.body?.name, mimeType: request.body?.mimeType,
        mediaKind: request.body?.mediaKind, byteSize: request.body?.byteSize, sha256: request.body?.sha256,
      }) } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : error.code === 'limit_reached' ? 429 : 404)
          .send({ error: `agent_direct_attachment_${error.code}` })
      }
    })
  app.post<{ Params: { conversationId: string; attachmentId: string } }>(
    '/:conversationId/attachments/:attachmentId/complete', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try { return await completeDirectAttachment({
        publicId: '', conversationId: request.params.conversationId, visitorUserId: request.userId,
        attachmentId: request.params.attachmentId,
      }) } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : 404).send({ error: `agent_direct_attachment_${error.code}` })
      }
    })
  app.post<{ Params: { conversationId: string }; Body: { text?: unknown; clientMessageId?: unknown; attachmentIds?: unknown } }>(
    '/:conversationId/owner-messages',
    { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try { return await sendOwnerAgentDirectMessage({
        ownerUserId: request.userId, conversationId: request.params.conversationId,
        text: request.body?.text, clientMessageId: request.body?.clientMessageId,
        attachmentIds: request.body?.attachmentIds,
      }) } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : error.code === 'not_found' ? 404 : 409)
          .send({ error: `agent_direct_conversation_${error.code}` })
      }
    })
  app.get<{ Params: { conversationId: string; attachmentId: string } }>(
    '/:conversationId/attachments/:attachmentId/download',
    { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try {
        return await downloadDirectAttachmentForParticipant({
          conversationId: request.params.conversationId, userId: request.userId,
          attachmentId: request.params.attachmentId,
        })
      } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(404).send({ error: 'agent_direct_attachment_not_found' })
      }
    },
  )
  app.post<{ Params: { conversationId: string } }>(
    '/:conversationId/resume',
    { preHandler: [requirePublishedAgentAuth, requireActivePlan, requireNonReviewMachineAccess] },
    async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try {
        return await resumeVisitorAgentConversation({
          conversationId: request.params.conversationId, ownerUserId: request.userId,
        })
      } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'not_found' ? 404 : 409)
          .send({ error: `agent_direct_conversation_${error.code}` })
      }
    },
  )
  app.get<{ Querystring: { cursor?: string } }>(
    '/', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try {
        return await listVisitorAgentDirectConversations({
          visitorUserId: request.userId, cursor: request.query.cursor,
        })
      } catch (error) {
        if (!(error instanceof AgentDirectConversationError)) throw error
        return reply.code(error.code === 'invalid' ? 400 : 404)
          .send({ error: `agent_direct_conversation_${error.code}` })
      }
    },
  )
  app.get<{
    Params: { conversationId: string }
    Querystring: { after?: string; before?: string; perspective?: string }
  }>('/:conversationId', { preHandler: requirePublishedAgentAuth }, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await readAgentDirectConversationById({
        conversationId: request.params.conversationId,
        userId: request.userId,
        after: request.query.after,
        before: request.query.before,
        ...(request.query.perspective === 'owner' ? { perspective: 'owner' as const } : {}),
      })
    } catch (error) {
      if (!(error instanceof AgentDirectConversationError)) throw error
      return reply.code(error.code === 'invalid' ? 400 : 404)
        .send({ error: `agent_direct_conversation_${error.code}` })
    }
  })
}
