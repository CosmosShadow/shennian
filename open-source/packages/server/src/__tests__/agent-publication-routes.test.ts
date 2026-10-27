// @covers open-source/packages/server/src/routes/agent-publications.ts

import Fastify from 'fastify'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'

const serviceMock = vi.hoisted(() => ({
  enqueueVisitorAgentMessage: vi.fn(),
  listVisitorAgentDirectConversations: vi.fn(),
  readAgentDirectConversationById: vi.fn(),
  getOwnedAgentPublicationReadiness: vi.fn(),
  activateAgentPublication: vi.fn(),
  getPublicAgentPublication: vi.fn(),
  listOwnerAgentDirectConversations: vi.fn(),
  sendOwnerAgentDirectMessage: vi.fn(),
}))
const authMock = vi.hoisted(() => ({ machineId: '' }))
const prismaMock = vi.hoisted(() => ({ machine: { findFirst: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: { decorateRequest: (name: string, value: string) => void }) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
  },
  requireUserOrMachineAuth: async (request: { userId: string; machineId: string }) => {
    request.userId = 'visitor-1'
    request.machineId = authMock.machineId
  },
  requireAuth: async (request: { userId: string }) => { request.userId = 'visitor-1' },
  requireActivePlan: async () => {},
}))
vi.mock('../services/review-account-policy.js', () => ({
  requireNonReviewMachineAccess: async () => {},
}))
vi.mock('../services/agent-publications.js', () => ({
  AgentPublicationError: class AgentPublicationError extends Error {},
  createAgentPublicationDraft: vi.fn(),
  activateAgentPublication: serviceMock.activateAgentPublication,
  getOwnedAgentPublication: vi.fn(),
  getOwnedAgentPublicationReadiness: serviceMock.getOwnedAgentPublicationReadiness,
  getPublicAgentPublication: serviceMock.getPublicAgentPublication,
  pauseAgentPublication: vi.fn(),
  revokeAgentPublication: vi.fn(),
  updateAgentPublicationDetails: vi.fn(),
}))
vi.mock('../services/agent-direct-conversations.js', () => ({
  AgentDirectConversationError: class AgentDirectConversationError extends Error {
    constructor(readonly code: string) { super(code) }
  },
  enqueueVisitorAgentMessage: serviceMock.enqueueVisitorAgentMessage,
  listVisitorAgentDirectConversations: serviceMock.listVisitorAgentDirectConversations,
  listOwnedAgentDirectConversations: vi.fn(),
  readAgentDirectConversationById: serviceMock.readAgentDirectConversationById,
  readVisitorAgentConversation: vi.fn(),
}))
vi.mock('../services/agent-direct-owner.js', () => ({
  listOwnerAgentDirectConversations: serviceMock.listOwnerAgentDirectConversations,
  sendOwnerAgentDirectMessage: serviceMock.sendOwnerAgentDirectMessage,
}))

import { agentDirectConversationRoutes, agentPublicationOwnerRoutes,
  agentPublicationPublicRoutes } from '../routes/agent-publications.js'

describe('published Agent owner readiness route', () => {
  const app = Fastify()
  beforeAll(async () => { await app.register(agentPublicationOwnerRoutes); await app.ready() })
  beforeEach(() => { vi.clearAllMocks(); authMock.machineId = '' })
  afterAll(async () => app.close())

  it('uses the authenticated owner and does not cache runtime proof', async () => {
    serviceMock.getOwnedAgentPublicationReadiness.mockResolvedValue({
      machineOnline: false, runtimeEligible: false, activationAvailable: false,
    })
    const response = await app.inject({ method: 'GET', url: '/agent-1/publication/readiness' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(serviceMock.getOwnedAgentPublicationReadiness).toHaveBeenCalledWith('visitor-1', 'agent-1')
  })

  it('passes owner identity and explicit versions to activation', async () => {
    serviceMock.activateAgentPublication.mockResolvedValue({ status: 'active' })
    const response = await app.inject({ method: 'POST', url: '/agent-1/publication/activate',
      payload: { expectedGeneration: 2, expectedPolicyVersion: 3 } })
    expect(response.statusCode).toBe(200)
    expect(serviceMock.activateAgentPublication).toHaveBeenCalledWith({
      ownerUserId: 'visitor-1', agentIdentityId: 'agent-1',
      expectedGeneration: 2, expectedPolicyVersion: 3,
    })
  })
})

describe('published Agent visitor message route', () => {
  const app = Fastify()
  beforeAll(async () => {
    await app.register(agentPublicationPublicRoutes)
    await app.ready()
  })
  beforeEach(() => { vi.clearAllMocks(); authMock.machineId = '' })
  afterAll(async () => app.close())

  it('returns only the public projection and no-store headers for a share URL', async () => {
    serviceMock.getPublicAgentPublication.mockResolvedValue({
      publicId: 'a'.repeat(32), status: 'active', machineOnline: true,
      displayName: 'Public agent', description: 'Introduction', avatar: null,
      creatorCanReadConversation: true,
    })
    const response = await app.inject({ method: 'GET', url: `/${'a'.repeat(32)}` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(response.json()).toEqual({ publication: {
      publicId: 'a'.repeat(32), status: 'active', machineOnline: true,
      displayName: 'Public agent', description: 'Introduction', avatar: null,
      creatorCanReadConversation: true,
    } })
  })

  it('returns 202 for a newly queued message with the authenticated visitor ID', async () => {
    serviceMock.enqueueVisitorAgentMessage.mockResolvedValue({
      conversationId: 'conversation-1', messageId: 'message-1',
      sequence: '1', status: 'pending', idempotent: false,
    })
    const response = await app.inject({
      method: 'POST', url: `/${'a'.repeat(32)}/messages`,
      payload: { text: '你好', clientMessageId: 'request-1' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(serviceMock.enqueueVisitorAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      visitorUserId: 'visitor-1', text: '你好', clientMessageId: 'request-1',
    }))
  })

  it('returns 200 for an idempotent retry', async () => {
    serviceMock.enqueueVisitorAgentMessage.mockResolvedValue({
      conversationId: 'conversation-1', messageId: 'message-1',
      sequence: '1', status: 'pending', idempotent: true,
    })
    const response = await app.inject({
      method: 'POST', url: `/${'a'.repeat(32)}/messages`,
      payload: { text: '你好', clientMessageId: 'request-1' },
    })
    expect(response.statusCode).toBe(200)
  })

  it('rejects an unpaired CLI machine before any message write', async () => {
    authMock.machineId = 'machine-1'
    prismaMock.machine.findFirst.mockResolvedValue(null)
    const response = await app.inject({
      method: 'POST', url: `/${'a'.repeat(32)}/messages`,
      payload: { text: '你好', clientMessageId: 'request-1' },
    })
    expect(response.statusCode).toBe(401)
    expect(serviceMock.enqueueVisitorAgentMessage).not.toHaveBeenCalled()
  })
})

describe('signed-in visitor conversation list route', () => {
  const app = Fastify()
  beforeAll(async () => {
    await app.register(agentDirectConversationRoutes, { prefix: '/agent-direct-conversations' })
    await app.ready()
  })
  beforeEach(() => { vi.clearAllMocks(); authMock.machineId = '' })
  afterAll(async () => app.close())

  it('passes only the authenticated visitor identity and cursor to the bounded list', async () => {
    serviceMock.listVisitorAgentDirectConversations.mockResolvedValue({
      conversations: [], nextCursor: null,
    })
    const response = await app.inject({ method: 'GET',
      url: '/agent-direct-conversations?cursor=conversation-1' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(serviceMock.listVisitorAgentDirectConversations).toHaveBeenCalledWith({
      visitorUserId: 'visitor-1', cursor: 'conversation-1',
    })
  })

  it('rejects an unpaired machine before reading visitor history', async () => {
    authMock.machineId = 'machine-1'
    prismaMock.machine.findFirst.mockResolvedValue(null)
    const response = await app.inject({ method: 'GET', url: '/agent-direct-conversations' })
    expect(response.statusCode).toBe(401)
    expect(serviceMock.listVisitorAgentDirectConversations).not.toHaveBeenCalled()
  })

  it('passes the latest-page cursor through the same exact conversation route', async () => {
    serviceMock.readAgentDirectConversationById.mockResolvedValue({
      conversation: { id: 'conversation-1', role: 'visitor' },
      messages: [], nextBefore: null,
    })
    const response = await app.inject({ method: 'GET',
      url: '/agent-direct-conversations/conversation-1?before=latest' })
    expect(response.statusCode).toBe(200)
    expect(serviceMock.readAgentDirectConversationById).toHaveBeenCalledWith({
      conversationId: 'conversation-1', userId: 'visitor-1',
      after: undefined, before: 'latest',
    })
  })
  it('lists publisher conversations using only authenticated identity', async () => {
    serviceMock.listOwnerAgentDirectConversations.mockResolvedValue({ conversations: [], nextCursor: null })
    const response = await app.inject({ method: 'GET', url: '/agent-direct-conversations/owned?cursor=chat-1' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
    expect(serviceMock.listOwnerAgentDirectConversations).toHaveBeenCalledWith({ ownerUserId: 'visitor-1', cursor: 'chat-1' })
  })
  it('does not trust the body to supply publisher identity or sender role', async () => {
    serviceMock.sendOwnerAgentDirectMessage.mockResolvedValue({ status: 'sent', conversationId: 'chat-1' })
    const response = await app.inject({ method: 'POST', url: '/agent-direct-conversations/chat-1/owner-messages',
      payload: { ownerUserId: 'forged-owner', authorRole: 'visitor', text: 'Hello', clientMessageId: 'request-1' } })
    expect(response.statusCode).toBe(200)
    expect(serviceMock.sendOwnerAgentDirectMessage).toHaveBeenCalledWith({ ownerUserId: 'visitor-1',
      conversationId: 'chat-1', text: 'Hello', clientMessageId: 'request-1' })
    expect(serviceMock.enqueueVisitorAgentMessage).not.toHaveBeenCalled()
  })
  it('passes an explicit owner perspective through the ACL-protected read route', async () => {
    serviceMock.readAgentDirectConversationById.mockResolvedValue({ conversation: { role: 'owner' }, messages: [] })
    const response = await app.inject({ method: 'GET', url: '/agent-direct-conversations/chat-1?before=latest&perspective=owner' })
    expect(response.statusCode).toBe(200)
    expect(serviceMock.readAgentDirectConversationById).toHaveBeenCalledWith({
      conversationId: 'chat-1', userId: 'visitor-1', before: 'latest', after: undefined, perspective: 'owner',
    })
  })
})
