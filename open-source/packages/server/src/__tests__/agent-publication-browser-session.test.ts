// @covers open-source/packages/server/src/services/agent-publication-browser-session.ts

import type { FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  publication: vi.fn(), create: vi.fn(), findUnique: vi.fn(),
  updateMany: vi.fn(), trusted: vi.fn(),
  transaction: vi.fn(), userCreate: vi.fn(), queryRaw: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction,
  user: { create: mocks.userCreate },
  $queryRaw: mocks.queryRaw,
  agentPublication: { findUnique: mocks.publication },
  agentPublicationBrowserSession: {
    create: mocks.create, findUnique: mocks.findUnique, updateMany: mocks.updateMany,
  },
} }))
vi.mock('../services/room-browser-identity.js', () => ({
  trustedRoomBrowserRequest: mocks.trusted,
}))

import {
  AgentPublicationBrowserError,
  authenticateAgentPublicationBrowser,
  createAgentPublicationBrowserSession,
  createAnonymousAgentPublicationBrowserSession,
  readAnonymousAgentPublicationBrowserCookie,
  readAgentPublicationBrowserCookie,
  revokeAgentPublicationBrowserSession,
  serializeAgentPublicationBrowserCookie,
} from '../services/agent-publication-browser-session.js'

const publicId = 'a'.repeat(32)
const now = new Date('2026-09-26T00:00:00Z')
const baseRequest = { protocol: 'https', headers: {} } as FastifyRequest

describe('publication scoped browser proof', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trusted.mockReturnValue(true)
    mocks.publication.mockResolvedValue({
      id: 'publication-1', status: 'active', ownerUserId: 'owner-1',
      allowAnonymousVisitors: true, requireContactApproval: false,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    mocks.transaction.mockImplementation(async (run) => run({
      $queryRaw: mocks.queryRaw,
      agentPublication: { findUnique: mocks.publication },
      user: { create: mocks.userCreate },
      agentPublicationBrowserSession: { create: mocks.create },
    }))
    mocks.userCreate.mockResolvedValue({ id: 'anonymous-1' })
  })

  it('stores a hash and issues an HttpOnly cookie scoped by public ID', async () => {
    const grant = await createAgentPublicationBrowserSession({ publicId, userId: 'visitor-1', now })
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(grant.expiresAt.toISOString()).toBe('2026-12-25T00:00:00.000Z')
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      publicationId: 'publication-1', userId: 'visitor-1',
      issuedPublicId: publicId,
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) })
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(grant.token)
    const cookie = serializeAgentPublicationBrowserCookie(baseRequest, publicId, grant.token, grant.expiresAt)
    expect(cookie).toContain(`__Host-shennian-agent-${publicId}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(readAgentPublicationBrowserCookie({ ...baseRequest, headers: {
      cookie: cookie.split(';')[0],
    } } as FastifyRequest, publicId)).toBe(grant.token)
    expect(readAgentPublicationBrowserCookie({ ...baseRequest, headers: {
      cookie: cookie.split(';')[0],
    } } as FastifyRequest, 'b'.repeat(32))).toBeUndefined()
  })

  it('creates a browser-only user only for an active opt-in publication', async () => {
    const grant = await createAnonymousAgentPublicationBrowserSession({ publicId, now })
    expect(grant.userId).toBe('anonymous-1')
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{54}$/)
    const cookie = serializeAgentPublicationBrowserCookie(baseRequest, publicId,
      grant.token, grant.expiresAt, true)
    expect(cookie).toContain(`__Host-shennian-anon-agent-${publicId}=`)
    const request = { ...baseRequest, headers: { cookie: cookie.split(';')[0] } } as FastifyRequest
    expect(readAnonymousAgentPublicationBrowserCookie(request, publicId)).toBe(grant.token)
    expect(readAgentPublicationBrowserCookie(request, publicId)).toBeUndefined()
    expect(readAgentPublicationBrowserCookie({ ...baseRequest, headers: {
      cookie: `__Host-shennian-agent-${publicId}=${grant.token}`,
    } } as FastifyRequest, publicId)).toBeUndefined()
    expect(grant.expiresAt.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(mocks.userCreate).toHaveBeenCalledWith({ data: {
      name: '匿名访客', accountTier: 'anonymous_visitor',
    }, select: { id: true } })
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'anonymous-1', accessKind: 'anonymous', issuedPublicId: publicId,
    }) })
    mocks.publication.mockResolvedValueOnce({ id: 'publication-1', status: 'active',
      allowAnonymousVisitors: false, requireContactApproval: false, ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' } })
    await expect(createAnonymousAgentPublicationBrowserSession({ publicId, now }))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.userCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired proof and a different publication', async () => {
    const token = 'x'.repeat(43)
    const request = { ...baseRequest, headers: {
      cookie: `__Host-shennian-agent-${publicId}=${token}`,
    } } as FastifyRequest
    mocks.findUnique.mockResolvedValue({
      id: 'session-1', status: 'active', expiresAt: new Date('2026-09-26T01:00:00Z'),
      lastSeenAt: now, userId: 'visitor-1',
      publication: { id: 'publication-1', publicId: 'b'.repeat(32), agentIdentityId: 'agent-1' },
    })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now))
      .rejects.toMatchObject({ code: 'unauthorized' })
    expect(mocks.updateMany).not.toHaveBeenCalled()
    mocks.findUnique.mockResolvedValue({
      id: 'session-1', status: 'active', expiresAt: now,
      lastSeenAt: now, userId: 'visitor-1',
      publication: { id: 'publication-1', publicId, agentIdentityId: 'agent-1' },
    })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now))
      .rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('permits old-link history only with the cookie issued for that exact link', async () => {
    const token = 'x'.repeat(43)
    const request = { ...baseRequest, headers: {
      cookie: `__Host-shennian-agent-${publicId}=${token}`,
    } } as FastifyRequest
    mocks.findUnique.mockResolvedValue({
      id: 'session-1', status: 'active', expiresAt: new Date('2026-09-26T01:00:00Z'),
      lastSeenAt: now, userId: 'visitor-1', issuedPublicId: publicId,
      publication: { id: 'publication-1', publicId: 'b'.repeat(32), agentIdentityId: 'agent-1' },
    })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now))
      .rejects.toMatchObject({ code: 'unauthorized' })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now, true))
      .resolves.toMatchObject({ userId: 'visitor-1', agentIdentityId: 'agent-1' })
    mocks.findUnique.mockResolvedValue({
      id: 'session-1', status: 'active', expiresAt: new Date('2026-09-26T01:00:00Z'),
      lastSeenAt: now, userId: 'visitor-1', issuedPublicId: 'c'.repeat(32),
      publication: { id: 'publication-1', publicId: 'b'.repeat(32), agentIdentityId: 'agent-1' },
    })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now, true))
      .rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('keeps an anonymous history proof scoped to its issuing link after rotation', async () => {
    const token = 'x'.repeat(54)
    const request = { ...baseRequest, headers: {
      cookie: `__Host-shennian-anon-agent-${publicId}=${token}`,
    } } as FastifyRequest
    mocks.findUnique.mockResolvedValue({
      id: 'session-1', status: 'active', expiresAt: new Date('2026-10-01T00:00:00Z'),
      lastSeenAt: now, userId: 'guest-1', accessKind: 'anonymous', issuedPublicId: publicId,
      publication: { id: 'publication-1', publicId: 'b'.repeat(32), agentIdentityId: 'agent-1' },
    })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now))
      .rejects.toMatchObject({ code: 'unauthorized' })
    await expect(authenticateAgentPublicationBrowser(request, publicId, now, true))
      .resolves.toMatchObject({ userId: 'guest-1', accessKind: 'anonymous' })
  })

  it('rejects an untrusted browser origin before token lookup', async () => {
    mocks.trusted.mockReturnValue(false)
    await expect(authenticateAgentPublicationBrowser(baseRequest, publicId, now))
      .rejects.toBeInstanceOf(AgentPublicationBrowserError)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('revokes the exact cookie originally issued by a rotated link', async () => {
    const token = 'x'.repeat(43)
    const request = { ...baseRequest, headers: {
      cookie: `__Host-shennian-agent-${publicId}=${token}`,
    } } as FastifyRequest
    await revokeAgentPublicationBrowserSession(request, publicId)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), issuedPublicId: publicId },
      data: { status: 'revoked' },
    })
  })
})
