// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-cli-routes.test.ts

import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RoomCliMessageView } from '@shennian/wire'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import {
  createRoomWithOwner,
  removeRoomMembership,
  sendRoomTextMessage,
  updateRoomSettings,
} from '../services/room-core.js'
import {
  deleteRoomRecord,
  getCanonicalRoomInvite,
  joinRoomFromBrowserState,
  leaveRoom,
  resetCanonicalRoomInvite,
} from '../services/room-membership.js'
import { finalizeExclusiveRoomSessionDeletions } from '../services/room-session-cleanup.js'
import { exchangeRoomInviteToken, RoomInviteBrowserError } from '../services/room-invite-browser.js'
import { RoomPolicyError } from '../services/room-policy.js'
import {
  broadcastRoomEvent,
  broadcastRoomMessageRecord,
  broadcastRoomEventToUsers,
  broadcastAuthorReadAdvanced,
} from '../services/room-events.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { scheduleRoomMessagePush } from '../services/room-message-push.js'
import { noticeUnavailableAgents } from '../services/room-agent-delivery-notices.js'
import {
  completeRoomAttachment,
  getRoomAttachmentDownload,
  initializeRoomAttachment,
} from '../services/room-attachments.js'
import { roomInviteUrl, roomLaunchUrl, roomWebUrl } from '../services/public-web-url.js'
import { createRoomBrowserHandoff } from '../services/room-browser-session.js'
import { roomMessageRetentionCutoff } from '../services/room-message-retention.js'
import { ContactError, listContacts } from '../services/contacts.js'

const SEQUENCE = /^(0|[1-9]\d{0,19})$/
const INVITE_TOKEN = /^[A-Za-z0-9_-]{32,256}$/

export async function roomCliRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineAuth = { preHandler: [requireUserOrMachineAuth, requireActivePlan] }

  app.get<{ Querystring: { q?: string } }>('/contacts', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    reply.header('cache-control', 'no-store')
    try {
      return await listContacts({ ownerUserId: request.userId, query: request.query.q })
    } catch (error) {
      if (error instanceof ContactError) return reply.code(400).send({ error: 'contact_invalid' })
      throw error
    }
  })

  app.post<{ Body: { name?: string; operationId?: string } }>('/create', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (
      request.body.operationId !== undefined &&
      !/^[A-Za-z0-9:_-]{8,128}$/.test(request.body.operationId)
    ) {
      return reply.code(400).send({ error: 'invalid_operation_id' })
    }
    try {
      const result = await createRoomWithOwner({
        userId: request.userId,
        name: request.body.name ?? '',
        clientOperationId: request.body.operationId,
      })
      const invite = await getCanonicalRoomInvite({
        roomId: result.room.id,
        actorUserId: request.userId,
      })
      const handoff = await createRoomBrowserHandoff({
        roomId: result.room.id,
        userId: request.userId,
        membershipId: result.membership.id,
      })
      const canonicalUrl = roomWebUrl(request, result.room.id)
      const launchUrl = roomLaunchUrl(request, result.room.id, handoff.token)
      if (!result.idempotent) {
        await broadcastRoomEvent(result.room.id, {
          event: 'room.created',
          roomId: result.room.id,
          sequence: result.room.nextSequence.toString(),
        })
      }
      return reply.code(result.idempotent ? 200 : 201).send({
        outcome: 'created',
        idempotent: result.idempotent,
        ...(request.body.operationId ? { operationId: request.body.operationId } : {}),
        room: {
          name: result.room.name,
          canonicalUrl,
          launchUrl,
          inviteUrl: roomInviteUrl(request, result.room.id, invite.rawToken),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get<{ Querystring: { includeDirect?: string } }>('/rooms', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const includeDirect = request.query.includeDirect === '1'
    const directCanonical = includeDirect
      && (await prisma.conversationWriteControl.findUnique({
        where: { name: 'published_ai' }, select: { mode: true },
      }))?.mode === 'canonical'
    const memberships = await prisma.roomMembership.findMany({
      where: { userId: request.userId, principalType: 'human', status: 'active',
        ...(includeDirect ? {} : { room: { conversationKind: 'group' } }) },
      include: { room: { include: { legacyDirectConversation: {
        select: { canonicalState: true },
      }, sessionMigrations: { select: { state: true }, take: 1 } } } },
      orderBy: { room: { updatedAt: 'desc' } },
    })
    return {
      rooms: memberships
        .filter((membership) => membership.room.status === 'active'
          && (membership.room.conversationKind !== 'published_ai'
            || (directCanonical
              && membership.room.legacyDirectConversation?.canonicalState === 'ready'))
          && (membership.room.conversationKind !== 'work'
            || membership.room.sessionMigrations[0]?.state === 'canonical'))
        .map((membership) => shapeRoomSummary(request, membership.room, membership.role)),
    }
  })

  app.get<{ Params: { roomId: string } }>('/:roomId', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const membership = await activeHumanMembership(request.params.roomId, request.userId)
    if (!membership) return reply.code(403).send({ error: 'room_read_forbidden' })
    return { room: shapeRoomSummary(request, membership.room, membership.role) }
  })

  app.post<{
    Params: { roomId: string }
    Body: {
      version?: string
      name?: string
      visibility?: 'private' | 'public_read'
      joinPolicy?: 'open' | 'approval' | 'closed'
    }
  }>('/:roomId/update', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const version = parseRoomVersion(request.body.version)
    if (!version) return reply.code(400).send({ error: 'room_version_required' })
    if (
      request.body.name === undefined &&
      request.body.visibility === undefined &&
      request.body.joinPolicy === undefined
    ) {
      return reply.code(400).send({ error: 'room_update_required' })
    }
    try {
      const result = await updateRoomSettings({
        roomId: request.params.roomId,
        actorUserId: request.userId,
        expectedUpdatedAt: version,
        name: request.body.name,
        visibility: request.body.visibility,
        joinPolicy: request.body.joinPolicy,
      })
      await broadcastRoomEvent(request.params.roomId, {
        event: 'room.updated',
        roomId: request.params.roomId,
        sequence: result.room.nextSequence.toString(),
      })
      if (result.message) await broadcastRoomMessageRecord(request.params.roomId, result.message)
      return {
        room: shapeRoomSummary(request, result.room, undefined),
        idempotent: result.idempotent,
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { roomId: string }; Body: { version?: string } }>(
    '/:roomId/delete',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      const version = parseRoomVersion(request.body.version)
      if (!version) return reply.code(400).send({ error: 'room_version_required' })
      try {
        const result = await deleteRoomRecord({
          roomId: request.params.roomId,
          userId: request.userId,
          expectedUpdatedAt: version,
        })
        broadcastRoomEventToUsers([request.userId], {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
        })
        return result
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/invite',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        const result = await getCanonicalRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
        })
        return {
          invite: {
            url: roomInviteUrl(request, request.params.roomId, result.rawToken),
            version: result.version,
          },
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{ Params: { roomId: string }; Body: { version?: number } }>(
    '/:roomId/invite/reset',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      if (!Number.isInteger(request.body.version) || Number(request.body.version) < 1) {
        return reply.code(400).send({ error: 'room_invite_version_required' })
      }
      try {
        const result = await resetCanonicalRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
          expectedVersion: request.body.version,
        })
        if (!result.idempotent) {
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.updated',
            roomId: request.params.roomId,
          })
        }
        return {
          invite: {
            url: roomInviteUrl(request, request.params.roomId, result.rawToken),
            version: result.version,
          },
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/members',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      const actor = await activeHumanMembership(request.params.roomId, request.userId)
      if (!actor) return reply.code(403).send({ error: 'room_read_forbidden' })
      const members = await prisma.roomMembership.findMany({
        where: { roomId: request.params.roomId, status: 'active' },
        orderBy: [{ principalType: 'asc' }, { joinedAt: 'asc' }],
        select: {
          id: true,
          displayAlias: true,
          principalType: true,
          role: true,
          membershipEpoch: true,
          agentIdentity: { select: { description: true } },
        },
      })
      return {
        members: members.map((member) => shapeMember(request.params.roomId, member)),
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: { memberRef?: string; version?: number }
  }>('/:roomId/members/remove', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    if (typeof request.body.memberRef !== 'string' || !/^member_[A-Za-z0-9_-]{32,64}$/.test(request.body.memberRef)) {
      return reply.code(400).send({ error: 'room_member_ref_required' })
    }
    if (!Number.isInteger(request.body.version) || Number(request.body.version) < 1) {
      return reply.code(400).send({ error: 'room_member_version_required' })
    }
    const actor = await activeHumanMembership(request.params.roomId, request.userId)
    if (!actor) return reply.code(403).send({ error: 'room_admin_forbidden' })
    const members = await prisma.roomMembership.findMany({
      where: { roomId: request.params.roomId },
      select: { id: true },
    })
    const target = members.find(
      (member) => publicMemberRef(request.params.roomId, member.id) === request.body.memberRef,
    )
    if (!target) return reply.code(404).send({ error: 'room_member_not_found' })
    try {
      const result = await removeRoomMembership({
        roomId: request.params.roomId,
        actorMembershipId: actor.id,
        targetMembershipId: target.id,
        expectedTargetVersion: request.body.version,
      })
      finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
      await broadcastRoomEvent(request.params.roomId, {
        event: 'room.membership.updated',
        roomId: request.params.roomId,
      })
      for (const message of result.messages) {
        await broadcastRoomMessageRecord(request.params.roomId, message)
      }
      return {
        removed: result.removedMembershipIds.length > 0,
        removedCount: result.removedMembershipIds.length,
        idempotent: result.idempotent,
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Body: { roomId?: string; inviteToken?: string; message?: string } }>(
    '/join',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      const token = request.body.inviteToken
      const roomId = request.body.roomId
      if (typeof token !== 'string' || !INVITE_TOKEN.test(token)) {
        return reply
          .code(400)
          .send({ error: 'invalid_invite_url', message: 'Room invite is invalid.' })
      }
      if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(roomId)) {
        return reply
          .code(400)
          .send({ error: 'invalid_invite_url', message: 'Room invite is invalid.' })
      }
      try {
        const exchanged = await exchangeRoomInviteToken(token, roomId)
        const result = await joinRoomFromBrowserState({
          browserState: exchanged.browserState,
          applicantUserId: request.userId,
          message: request.body.message,
        })
        await broadcastRoomEvent(result.roomId, {
          event:
            result.outcome === 'joined' ? 'room.membership.updated' : 'room.join_request.created',
          roomId: result.roomId,
          entityId: result.outcome === 'joined' ? result.membership.id : result.joinRequest.id,
        })
        if (result.outcome === 'joined' && result.message) {
          await broadcastRoomMessageRecord(result.roomId, result.message)
        }
        if (result.outcome === 'pending_approval') {
          return reply.code(202).send({
            outcome: 'pending_approval',
            idempotent: result.idempotent,
            nextAction: { type: 'wait_for_room_approval' },
          })
        }
        const room = await prisma.room.findUnique({
          where: { id: result.roomId },
          select: { name: true },
        })
        const handoff = await createRoomBrowserHandoff({
          roomId: result.roomId,
          userId: request.userId,
          membershipId: result.membership.id,
        })
        const canonicalUrl = roomWebUrl(request, result.roomId)
        const launchUrl = roomLaunchUrl(request, result.roomId, handoff.token)
        return reply.code(result.idempotent ? 200 : 201).send({
          outcome: 'joined',
          idempotent: result.idempotent,
          room: { name: room?.name ?? '', canonicalUrl, launchUrl },
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{ Params: { roomId: string } }>('/:roomId/open', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const membership = await activeHumanMembership(request.params.roomId, request.userId)
    if (!membership) {
      return reply.code(403).send({
        error: 'room_membership_required',
        message: 'An active Room membership is required.',
        nextAction: { type: 'request_invite' },
      })
    }
    const handoff = await createRoomBrowserHandoff({
      roomId: membership.room.id,
      userId: request.userId,
      membershipId: membership.id,
    })
    const canonicalUrl = roomWebUrl(request, membership.room.id)
    const launchUrl = roomLaunchUrl(request, membership.room.id, handoff.token)
    return {
      outcome: 'ready',
      room: { name: membership.room.name, canonicalUrl, launchUrl },
      nextAction: { type: 'open_url', url: launchUrl },
    }
  })

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/status',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      const membership = await activeHumanMembership(request.params.roomId, request.userId)
      if (!membership) return reply.code(403).send({ error: 'room_read_forbidden' })
      const members = await prisma.roomMembership.findMany({
        where: { roomId: request.params.roomId, status: 'active' },
        orderBy: [{ principalType: 'asc' }, { joinedAt: 'asc' }],
        select: {
          displayAlias: true,
          principalType: true,
          role: true,
          agentIdentity: { select: { description: true } },
        },
      })
      const canonicalUrl = roomWebUrl(request, membership.room.id)
      return {
        room: {
          name: membership.room.name,
          status: membership.room.status,
          visibility: membership.room.visibility,
          joinPolicy: membership.room.joinPolicy,
          lastSequence: membership.room.nextSequence.toString(),
          canonicalUrl,
        },
        currentUser: { role: membership.role },
        members: members.map((member) => ({
          nickname: member.displayAlias,
          type: member.principalType,
          role: member.role,
          ...(member.principalType === 'agent' && member.agentIdentity?.description
            ? { description: member.agentIdentity.description }
            : {}),
        })),
      }
    },
  )

  app.get<{
    Params: { roomId: string }
    Querystring: { before?: string; after?: string; limit?: string }
  }>('/:roomId/messages', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const membership = await activeHumanMembership(request.params.roomId, request.userId)
    if (!membership) return reply.code(403).send({ error: 'room_read_forbidden' })
    if (request.query.before != null && request.query.after != null) {
      return reply.code(400).send({ error: 'ambiguous_sequence_cursor' })
    }
    const before = parseOptionalSequence(request.query.before)
    const after = parseOptionalSequence(request.query.after)
    if (before === false || after === false)
      return reply.code(400).send({ error: 'invalid_sequence' })
    const limit = parsePublicLimit(request.query.limit)
    if (!limit) return reply.code(400).send({ error: 'invalid_limit' })
    const floor = membership.historyFromSequence > 0n ? membership.historyFromSequence - 1n : 0n
    const where = {
      roomId: request.params.roomId,
      createdAt: { gte: roomMessageRetentionCutoff() },
      sequence:
        before !== null
          ? { gt: floor, lt: before }
          : after !== null
            ? { gt: after > floor ? after : floor }
            : { gt: floor },
    }
    const descending = before !== null || (before === null && after === null)
    const records = await prisma.roomMessage.findMany({
      where,
      include: {
        attachments: true,
        authorMembership: { select: { displayAlias: true, status: true } },
      },
      orderBy: { sequence: descending ? 'desc' : 'asc' },
      take: limit,
    })
    const ordered = descending ? records.reverse() : records
    return { messages: ordered.map((message) => shapeCliMessage(shapeRoomMessage(message))) }
  })

  app.post<{
    Params: { roomId: string }
    Body: { clientMessageId?: string; text?: string; attachmentIds?: string[] }
  }>('/:roomId/messages', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const membership = await activeHumanMembership(request.params.roomId, request.userId)
    if (!membership) return reply.code(403).send({ error: 'room_write_forbidden' })
    try {
      const text = request.body.text ?? ''
      const mentionMembershipIds = await resolveMentionMembershipIds(request.params.roomId, text)
      const result = await sendRoomTextMessage({
        roomId: request.params.roomId,
        authorMembershipId: membership.id,
        clientMessageId: request.body.clientMessageId ?? `cli:${crypto.randomUUID()}`,
        text,
        mentionMembershipIds,
        attachmentIds: request.body.attachmentIds,
        source: 'cli',
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
      return reply.code(result.idempotent ? 200 : 201).send({
        message: shapeCliMessage(message),
        idempotent: result.idempotent,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

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
  }>('/:roomId/attachments/init', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try {
      return await initializeRoomAttachment({
        roomId: request.params.roomId,
        userId: request.userId,
        clientUploadId: request.body.clientUploadId ?? '',
        originalName: request.body.name ?? '',
        mediaKind: request.body.mediaKind ?? 'file',
        mimeType: request.body.mimeType ?? '',
        byteSize: request.body.byteSize ?? 0,
        sha256: request.body.sha256 ?? '',
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { roomId: string; attachmentId: string } }>(
    '/:roomId/attachments/:attachmentId/complete',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        const result = await completeRoomAttachment({
          roomId: request.params.roomId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
        })
        return {
          attachment: {
            attachmentId: result.attachment.id,
            mediaKind: result.attachment.mediaKind,
            name: result.attachment.safeName,
            mimeType: result.attachment.mimeType,
            byteSize: result.attachment.byteSize.toString(),
            sha256: result.attachment.sha256,
          },
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string; attachmentId: string } }>(
    '/:roomId/attachments/:attachmentId/download',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        return await getRoomAttachmentDownload({
          roomId: request.params.roomId,
          attachmentId: request.params.attachmentId,
          userId: request.userId,
        })
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{ Params: { roomId: string } }>(
    '/:roomId/leave',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        const result = await leaveRoom({ roomId: request.params.roomId, userId: request.userId })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
          entityId: result.leftMembershipIds[0],
        })
        return { outcome: 'left', idempotent: result.idempotent }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
}

async function activeHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  if (membership?.status !== 'active' || membership.room.status !== 'active') return null
  if (membership.room.conversationKind === 'work') {
    const migration = await prisma.sessionRoomMigration.findFirst({
      where: { roomId, state: 'canonical' }, select: { sessionId: true },
    })
    return migration ? membership : null
  }
  if (membership.room.conversationKind !== 'published_ai') return membership
  const [control, direct] = await Promise.all([
    prisma.conversationWriteControl.findUnique({ where: { name: 'published_ai' },
      select: { mode: true } }),
    prisma.agentDirectConversation.findUnique({ where: { roomId },
      select: { canonicalState: true } }),
  ])
  return control?.mode === 'canonical' && direct?.canonicalState === 'ready'
    ? membership : null
}

function shapeRoomSummary(
  request: FastifyRequest,
  room: {
    id: string
    name: string
    status: string
    visibility: string
    joinPolicy: string
    nextSequence: bigint
    updatedAt: Date
    conversationKind?: string
  },
  role?: string,
) {
  return {
    name: room.name,
    status: room.status,
    visibility: room.visibility,
    joinPolicy: room.joinPolicy,
    lastSequence: room.nextSequence.toString(),
    canonicalUrl: roomWebUrl(request, room.id),
    version: room.updatedAt.toISOString(),
    ...(room.conversationKind ? { conversationKind: room.conversationKind } : {}),
    ...(role ? { currentUser: { role } } : {}),
  }
}

function shapeMember(
  roomId: string,
  member: {
    id: string
    displayAlias: string
    principalType: string
    role: string
    membershipEpoch: number
    agentIdentity?: { description: string } | null
  },
) {
  return {
    memberRef: publicMemberRef(roomId, member.id),
    nickname: member.displayAlias,
    type: member.principalType,
    role: member.role,
    version: member.membershipEpoch,
    ...(member.principalType === 'agent' && member.agentIdentity?.description
      ? { description: member.agentIdentity.description }
      : {}),
  }
}

function publicMemberRef(roomId: string, membershipId: string): string {
  const secret = process.env.ROOM_CAPABILITY_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me'
  return `member_${crypto.createHmac('sha256', secret).update(`${roomId}:${membershipId}`).digest('base64url')}`
}

function parseRoomVersion(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : parsed
}

async function resolveMentionMembershipIds(roomId: string, text: string): Promise<string[]> {
  if (!text.includes('@')) return []
  const members = await prisma.roomMembership.findMany({
    where: { roomId, status: 'active' },
    select: { id: true, displayAlias: true },
  })
  return members
    .sort((left, right) => right.displayAlias.length - left.displayAlias.length)
    .filter((member) => text.includes(`@${member.displayAlias}`))
    .map((member) => member.id)
}

function shapeCliMessage(message: ReturnType<typeof shapeRoomMessage>): RoomCliMessageView {
  return {
    sequence: message.sequence,
    kind: message.kind,
    source: message.source ?? 'app',
    author: {
      nickname: message.author.displayName,
      type: message.author.principalType,
      ...(message.author.ownerDisplayName
        ? { ownerNickname: message.author.ownerDisplayName }
        : {}),
      ...(message.author.avatar ? { avatar: message.author.avatar } : {}),
    },
    mentions: (message.mentions ?? []).map((mention) => ({
      nickname: mention.displayName,
      type: mention.principalType,
    })),
    text: message.text ?? null,
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      mediaKind: attachment.mediaKind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      durationMs: attachment.durationMs ?? null,
      status: attachment.status,
    })),
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
  }
}

function requireMachine(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.machineId) return true
  void reply.code(403).send({ error: 'machine_auth_required' })
  return false
}

function parseOptionalSequence(value: string | undefined): bigint | null | false {
  if (value == null) return null
  return SEQUENCE.test(value) ? BigInt(value) : false
}

function parsePublicLimit(value: string | undefined): number | null {
  if (value == null) return 50
  if (!/^\d+$/.test(value)) return null
  const limit = Number(value)
  return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : null
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoomInviteBrowserError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  if (!(error instanceof RoomPolicyError)) throw error
  const status = error.code.endsWith('_forbidden')
    ? 403
    : error.code.endsWith('_conflict')
      ? 409
    : error.code.endsWith('_not_found')
      ? 404
      : error.code === 'room_invite_unavailable'
        ? 410
        : 400
  return reply.code(status).send({
    error: error.code,
    message: error.message,
    ...(error.code === 'join_message_required'
      ? { nextAction: { type: 'request_join_message' } }
      : {}),
  })
}
