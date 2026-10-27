// @arch open-source/docs/server-runtime.md
// @test src/__tests__/rooms-routes.test.ts

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { requireActivePlan, requireAuth } from '../middleware/auth.js'
import { dissolveRoom, removeRoomMembership, sendRoomTextMessage } from '../services/room-core.js'
import {
  cancelRoomJoinRequest,
  deleteRoomRecord,
  leaveRoom,
  reviewRoomJoinRequest,
} from '../services/room-membership.js'
import {
  broadcastRoomEvent,
  broadcastRoomMessageRecord,
  broadcastRoomEventToUsers,
  broadcastAuthorReadAdvanced,
} from '../services/room-events.js'
import { closeRoomBrowserSockets } from '../services/room-browser-events.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { finalizeExclusiveRoomSessionDeletions } from '../services/room-session-cleanup.js'
import {
  completeRoomAttachment,
  getRoomAttachmentDownload,
  initializeRoomAttachment,
} from '../services/room-attachments.js'
import { scheduleRoomMessagePush } from '../services/room-message-push.js'
import { noticeUnavailableAgents } from '../services/room-agent-delivery-notices.js'
import { roomMessageRetentionCutoff } from '../services/room-message-retention.js'
import { advanceRoomReadState } from '../services/room-read-state.js'
import {
  findActiveHumanMembership,
  parseSequence,
  resolveRoomReadAccess,
  sendRoomError,
  shapeRoomLimits,
} from './room-route-helpers.js'

export async function registerRoomCollaborationRoutes(app: FastifyInstance) {
  app.get(
    '/join-requests/mine',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request) => {
      const requests = await prisma.roomJoinRequest.findMany({
        where: { applicantUserId: request.userId, status: 'pending' },
        select: {
          id: true,
          roomId: true,
          status: true,
          createdAt: true,
          room: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return {
        joinRequests: requests.map((item) => ({
          id: item.id,
          roomId: item.roomId,
          roomName: item.room.name,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
        })),
      }
    },
  )

  app.get<{
    Params: { roomId: string }
    Querystring: { status?: 'pending' | 'approved' | 'rejected' | 'cancelled' }
  }>(
    '/:roomId/join-requests',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const actor = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!actor || actor.role !== 'owner') {
        return reply.code(403).send({ error: 'room_admin_forbidden' })
      }
      const status = request.query.status ?? 'pending'
      if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
        return reply.code(400).send({ error: 'invalid_join_request_status' })
      }
      const requests = await prisma.roomJoinRequest.findMany({
        where: { roomId: request.params.roomId, status },
        include: { applicant: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return {
        joinRequests: requests.map((item) => ({
          id: item.id,
          roomId: item.roomId,
          applicant: item.applicant,
          message: item.message,
          requestedAgentAlias: item.requestedAgentAlias,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          reviewedAt: item.reviewedAt?.toISOString() ?? null,
        })),
      }
    },
  )

  app.post<{
    Params: { roomId: string; requestId: string }
    Body: { decision?: 'approve' | 'reject' }
  }>(
    '/:roomId/join-requests/:requestId/review',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await reviewRoomJoinRequest({
          roomId: request.params.roomId,
          requestId: request.params.requestId,
          reviewerUserId: request.userId,
          decision: request.body.decision ?? ('' as 'approve'),
        })
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.join_request.updated',
          roomId: request.params.roomId,
          entityId: request.params.requestId,
        })
        if (result.outcome === 'approved' && result.membership) {
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.membership.updated',
            roomId: request.params.roomId,
            entityId: result.membership.id,
          })
          if (result.message) {
            await broadcastRoomMessageRecord(request.params.roomId, result.message)
          }
        }
        return {
          outcome: result.outcome,
          membershipId: result.membership?.id,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string; requestId: string } }>(
    '/:roomId/join-requests/:requestId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const item = await prisma.roomJoinRequest.findUnique({
        where: { id: request.params.requestId },
        include: { applicant: { select: { id: true, name: true } } },
      })
      if (!item || item.roomId !== request.params.roomId) {
        return reply.code(404).send({ error: 'join_request_not_found' })
      }
      if (item.applicantUserId !== request.userId) {
        const actor = await findActiveHumanMembership(request.params.roomId, request.userId)
        if (!actor || actor.role !== 'owner') {
          return reply.code(403).send({ error: 'join_request_read_forbidden' })
        }
      }
      return {
        joinRequest: {
          id: item.id,
          roomId: item.roomId,
          applicant: item.applicant,
          message: item.message,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          reviewedAt: item.reviewedAt?.toISOString() ?? null,
        },
      }
    },
  )

  app.post<{ Params: { roomId: string; requestId: string } }>(
    '/:roomId/join-requests/:requestId/cancel',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await cancelRoomJoinRequest({
          roomId: request.params.roomId,
          requestId: request.params.requestId,
          applicantUserId: request.userId,
        })
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.join_request.updated',
          roomId: request.params.roomId,
          entityId: request.params.requestId,
        })
        return { status: result.request.status, idempotent: result.idempotent }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.post<{ Params: { roomId: string } }>(
    '/:roomId/leave',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await leaveRoom({ roomId: request.params.roomId, userId: request.userId })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: result.leftMembershipIds[0],
        })
        broadcastRoomEventToUsers([request.userId], {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: result.leftMembershipIds[0],
        })
        for (const rawMessage of result.messages) {
          const message = shapeRoomMessage(rawMessage)
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
          broadcastRoomEventToUsers([request.userId], {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
        }
        return {
          leftMembershipIds: result.leftMembershipIds,
          detachedBindingCount: result.detachedBindingCount,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.delete<{ Params: { roomId: string } }>(
    '/:roomId/record',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await deleteRoomRecord({
          roomId: request.params.roomId,
          userId: request.userId,
        })
        broadcastRoomEventToUsers([request.userId], {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
        })
        return result
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.delete<{ Params: { roomId: string } }>(
    '/:roomId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await dissolveRoom({
          roomId: request.params.roomId,
          actorUserId: request.userId,
        })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.updated',
          roomId: request.params.roomId,
        })
        closeRoomBrowserSockets(request.params.roomId, 4403, 'Room archived')
        return { roomId: result.roomId, status: result.status }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const access = await resolveRoomReadAccess(request.params.roomId, request.userId)
      if (!access) return reply.code(403).send({ error: 'room_read_forbidden' })
      return {
        room: {
          id: access.room.id,
          name: access.room.name,
          conversationKind: access.room.conversationKind,
          description: access.room.description,
          status: access.room.status,
          visibility: access.room.visibility,
          joinPolicy: access.room.joinPolicy,
          lastSequence: (access.historyThroughSequence ?? access.room.nextSequence).toString(),
          historyFromSequence: access.historyFromSequence.toString(),
          historyThroughSequence: access.historyThroughSequence?.toString() ?? null,
          membershipStatus: access.membership?.status ?? null,
          muteRegularNotifications: access.membership?.muteRegularNotifications ?? false,
          muteMentionNotifications: access.membership?.muteMentionNotifications ?? false,
          limits: shapeRoomLimits(access.room),
        },
        membershipId: access.membership?.status === 'active' ? access.membership.id : null,
      }
    },
  )

  app.get<{
    Params: { roomId: string }
    Querystring: { after?: string; before?: string; limit?: string }
  }>(
    '/:roomId/messages',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const access = await resolveRoomReadAccess(request.params.roomId, request.userId)
      if (!access) return reply.code(403).send({ error: 'room_read_forbidden' })
      if (request.query.after != null && request.query.before != null) {
        return reply.code(400).send({ error: 'ambiguous_sequence_cursor' })
      }
      const after = parseSequence(request.query.after)
      const before = request.query.before == null ? null : parseSequence(request.query.before)
      if (after == null || (before == null && request.query.before != null)) {
        return reply.code(400).send({ error: 'invalid_sequence' })
      }
      const limit = Math.max(
        1,
        Math.min(100, Number.parseInt(request.query.limit ?? '50', 10) || 50),
      )
      const floor = access.historyFromSequence > 0n ? access.historyFromSequence - 1n : 0n
      const ceiling = access.historyThroughSequence
      const retentionCutoff = roomMessageRetentionCutoff()
      if (before != null) {
        const page = await prisma.roomMessage.findMany({
          where: {
            roomId: request.params.roomId,
            sequence: { gt: floor, lt: before, ...(ceiling == null ? {} : { lte: ceiling }) },
            createdAt: { gte: retentionCutoff },
          },
          include: {
            attachments: true,
            authorMembership: { select: { displayAlias: true, status: true } },
          },
          orderBy: { sequence: 'desc' },
          take: limit + 1,
        })
        const hasMore = page.length > limit
        const messages = page.slice(0, limit).reverse()
        return {
          messages: messages.map(shapeRoomMessage),
          hasMore,
          retentionCutoff: retentionCutoff.toISOString(),
        }
      }
      const messages = await prisma.roomMessage.findMany({
        where: {
          roomId: request.params.roomId,
          sequence: {
            gt: after > floor ? after : floor,
            ...(ceiling == null ? {} : { lte: ceiling }),
          },
          createdAt: { gte: retentionCutoff },
        },
        include: {
          attachments: true,
          authorMembership: { select: { displayAlias: true, status: true } },
        },
        orderBy: { sequence: 'asc' },
        take: limit,
      })
      return {
        messages: messages.map(shapeRoomMessage),
        hasMore: messages.length === limit,
        retentionCutoff: retentionCutoff.toISOString(),
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: {
      clientMessageId?: string
      text?: string
      mentionMembershipIds?: string[]
      replyToMessageId?: string
      attachmentIds?: string[]
    }
  }>(
    '/:roomId/messages',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const membership = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!membership) return reply.code(403).send({ error: 'room_write_forbidden' })
      try {
        const result = await sendRoomTextMessage({
          roomId: request.params.roomId,
          authorMembershipId: membership.id,
          clientMessageId: request.body.clientMessageId ?? '',
          text: request.body.text ?? '',
          mentionMembershipIds: request.body.mentionMembershipIds,
          replyToMessageId: request.body.replyToMessageId,
          attachmentIds: request.body.attachmentIds,
        })
        const message = shapeRoomMessage(result.message)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.message.created',
          roomId: request.params.roomId,
          sequence: message.sequence,
          message,
        })
        broadcastAuthorReadAdvanced(result)
        void scheduleRoomMessagePush({
          roomId: request.params.roomId,
          messageId: message.id,
        })
        if (!result.idempotent) void noticeUnavailableAgents(result.message)
        return reply
          .code(result.idempotent ? 200 : 201)
          .send({ message, idempotent: result.idempotent })
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: {
      clientUploadId?: string
      name?: string
      mediaKind?: 'image' | 'audio' | 'file'
      mimeType?: string
      byteSize?: number
      sha256?: string
    }
  }>(
    '/:roomId/attachments/init',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await initializeRoomAttachment({
          roomId: request.params.roomId,
          userId: request.userId,
          clientUploadId: request.body.clientUploadId ?? '',
          originalName: request.body.name ?? '',
          mediaKind: request.body.mediaKind ?? 'file',
          mimeType: request.body.mimeType ?? '',
          byteSize: request.body.byteSize ?? 0,
          sha256: request.body.sha256 ?? '',
        })
        return reply.code(result.idempotent ? 200 : 201).send(result)
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string; attachmentId: string }
  }>(
    '/:roomId/attachments/:attachmentId/complete',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await completeRoomAttachment({
          roomId: request.params.roomId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
        })
        return reply.send({
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
        })
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{
    Params: { roomId: string; attachmentId: string }
  }>(
    '/:roomId/attachments/:attachmentId/download',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        return await getRoomAttachmentDownload({
          roomId: request.params.roomId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
        })
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: { lastReadSequence?: string }
  }>(
    '/:roomId/read-state',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const membership = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!membership) return reply.code(403).send({ error: 'room_read_forbidden' })
      const sequence = parseSequence(request.body.lastReadSequence)
      if (sequence == null || sequence > membership.room.nextSequence) {
        return reply.code(400).send({ error: 'invalid_sequence' })
      }
      const { lastReadSequence, advanced } = await advanceRoomReadState({
        roomId: request.params.roomId,
        membershipId: membership.id,
        lastReadSequence: sequence,
      })
      if (advanced) {
        broadcastRoomEventToUsers([request.userId], {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: membership.id,
        })
      }
      return { lastReadSequence: lastReadSequence.toString() }
    },
  )

  app.delete<{
    Params: { roomId: string; membershipId: string }
  }>(
    '/:roomId/members/:membershipId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const actor = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!actor) return reply.code(403).send({ error: 'room_admin_forbidden' })
      try {
        const result = await removeRoomMembership({
          roomId: request.params.roomId,
          actorMembershipId: actor.id,
          targetMembershipId: request.params.membershipId,
        })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: request.params.membershipId,
        })
        broadcastRoomEventToUsers(result.removedHumanUserIds, {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: request.params.membershipId,
        })
        for (const rawMessage of result.messages) {
          const message = shapeRoomMessage(rawMessage)
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
          broadcastRoomEventToUsers(result.removedHumanUserIds, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
        }
        return {
          removedMembershipIds: result.removedMembershipIds,
          detachedBindingCount: result.detachedBindingCount,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )
}
