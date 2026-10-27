// @covers open-source/packages/server/src/routes/local-app-sharing.ts
// @covers open-source/packages/server/src/services/local-apps/sharing.ts
// @covers open-source/packages/server/src/services/local-apps/public-page.ts
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ data: new Map<string, string>(), relay: vi.fn(), owner: vi.fn(), plan: vi.fn(), counts: new Map<string, number>() }))
vi.mock('../lib/redis.js', () => ({ redis: {
  get: async (k: string) => m.data.get(k) ?? null,
  set: async (k: string, v: string) => m.data.set(k, v),
  del: async (k: string) => m.data.delete(k),
  eval: async (_script: string, _n: number, k: string) => { const n = (m.counts.get(k) ?? 0) + 1; m.counts.set(k, n); return n },
} }))
const entry = { id: 'survey', title: '问卷', port: 18371, entryPath: '/', directory: '/private', updatedAt: 'one' }
vi.mock('../services/local-apps/gateway.js', () => ({ listApps: async (user: string) => { await m.owner(user); return [entry] }, ownedMachine: async (user: string) => m.owner(user), relayService: m.relay }))
vi.mock('../services/plan-access.js', () => ({ requirePlanAccess: m.plan }))
vi.mock('../middleware/auth.js', () => ({ requireActivePlan: async () => {}, requireUserOrMachineAuth: async (r: { headers: Record<string, string>; userId: string }, reply: { code(n: number): { send(body: unknown): void } }) => {
  if (!r.headers.authorization) return reply.code(401).send({ error: 'auth_required' }); r.userId = r.headers.authorization
} }))
import { localAppSharingRoutes } from '../routes/local-app-sharing.js'
import { paths } from '../services/local-apps/sharing.js'
async function setup() {
  const a = Fastify(); a.setErrorHandler((e, _req, r) => r.code((e as Error).message.includes('rate_limited') ? 429 : 403).send({ error: (e as Error).message }))
  await a.register(localAppSharingRoutes, { prefix: '/api/local-apps' })
  return a
}
async function publish(a: Awaited<ReturnType<typeof setup>>) {
  const r = await a.inject({ method: 'POST', url: '/api/local-apps/shares', headers: { authorization: 'owner' }, payload: { machineId: 'machine', appId: 'survey', assets: [], posts: ['/api/submissions'] } })
  expect(r.statusCode).toBe(200); return r.json() as { shareId: string; sharePath: string }
}
beforeEach(() => {
  m.data.clear(); m.counts.clear(); vi.resetAllMocks()
  m.owner.mockImplementation(async user => { if (user !== 'owner') throw Error('machine_owner_required'); return { id: 'machine' } })
  m.relay.mockResolvedValue({ status: 201, headers: { 'content-type': 'application/json' }, base64: Buffer.from('{"saved":true}').toString('base64') })
})
describe('explicit public app capability', () => {
  it('retains the public /api prefix when the edge forwards an internally rewritten URL', async () => {
    const a = Fastify()
    await a.register(localAppSharingRoutes, { prefix: '/local-apps' })
    try {
      const created = await a.inject({ method: 'POST', url: '/local-apps/shares', headers: { authorization: 'owner' }, payload: { machineId: 'machine', appId: 'survey', posts: ['/api/submissions'] } })
      const { shareId, sharePath } = created.json()
      const shell = await a.inject('/local-apps/shared/' + shareId + '/')
      expect(shell.statusCode).toBe(200)
      expect(shell.body).toContain(`base="/api/local-apps/shared/${shareId}"`)
      expect(sharePath).toBe(`/api/local-apps/shared/${shareId}/`)
    } finally { await a.close() }
  })

  it('requires owner authentication and rejects noncanonical/wildcard API grants', async () => {
    const a = await setup()
    try {
      expect((await a.inject({ method: 'POST', url: '/api/local-apps/shares', payload: {} })).statusCode).toBe(401)
      expect((await a.inject({ method: 'POST', url: '/api/local-apps/shares', headers: { authorization: 'other' }, payload: { machineId: 'machine', appId: 'survey' } })).statusCode).toBe(403)
      for (const value of ['/api/*', '/%61pi', '/a/../b', '//host', '/?q=a']) expect(() => paths([value])).toThrow()
      expect(m.relay).not.toHaveBeenCalled()
    } finally { await a.close() }
  })
  it('opens anonymously with an opaque sandbox and temporary per-visitor capability, without owner metadata', async () => {
    const a = await setup()
    try {
      const share = await publish(a), page = await a.inject(share.sharePath)
      expect(page.statusCode).toBe(200); expect(page.body).toContain('sandbox="allow-scripts allow-forms"')
      expect(page.body).not.toContain('allow-same-origin'); expect(page.body).not.toContain('/private'); expect(page.body).not.toContain('18371')
      expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'")
      expect(page.headers['set-cookie']).toBeUndefined()
      m.relay.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html' }, base64: Buffer.from('<html>问卷</html>').toString('base64') })
      const html = await a.inject(share.sharePath + 'page/')
      expect(html.body).toContain('public-service'); expect(html.headers['content-security-policy']).toContain('sandbox allow-scripts allow-forms;')
      expect(html.headers['content-security-policy']).toContain("connect-src 'none'")
      expect(html.headers['content-security-policy']).toContain("frame-ancestors 'self'")
      expect((await a.inject(share.sharePath + 'page/private.json')).statusCode).toBe(403)
      expect((await a.inject(share.sharePath + 'page/?x=1')).statusCode).toBe(403)
    } finally { await a.close() }
  })
  it('only forwards the exact POST grant, and revokes already-issued visitor sessions', async () => {
    const a = await setup()
    try {
      const share = await publish(a), page = await a.inject(share.sharePath)
      const visitor = /visitor="([a-f0-9]{48})"/.exec(page.body)![1]!
      const call = (payload: object, token = visitor) => a.inject({ method: 'POST', url: share.sharePath + 'service', headers: { 'x-local-visitor': token }, payload })
      expect((await call({ method: 'POST', path: '/api/submissions', args: {} }, 'wrong')).statusCode).toBe(403)
      for (const payload of [{ method: 'GET', path: '/api/submissions' }, { method: 'DELETE', path: '/api/submissions' }, { method: 'POST', path: '/api/admin' }, { method: 'POST', path: '/api/submissions?admin=1' }]) expect((await call(payload)).statusCode).toBe(403)
      expect(m.relay).not.toHaveBeenCalled()
      expect((await call({ method: 'POST', path: '/api/submissions', args: { value: 'hello' } })).json()).toEqual({ status: 201, headers: { 'content-type': 'application/json' }, body: { saved: true } })
      expect(m.relay).toHaveBeenCalledWith('owner', 'machine', expect.objectContaining({ appId: 'survey', port: 18371, path: '/api/submissions' }))
      expect((await a.inject({ method: 'DELETE', url: '/api/local-apps/shares/' + share.shareId, headers: { authorization: 'other' } })).statusCode).toBe(403)
      expect((await a.inject({ method: 'DELETE', url: '/api/local-apps/shares/' + share.shareId, headers: { authorization: 'owner' } })).statusCode).toBe(200)
      expect((await call({ method: 'POST', path: '/api/submissions' })).statusCode).toBe(403)
    } finally { await a.close() }
  })
  it('fails closed on expiry, owner access loss, offline machines, app changes and traffic limit', async () => {
    const a = await setup()
    try {
      const share = await publish(a)
      m.plan.mockRejectedValueOnce(Error('plan_expired')); expect((await a.inject(share.sharePath)).statusCode).toBe(403)
      m.owner.mockRejectedValueOnce(Error('local_machine_unavailable')); expect((await a.inject(share.sharePath)).statusCode).toBe(403)
      m.counts.set(`local-app-limit:read:${share.shareId}`, 120); expect((await a.inject(share.sharePath)).statusCode).toBe(429)
      m.counts.clear(); entry.updatedAt = 'changed'; expect((await a.inject(share.sharePath)).statusCode).toBe(403); entry.updatedAt = 'one'
      m.data.delete('local-app-share:' + share.shareId); expect((await a.inject(share.sharePath)).statusCode).toBe(403)
      expect(m.relay).not.toHaveBeenCalled()
    } finally { await a.close() }
  })
})
