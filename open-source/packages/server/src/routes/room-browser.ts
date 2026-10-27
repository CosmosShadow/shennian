import { executeSchedule, listSchedules } from '../services/conversation-schedules.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-session.test.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { sendRoomTextMessage } from '../services/room-core.js'
import { broadcastRoomEvent, broadcastRoomEventToUsers, broadcastAuthorReadAdvanced, broadcastRoomMessageRecord } from '../services/room-events.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { scheduleRoomMessagePush } from '../services/room-message-push.js'
import { noticeUnavailableAgents } from '../services/room-agent-delivery-notices.js'
import { publicUserAvatar } from '../services/user-avatar.js'
import { publicAgentAvatar } from '../services/agent-avatar.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { requireAuth } from '../middleware/auth.js'
import { verifyPhoneIdentity, AuthRouteError } from '../services/auth-session.js'
import { offerScopedNicknameSetup } from '../services/nickname-setup.js'
import {
  clearRoomBrowserCookie,
  readRoomBrowserCookie,
  createActiveRoomBrowserSession,
  roomBrowserClientLabel,
  RoomBrowserSessionError,
  serializeRoomBrowserCookie,
} from '../services/room-browser-session.js'
import {
  authenticateRoomBrowserRequest, clearRoomIdentityCookie,
  logoutRoomBrowser, requireTrustedRoomBrowser,
} from '../services/room-browser-identity.js'
import { addRoomBrowserSocket } from '../services/room-browser-events.js'
import {
  completeRoomAttachmentForMembership,
  getRoomAttachmentDownload,
  initializeRoomAttachmentForMembership,
} from '../services/room-attachments.js'
import {
  confirmRoomBrowserApproval,
  consumeRoomBrowserApproval,
  createRoomBrowserApproval,
  RoomBrowserApprovalError,
  previewRoomBrowserApproval,
} from '../services/room-browser-approval.js'
import { deriveRoomBindingAvailability } from '../services/agent-runtime-availability.js'
import { getCanonicalRoomInvite, joinOpenRoomFromLink } from '../services/room-membership.js'
import { roomInviteUrl } from '../services/public-web-url.js'
import { roomMessageRetentionCutoff } from '../services/room-message-retention.js'
import { advanceRoomReadState } from '../services/room-read-state.js'

function privateHeaders(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store, max-age=0')
  reply.header('pragma', 'no-cache')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('x-robots-tag', 'noindex, nofollow, noarchive')
  reply.header('vary', 'Cookie')
}

async function requireRoomSession(request: FastifyRequest, reply: FastifyReply) {
  privateHeaders(reply)
  const roomId = readExpectedRoomId(request)
  if (!roomId) {
    void reply.code(400).send({ error: 'room_id_required' })
    return null
  }
  try {
    return await authenticateRoomBrowserRequest(request, roomId)
  } catch (error) {
    if (!(error instanceof RoomBrowserSessionError)) throw error
    void reply.code(error.statusCode).send({ error: error.code })
    return null
  }
}

function readExpectedRoomId(request: FastifyRequest): string | null {
  const value = request.headers['x-shennian-room-id']
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value) ? value : null
}

function parseSequence(value: string | undefined): bigint | null {
  if (value == null || value === '') return 0n
  return /^\d+$/.test(value) ? BigInt(value) : null
}

export async function roomBrowserRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireTrustedRoomBrowser)
  app.get('/room-browser/schedules', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    return { tasks: await listSchedules(session.userId, { roomId: session.roomId }) }
  })
  app.post<{ Body: Record<string, unknown> }>('/room-browser/schedules', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    const body = request.body
    const task = await prisma.conversationSchedule.findFirst({ where: { id: String(body.id ?? ''), userId: session.userId, roomId: session.roomId, state: { not: 'deleted' } } })
    if (!task) return reply.code(404).send({ error: 'schedule_not_found' })
    try { return { tasks: await executeSchedule(session.userId, task.sessionId, body.action as import('@shennian/wire').ScheduleAction, body) } }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'schedules_unavailable' }) }
  })

  // Phone control surface: one batch request, never a per-row authorization poll.
  app.get('/room-browser/authorizations', { preHandler: requireAuth }, async (request, reply) => {
    privateHeaders(reply)
    const sessions = await prisma.roomBrowserSession.findMany({
      where: { userId: request.userId, authorizationVersion: 2, identityId: null, status: 'active', expiresAt: { gt: new Date() },
        membership: { status: 'active', principalType: 'human', userId: request.userId }, room: { status: 'active' } },
      select: { id: true, roomId: true, expiresAt: true },
    })
    return { sessions: sessions.map((session) => ({ ...session, expiresAt: session.expiresAt.toISOString() })) }
  })
  app.get('/room-browser/identity', async (request, reply) => {
    privateHeaders(reply)
    return { user: null, expiresAt: null, scopedOnly: true }
  })
  app.post('/room-browser/logout', async (request, reply) => {
    privateHeaders(reply)
    const roomId = readExpectedRoomId(request)
    if (!roomId) return reply.code(400).send({ error: 'room_id_required' })
    await logoutRoomBrowser(request, roomId)
    reply.header('set-cookie', [clearRoomIdentityCookie(request), clearRoomBrowserCookie(request), clearRoomBrowserCookie(request, roomId)])
    return { ok: true }
  })
  app.get<{ Querystring: { roomId?: string } }>(
    '/room-browser/events',
    { websocket: true },
    (socket, request) => {
      const roomId = request.query.roomId
      if (typeof roomId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(roomId)) {
        socket.close(4400, 'Room is required')
        return
      }
      void authenticateRoomBrowserRequest(request, roomId)
        .then(async (session) => {
          const remove = addRoomBrowserSocket(
            session.roomId,
            session.id,
            session.membershipId,
            session.expiresAt,
            socket,
          )
          const expiryTimer = setTimeout(
            () => socket.close(4401, 'Room access expired'),
            Math.max(1, session.expiresAt.getTime() - Date.now()),
          )
          const cleanup = () => {
            clearTimeout(expiryTimer)
            remove()
          }
          socket.on('close', cleanup)
          socket.on('error', cleanup)
          // Register before rechecking, so a concurrent logout/revocation cannot
          // slip between authentication and registration and leave a live socket.
          const confirmed = await authenticateRoomBrowserRequest(request, roomId)
          if (confirmed.id !== session.id) throw new RoomBrowserSessionError('room_browser_session_unavailable')
          socket.send(
            JSON.stringify({
              type: 'event',
              event: 'room.browser.ready',
              payload: { roomId: session.roomId },
            }),
          )
        })
        .catch(() => socket.close(4401, 'Room access unavailable'))
    },
  )

  app.get('/room-browser/bootstrap', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    const memberships = await prisma.roomMembership.findMany({
      where: { roomId: session.roomId, status: 'active' },
      orderBy: [{ principalType: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        principalType: true,
        ownerUserId: true,
        parentHumanMembershipId: true,
        displayAlias: true,
        role: true,
        joinedAt: true,
        user: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true } },
        ownerUser: {
          select: { id: true, name: true, avatarVersion: true, avatarUpdatedAt: true },
        },
        agentIdentity: {
          select: {
            id: true,
            description: true,
            avatarVersion: true,
            avatarUpdatedAt: true,
          },
        },
        binding: {
          select: {
            status: true,
            activationMode: true,
            detachedReason: true,
            machine: { select: { paired: true, online: true } },
          },
        },
      },
    })
    const before = session.room.nextSequence + 1n
    const floor =
      session.membership.historyFromSequence > 0n ? session.membership.historyFromSequence - 1n : 0n
    const retentionCutoff = roomMessageRetentionCutoff()
    const page = await prisma.roomMessage.findMany({
      where: {
        roomId: session.roomId,
        sequence: { gt: floor, lt: before },
        createdAt: { gte: retentionCutoff },
      },
      include: {
        attachments: true,
        authorMembership: { select: { displayAlias: true, status: true } },
      },
      orderBy: { sequence: 'desc' },
      take: 51,
    })
    const hasOlder = page.length > 50
    const messages = page.slice(0, 50).reverse().map(shapeRoomMessage)
    return {
      room: {
        id: session.room.id,
        name: session.room.name,
        description: session.room.description,
        status: session.room.status,
        joinPolicy: session.room.joinPolicy,
        lastSequence: session.room.nextSequence.toString(),
      },
      browserLogoutAvailable: true,
      currentUser: { id: session.user.id, name: session.user.name },
      membershipId: session.membership.id,
      members: memberships.map((member) => ({
        id: member.id,
        principalType: member.principalType,
        ownerUserId: member.ownerUserId,
        parentHumanMembershipId: member.parentHumanMembershipId,
        displayAlias: member.displayAlias,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        avatar:
          member.principalType === 'human' && member.user
            ? publicUserAvatar(member.user)
            : member.principalType === 'agent'
              ? publicAgentAvatar(member.agentIdentity)
              : null,
        ownerAvatar: member.principalType === 'agent' ? publicUserAvatar(member.ownerUser) : null,
        ownerDisplayName: member.principalType === 'agent' ? member.ownerUser.name : null,
        description:
          member.principalType === 'agent' ? (member.agentIdentity?.description ?? '') : '',
        agentParticipation:
          member.principalType === 'agent'
            ? member.binding
              ? {
                  activationMode: member.binding.activationMode,
                  availability: deriveRoomBindingAvailability({
                    status: member.binding.status,
                    machine: member.binding.machine,
                    recovering: member.binding.detachedReason === 'recovering',
                  }),
                }
              : { activationMode: 'paused' as const, availability: 'unavailable' as const }
            : undefined,
      })),
      messages,
      hasOlder,
      retentionCutoff: retentionCutoff.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }
  })

  app.get('/room-browser/invite-link', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    try {
      const result = await getCanonicalRoomInvite({
        roomId: session.roomId,
        actorUserId: session.userId,
      })
      return {
        invite: {
          url: roomInviteUrl(request, session.roomId, result.rawToken),
          joinPolicy: session.room.joinPolicy,
        },
      }
    } catch (error) {
      if (!(error instanceof RoomPolicyError)) throw error
      return reply.code(403).send({ error: error.code, message: error.message })
    }
  })

  app.post<{ Params: { roomId: string } }>(
    '/room-browser/:roomId/authorize',
    { preHandler: requireAuth },
    async (request, reply) => {
      privateHeaders(reply)
      const membership = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!membership) {
        return reply.code(403).send({
          error: 'room_membership_required',
          nextAction: { type: 'request_invite' },
        })
      }
      try {
        const session = await createActiveRoomBrowserSession({
          roomId: request.params.roomId,
          userId: request.userId,
          membershipId: membership.id,
          clientLabel: roomBrowserClientLabel(request),
          existingToken: readRoomBrowserCookie(request, request.params.roomId),
        })
        reply.header(
          'set-cookie',
          serializeRoomBrowserCookie(request, session.token, session.expiresAt, request.params.roomId),
        )
        return { scopedPath: `/spaces/${encodeURIComponent(request.params.roomId)}` }
      } catch (error) {
        if (!(error instanceof RoomBrowserSessionError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )

  app.post<{ Params: { roomId: string } }>(
    '/room-browser/:roomId/qr/create',
    async (request, reply) => {
      privateHeaders(reply)
      try {
        const approval = await createRoomBrowserApproval(request.params.roomId)
        reply.header('set-cookie', serializeRoomBrowserCookie(request, approval.browserSecret, approval.expiresAt, `approval-${request.params.roomId}`))
        return {
          approvalToken: approval.token,
          payload: approval.payload,
          expiresAt: approval.expiresAt.toISOString(),
          roomName: approval.roomName,
        }
      } catch (error) {
        if (!(error instanceof RoomBrowserApprovalError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )

  app.post<{ Params: { roomId: string }; Body: { token?: string } }>(
    '/room-browser/:roomId/qr/preview', { preHandler: requireAuth }, async (request, reply) => {
      privateHeaders(reply)
      try {
        return await previewRoomBrowserApproval({ roomId: request.params.roomId, token: request.body.token, userId: request.userId })
      } catch (error) {
        if (!(error instanceof RoomBrowserApprovalError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: { token?: string; confirmed?: boolean }
  }>('/room-browser/:roomId/qr/confirm', { preHandler: requireAuth }, async (request, reply) => {
    privateHeaders(reply)
    try {
      if (request.body.confirmed !== true) return reply.code(409).send({ error: 'room_browser_confirmation_required' })
      const result = await confirmRoomBrowserApproval({
        roomId: request.params.roomId,
        token: request.body.token,
        userId: request.userId,
      })
      if ('joined' in result && result.joined?.joined) {
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.membership.updated', roomId: request.params.roomId, entityId: result.joined.membership.id,
        })
        if (result.joined.message) await broadcastRoomMessageRecord(request.params.roomId, result.joined.message)
      }
      return { status: result.status }
    } catch (error) {
      if (error instanceof RoomBrowserSessionError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }
      if (!(error instanceof RoomBrowserApprovalError)) throw error
      return reply.code(error.statusCode).send({ error: error.code })
    }
  })

  app.post<{
    Params: { roomId: string }
    Body: { token?: string }
  }>('/room-browser/:roomId/qr/status', async (request, reply) => {
    privateHeaders(reply)
    try {
      const result = await consumeRoomBrowserApproval({
        browserSecret: readRoomBrowserCookie(request, `approval-${request.params.roomId}`),
        roomId: request.params.roomId,
        token: request.body.token,
        clientLabel: roomBrowserClientLabel(request),
        existingToken: readRoomBrowserCookie(request, request.params.roomId),
      })
      if (result.status !== 'authorized') return result
      const nicknameSetup = await prisma.user.findUnique({ where: { id: result.userId } })
        .then(user => user ? offerScopedNicknameSetup(user) : undefined)
        .catch(() => undefined)
      reply.header(
        'set-cookie',
        serializeRoomBrowserCookie(request, result.token, result.expiresAt, request.params.roomId),
      )
      return {
        status: result.status,
        nicknameSetup,
        scopedPath: `/spaces/${encodeURIComponent(request.params.roomId)}`,
      }
    } catch (error) {
      if (error instanceof RoomBrowserSessionError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }
      if (!(error instanceof RoomBrowserApprovalError)) throw error
      return reply.code(error.statusCode).send({ error: error.code })
    }
  })

  app.post<{
    Params: { roomId: string }
    Body: { phone?: string; code?: string; name?: string; rememberBrowser?: boolean }
  }>('/room-browser/:roomId/scoped/verify-phone', async (request, reply) => {
    privateHeaders(reply)
    try {
      const user = await verifyPhoneIdentity({
        phone: request.body.phone ?? '',
        code: request.body.code ?? '',
        name: request.body.name,
      }, async (userId) => {
        const membership = userId && await findActiveHumanMembership(request.params.roomId, userId)
        if (membership) return
        const room = await prisma.room.findUnique({ where: { id: request.params.roomId }, select: { status: true, joinPolicy: true } })
        if (room?.status !== 'active' || room.joinPolicy !== 'open')
          throw new RoomBrowserSessionError('room_join_unavailable', 403)
      })
      let membership = await findActiveHumanMembership(request.params.roomId, user.id)
      if (!membership) {
        const joined = await joinOpenRoomFromLink({ roomId: request.params.roomId, userId: user.id })
        membership = await findActiveHumanMembership(request.params.roomId, user.id)
        if (joined.joined) {
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.membership.updated', roomId: request.params.roomId, entityId: joined.membership.id,
          })
          if (joined.message) await broadcastRoomMessageRecord(request.params.roomId, joined.message)
        }
        if (!membership) throw new RoomBrowserSessionError('room_join_unavailable', 403)
      }
      const session = await createActiveRoomBrowserSession({
        roomId: request.params.roomId,
        userId: user.id,
        membershipId: membership.id,
        clientLabel: roomBrowserClientLabel(request),
        existingToken: readRoomBrowserCookie(request, request.params.roomId),
      })
      reply.header(
        'set-cookie',
        serializeRoomBrowserCookie(request, session.token, session.expiresAt, request.params.roomId),
      )
      return { scopedPath: `/spaces/${encodeURIComponent(request.params.roomId)}`, nicknameSetup: await offerScopedNicknameSetup(user) }
    } catch (error) {
      if (error instanceof RoomPolicyError) return reply.code(403).send({ error: error.code })
      if (error instanceof RoomBrowserSessionError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }
      if (!(error instanceof AuthRouteError)) throw error
      return reply.code(error.statusCode).send({ error: error.message })
    }
  })

  app.get<{ Querystring: { before?: string; after?: string; limit?: string } }>(
    '/room-browser/messages',
    async (request, reply) => {
      const session = await requireRoomSession(request, reply)
      if (!session) return
      if (request.query.before != null && request.query.after != null) {
        return reply.code(400).send({ error: 'ambiguous_sequence_cursor' })
      }
      const before = request.query.before == null ? null : parseSequence(request.query.before)
      const after = request.query.after == null ? null : parseSequence(request.query.after)
      if (
        (request.query.before != null && before == null) ||
        (request.query.after != null && after == null)
      ) {
        return reply.code(400).send({ error: 'invalid_sequence' })
      }
      const limit = Math.max(
        1,
        Math.min(50, Number.parseInt(request.query.limit ?? '50', 10) || 50),
      )
      const floor =
        session.membership.historyFromSequence > 0n
          ? session.membership.historyFromSequence - 1n
          : 0n
      const descending = before != null || after == null
      const retentionCutoff = roomMessageRetentionCutoff()
      const records = await prisma.roomMessage.findMany({
        where: {
          roomId: session.roomId,
          createdAt: { gte: retentionCutoff },
          sequence:
            before != null
              ? { gt: floor, lt: before }
              : { gt: after != null && after > floor ? after : floor },
        },
        include: {
          attachments: true,
          authorMembership: { select: { displayAlias: true, status: true } },
        },
        orderBy: { sequence: descending ? 'desc' : 'asc' },
        take: limit + (descending ? 1 : 0),
      })
      const hasMore = descending ? records.length > limit : records.length === limit
      const selected = records.slice(0, limit)
      if (descending) selected.reverse()
      return {
        messages: selected.map(shapeRoomMessage),
        hasMore,
        retentionCutoff: retentionCutoff.toISOString(),
      }
    },
  )

  app.post<{
    Body: {
      clientMessageId?: string
      text?: string
      attachmentIds?: string[]
      mentionMembershipIds?: string[]
    }
  }>('/room-browser/messages', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    try {
      const result = await sendRoomTextMessage({
        roomId: session.roomId,
        authorMembershipId: session.membershipId,
        clientMessageId: request.body.clientMessageId ?? '',
        text: request.body.text ?? '',
        attachmentIds: request.body.attachmentIds,
        mentionMembershipIds: request.body.mentionMembershipIds,
        source: 'app',
      })
      const message = shapeRoomMessage(result.message)
      await broadcastRoomEvent(session.roomId, {
        event: 'room.message.created',
        roomId: session.roomId,
        sequence: message.sequence,
        message,
      })
      broadcastAuthorReadAdvanced(result)
      void scheduleRoomMessagePush({ roomId: session.roomId, messageId: message.id })
      if (!result.idempotent) void noticeUnavailableAgents(result.message)
      return reply.code(result.idempotent ? 200 : 201).send({ message })
    } catch (error) {
      if (!(error instanceof RoomPolicyError)) throw error
      return reply.code(400).send({ error: error.code, message: error.message })
    }
  })

  app.post<{
    Body: {
      clientUploadId?: string
      name?: string
      mediaKind?: 'image' | 'audio' | 'file'
      mimeType?: string
      byteSize?: number
      sha256?: string
    }
  }>('/room-browser/attachments/init', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    try {
      const result = await initializeRoomAttachmentForMembership(
        {
          roomId: session.roomId,
          userId: session.userId,
          clientUploadId: request.body.clientUploadId ?? '',
          originalName: request.body.name ?? '',
          mediaKind: request.body.mediaKind ?? 'file',
          mimeType: request.body.mimeType ?? '',
          byteSize: request.body.byteSize ?? 0,
          sha256: request.body.sha256 ?? '',
        },
        session.membershipId,
      )
      return reply.code(result.idempotent ? 200 : 201).send(result)
    } catch (error) {
      if (!(error instanceof RoomPolicyError)) throw error
      return reply.code(400).send({ error: error.code, message: error.message })
    }
  })

  app.post<{ Params: { attachmentId: string } }>(
    '/room-browser/attachments/:attachmentId/complete',
    async (request, reply) => {
      const session = await requireRoomSession(request, reply)
      if (!session) return
      try {
        const result = await completeRoomAttachmentForMembership(
          {
            roomId: session.roomId,
            attachmentId: request.params.attachmentId,
          },
          session.membershipId,
        )
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
        if (!(error instanceof RoomPolicyError)) throw error
        return reply.code(400).send({ error: error.code, message: error.message })
      }
    },
  )

  app.get<{ Params: { attachmentId: string } }>(
    '/room-browser/attachments/:attachmentId/download',
    async (request, reply) => {
      const session = await requireRoomSession(request, reply)
      if (!session) return
      try {
        return await getRoomAttachmentDownload({
          roomId: session.roomId,
          attachmentId: request.params.attachmentId,
          userId: session.userId,
        })
      } catch (error) {
        if (!(error instanceof RoomPolicyError)) throw error
        return reply.code(404).send({ error: error.code, message: error.message })
      }
    },
  )

  app.post('/room-browser/read-state', async (request, reply) => {
    const session = await requireRoomSession(request, reply)
    if (!session) return
    const body = (request.body ?? {}) as { lastReadSequence?: string }
    const sequence = parseSequence(body.lastReadSequence)
    if (sequence == null) return reply.code(400).send({ error: 'invalid_sequence' })
    const bounded = sequence > session.room.nextSequence ? session.room.nextSequence : sequence
    const { lastReadSequence, advanced } = await advanceRoomReadState({
      roomId: session.roomId,
      membershipId: session.membershipId,
      lastReadSequence: bounded,
    })
    if (advanced) {
      broadcastRoomEventToUsers([session.userId], {
        event: 'room.membership.updated',
        roomId: session.roomId,
        entityId: session.membershipId,
      })
    }
    return { lastReadSequence: lastReadSequence.toString() }
  })
}

async function findActiveHumanMembership(roomId: string, userId: string) {
  return prisma.roomMembership
    .findUnique({
      where: {
        roomId_principalKey: { roomId, principalKey: `human:${userId}` },
      },
      include: { room: true },
    })
    .then((membership) =>
      membership?.status === 'active' && membership.room.status === 'active' ? membership : null,
    )
}
