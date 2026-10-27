// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-invite-browser-routes.test.ts

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { registerAuthDecorators, requireAuth } from '../middleware/auth.js'
import {
  bindRoomInviteApplicant,
  clearRoomInviteApplicant,
  exchangeRoomInviteToken,
  getRoomInviteBootstrap,
  readRoomInviteApplicant,
  RoomInviteBrowserError,
} from '../services/room-invite-browser.js'
import {
  getHumanRoomInviteEntryState,
  joinRoomFromBrowserState,
} from '../services/room-membership.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { broadcastRoomEvent, broadcastRoomMessageRecord } from '../services/room-events.js'
import {
  ROOM_AGENT_BOOTSTRAP,
  roomAgentBootstrapLinkHeader,
} from '../services/room-agent-bootstrap.js'
import { verifyPhoneIdentity, AuthRouteError } from '../services/auth-session.js'
import { offerScopedNicknameSetup } from '../services/nickname-setup.js'
import {
  authenticateRoomBrowserSession,
  clearRoomBrowserCookie,
  createActiveRoomBrowserSession,
  exchangeRoomBrowserHandoff,
  readRoomBrowserCookie,
  roomBrowserClientLabel,
  RoomBrowserSessionError,
  serializeRoomBrowserCookie,
} from '../services/room-browser-session.js'

import { requireTrustedRoomBrowser } from '../services/room-browser-identity.js'

const PROD_COOKIE = '__Host-shennian-room-invite'
const DEV_COOKIE = 'shennian-room-invite-dev'

export async function roomInviteBrowserRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.addHook('onRequest', async (request, reply) => {
    // Invitation/handoff links are deliberately navigable from external sites.
    // They carry their own one-time capability and never mint a browser identity.
    if (
      request.method === 'GET' &&
      ['/spaces/:roomId', '/room-invites/agent-bootstrap'].includes(request.routeOptions.url ?? '')
    )
      return
    return requireTrustedRoomBrowser(request, reply)
  })

  app.get<{
    Params: { roomId: string }
    Querystring: { invite?: string; access?: string }
  }>('/spaces/:roomId', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    reply.header('link', roomAgentBootstrapLinkHeader())
    const cleanPath = `/spaces/${encodeURIComponent(request.params.roomId)}`
    const { invite, access } = request.query
    if ((invite && access) || (!invite && !access)) {
      return reply.code(400).send({ error: 'room_entry_capability_required' })
    }
    if (invite) {
      try {
        const state = await exchangeRoomInviteToken(invite, request.params.roomId)
        reply.header(
          'set-cookie',
          serializeInviteCookie(request, state.browserState, state.expiresAt),
        )
      } catch (error) {
        if (!(error instanceof RoomInviteBrowserError)) throw error
        reply.header('set-cookie', clearInviteCookies(request))
      }
      return reply.redirect(cleanPath, 303)
    }
    try {
      const exchanged = await exchangeRoomBrowserHandoff(
        access,
        request.params.roomId,
        roomBrowserClientLabel(request),
        undefined,
        readRoomBrowserCookie(request, request.params.roomId),
      )
      reply.header(
        'set-cookie',
        serializeRoomBrowserCookie(
          request,
          exchanged.token,
          exchanged.expiresAt,
          request.params.roomId,
        ),
      )
    } catch (error) {
      if (!(error instanceof RoomBrowserSessionError)) throw error
      try {
        await authenticateRoomBrowserSession(
          readRoomBrowserCookie(request, request.params.roomId),
          request.params.roomId,
        )
      } catch (sessionError) {
        if (!(sessionError instanceof RoomBrowserSessionError)) throw sessionError
        reply.header('set-cookie', clearRoomBrowserCookie(request, request.params.roomId))
      }
    }
    return reply.redirect(cleanPath, 303)
  })

  app.get('/room-invites/agent-bootstrap', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300')
    reply.header('content-type', 'application/json; charset=utf-8')
    reply.header('x-content-type-options', 'nosniff')
    return ROOM_AGENT_BOOTSTRAP
  })

  app.get('/room-invites/bootstrap', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    reply.header('link', roomAgentBootstrapLinkHeader())
    try {
      return await getRoomInviteBootstrap(readInviteCookie(request))
    } catch (error) {
      if (!(error instanceof RoomInviteBrowserError)) throw error
      return reply.code(error.statusCode).send({ error: error.code })
    }
  })

  app.post<{ Body: { roomId?: string; token?: string } }>(
    '/room-invites/native/exchange',
    { preHandler: requireAuth },
    async (request, reply) => {
      setPrivateResponseHeaders(reply)
      try {
        const roomId = request.body.roomId ?? ''
        const entryState = await getHumanRoomInviteEntryState({
          roomId,
          userId: request.userId,
        })
        if (entryState !== 'can_join') return { entryState, roomId }
        const exchanged = await exchangeRoomInviteToken(request.body.token, roomId)
        const invite = await getRoomInviteBootstrap(exchanged.browserState)
        return { joinHandle: exchanged.browserState, invite, entryState }
      } catch (error) {
        if (!(error instanceof RoomInviteBrowserError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )

  app.post<{ Body: { joinHandle?: string; message?: string } }>(
    '/room-invites/native/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      setPrivateResponseHeaders(reply)
      try {
        const result = await joinRoomFromBrowserState({
          browserState: request.body.joinHandle,
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
        return reply.code(result.idempotent ? 200 : result.outcome === 'joined' ? 201 : 202).send({
          outcome: result.outcome,
          roomId: result.roomId,
          joinRequestId: result.outcome === 'pending_approval' ? result.joinRequest.id : undefined,
          idempotent: result.idempotent,
        })
      } catch (error) {
        if (!(error instanceof RoomPolicyError)) throw error
        const code = error.code === 'room_invite_unavailable' ? 410 : 400
        return reply.code(code).send({
          error: error.code,
          message: error.message,
          ...(error.code === 'join_message_required'
            ? { nextAction: { type: 'request_join_message' } }
            : {}),
        })
      }
    },
  )

  app.post<{ Body: { message?: string } }>(
    '/room-invites/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      setPrivateResponseHeaders(reply)
      try {
        const result = await joinRoomFromBrowserState({
          browserState: readInviteCookie(request),
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
        let roomCookie: string | null = null
        if (result.outcome === 'joined') {
          const scoped = await createActiveRoomBrowserSession({
            roomId: result.roomId,
            userId: request.userId,
            membershipId: result.membership.id,
            clientLabel: roomBrowserClientLabel(request),
            existingToken: readRoomBrowserCookie(request, result.roomId),
          })
          roomCookie = serializeRoomBrowserCookie(
            request,
            scoped.token,
            scoped.expiresAt,
            result.roomId,
          )
        }
        reply.header(
          'set-cookie',
          roomCookie ? [clearInviteCookies(request), roomCookie] : clearInviteCookies(request),
        )
        return reply.code(result.idempotent ? 200 : result.outcome === 'joined' ? 201 : 202).send({
          outcome: result.outcome,
          roomId: result.roomId,
          membershipId: result.outcome === 'joined' ? result.membership.id : undefined,
          joinRequestId: result.outcome === 'pending_approval' ? result.joinRequest.id : undefined,
          idempotent: result.idempotent,
          scopedPath:
            result.outcome === 'joined'
              ? `/spaces/${encodeURIComponent(result.roomId)}`
              : undefined,
        })
      } catch (error) {
        if (error instanceof RoomBrowserSessionError) {
          return reply.code(error.statusCode).send({ error: error.code })
        }
        if (!(error instanceof RoomPolicyError)) throw error
        if (error.code === 'room_invite_unavailable') {
          reply.header('set-cookie', clearInviteCookies(request))
        }
        const code =
          error.code === 'profile_name_required'
            ? 409
            : error.code === 'room_invite_unavailable'
              ? 410
              : 400
        return reply.code(code).send({
          error: error.code,
          message: error.message,
          ...(error.code === 'join_message_required'
            ? { nextAction: { type: 'request_join_message' } }
            : {}),
        })
      }
    },
  )

  type BrowserJoinBody = {
    phone?: string
    code?: string
    name?: string
    message?: string
    rememberBrowser?: boolean
    roomId?: string
  }
  const joinWithIdentity =
    (verifyPhone: boolean, deferApprovalApplication = false) =>
    async (
      request: FastifyRequest<{ Body: BrowserJoinBody }>,
      reply: import('fastify').FastifyReply,
    ) => {
      setPrivateResponseHeaders(reply)
      let user: Awaited<ReturnType<typeof verifyPhoneIdentity>> | null = null
      try {
        user = verifyPhone
          ? await verifyPhoneIdentity({
              phone: request.body.phone ?? '',
              code: request.body.code ?? '',
              name: request.body.name,
            })
          : null
        if (!user) return reply.code(401).send({ error: 'room_browser_identity_required' })
        const result = await joinRoomFromBrowserState({
          browserState: readInviteCookie(request),
          applicantUserId: user.id,
          message: request.body.message,
          ...(request.body.roomId ? { expectedRoomId: request.body.roomId } : {}),
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
        const cookies = [clearInviteCookies(request)]
        if (result.outcome === 'joined') {
          const scoped = await createActiveRoomBrowserSession({
            roomId: result.roomId,
            userId: user.id,
            membershipId: result.membership.id,
            clientLabel: roomBrowserClientLabel(request),
            existingToken: readRoomBrowserCookie(request, result.roomId),
          })
          cookies.push(
            serializeRoomBrowserCookie(request, scoped.token, scoped.expiresAt, result.roomId),
          )
        }
        // Every phone verification grants this Room only, including older clients sending rememberBrowser.
        reply.header('set-cookie', cookies)
        return reply.code(result.outcome === 'joined' ? 201 : 202).send({
          nicknameSetup: verifyPhone ? await offerScopedNicknameSetup(user) : undefined,
          outcome: result.outcome,
          roomId: result.roomId,
          joinRequestId: result.outcome === 'pending_approval' ? result.joinRequest.id : undefined,
          scopedPath:
            result.outcome === 'joined'
              ? `/spaces/${encodeURIComponent(result.roomId)}`
              : undefined,
          idempotent: result.idempotent,
        })
      } catch (error) {
        if (error instanceof AuthRouteError)
          return reply.code(error.statusCode).send({ error: error.message })
        if (error instanceof RoomBrowserSessionError)
          return reply.code(error.statusCode).send({ error: error.code })
        if (error instanceof RoomInviteBrowserError)
          return reply.code(error.statusCode).send({ error: error.code })
        if (!(error instanceof RoomPolicyError)) throw error
        if (deferApprovalApplication && user && error.code === 'join_message_required') {
          const browserState = readInviteCookie(request)
          const bootstrap = await getRoomInviteBootstrap(browserState)
          if (request.body.roomId && bootstrap.room.id !== request.body.roomId) {
            return reply.code(410).send({ error: 'room_invite_unavailable' })
          }
          await bindRoomInviteApplicant(browserState, {
            userId: user.id,
            roomId: bootstrap.room.id,
          })
          return reply.send({
            outcome: 'needs_application',
            roomId: bootstrap.room.id,
            nicknameSetup: await offerScopedNicknameSetup(user),
          })
        }
        if (deferApprovalApplication && user && error.code === 'room_invite_unavailable') {
          const bootstrap = await getRoomInviteBootstrap(readInviteCookie(request))
          if (bootstrap.room.joinPolicy === 'closed') {
            return reply.send({ outcome: 'join_closed', roomId: bootstrap.room.id })
          }
        }
        return reply.code(error.code === 'room_invite_unavailable' ? 410 : 400).send({
          error: error.code,
          message: error.message,
          ...(error.code === 'join_message_required'
            ? { nextAction: { type: 'request_join_message' } }
            : {}),
        })
      }
    }
  app.post<{ Body: BrowserJoinBody }>(
    '/room-invites/scoped/verify-phone-and-join',
    joinWithIdentity(true),
  )
  app.post<{ Body: BrowserJoinBody }>(
    '/room-invites/scoped/verify-phone',
    joinWithIdentity(true, true),
  )
  app.post<{ Body: BrowserJoinBody }>('/room-invites/scoped/join', async (request, reply) => {
    setPrivateResponseHeaders(reply)
    const browserState = readInviteCookie(request)
    try {
      const bootstrap = await getRoomInviteBootstrap(browserState)
      if (request.body.roomId && request.body.roomId !== bootstrap.room.id) {
        return reply.code(410).send({ error: 'room_invite_unavailable' })
      }
      const applicant = await readRoomInviteApplicant(browserState, bootstrap.room.id)
      if (!applicant) return reply.code(401).send({ error: 'room_browser_identity_required' })
      const result = await joinRoomFromBrowserState({
        browserState,
        applicantUserId: applicant.userId,
        expectedRoomId: bootstrap.room.id,
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
      const cookies = [clearInviteCookies(request)]
      if (result.outcome === 'joined') {
        const scoped = await createActiveRoomBrowserSession({
          roomId: result.roomId,
          userId: applicant.userId,
          membershipId: result.membership.id,
          clientLabel: roomBrowserClientLabel(request),
          existingToken: readRoomBrowserCookie(request, result.roomId),
        })
        cookies.push(
          serializeRoomBrowserCookie(request, scoped.token, scoped.expiresAt, result.roomId),
        )
      }
      await clearRoomInviteApplicant(browserState)
      reply.header('set-cookie', cookies)
      return reply.code(result.idempotent ? 200 : result.outcome === 'joined' ? 201 : 202).send({
        outcome: result.outcome,
        roomId: result.roomId,
        joinRequestId: result.outcome === 'pending_approval' ? result.joinRequest.id : undefined,
        scopedPath:
          result.outcome === 'joined' ? `/spaces/${encodeURIComponent(result.roomId)}` : undefined,
        idempotent: result.idempotent,
      })
    } catch (error) {
      if (error instanceof RoomInviteBrowserError)
        return reply.code(error.statusCode).send({ error: error.code })
      if (error instanceof RoomBrowserSessionError)
        return reply.code(error.statusCode).send({ error: error.code })
      if (!(error instanceof RoomPolicyError)) throw error
      return reply.code(error.code === 'room_invite_unavailable' ? 410 : 400).send({
        error: error.code,
        message: error.message,
        ...(error.code === 'join_message_required'
          ? { nextAction: { type: 'request_join_message' } }
          : {}),
      })
    }
  })
}

function setPrivateResponseHeaders(reply: {
  header: (name: string, value: string) => unknown
}): void {
  reply.header('cache-control', 'no-store, max-age=0')
  reply.header('pragma', 'no-cache')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('x-robots-tag', 'noindex, nofollow, noarchive')
  reply.header('vary', 'Cookie')
}

function isSecureRequest(request: FastifyRequest): boolean {
  return (
    request.protocol === 'https' ||
    request.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production'
  )
}

function serializeInviteCookie(request: FastifyRequest, value: string, expiresAt: Date): string {
  const secure = isSecureRequest(request)
  const name = secure ? PROD_COOKIE : DEV_COOKIE
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    'Max-Age=900',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

function clearInviteCookies(request: FastifyRequest): string {
  const secure = isSecureRequest(request)
  return [
    `${secure ? PROD_COOKIE : DEV_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

function readInviteCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie
  if (!header || header.length > 8192) return undefined
  const found: string[] = []
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    if (name !== PROD_COOKIE && name !== DEV_COOKIE) continue
    found.push(part.slice(separator + 1).trim())
  }
  return found.length === 1 ? found[0] : undefined
}
