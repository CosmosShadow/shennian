// @arch open-source/docs/server-runtime.md

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { shapeDownload } from '../services/agent-direct-attachments.js'
import { registerAuthDecorators, requireActivePlan, requireUserOrMachineAuth } from '../middleware/auth.js'
import {
  AgentDirectDeliveryError,
  bindAgentDirectSession,
  checkAgentDirectLease,
  claimAgentDirectMessage,
  completeAgentDirectMessage,
  failAgentDirectMessage,
  prepareAgentDirectSession,
  saveAgentDirectNativeSession,
} from '../services/agent-direct-delivery.js'

async function requirePairedMachine(request: FastifyRequest, reply: FastifyReply) {
  await requireUserOrMachineAuth(request, reply)
  if (reply.sent) return
  if (!request.machineId) return reply.code(403).send({ error: 'machine_auth_required' })
  const machine = await prisma.machine.findFirst({
    where: { id: request.machineId, userId: request.userId, paired: true },
    select: { id: true },
  })
  if (!machine) return reply.code(401).send({ error: 'machine_unavailable' })
}

function sendDeliveryError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AgentDirectDeliveryError)) throw error
  return reply.code(error.code === 'invalid' ? 400
    : error.code === 'not_found' ? 404 : 409)
    .send({ error: `agent_direct_delivery_${error.code}` })
}

export async function agentDirectDeliveryRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineAuth = { preHandler: [requirePairedMachine, requireActivePlan] }
  app.post('/claim', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await claimAgentDirectMessage({
        ownerUserId: request.userId, machineId: request.machineId,
        supportsAttachments: (request.body as { supportsAttachments?: unknown } | null)?.supportsAttachments === true,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: { messageId?: unknown; conversationId?: unknown;
    bindingEpoch?: unknown; leaseToken?: unknown; attachmentId?: unknown } }>(
    '/attachment', machineAuth, async (request, reply) => {
      reply.header('cache-control', 'no-store, max-age=0')
      try {
        await checkAgentDirectLease({ ownerUserId: request.userId, machineId: request.machineId,
          messageId: request.body?.messageId, conversationId: request.body?.conversationId,
          bindingEpoch: request.body?.bindingEpoch, leaseToken: request.body?.leaseToken })
        const file = typeof request.body?.attachmentId === 'string'
          ? await prisma.agentDirectAttachment.findFirst({ where: {
            id: request.body.attachmentId, messageId: request.body.messageId as string,
            status: 'ready', expiresAt: { gt: new Date() },
          } }) : null
        if (!file) return reply.code(404).send({ error: 'agent_direct_attachment_not_found' })
        return shapeDownload(file)
      } catch (error) { return sendDeliveryError(reply, error) }
    },
  )
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown
  } }>('/check-lease', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await checkAgentDirectLease({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown; nianSessionId?: unknown
  } }>('/bind-session', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await bindAgentDirectSession({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
        nianSessionId: request.body?.nianSessionId,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown; workDir?: unknown
  } }>('/prepare-session', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await prepareAgentDirectSession({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
        workDir: request.body?.workDir,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown; nianSessionId?: unknown; nativeSessionId?: unknown
  } }>('/native-session', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await saveAgentDirectNativeSession({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
        nianSessionId: request.body?.nianSessionId,
        nativeSessionId: request.body?.nativeSessionId,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown; replyText?: unknown; pauseConversation?: unknown
  } }>('/complete', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await completeAgentDirectMessage({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
        replyText: request.body?.replyText,
        pauseConversation: request.body?.pauseConversation,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
  app.post<{ Body: {
    messageId?: unknown; conversationId?: unknown; bindingEpoch?: unknown
    leaseToken?: unknown; failureCode?: unknown
  } }>('/fail', machineAuth, async (request, reply) => {
    reply.header('cache-control', 'no-store, max-age=0')
    try {
      return await failAgentDirectMessage({
        ownerUserId: request.userId, machineId: request.machineId,
        messageId: request.body?.messageId,
        conversationId: request.body?.conversationId,
        bindingEpoch: request.body?.bindingEpoch,
        leaseToken: request.body?.leaseToken,
        failureCode: request.body?.failureCode,
      })
    } catch (error) { return sendDeliveryError(reply, error) }
  })
}
