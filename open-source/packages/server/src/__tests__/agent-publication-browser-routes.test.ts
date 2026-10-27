// @covers open-source/packages/server/src/routes/agent-publications.ts

import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserAuth: vi.fn(), verifyPhone: vi.fn(), createSession: vi.fn(),
  publicPublication: vi.fn(), enqueue: vi.fn(), read: vi.fn(), readCli: vi.fn(),
  accountAuth: vi.fn(), trusted: vi.fn(), revokeSession: vi.fn(),
  offerNickname: vi.fn(),
  createAnonymous: vi.fn(), anonymousRate: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: () => {},
  requireUserOrMachineAuth: mocks.accountAuth,
  requireAuth: mocks.accountAuth,
  requireActivePlan: async () => {},
}))
vi.mock('../services/review-account-policy.js', () => ({
  requireNonReviewMachineAccess: async () => {},
}))
vi.mock('../services/room-browser-identity.js', () => ({
  trustedRoomBrowserRequest: mocks.trusted,
}))
vi.mock('../services/auth-session.js', () => ({
  AuthRouteError: class AuthRouteError extends Error {},
  verifyPhoneIdentity: mocks.verifyPhone,
}))
vi.mock('../services/nickname-setup.js', () => ({
  offerScopedNicknameSetup: mocks.offerNickname,
}))
vi.mock('../services/agent-publication-browser-session.js', () => ({
  AgentPublicationBrowserError: class AgentPublicationBrowserError extends Error {
    constructor(readonly code: string) { super(code) }
  },
  authenticateAgentPublicationBrowser: mocks.browserAuth,
  createAgentPublicationBrowserSession: mocks.createSession,
  createAnonymousAgentPublicationBrowserSession: mocks.createAnonymous,
  revokeAgentPublicationBrowserSession: mocks.revokeSession,
  serializeAgentPublicationBrowserCookie: (_request: unknown, _publicId: string,
    _token: string, _expiresAt: Date, anonymous = false) =>
    `__Host-shennian-${anonymous ? 'anon-agent' : 'agent'}-x=token; Path=/; HttpOnly; Secure`,
}))
vi.mock('../services/anonymous-agent-rate-limit.js', () => ({
  consumeAnonymousAgentRateLimit: mocks.anonymousRate,
}))
vi.mock('../services/agent-publications.js', () => ({
  AgentPublicationError: class AgentPublicationError extends Error {},
  getPublicAgentPublication: mocks.publicPublication,
}))
vi.mock('../services/agent-direct-conversations.js', () => ({
  AgentDirectConversationError: class AgentDirectConversationError extends Error {
    constructor(readonly code: string) { super(code) }
  },
  enqueueVisitorAgentMessage: mocks.enqueue,
  readVisitorAgentConversationByAgent: mocks.read,
  readVisitorAgentConversation: mocks.readCli,
}))

import { agentPublicationPublicRoutes } from '../routes/agent-publications.js'

const publicId = 'a'.repeat(32)

describe('publication scoped browser routes', () => {
  const app = Fastify()
  beforeAll(async () => { await app.register(agentPublicationPublicRoutes); await app.ready() })
  afterAll(async () => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trusted.mockReturnValue(true)
    mocks.publicPublication.mockResolvedValue({ publicId, status: 'active' })
    mocks.browserAuth.mockResolvedValue({ userId: 'visitor-1', agentIdentityId: 'agent-1' })
    mocks.accountAuth.mockImplementation(async (request) => { request.userId = 'visitor-1' })
    mocks.anonymousRate.mockResolvedValue(true)
  })

  it('lets an already signed-in user explicitly scope this link without a phone code', async () => {
    mocks.createSession.mockResolvedValue({ token: 'token', expiresAt: new Date('2026-09-26T08:00:00Z') })
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/use-account` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ userId: 'visitor-1', scopedPath: `/p/${publicId}` })
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('HttpOnly')
    expect(mocks.accountAuth).toHaveBeenCalledOnce()
    expect(mocks.createSession).toHaveBeenCalledWith({ publicId, userId: 'visitor-1' })
    expect(mocks.revokeSession).toHaveBeenCalledWith(expect.anything(), publicId)
    expect(mocks.revokeSession.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createSession.mock.invocationCallOrder[0]!)
    expect(mocks.verifyPhone).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('starts a browser-only guest after rate limiting and never creates a conversation on read', async () => {
    mocks.browserAuth.mockRejectedValueOnce(new (await import('../services/agent-publication-browser-session.js'))
      .AgentPublicationBrowserError('unauthorized'))
    mocks.createAnonymous.mockResolvedValue({ token: 'guest-token', userId: 'guest-1',
      expiresAt: new Date('2026-10-26T00:00:00Z') })
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/anonymous` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ userId: 'guest-1', accessKind: 'anonymous' })
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('HttpOnly')
    expect(mocks.anonymousRate).toHaveBeenCalledWith(expect.objectContaining({ action: 'start' }))
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.accountAuth).not.toHaveBeenCalled()
  })

  it('rate limits guest creation and sends without falling back to account auth', async () => {
    mocks.browserAuth.mockRejectedValueOnce(new (await import('../services/agent-publication-browser-session.js'))
      .AgentPublicationBrowserError('unauthorized'))
    mocks.anonymousRate.mockResolvedValueOnce(false)
    const start = await app.inject({ method: 'POST', url: `/${publicId}/browser/anonymous` })
    expect(start.statusCode).toBe(429)
    expect(mocks.createAnonymous).not.toHaveBeenCalled()
    mocks.browserAuth.mockResolvedValue({ userId: 'guest-1', agentIdentityId: 'agent-1',
      accessKind: 'anonymous' })
    mocks.anonymousRate.mockResolvedValueOnce(false)
    const send = await app.inject({ method: 'POST', url: `/${publicId}/browser/messages`,
      payload: { text: 'hi', clientMessageId: 'm1' } })
    expect(send.statusCode).toBe(429)
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.accountAuth).not.toHaveBeenCalled()
  })

  it('uses the reverse proxy observed peer rather than a client-prepended IP', async () => {
    mocks.browserAuth.mockRejectedValueOnce(new (await import('../services/agent-publication-browser-session.js'))
      .AgentPublicationBrowserError('unauthorized'))
    mocks.createAnonymous.mockResolvedValue({ token: 'guest-token', userId: 'guest-1',
      expiresAt: new Date('2026-10-26T00:00:00Z') })
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/anonymous`,
      headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.4' } })
    expect(response.statusCode).toBe(200)
    expect(mocks.anonymousRate).toHaveBeenCalledWith(expect.objectContaining({
      ip: '198.51.100.4', action: 'start',
    }))
  })

  it('fails closed when the shared guest limiter is unavailable', async () => {
    mocks.browserAuth.mockRejectedValueOnce(new (await import('../services/agent-publication-browser-session.js'))
      .AgentPublicationBrowserError('unauthorized'))
    mocks.anonymousRate.mockRejectedValueOnce(new Error('redis unavailable'))
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/anonymous` })
    expect(response.statusCode).toBe(503)
    expect(mocks.createAnonymous).not.toHaveBeenCalled()
  })

  it('does not let an anonymous browser proof request contact approval', async () => {
    mocks.browserAuth.mockResolvedValue({ userId: 'guest-1', agentIdentityId: 'agent-1',
      accessKind: 'anonymous' })
    const get = await app.inject({ method: 'GET', url: `/${publicId}/browser/contact-request` })
    const post = await app.inject({ method: 'POST', url: `/${publicId}/browser/contact-request`,
      payload: {} })
    expect(get.statusCode).toBe(403)
    expect(post.statusCode).toBe(403)
  })

  it('does not cache the public profile while pause and revocation can change it', async () => {
    const response = await app.inject({ method: 'GET', url: `/${publicId}` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })

  it('rejects a cross-site account scope request before creating a cookie', async () => {
    mocks.trusted.mockReturnValue(false)
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/use-account` })
    expect(response.statusCode).toBe(403)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('rejects a cross-site guest start before rate limiting or creating a user', async () => {
    mocks.trusted.mockReturnValue(false)
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/anonymous`,
      headers: { origin: 'https://elsewhere.example' } })
    expect(response.statusCode).toBe(403)
    expect(mocks.anonymousRate).not.toHaveBeenCalled()
    expect(mocks.createAnonymous).not.toHaveBeenCalled()
  })

  it('issues only a scoped cookie after a verified phone', async () => {
    mocks.verifyPhone.mockResolvedValue({ id: 'visitor-1', name: 'Visitor' })
    mocks.offerNickname.mockResolvedValue({ required: true, userId: 'visitor-1' })
    mocks.createSession.mockResolvedValue({ token: 'token', expiresAt: new Date('2026-09-26T08:00:00Z') })
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/verify-phone`,
      payload: { phone: '+8613800000000', code: '123456' } })
    expect(response.statusCode).toBe(200)
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('HttpOnly')
    expect(response.json()).not.toHaveProperty('token')
    expect(response.json()).toMatchObject({ nicknameSetup: { required: true, userId: 'visitor-1' } })
    expect(mocks.offerNickname).toHaveBeenCalledWith({ id: 'visitor-1', name: 'Visitor' })
    expect(mocks.createSession).toHaveBeenCalledWith({ publicId, userId: 'visitor-1' })
    expect(mocks.revokeSession).toHaveBeenCalledWith(expect.anything(), publicId)
    expect(mocks.revokeSession.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createSession.mock.invocationCallOrder[0]!)
    expect(mocks.accountAuth).not.toHaveBeenCalled()
  })

  it('uses the scoped user for sending and history without account auth', async () => {
    mocks.enqueue.mockResolvedValue({ status: 'pending', idempotent: false })
    mocks.read.mockResolvedValue({ conversation: null, messages: [], nextAfter: null })
    const send = await app.inject({ method: 'POST', url: `/${publicId}/browser/messages`,
      payload: { text: 'hello', clientMessageId: 'message-1' } })
    expect(send.statusCode).toBe(202)
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      visitorUserId: 'visitor-1', publicId, text: 'hello',
    }))
    expect(mocks.browserAuth).toHaveBeenNthCalledWith(1, expect.anything(), publicId)
    const read = await app.inject({ method: 'GET', url: `/${publicId}/browser/conversation` })
    expect(read.statusCode).toBe(200)
    expect(mocks.browserAuth).toHaveBeenNthCalledWith(2, expect.anything(), publicId,
      expect.any(Date), true)
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({
      visitorUserId: 'visitor-1', agentIdentityId: 'agent-1',
    }))
    const latest = await app.inject({ method: 'GET',
      url: `/${publicId}/browser/conversation?before=latest` })
    expect(latest.statusCode).toBe(200)
    expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({
      visitorUserId: 'visitor-1', agentIdentityId: 'agent-1', before: 'latest',
    }))
    expect(mocks.accountAuth).not.toHaveBeenCalled()
  })

  it('passes the latest-page cursor through the authenticated CLI history route', async () => {
    mocks.readCli.mockResolvedValue({ conversation: null, messages: [], nextBefore: null })
    const response = await app.inject({ method: 'GET',
      url: `/${publicId}/conversation?before=latest` })
    expect(response.statusCode).toBe(200)
    expect(mocks.readCli).toHaveBeenCalledWith(expect.objectContaining({
      publicId, visitorUserId: 'visitor-1', before: 'latest',
    }))
  })

  it('checks origin before consuming the phone code', async () => {
    mocks.trusted.mockReturnValue(false)
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/verify-phone`,
      payload: { phone: '+8613800000000', code: '123456' } })
    expect(response.statusCode).toBe(403)
    expect(mocks.verifyPhone).not.toHaveBeenCalled()
  })

  it('lets the visitor explicitly clear only this link session', async () => {
    const response = await app.inject({ method: 'POST', url: `/${publicId}/browser/logout` })
    expect(response.statusCode).toBe(200)
    expect(mocks.revokeSession).toHaveBeenCalledWith(expect.anything(), publicId)
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('HttpOnly')
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('shennian-anon-agent-')
    expect(JSON.stringify(response.headers['set-cookie'])).toContain('shennian-agent-')
    expect(mocks.accountAuth).not.toHaveBeenCalled()
  })
})
