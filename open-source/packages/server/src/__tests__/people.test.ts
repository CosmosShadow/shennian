// @covers open-source/packages/server/src/services/people.ts
// @covers open-source/packages/server/src/routes/people.ts

import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  userContact: { findUnique: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: { decorateRequest: (name: string, value: string) => void }) => {
    app.decorateRequest('userId', '')
  },
  requireAuth: async (request: { headers: { authorization?: string }; userId: string },
    reply: { code: (status: number) => { send: (body: object) => unknown } }) => {
    if (request.headers.authorization !== 'Bearer test') {
      return reply.code(401).send({ error: 'Missing token' })
    }
    request.userId = 'viewer-1234'
  },
  requireActivePlan: async () => {},
}))
vi.mock('../services/review-account-policy.js', () => ({
  requireNonReviewMachineAccess: async () => {},
}))

import { getPerson, updateOwnIntroduction } from '../services/people.js'
import { peopleRoutes } from '../routes/people.js'

const person = {
  id: 'person-1234', name: 'Ada', description: '公开介绍',
  avatarVersion: null, avatarUpdatedAt: null,
  phone: 'hidden-phone', email: 'hidden@example.test',
}

describe('person identity and sharing', () => {
  const app = Fastify()
  beforeAll(async () => { await app.register(peopleRoutes, { prefix: '/people' }); await app.ready() })
  afterAll(async () => app.close())
  beforeEach(() => vi.clearAllMocks())

  it('blocks anonymous reads and writes', async () => {
    for (const [method, url, payload] of [
      ['GET', '/people/me'], ['PATCH', '/people/me', { description: 'Hello' }],
      ['GET', '/people/person-1234'],
    ] as const) {
      expect((await app.inject({ method, url, payload })).statusCode).toBe(401)
    }
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('shows only the public projection and a private saved state', async () => {
    db.user.findUnique.mockResolvedValue(person)
    db.userContact.findUnique.mockResolvedValue({ id: 'contact-1234' })
    const response = await app.inject({ method: 'GET', url: '/people/person-1234',
      headers: { authorization: 'Bearer test' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ person: {
      userId: 'person-1234', displayName: 'Ada', description: '公开介绍',
      savedContactId: 'contact-1234',
    } })
    expect(response.json().shareUrl).toContain('/contacts/users/person-1234')
    expect(response.json().qrPayload).toBe(response.json().shareUrl)
    expect(JSON.stringify(response.json())).not.toMatch(/hidden-phone|hidden@example|owner|agent/)
    expect(db.userContact.findUnique).toHaveBeenCalledWith({
      where: { ownerUserId_targetUserId: {
        ownerUserId: 'viewer-1234', targetUserId: 'person-1234',
      } }, select: { id: true },
    })
  })

  it('accepts an empty introduction but rejects oversized or non-text input', async () => {
    await expect(updateOwnIntroduction('viewer-1234', 42)).rejects.toMatchObject({ code: 'invalid' })
    await expect(updateOwnIntroduction('viewer-1234', 'x'.repeat(1001)))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(db.user.update).not.toHaveBeenCalled()
    db.user.update.mockResolvedValue({ ...person, description: '' })
    await updateOwnIntroduction('viewer-1234', '  ')
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'viewer-1234' }, data: { description: '' },
    }))
  })

  it('looks up exactly one person without reading a phone or owned AI list', async () => {
    db.user.findUnique.mockResolvedValue(person)
    db.userContact.findUnique.mockResolvedValue(null)
    const result = await getPerson('person-1234', 'viewer-1234')
    expect(result).toMatchObject({ userId: 'person-1234', savedContactId: null })
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, name: true, description: true,
        avatarVersion: true, avatarUpdatedAt: true },
    }))
  })
})
