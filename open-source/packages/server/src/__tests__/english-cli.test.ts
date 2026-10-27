// @covers src/routes/english-cli.ts
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ owned: vi.fn(), items: vi.fn() }))
vi.mock('../services/local-apps/gateway.js', () => ({ ownedMachine: mocks.owned }))
vi.mock('../services/personal-modules/english.js', () => ({ englishItems: mocks.items }))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: () => {},
  requireUserOrMachineAuth: async (r: any, reply: any) => {
    if (!r.headers.authorization) return reply.code(401).send({ error: 'unauthorized' })
    r.userId = r.headers.authorization === 'other' ? 'other-user' : 'owner'
    if (r.headers.authorization !== 'device') r.machineId = 'paired'
  },
  requireActivePlan: async (r: any, reply: any) => {
    if (r.headers.authorization === 'no-plan')
      return reply.code(402).send({ error: 'plan_required' })
  },
}))
vi.mock('../services/review-account-policy.js', () => ({
  requireNonReviewMachineAccess: async (r: any, reply: any) => {
    if (r.headers.authorization === 'review')
      return reply.code(403).send({ error: 'review_forbidden' })
  },
}))
import { englishCliRoutes } from '../routes/english-cli.js'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.owned.mockResolvedValue({ id: 'paired', online: false })
  mocks.items.mockResolvedValue({
    items: [
      { word: 'apple', state: 'mastered' },
      { word: 'water', state: 'partial' },
      { word: 'tea', state: 'unseen' },
    ],
  })
})
describe('owner-scoped read-only English API', () => {
  it('requires a paired owner, plan and review policy; revoked pairing cannot read', async () => {
    const app = Fastify()
    await app.register(englishCliRoutes)
    try {
      for (const [authorization, code] of [
        [undefined, 401],
        ['device', 403],
        ['no-plan', 402],
        ['review', 403],
      ] as const) {
        expect(
          (await app.inject({ url: '/progress', headers: authorization ? { authorization } : {} }))
            .statusCode,
        ).toBe(code)
      }
      expect(mocks.items).not.toHaveBeenCalled()
      mocks.owned.mockRejectedValue(new Error('revoked'))
      expect(
        (await app.inject({ url: '/progress', headers: { authorization: 'owner' } })).statusCode,
      ).toBe(403)
      expect(mocks.items).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
  it('reads only authenticated account even with user override; works when machine is offline', async () => {
    const app = Fastify()
    await app.register(englishCliRoutes)
    try {
      const response = await app.inject({
        url: '/progress?userId=victim',
        headers: { authorization: 'other' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ source: 'cloud', total: 3, mastered: 1, learning: 2 })
      expect(Number.isFinite(Date.parse(response.json().fetchedAt))).toBe(true)
      expect(mocks.items).toHaveBeenCalledExactlyOnceWith('other-user')
      expect(mocks.owned).toHaveBeenCalledExactlyOnceWith('other-user', 'paired')
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/progress',
            headers: { authorization: 'owner' },
          })
        ).statusCode,
      ).toBe(404)
      mocks.items.mockRejectedValue(new Error('private transcript'))
      const failed = await app.inject({ url: '/progress', headers: { authorization: 'owner' } })
      expect(failed.statusCode).toBe(503)
      expect(failed.json()).toEqual({ error: 'english_progress_unavailable' })
    } finally {
      await app.close()
    }
  })
})
