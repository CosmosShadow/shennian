// @arch open-source/docs/server-runtime.md
// @test src/__tests__/support-cli-routes.test.ts

import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RoomCliMessageView, SupportRoomSummary } from '@shennian/wire'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import { OfficialRoomUnavailableError, type OfficialRoomTarget } from '../services/official-room.js'
import {
  ensureSupportRoomMembership,
  getSupportRoomMembership,
  normalizeSupportText,
  requireSupportRoomMembership,
  SupportContactError,
} from '../services/support-contact.js'
import { sendRoomTextMessage } from '../services/room-core.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { RoomInviteBrowserError } from '../services/room-invite-browser.js'
import { broadcastRoomEvent, broadcastAuthorReadAdvanced } from '../services/room-events.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { scheduleRoomMessagePush } from '../services/room-message-push.js'
import { noticeUnavailableAgents } from '../services/room-agent-delivery-notices.js'
import { roomWebUrl } from '../services/public-web-url.js'
import { roomMessageRetentionCutoff } from '../services/room-message-retention.js'

const SEQUENCE = /^(0|[1-9]\d{0,19})$/

export async function supportCliRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineAuth = { preHandler: [requireUserOrMachineAuth, requireActivePlan] }

  app.get('/status', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try {
      const { officialRoom, membership } = await getSupportRoomMembership(request.userId)
      return { joined: membership != null, room: summarizeRoom(request, officialRoom) }
    } catch (error) {
      return sendError(app, reply, error)
    }
  })

  app.post<{ Body: { text?: string } }>('/ask', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try {
      const text = normalizeSupportText(request.body?.text)
      const { officialRoom, membership, justJoined } = await ensureSupportRoomMembership(
        request.userId,
      )
      const result = await sendRoomTextMessage({
        roomId: officialRoom.roomId,
        authorMembershipId: membership.id,
        clientMessageId: `support:${crypto.randomUUID()}`,
        text,
        mentionMembershipIds: [],
        source: 'cli',
      })
      const shapedMessage = shapeRoomMessage(result.message)
      await broadcastRoomEvent(officialRoom.roomId, {
        event: 'room.message.created',
        roomId: officialRoom.roomId,
        sequence: shapedMessage.sequence,
        message: shapedMessage,
      })
      broadcastAuthorReadAdvanced(result)
      void scheduleRoomMessagePush({ roomId: officialRoom.roomId, messageId: shapedMessage.id })
      if (!result.idempotent) void noticeUnavailableAgents(result.message)
      return reply.code(result.idempotent ? 200 : 201).send({
        outcome: 'sent',
        joinedRoom: justJoined,
        idempotent: result.idempotent,
        room: summarizeRoom(request, officialRoom),
        message: shapeSupportMessage(shapedMessage),
      })
    } catch (error) {
      return sendError(app, reply, error)
    }
  })

  app.get<{ Querystring: { before?: string; after?: string; limit?: string } }>(
    '/read',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        const { officialRoom, membership } = await requireSupportRoomMembership(request.userId)
        if (request.query.before != null && request.query.after != null) {
          return reply.code(400).send({ error: 'ambiguous_sequence_cursor' })
        }
        const before = parseOptionalSequence(request.query.before)
        const after = parseOptionalSequence(request.query.after)
        if (before === false || after === false) {
          return reply.code(400).send({ error: 'invalid_sequence' })
        }
        const limit = parsePublicLimit(request.query.limit)
        if (!limit) return reply.code(400).send({ error: 'invalid_limit' })
        const floor = membership.historyFromSequence > 0n ? membership.historyFromSequence - 1n : 0n
        const where = {
          roomId: officialRoom.roomId,
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
        return {
          messages: ordered.map((message) => shapeSupportMessage(shapeRoomMessage(message))),
        }
      } catch (error) {
        return sendError(app, reply, error)
      }
    },
  )
}

function summarizeRoom(request: FastifyRequest, officialRoom: OfficialRoomTarget): SupportRoomSummary {
  return {
    roomId: officialRoom.roomId,
    name: officialRoom.name,
    canonicalUrl: roomWebUrl(request, officialRoom.roomId),
  }
}

function shapeSupportMessage(message: ReturnType<typeof shapeRoomMessage>): RoomCliMessageView {
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

function sendError(app: FastifyInstance, reply: FastifyReply, error: unknown) {
  if (error instanceof SupportContactError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  if (error instanceof OfficialRoomUnavailableError) {
    return reply.code(503).send({ error: 'official_room_unavailable' })
  }
  if (error instanceof RoomInviteBrowserError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  if (error instanceof RoomPolicyError) {
    const status = error.code.endsWith('_forbidden')
      ? 403
      : error.code.endsWith('_not_found')
        ? 404
        : error.code === 'room_invite_unavailable'
          ? 410
          : 400
    return reply.code(status).send({ error: error.code, message: error.message })
  }
  app.log.warn({ error }, 'Support contact request failed')
  throw error
}
