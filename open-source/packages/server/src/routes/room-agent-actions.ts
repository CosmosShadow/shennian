// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-action-routes.test.ts

import { prisma } from '../lib/prisma.js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RoomActivationMode } from '@shennian/wire'
import { registerAuthDecorators, requireUserOrMachineAuth } from '../middleware/auth.js'
import {
  getRoomAgentStatus,
  getRoomAgentAttachmentCapability,
  readRoomAgentMessages,
  sendRoomAgentMessage,
  initializeRoomAgentAttachment,
  completeRoomAgentAttachment,
  updateRoomAgentMode,
  pauseRoomAgentWork,
} from '../services/room-agent-actions.js'
import { broadcastRoomEvent, broadcastRoomMessageRecord } from '../services/room-events.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { createRoomFromAgent, joinRoomFromAgent } from '../services/room-agent-onboarding.js'
import {
  resolveRoomNativeSession,
  RoomNativeSessionError,
} from '../services/room-native-session.js'
import { createRoomWithOwner } from '../services/room-core.js'
import { createRoomAttachmentLinkToken } from '../services/room-attachment-link.js'
import { roomInviteUrl, roomWebUrl } from '../services/public-web-url.js'
import { scheduleAgentSafetyPausePush, scheduleRoomMessagePush } from '../services/room-message-push.js'

function requireMachine(reply: FastifyReply, machineId: string): boolean {
  if (machineId) return true
  reply.code(403).send({ error: 'machine_auth_required' })
  return false
}

async function rejectRetiredExternalBinding(_request: unknown, reply: FastifyReply) {
  return reply.code(410).send({
    error: 'external_room_binding_retired',
    message:
      'Third-party Session binding was retired. Use Shennian Skill + CLI as the paired user.',
    nextAction: { type: 'open_install_guide', url: 'https://shennian.net/install.md' },
  })
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoomNativeSessionError) {
    const forbidden = error.code.endsWith('_forbidden')
    const conflict = error.code === 'room_native_session_deleted'
    return reply.code(forbidden ? 403 : conflict ? 409 : 400).send({
      error: error.code,
      message: error.message,
    })
  }
  if (!(error instanceof RoomPolicyError)) throw error
  const forbidden =
    error.code === 'room_binding_unavailable' ||
    error.code === 'managed_agent_security_pending' ||
    error.code.endsWith('_forbidden')
  const conflict = error.code.endsWith('_conflict') || error.code.endsWith('_limit_reached')
  return reply.code(forbidden ? 403 : conflict ? 409 : 400).send({
    error: error.code,
    message: error.message,
  })
}

export async function roomAgentActionRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.post<{ Body: { name?: string } }>(
    '/actions/operator/create',
    { preHandler: [requireUserOrMachineAuth, rejectRetiredExternalBinding] },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      if (Object.keys(request.body).some((key) => key !== 'name')) {
        return reply.code(400).send({ error: 'invalid_operator_room_create' })
      }
      try {
        const result = await createRoomWithOwner({
          userId: request.userId,
          name: request.body.name ?? '',
          visibility: 'private',
          joinPolicy: 'open',
        })
        await broadcastRoomEvent(result.room.id, {
          event: 'room.created',
          roomId: result.room.id,
        })
        return reply.code(201).send({
          outcome: 'created',
          room: {
            id: result.room.id,
            name: result.room.name,
            visibility: result.room.visibility,
            joinPolicy: result.room.joinPolicy,
            canonicalUrl: roomWebUrl(request, result.room.id),
          },
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Body: {
      runtimeAdapter?: 'codex' | 'claude_code' | 'workbuddy'
      sourceSessionKey?: string
    }
  }>(
    '/actions/resolve-session',
    { preHandler: [requireUserOrMachineAuth, rejectRetiredExternalBinding] },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        return await resolveRoomNativeSession({
          userId: request.userId,
          machineId: request.machineId,
          runtimeAdapter: request.body.runtimeAdapter ?? ('' as 'codex'),
          sourceSessionKey: request.body.sourceSessionKey ?? '',
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Body: {
      bindingIntentId?: string
      nianSessionId?: string
      runtimeAdapter?: 'codex' | 'claude_code' | 'workbuddy'
      sessionRegistryKey?: string
      name?: string
      agentAlias?: string
      agentDescription?: string
      activationCapability?: 'managed' | 'idle_resume' | 'notify_only'
      activationMode?: RoomActivationMode
    }
  }>(
    '/actions/create',
    { preHandler: [requireUserOrMachineAuth, rejectRetiredExternalBinding] },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await createRoomFromAgent({
          bindingIntentId: request.body.bindingIntentId ?? '',
          userId: request.userId,
          machineId: request.machineId,
          nianSessionId: request.body.nianSessionId ?? '',
          runtimeAdapter: request.body.runtimeAdapter ?? ('' as 'codex'),
          sessionRegistryKey: request.body.sessionRegistryKey ?? '',
          name: request.body.name ?? '',
          agentAlias: request.body.agentAlias ?? '',
          agentDescription: request.body.agentDescription,
          activationCapability: request.body.activationCapability ?? 'notify_only',
          activationMode: request.body.activationMode ?? 'auto_follow',
        })
        await broadcastRoomEvent(result.room.id, {
          event: 'room.created',
          roomId: result.room.id,
        })
        await broadcastRoomEvent(result.room.id, {
          event: 'room.binding.updated',
          roomId: result.room.id,
          entityId: result.binding.id,
        })
        return reply.code(result.idempotent ? 200 : 201).send({
          outcome: 'created',
          room: {
            id: result.room.id,
            name: result.room.name,
            visibility: result.room.visibility,
            joinPolicy: result.room.joinPolicy,
            canonicalUrl: roomWebUrl(request, result.room.id),
            inviteUrl: roomInviteUrl(request, result.room.id, result.rawInviteToken),
          },
          agentIdentity: {
            id: result.agentIdentity.id,
            displayName: result.agentIdentity.displayName,
            description:
              'description' in result.agentIdentity
                ? result.agentIdentity.description
                : (request.body.agentDescription?.trim() ?? ''),
          },
          binding: {
            id: result.binding.id,
            roomId: result.binding.roomId,
            agentIdentityId: result.binding.agentIdentityId,
            agentMembershipId: result.binding.agentMembershipId,
            status: result.binding.status,
            activationMode: result.binding.activationMode,
          },
          idempotent: result.idempotent,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Body: {
      bindingIntentId?: string
      nianSessionId?: string
      runtimeAdapter?: 'codex' | 'claude_code' | 'workbuddy'
      sessionRegistryKey?: string
      inviteToken?: string
      message?: string
      agentAlias?: string
      agentDescription?: string
      activationCapability?: 'managed' | 'idle_resume' | 'notify_only'
      activationMode?: RoomActivationMode
    }
  }>(
    '/actions/join',
    { preHandler: [requireUserOrMachineAuth, rejectRetiredExternalBinding] },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await joinRoomFromAgent({
          bindingIntentId: request.body.bindingIntentId ?? '',
          userId: request.userId,
          machineId: request.machineId,
          nianSessionId: request.body.nianSessionId ?? '',
          runtimeAdapter: request.body.runtimeAdapter ?? ('' as 'codex'),
          sessionRegistryKey: request.body.sessionRegistryKey ?? '',
          inviteToken: request.body.inviteToken ?? '',
          message: request.body.message,
          agentAlias: request.body.agentAlias ?? '',
          agentDescription: request.body.agentDescription,
          activationCapability: request.body.activationCapability ?? 'notify_only',
          activationMode: request.body.activationMode ?? 'auto_follow',
        })
        await broadcastRoomEvent(result.room.id, {
          event:
            result.outcome === 'joined' ? 'room.membership.updated' : 'room.join_request.created',
          roomId: result.room.id,
          entityId:
            result.outcome === 'joined' ? result.agentMembership!.id : result.joinRequest!.id,
        })
        if (result.outcome === 'joined' && result.message) {
          await broadcastRoomMessageRecord(result.room.id, result.message)
        }
        await broadcastRoomEvent(result.room.id, {
          event: 'room.binding.updated',
          roomId: result.room.id,
          entityId: result.binding.id,
        })
        return reply.code(result.idempotent ? 200 : result.outcome === 'joined' ? 201 : 202).send({
          outcome: result.outcome,
          room: {
            id: result.room.id,
            name: result.room.name,
            canonicalUrl: roomWebUrl(request, result.room.id),
          },
          agentIdentity: {
            id: result.agentIdentity.id,
            displayName: result.agentIdentity.displayName,
            description:
              'description' in result.agentIdentity
                ? result.agentIdentity.description
                : (request.body.agentDescription?.trim() ?? ''),
          },
          binding: {
            id: result.binding.id,
            roomId: result.binding.roomId,
            agentIdentityId: result.binding.agentIdentityId,
            agentMembershipId: result.binding.agentMembershipId,
            status: result.binding.status,
            activationMode: result.binding.activationMode,
          },
          joinRequestId: result.joinRequest?.id,
          idempotent: result.idempotent,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string; bindingId: string }; Querystring: { scheduleAuthorization?: string; causeMessageId?: string } }>(
    '/:roomId/bindings/:bindingId/status',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await getRoomAgentStatus({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
        })
        let scheduleAuthorized: boolean | undefined
        if (request.query.scheduleAuthorization === '1') {
          const cause = request.query.causeMessageId
          const message = cause ? await prisma.roomMessage.findFirst({
            where: { id: cause, roomId: request.params.roomId, ownerUserIdSnapshot: request.userId, authorPrincipalTypeSnapshot: 'human' },
            select: { id: true },
          }) : null
          scheduleAuthorized = result.status === 'active' && (!cause || Boolean(message))
        }
        return {
          ...result,
          ...(scheduleAuthorized !== undefined ? { scheduleAuthorized } : {}),
          room: {
            ...result.room,
            canonicalUrl: roomWebUrl(request, result.roomId),
          },
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string; bindingId: string }
    Body: {
      clientUploadId?: string
      name?: string
      mediaKind?: 'image' | 'audio' | 'file'
      mimeType?: string
      byteSize?: number
      sha256?: string
    }
  }>(
    '/:roomId/bindings/:bindingId/attachments/init',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await initializeRoomAgentAttachment({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          clientUploadId: request.body.clientUploadId ?? '',
          originalName: request.body.name ?? '',
          mediaKind: request.body.mediaKind ?? 'file',
          mimeType: request.body.mimeType ?? '',
          byteSize: request.body.byteSize ?? 0,
          sha256: request.body.sha256 ?? '',
        })
        return reply.code(result.idempotent ? 200 : 201).send(result)
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string; bindingId: string; attachmentId: string }
  }>(
    '/:roomId/bindings/:bindingId/attachments/:attachmentId/complete',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await completeRoomAgentAttachment({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
          machineId: request.machineId,
        })
        return {
          attachment: {
            attachmentId: result.attachment.id,
            mediaKind: result.attachment.mediaKind,
            name: result.attachment.safeName,
            mimeType: result.attachment.mimeType,
            byteSize: result.attachment.byteSize.toString(),
            sha256: result.attachment.sha256,
            status: result.attachment.status,
          },
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{
    Params: { roomId: string; bindingId: string }
    Querystring: { before?: string; after?: string; limit?: string }
  }>(
    '/:roomId/bindings/:bindingId/messages',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await readRoomAgentMessages({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          beforeSequence: request.query.before,
          afterSequence: request.query.after,
          limit: request.query.limit == null ? undefined : Number(request.query.limit),
        })
        const baseUrl = publicBaseUrl(request)
        return {
          messages: result.messages.map((rawMessage) => {
            const message = shapeRoomMessage(rawMessage)
            message.attachments = message.attachments.map((attachment) => {
              const rawAttachment = rawMessage.attachments?.find(
                (item) => item.id === attachment.attachmentId,
              )
              const capability = createRoomAttachmentLinkToken({
                roomId: request.params.roomId,
                bindingId: request.params.bindingId,
                capabilityEpoch: result.capabilityEpoch,
                attachmentId: attachment.attachmentId,
                attachmentExpiresAt: rawAttachment?.expiresAt,
              })
              return {
                ...attachment,
                downloadUrl: `${baseUrl}/a/${capability.token}`,
                downloadExpiresAt: capability.expiresAt,
              }
            })
            return message
          }),
          nextSequence: result.nextSequence,
          hasMore: result.hasMore,
          historyFromSequence: result.historyFromSequence,
          roomName: result.roomName,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string; bindingId: string; attachmentId: string } }>(
    '/:roomId/bindings/:bindingId/attachments/:attachmentId/download-capability',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        return await getRoomAgentAttachmentCapability({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
          machineId: request.machineId,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string; bindingId: string }
    Body: {
      clientMessageId?: string
      text?: string
      mentionMembershipIds?: string[]
      replyToMessageId?: string
      activationCauseMessageId?: string
      activeRunId?: string
      attachmentIds?: string[]
    }
  }>(
    '/:roomId/bindings/:bindingId/messages',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await sendRoomAgentMessage({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          clientMessageId: request.body.clientMessageId ?? '',
          text: request.body.text ?? '',
          mentionMembershipIds: request.body.mentionMembershipIds,
          replyToMessageId: request.body.replyToMessageId,
          activationCauseMessageId: request.body.activationCauseMessageId,
          activeRunId: request.body.activeRunId,
          attachmentIds: request.body.attachmentIds,
        })
        const message = shapeRoomMessage(result.message)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.message.created',
          roomId: request.params.roomId,
          sequence: message.sequence,
          message,
        })
        void scheduleRoomMessagePush({
          roomId: request.params.roomId,
          messageId: message.id,
        })
        return reply.code(result.idempotent ? 200 : 201).send({
          message,
          idempotent: result.idempotent,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.patch<{
    Params: { roomId: string; bindingId: string }
    Body: { activationMode?: RoomActivationMode }
  }>(
    '/:roomId/bindings/:bindingId/mode',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await updateRoomAgentMode({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          activationMode: request.body.activationMode ?? ('' as RoomActivationMode),
        })
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.binding.updated',
          roomId: request.params.roomId,
          entityId: result.binding.id,
        })
        if (result.message) {
          const message = shapeRoomMessage(result.message)
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
        }
        return {
          bindingId: result.binding.id,
          roomId: result.binding.roomId,
          status: result.binding.status,
          activationMode: result.binding.activationMode,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string; bindingId: string }
    Body: { reason?: string }
  }>(
    '/:roomId/bindings/:bindingId/pause',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!requireMachine(reply, request.machineId)) return
      try {
        const result = await pauseRoomAgentWork({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          reason: request.body.reason ?? '',
        })
        const message = shapeRoomMessage(result.message)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.binding.updated',
          roomId: request.params.roomId,
          entityId: result.binding.id,
        })
        if (!result.idempotent) {
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
          void scheduleRoomMessagePush({ roomId: request.params.roomId, messageId: message.id })
        }
        void scheduleAgentSafetyPausePush({
          roomId: result.binding.roomId,
          messageId: message.id,
          ownerUserId: result.binding.userId,
        })
        return reply.code(result.idempotent ? 200 : 201).send({
          bindingId: result.binding.id,
          roomId: result.binding.roomId,
          status: result.binding.status,
          activationMode: result.binding.activationMode,
          message,
          idempotent: result.idempotent,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
}

function publicBaseUrl(request: { protocol: string; hostname: string }): string {
  const configured = (process.env.WEB_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL)
    ?.trim()
    .replace(/\/+$/, '')
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://shennian.net'
  return `${request.protocol}://${request.hostname.includes(':') ? `[${request.hostname}]` : request.hostname}:8081`
}
