// @covers open-source/packages/server/src/routes/contacts.ts
// @covers open-source/packages/server/src/routes/agent-discovery.ts

import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({ listContacts: vi.fn(), saveContact: vi.fn(),
  listPlazaAgents: vi.fn() }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: { decorateRequest: (name: string, value: string) => void }) => {
    app.decorateRequest('userId', '')
  },
  requireAuth: async (request: { headers: { authorization?: string }; userId: string },
    reply: { code: (status: number) => { send: (body: object) => unknown } }) => {
    if (request.headers.authorization !== 'Bearer test') {
      return reply.code(401).send({ error: 'Missing token' })
    }
    request.userId = 'owner-1234'
  },
  requireActivePlan: async () => {},
}))
vi.mock('../services/review-account-policy.js', () => ({
  requireNonReviewMachineAccess: async () => {},
}))
vi.mock('../services/contacts.js', () => ({
  ContactError: class ContactError extends Error {
    constructor(readonly code: string) { super(code) }
  },
  listContacts: services.listContacts,
  saveContact: services.saveContact, removeContact: vi.fn(),
}))
vi.mock('../services/agent-discovery.js', () => ({
  AgentDiscoveryError: class AgentDiscoveryError extends Error {},
  listPlazaAgents: services.listPlazaAgents,
  getPlazaAgent: vi.fn(), setPlazaListing: vi.fn(),
}))

import { contactRoutes } from '../routes/contacts.js'
import { agentDiscoveryRoutes } from '../routes/agent-discovery.js'
import { ContactError } from '../services/contacts.js'

describe('contact and plaza authentication', () => {
  const app = Fastify()
  beforeAll(async () => {
    await app.register(contactRoutes, { prefix: '/contacts' })
    await app.register(agentDiscoveryRoutes, { prefix: '/plaza/agents' })
    await app.ready()
  })
  afterAll(async () => app.close())

  it('blocks every protected collection endpoint without a signed-in user', async () => {
    for (const [method, url, payload] of [
      ['GET', '/contacts'], ['POST', '/contacts', { targetUserId: 'user-1234' }],
      ['POST', '/contacts/agent-requests', { publicAgentId: 'a'.repeat(32) }],
      ['GET', `/contacts/agent-requests/${'a'.repeat(32)}`],
      ['DELETE', '/contacts/contact-1234'], ['GET', '/plaza/agents'],
      ['GET', `/plaza/agents/${'a'.repeat(32)}`],
    ] as const) {
      const response = await app.inject({ method, url, payload })
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
    expect(services.listContacts).not.toHaveBeenCalled()
    expect(services.listPlazaAgents).not.toHaveBeenCalled()
  })

  it('uses the verified user ID for contact search', async () => {
    services.listContacts.mockResolvedValue({ contacts: [], truncated: false })
    const response = await app.inject({ method: 'GET', url: '/contacts?q=Ada',
      headers: { authorization: 'Bearer test' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(services.listContacts).toHaveBeenCalledWith({ ownerUserId: 'owner-1234', query: 'Ada' })
  })

  it('tells old clients approval is required instead of reporting a saved contact', async () => {
    services.saveContact.mockRejectedValueOnce(new ContactError('approval_required'))
    const response = await app.inject({ method: 'POST', url: '/contacts',
      headers: { authorization: 'Bearer test' }, payload: { publicAgentId: 'a'.repeat(32) } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'contact_approval_required' })
  })
})
