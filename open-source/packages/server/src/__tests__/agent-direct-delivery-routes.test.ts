// @covers open-source/packages/server/src/routes/agent-direct-delivery.ts

import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  machineId: 'machine-1', findMachine: vi.fn(), claim: vi.fn(), complete: vi.fn(),
  checkLease: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: mocks.findMachine } } }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: { decorateRequest: (name: string, value: string) => void }) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
  },
  requireUserOrMachineAuth: async (request: { userId: string; machineId: string }) => {
    request.userId = 'owner-1'
    request.machineId = mocks.machineId
  },
  requireActivePlan: async () => {},
}))
vi.mock('../services/agent-direct-delivery.js', () => ({
  AgentDirectDeliveryError: class AgentDirectDeliveryError extends Error {
    constructor(readonly code: string) { super(code) }
  },
  claimAgentDirectMessage: mocks.claim,
  completeAgentDirectMessage: mocks.complete,
  checkAgentDirectLease: mocks.checkLease,
}))

import { agentDirectDeliveryRoutes } from '../routes/agent-direct-delivery.js'

describe('Agent direct delivery machine routes', () => {
  const app = Fastify()
  beforeAll(async () => { await app.register(agentDirectDeliveryRoutes); await app.ready() })
  afterAll(async () => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.machineId = 'machine-1'
    mocks.findMachine.mockResolvedValue({ id: 'machine-1' })
  })

  it('rejects a human bearer before looking at pending work', async () => {
    mocks.machineId = ''
    const response = await app.inject({ method: 'POST', url: '/claim' })
    expect(response.statusCode).toBe(403)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('rejects an unpaired machine', async () => {
    mocks.findMachine.mockResolvedValue(null)
    const response = await app.inject({ method: 'POST', url: '/claim' })
    expect(response.statusCode).toBe(401)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('passes only the authenticated owner and paired machine to the claim service', async () => {
    mocks.claim.mockResolvedValue({ claim: null })
    const response = await app.inject({ method: 'POST', url: '/claim' })
    expect(response.statusCode).toBe(200)
    expect(mocks.claim).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', machineId: 'machine-1', supportsAttachments: false,
    })
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
  })

  it('checks a lease only for the authenticated machine', async () => {
    mocks.checkLease.mockResolvedValue({ valid: true, leaseExpiresAt: '2026-09-26T00:10:00Z' })
    const body = { messageId: 'message-1', conversationId: 'conversation-1',
      bindingEpoch: 1, leaseToken: 'x'.repeat(43) }
    const response = await app.inject({ method: 'POST', url: '/check-lease', payload: body })
    expect(response.statusCode).toBe(200)
    expect(mocks.checkLease).toHaveBeenCalledWith({
      ...body, ownerUserId: 'owner-1', machineId: 'machine-1',
    })
  })

  it('passes a conversation-scoped pause request only with the paired machine identity', async () => {
    mocks.complete.mockResolvedValue({ replyMessageId: 'reply-1', sequence: '2', idempotent: false })
    const body = { messageId: 'message-1', conversationId: 'conversation-1',
      bindingEpoch: 1, leaseToken: 'x'.repeat(43), replyText: '已暂停。', pauseConversation: true }
    const response = await app.inject({ method: 'POST', url: '/complete', payload: body })
    expect(response.statusCode).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith({
      ...body, ownerUserId: 'owner-1', machineId: 'machine-1',
    })
  })
})
