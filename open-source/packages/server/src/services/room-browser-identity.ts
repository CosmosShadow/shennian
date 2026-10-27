// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-identity.test.ts

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { hashRoomInviteCapability } from './room-invite-browser.js'
import {
  authenticateRoomBrowserSession,
  readRoomBrowserCookie,
  RoomBrowserSessionError,
  serializeRoomBrowserCookie,
} from './room-browser-session.js'
import { publicWebAppBaseUrl } from './public-web-url.js'
import { notifyRoomBrowserAccessChanged } from './room-browser-notifications.js'
import { publishRoomBrowserSessionRevoked } from '../relay/connection-control.js'

const COOKIE = '__Host-shennian-room-identity'
const DEV_COOKIE = 'shennian-room-identity-dev'
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/

// Identity cookies never participate in requireAuth or account-level APIs.
export function readRoomIdentityCookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie
  if (!header || header.length > 8192) return undefined
  const values = header.split(';').flatMap((part) => {
    const split = part.indexOf('=')
    const name = part.slice(0, split).trim()
    return split > 0 && (name === COOKIE || name === DEV_COOKIE)
      ? [part.slice(split + 1).trim()]
      : []
  })
  return values.length === 1 ? values[0] : undefined
}

function identityCookie(request: FastifyRequest, token: string, expiresAt: Date): string {
  return serializeRoomBrowserCookie(request, token, expiresAt)
    .replace(/^__Host-shennian-room=/, `${COOKIE}=`)
    .replace(/^shennian-room-dev=/, `${DEV_COOKIE}=`)
}

export function clearRoomIdentityCookie(request: FastifyRequest): string {
  return identityCookie(request, '', new Date(0))
}

// CORS is not a CSRF boundary. Protect cookie reads, writes and websocket handshakes,
// including same-site sibling origins. Missing Origin is allowed for non-browser clients.
export function trustedRoomBrowserRequest(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  if (!origin) return request.headers['sec-fetch-site'] !== 'cross-site'
  const allowed = [
    new URL(publicWebAppBaseUrl(request)).origin,
    `${request.protocol}://${request.host}`,
  ]
  return allowed.includes(origin)
}

export async function requireTrustedRoomBrowser(request: FastifyRequest, reply: FastifyReply) {
  if (!trustedRoomBrowserRequest(request)) {
    return reply.code(403).send({ error: 'room_browser_origin_forbidden' })
  }
}

// Compatibility endpoint only. A remembered account identity is no longer a Room grant.
export async function findRoomBrowserIdentity(request: FastifyRequest, _now = new Date()): Promise<null> {
  if (!trustedRoomBrowserRequest(request)) throw new RoomBrowserSessionError('room_browser_origin_forbidden', 403)
  return null
}

export async function authenticateRoomBrowserRequest(request: FastifyRequest, roomId: string, now = new Date()) {
  if (!trustedRoomBrowserRequest(request)) throw new RoomBrowserSessionError('room_browser_origin_forbidden', 403)
  return authenticateRoomBrowserSession(readRoomBrowserCookie(request, roomId), roomId, now)
}

export async function logoutRoomBrowser(request: FastifyRequest, roomId?: string) {
  const token = readRoomIdentityCookie(request)
  if (token && RAW_TOKEN.test(token)) {
    const identity = await prisma.roomBrowserIdentity.findUnique({
      where: { tokenHash: hashRoomInviteCapability(token) },
    })
    if (identity) {
      await prisma.roomBrowserIdentity.updateMany({
        where: { id: identity.id },
        data: { status: 'revoked' },
      })
      await prisma.roomBrowserSession.updateMany({
        where: { identityId: identity.id, status: 'active' },
        data: { status: 'revoked' },
      })
      const sessions = await prisma.roomBrowserSession.findMany({
        where: { identityId: identity.id },
        select: { id: true },
      })
      for (const session of sessions) publishRoomBrowserSessionRevoked(session.id)
    }
  }
  const scoped = readRoomBrowserCookie(request, roomId)
  if (scoped && RAW_TOKEN.test(scoped)) {
    const where = { tokenHash: hashRoomInviteCapability(scoped), status: 'active' }
    const session = await prisma.roomBrowserSession.findFirst({ where, select: { id: true, roomId: true, userId: true } })
    if (session && roomId && session.roomId !== roomId) return
    await prisma.roomBrowserSession.updateMany({ where, data: { status: 'revoked' } })
    if (session) {
      publishRoomBrowserSessionRevoked(session.id)
      notifyRoomBrowserAccessChanged(session.userId, session.roomId)
    }
  }
}
