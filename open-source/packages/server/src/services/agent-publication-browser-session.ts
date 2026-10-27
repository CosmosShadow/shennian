// @arch open-source/docs/server-runtime.md

import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { trustedRoomBrowserRequest } from './room-browser-identity.js'

const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/
const TOKEN = /^[A-Za-z0-9_-]{43}$/
// Deliberately different from old account tokens. An old Server must reject a
// guest proof after rollback even if a client copies it into the old cookie.
const ANONYMOUS_TOKEN = /^[A-Za-z0-9_-]{54}$/
// Match the account refresh session's lifetime: visitors are signed-in users,
// while the short machine lease belongs only to processing one Agent reply.
const TTL_MS = 90 * 24 * 60 * 60 * 1000
const ANONYMOUS_TTL_MS = 30 * 24 * 60 * 60 * 1000

export class AgentPublicationBrowserError extends Error {
  constructor(readonly code: 'not_found' | 'unauthorized' | 'origin_forbidden') {
    super(code)
  }
}

function hash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function secure(request: FastifyRequest) {
  return request.protocol === 'https'
    || request.headers['x-forwarded-proto'] === 'https'
    || process.env.NODE_ENV === 'production'
}

function cookieName(request: FastifyRequest, publicId: string, anonymous = false) {
  const prefix = anonymous ? 'shennian-anon-agent-' : 'shennian-agent-'
  return `${secure(request) ? '__Host-' : ''}${prefix}${secure(request) ? '' : 'dev-'}${publicId}`
}

function readCookie(request: FastifyRequest, publicId: string, anonymous: boolean) {
  if (!PUBLIC_ID.test(publicId)) return undefined
  const header = request.headers.cookie
  if (!header || header.length > 8192) return undefined
  const name = cookieName(request, publicId, anonymous)
  const values = header.split(';').flatMap((part) => {
    const split = part.indexOf('=')
    return split > 0 && part.slice(0, split).trim() === name
      ? [part.slice(split + 1).trim()] : []
  })
  return values.length === 1 && (anonymous ? ANONYMOUS_TOKEN : TOKEN).test(values[0]!)
    ? values[0] : undefined
}

export function readAgentPublicationBrowserCookie(request: FastifyRequest, publicId: string) {
  return readCookie(request, publicId, false)
}

export function readAnonymousAgentPublicationBrowserCookie(request: FastifyRequest, publicId: string) {
  return readCookie(request, publicId, true)
}

export function serializeAgentPublicationBrowserCookie(
  request: FastifyRequest, publicId: string, token: string, expiresAt: Date,
  anonymous = false,
) {
  if (!PUBLIC_ID.test(publicId)) throw new AgentPublicationBrowserError('not_found')
  return [
    `${cookieName(request, publicId, anonymous)}=${token}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`,
    secure(request) ? 'Secure' : '',
  ].filter(Boolean).join('; ')
}

export async function createAgentPublicationBrowserSession(input: {
  publicId: string; userId: string; now?: Date
}) {
  if (!PUBLIC_ID.test(input.publicId)) throw new AgentPublicationBrowserError('not_found')
  const publication = await prisma.agentPublication.findUnique({
    where: { publicId: input.publicId },
    select: { id: true, status: true, ownerUserId: true,
      agentIdentity: { select: { status: true, ownerUserId: true } } },
  })
  if (!publication || !['active', 'paused'].includes(publication.status)
    || publication.agentIdentity.ownerUserId !== publication.ownerUserId) {
    throw new AgentPublicationBrowserError('not_found')
  }
  const token = crypto.randomBytes(32).toString('base64url')
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS)
  await prisma.agentPublicationBrowserSession.create({
    data: { tokenHash: hash(token), publicationId: publication.id,
      issuedPublicId: input.publicId,
      userId: input.userId, accessKind: 'account', expiresAt, createdAt: now, lastSeenAt: now },
  })
  return { token, expiresAt }
}

/** A browser-only principal. Never issue an account/device token for this User. */
export async function createAnonymousAgentPublicationBrowserSession(input: {
  publicId: string; now?: Date
}) {
  if (!PUBLIC_ID.test(input.publicId)) throw new AgentPublicationBrowserError('not_found')
  const now = input.now ?? new Date()
  const token = crypto.randomBytes(40).toString('base64url')
  const expiresAt = new Date(now.getTime() + ANONYMOUS_TTL_MS)
  const userId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE publicId = ${input.publicId} FOR UPDATE`
    const publication = await tx.agentPublication.findUnique({
      where: { publicId: input.publicId },
      select: { id: true, status: true, ownerUserId: true,
        allowAnonymousVisitors: true, requireContactApproval: true,
        agentIdentity: { select: { status: true, ownerUserId: true } } },
    })
    if (!publication || publication.status !== 'active'
      || publication.allowAnonymousVisitors !== true || publication.requireContactApproval
      || publication.agentIdentity.status !== 'active'
      || publication.agentIdentity.ownerUserId !== publication.ownerUserId) {
      throw new AgentPublicationBrowserError('not_found')
    }
    const user = await tx.user.create({
      data: { name: '匿名访客', accountTier: 'anonymous_visitor' }, select: { id: true },
    })
    await tx.agentPublicationBrowserSession.create({
      data: { tokenHash: hash(token), publicationId: publication.id,
        issuedPublicId: input.publicId, userId: user.id, accessKind: 'anonymous',
        expiresAt, createdAt: now, lastSeenAt: now },
    })
    return user.id
  })
  return { token, expiresAt, userId }
}

export async function authenticateAgentPublicationBrowser(
  request: FastifyRequest, publicId: string, now = new Date(),
  allowRotatedHistory = false,
) {
  if (!trustedRoomBrowserRequest(request)) throw new AgentPublicationBrowserError('origin_forbidden')
  const accountToken = readAgentPublicationBrowserCookie(request, publicId)
  const anonymousToken = readAnonymousAgentPublicationBrowserCookie(request, publicId)
  const token = accountToken ?? anonymousToken
  const expectedKind = accountToken ? 'account' : 'anonymous'
  if (!token) throw new AgentPublicationBrowserError('unauthorized')
  const session = await prisma.agentPublicationBrowserSession.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, status: true, expiresAt: true, lastSeenAt: true,
      issuedPublicId: true,
      userId: true, accessKind: true, publication: { select: { id: true, publicId: true,
        agentIdentityId: true } } },
  })
  if (!session || (session.accessKind ?? 'account') !== expectedKind
    || session.status !== 'active' || session.expiresAt <= now
    || (session.publication.publicId !== publicId
      && !(allowRotatedHistory && session.issuedPublicId === publicId))) {
    throw new AgentPublicationBrowserError('unauthorized')
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
    await prisma.agentPublicationBrowserSession.updateMany({
      where: { id: session.id, status: 'active' }, data: { lastSeenAt: now },
    })
  }
  return { sessionId: session.id, userId: session.userId,
    accessKind: session.accessKind,
    publicationId: session.publication.id,
    agentIdentityId: session.publication.agentIdentityId }
}

export async function revokeAgentPublicationBrowserSession(
  request: FastifyRequest, publicId: string,
) {
  if (!trustedRoomBrowserRequest(request)) throw new AgentPublicationBrowserError('origin_forbidden')
  for (const token of [readAgentPublicationBrowserCookie(request, publicId),
    readAnonymousAgentPublicationBrowserCookie(request, publicId)]) {
    if (!token) continue
    await prisma.agentPublicationBrowserSession.updateMany({
      // A rotated link still owns the cookie it originally issued.
      where: { tokenHash: hash(token), issuedPublicId: publicId },
      data: { status: 'revoked' },
    })
  }
}
