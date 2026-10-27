// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-session.test.ts

import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Prisma } from '../generated/prisma/client.js'
import { publishRoomBrowserSessionRevoked } from '../relay/connection-control.js'
import { notifyRoomBrowserAccessChanged } from './room-browser-notifications.js'
import { prisma } from '../lib/prisma.js'
import { hashRoomInviteCapability } from './room-invite-browser.js'

export const ROOM_BROWSER_COOKIE = '__Host-shennian-room'
export const ROOM_BROWSER_DEV_COOKIE = 'shennian-room-dev'
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/
const HANDOFF_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
export const MAX_ACTIVE_ROOM_BROWSER_SESSIONS = 8

export type RoomBrowserSessionAudit = {
  id: string
  clientLabel: string | null
  status: 'active' | 'expired' | 'revoked'
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  endedAt: string | null
}

export class RoomBrowserSessionError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 401) {
    super(code)
    this.name = 'RoomBrowserSessionError'
  }
}

function rawToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export async function createRoomBrowserHandoff(input: {
  roomId: string
  userId: string
  membershipId: string
  now?: Date
}) {
  const token = rawToken()
  const now = input.now ?? new Date()
  await prisma.roomBrowserSession.create({
    data: {
      tokenHash: hashRoomInviteCapability(token),
      roomId: input.roomId,
      userId: input.userId,
      membershipId: input.membershipId,
      status: 'pending_handoff',
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
      lastSeenAt: now,
    },
  })
  return { token, expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS) }
}

// Serialize every grant on the same membership row, across Server instances.
// Pending handoffs do not evict the current browser until they are actually redeemed.
async function lockMembership(tx: Prisma.TransactionClient, input: {
  membershipId: string; roomId: string; userId: string
}) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM RoomMembership WHERE id = ${input.membershipId} FOR UPDATE`
  if (!rows.length) throw unavailable()
  const member = await tx.roomMembership.findUnique({ where: { id: input.membershipId }, include: { room: true } })
  if (!member || member.status !== 'active' || member.principalType !== 'human' ||
      member.userId !== input.userId || member.roomId !== input.roomId || member.room.status !== 'active') throw unavailable()
}

async function assertGrantAvailable(
  tx: Prisma.TransactionClient,
  input: { userId: string; roomId: string },
  now: Date,
) {
  const activeCount = await tx.roomBrowserSession.count({
    where: {
      userId: input.userId,
      roomId: input.roomId,
      status: 'active',
      authorizationVersion: 2,
      identityId: null,
      expiresAt: { gt: now },
    },
  })
  if (activeCount >= MAX_ACTIVE_ROOM_BROWSER_SESSIONS) {
    throw new RoomBrowserSessionError('room_browser_session_limit_reached', 409)
  }
}

function grantCommitted(input: { userId: string; roomId: string }) {
  notifyRoomBrowserAccessChanged(input.userId, input.roomId)
}

async function revokeReplacedBrowser(
  tx: Prisma.TransactionClient,
  input: { userId: string; roomId: string; existingToken?: string },
  now: Date,
): Promise<string | null> {
  if (!input.existingToken || !RAW_TOKEN.test(input.existingToken)) return null
  const existing = await tx.roomBrowserSession.findUnique({
    where: { tokenHash: hashRoomInviteCapability(input.existingToken) },
    select: {
      id: true,
      roomId: true,
      userId: true,
      identityId: true,
      authorizationVersion: true,
      status: true,
      expiresAt: true,
    },
  })
  if (!existing || existing.roomId !== input.roomId || existing.userId !== input.userId ||
      existing.identityId != null || existing.authorizationVersion !== 2 ||
      existing.status !== 'active' || existing.expiresAt <= now) return null
  const revoked = await tx.roomBrowserSession.updateMany({
    where: { id: existing.id, status: 'active', expiresAt: { gt: now } },
    data: { status: 'revoked' },
  })
  return revoked.count === 1 ? existing.id : null
}

export async function createActiveRoomBrowserSession(input: {
  roomId: string; userId: string; membershipId: string; clientLabel?: string
  existingToken?: string; now?: Date
}) {
  const token = rawToken()
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  const replacedSessionId = await prisma.$transaction(async (tx) => {
    await lockMembership(tx, input)
    const replaced = await revokeReplacedBrowser(tx, input, now)
    await assertGrantAvailable(tx, input, now)
    await tx.roomBrowserSession.create({ data: {
      tokenHash: hashRoomInviteCapability(token), roomId: input.roomId,
      userId: input.userId, membershipId: input.membershipId,
      clientLabel: input.clientLabel, status: 'active', authorizationVersion: 2,
      expiresAt, createdAt: now, lastSeenAt: now,
    } })
    return replaced
  })
  if (replacedSessionId) publishRoomBrowserSessionRevoked(replacedSessionId)
  grantCommitted(input)
  return { token, expiresAt }
}

export async function exchangeRoomBrowserHandoff(
  value: unknown,
  expectedRoomId: string,
  clientLabelOrNow?: string | Date,
  providedNow?: Date,
  existingToken?: string,
) {
  const clientLabel = typeof clientLabelOrNow === 'string' ? clientLabelOrNow : undefined
  const now = clientLabelOrNow instanceof Date ? clientLabelOrNow : (providedNow ?? new Date())
  if (typeof value !== 'string' || !RAW_TOKEN.test(value)) throw unavailable()
  const session = await prisma.roomBrowserSession.findUnique({ where: { tokenHash: hashRoomInviteCapability(value) } })
  if (!session || session.status !== 'pending_handoff' || session.expiresAt <= now || session.roomId !== expectedRoomId) throw unavailable()
  const token = rawToken()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  const replacedSessionId = await prisma.$transaction(async (tx) => {
    await lockMembership(tx, session)
    const replaced = await revokeReplacedBrowser(tx, { ...session, existingToken }, now)
    await assertGrantAvailable(tx, session, now)
    // Claim and activation happen atomically; replay must not mint a second browser session.
    const claimed = await tx.roomBrowserSession.updateMany({
      where: { id: session.id, status: 'pending_handoff', expiresAt: { gt: now } },
      data: { status: 'consuming_handoff' },
    })
    if (claimed.count !== 1) throw unavailable()
    await tx.roomBrowserSession.updateMany({ where: { id: session.id, status: 'consuming_handoff' }, data: {
      tokenHash: hashRoomInviteCapability(token), clientLabel, status: 'active',
      authorizationVersion: 2, expiresAt, createdAt: now, lastSeenAt: now,
    } })
    return replaced
  })
  if (replacedSessionId) publishRoomBrowserSessionRevoked(replacedSessionId)
  grantCommitted(session)
  return { token, expiresAt, roomId: session.roomId }
}

export async function authenticateRoomBrowserSession(
  value: unknown,
  expectedRoomId?: string,
  now = new Date(),
) {
  if (typeof value !== 'string' || !RAW_TOKEN.test(value)) throw unavailable()
  const session = await prisma.roomBrowserSession.findUnique({
    where: { tokenHash: hashRoomInviteCapability(value) },
    include: {
      room: true,
      user: true,
      membership: true,
    },
  })
  if (
    !session ||
    session.status !== 'active' ||
    session.authorizationVersion !== 2 ||
    session.identityId != null ||
    session.expiresAt <= now ||
    session.room.status !== 'active' ||
    session.membership.status !== 'active' ||
    session.membership.principalType !== 'human' ||
    session.membership.roomId !== session.roomId ||
    session.membership.userId !== session.userId ||
    (expectedRoomId != null && session.roomId !== expectedRoomId)
  ) {
    throw unavailable()
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
    await prisma.roomBrowserSession.updateMany({
      where: { id: session.id, status: 'active' },
      data: { lastSeenAt: now },
    })
  }
  return session
}

export async function listRoomBrowserSessionsForUser(input: {
  roomId: string
  userId: string
  now?: Date
}): Promise<RoomBrowserSessionAudit[]> {
  const now = input.now ?? new Date()
  const sessions = await prisma.roomBrowserSession.findMany({
    where: {
      roomId: input.roomId,
      userId: input.userId,
      status: { in: ['active', 'revoked'] },
      authorizationVersion: 2,
    },
    // Valid active grants sort ahead of expired/revoked history, so the eight manageable
    // sessions can never be pushed out of the bounded audit response by recent revocations.
    orderBy: [{ status: 'asc' }, { expiresAt: 'desc' }, { lastSeenAt: 'desc' }],
    take: 20,
    select: {
      id: true,
      clientLabel: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
  })
  return sessions.map((session) => {
    const status = session.status === 'revoked'
      ? 'revoked'
      : session.expiresAt <= now
        ? 'expired'
        : 'active'
    return {
      id: session.id,
      clientLabel: session.clientLabel,
      status,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      endedAt: status === 'revoked' ? session.updatedAt.toISOString() : null,
    }
  })
}

export function roomBrowserClientLabel(request: Pick<FastifyRequest, 'headers'>): string {
  const userAgent = request.headers['user-agent'] ?? ''
  const browser = browserName(userAgent)
  const system = systemName(userAgent)
  return [browser, system].filter(Boolean).join(' · ') || 'Web browser'
}

function browserName(userAgent: string): string {
  if (/\bCodex\b/i.test(userAgent)) return 'Codex'
  if (/\bClaude\b/i.test(userAgent)) return 'Claude'
  if (/\bCursor\b/i.test(userAgent)) return 'Cursor'
  if (/\bEdg(?:A|iOS)?\//.test(userAgent)) return 'Microsoft Edge'
  if (/\bOPR\//.test(userAgent)) return 'Opera'
  if (/\bFxiOS\//.test(userAgent) || /\bFirefox\//.test(userAgent)) return 'Firefox'
  if (/\bCriOS\//.test(userAgent) || /\bChrome\//.test(userAgent)) return 'Chrome'
  if (/\bVersion\//.test(userAgent) && /\bSafari\//.test(userAgent)) return 'Safari'
  return 'Web browser'
}

function systemName(userAgent: string): string {
  if (/\biPad\b/i.test(userAgent)) return 'iPadOS'
  if (/\biPhone\b|\biPod\b/i.test(userAgent)) return 'iOS'
  if (/\bAndroid\b/i.test(userAgent)) return 'Android'
  if (/\bWindows NT\b/i.test(userAgent)) return 'Windows'
  if (/\bCrOS\b/i.test(userAgent)) return 'ChromeOS'
  if (/\bMac OS X\b|\bMacintosh\b/i.test(userAgent)) return 'macOS'
  if (/\bLinux\b/i.test(userAgent)) return 'Linux'
  return ''
}

export async function revokeRoomBrowserSessionForUser(input: {
  roomId: string
  userId: string
  sessionId: string
  now?: Date
}): Promise<{ sessionId: string; status: 'revoked' | 'expired'; idempotent: boolean } | null> {
  const now = input.now ?? new Date()
  const session = await prisma.roomBrowserSession.findFirst({
    where: {
      id: input.sessionId,
      roomId: input.roomId,
      userId: input.userId,
      status: { in: ['active', 'revoked'] },
    },
    select: { id: true, status: true, expiresAt: true },
  })
  if (!session) return null
  if (session.status === 'revoked') {
    return { sessionId: session.id, status: 'revoked', idempotent: true }
  }
  if (session.expiresAt <= now) {
    return { sessionId: session.id, status: 'expired', idempotent: true }
  }
  const revoked = await prisma.roomBrowserSession.updateMany({
    where: {
      id: session.id,
      roomId: input.roomId,
      userId: input.userId,
      status: 'active',
      expiresAt: { gt: now },
    },
    data: { status: 'revoked' },
  })
  if (revoked.count) {
    publishRoomBrowserSessionRevoked(session.id)
    notifyRoomBrowserAccessChanged(input.userId, input.roomId)
  }
  return { sessionId: session.id, status: 'revoked', idempotent: revoked.count !== 1 }
}

export function readRoomBrowserCookie(request: FastifyRequest, roomId?: string): string | undefined {
  const header = request.headers.cookie
  if (!header || header.length > 8192) return undefined
  const found: string[] = []
  const legacy: string[] = []
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (roomId && [cookieName(true, roomId), cookieName(false, roomId)].includes(name)) found.push(value)
    else if ([ROOM_BROWSER_COOKIE, ROOM_BROWSER_DEV_COOKIE].includes(name)) legacy.push(value)
  }
  return found.length ? (found.length === 1 ? found[0] : undefined) : (legacy.length === 1 ? legacy[0] : undefined)
}

export function serializeRoomBrowserCookie(
  request: FastifyRequest,
  token: string,
  expiresAt: Date,
  roomId?: string,
): string {
  const secure = isSecureRequest(request)
  return [
    `${cookieName(secure, roomId)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

export function clearRoomBrowserCookie(request: FastifyRequest, roomId?: string): string {
  const secure = isSecureRequest(request)
  return [
    `${cookieName(secure, roomId)}=`,
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

function cookieName(secure: boolean, roomId?: string) {
  if (roomId && !/^[A-Za-z0-9_-]{1,210}$/.test(roomId)) throw unavailable()
  return `${secure ? ROOM_BROWSER_COOKIE : ROOM_BROWSER_DEV_COOKIE}${roomId ? `-${roomId}` : ''}`
}

function isSecureRequest(request: FastifyRequest): boolean {
  return (
    request.protocol === 'https' ||
    request.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production'
  )
}

function unavailable() {
  return new RoomBrowserSessionError('room_browser_session_unavailable')
}
