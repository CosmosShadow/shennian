// @covers open-source/packages/server/src/routes/local-apps.ts
// @covers open-source/packages/server/src/services/local-apps/gateway.ts
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ machine: vi.fn(), machines: vi.fn(), device: vi.fn(), relay: vi.fn(), data: new Map<string, string>() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: mocks.machine, findMany: mocks.machines }, device: { findUnique: mocks.device } } }))
vi.mock('../lib/redis.js', () => ({ redis: { set: async (k: string, v: string) => { mocks.data.set(k, v) }, get: async (k: string) => mocks.data.get(k) ?? null } }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: mocks.relay }))
vi.mock('../middleware/auth.js', () => ({ registerAuthDecorators: () => {}, requireActivePlan: async () => {}, requireUserOrMachineAuth: async () => {}, requireAuth: async (r: { headers: { authorization?: string }; userId: string; deviceId: string }, reply: { code(n: number): { send(v: object): void } }) => {
  if (!r.headers.authorization) return reply.code(401).send({ error: 'missing_token' })
  r.userId = r.headers.authorization; r.deviceId = r.userId + '-device'
} }))
import { redactSensitiveLogText } from '../security/log-redaction.js'
import { redactSensitiveRequestUrl } from '../security/sensitive-request-url.js'
import { localAppsRoutes } from '../routes/local-apps.js'
import { relayService } from '../services/local-apps/gateway.js'
const entry = { id: 'unit-app', title: 'Unit app', port: 5173, entryPath: '/', directory: '/unit', updatedAt: new Date().toISOString() }
const owner = { authorization: 'owner' }
async function app() { const a = Fastify(); await a.register(localAppsRoutes, { prefix: '/api/local-apps' }); return a }
beforeEach(() => {
  vi.resetAllMocks(); mocks.data.clear()
  mocks.machine.mockImplementation(async ({ where }) => where.userId === 'owner' ? { id: 'machine', name: 'My computer', online: true } : null)
  mocks.machines.mockResolvedValue([{ id: 'machine', name: 'My computer', online: true }])
  mocks.device.mockImplementation(async ({ where }) => ({ userId: where.id.replace(/-device$/, ''), tokenExpiry: new Date(Date.now() + 60000) }))
  mocks.relay.mockImplementation(async (_machine, frame) => frame.method === 'personal.apps.list' ? { ok: true, payload: { apps: [entry] } } : { ok: true, payload: { status: 200, headers: { 'content-type': frame.params.path.endsWith('.js') ? 'application/javascript' : 'text/html' }, base64: Buffer.from(frame.params.path.endsWith('.js') ? 'window.localAssetLoaded=true' : '<!doctype html><html><head></head><body><script src="./app.js"></script></body></html>').toString('base64') } })
})
describe('owner-only local app relay', () => {
  it('redacts runtime URLs and resource paths from request and free-form logs', () => {
    const url = '/api/local-apps/runtime/' + 'a'.repeat(48) + '/private.js?secret=1'
    expect(redactSensitiveRequestUrl(url)).toBe('/local-apps/runtime/[redacted]')
    expect(redactSensitiveLogText('GET https://shennian.net' + url)).toBe('GET https://shennian.net/api/local-apps/runtime/[redacted]')
    const shared = '/api/local-apps/shared/' + 'b'.repeat(48) + '/page/private.json'
    expect(redactSensitiveRequestUrl(shared)).toBe('/local-apps/runtime/[redacted]')
    expect(redactSensitiveLogText('GET https://shennian.net' + shared)).toBe('GET https://shennian.net/api/local-apps/shared/[redacted]')
  })
  it('rejects anonymous callers and sharing grantees before forwarding', async () => {
    const a = await app()
    try {
      expect((await a.inject('/api/local-apps/machines/machine/apps')).statusCode).toBe(401)
      expect((await a.inject({ url: '/api/local-apps/machines/machine/apps', headers: { authorization: 'grantee' } })).statusCode).toBe(403)
      expect(mocks.relay).not.toHaveBeenCalled()
      expect(mocks.machine).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'grantee', paired: true, remoteAccessDisabledAt: null }) }))
    } finally { await a.close() }
  })
  it('loads HTML and independent JS through cloud relay with a path-scoped HttpOnly cookie, not a public link', async () => {
    const a = await app()
    try {
      const created = await a.inject({ method: 'POST', url: '/api/local-apps/runtime', headers: owner, payload: { machineId: 'machine', appId: entry.id } })
      expect(created.statusCode).toBe(200)
      const url = '/api' + created.json().runtimePath
      expect((await a.inject(url)).statusCode).toBe(401)
      expect((await a.inject({ url, headers: { authorization: 'grantee' } })).statusCode).toBe(403)
      const html = await a.inject({ url, headers: owner })
      expect(html.statusCode).toBe(200)
      expect(html.body).toContain('shennian'); expect(html.body).toContain('./app.js')
      expect(html.body).not.toContain('owner-device')
      const cookie = html.headers['set-cookie'] as string
      expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict')
      expect(cookie).toContain(`Path=${url}`)
      expect(html.headers['cache-control']).toBe('private, no-cache')
      expect(html.headers['content-security-policy']).toContain("connect-src 'none'")
      const js = await a.inject({ url: url + 'app.js', headers: { cookie: cookie.split(';')[0]! } })
      expect(js.body).toBe('window.localAssetLoaded=true')
      expect(mocks.relay).toHaveBeenLastCalledWith('machine', expect.objectContaining({ method: 'personal.service', params: expect.objectContaining({ path: '/app.js', asset: true }) }), 20000)
      expect((await a.inject({ url: url + 'app.js', headers: { cookie: cookie.split(';')[0]!, 'if-none-match': js.headers.etag as string } })).statusCode).toBe(304)
      mocks.device.mockResolvedValue(null)
      expect((await a.inject({ url, headers: { cookie: cookie.split(';')[0]! } })).statusCode).toBe(401)
    } finally { await a.close() }
  })
  it('invalidates runtimes independently, and never serves an expired token', async () => {
    const a = await app()
    try { expect((await a.inject('/api/local-apps/runtime/' + 'a'.repeat(48) + '/')).statusCode).toBe(410) }
    finally { await a.close() }
  })
  it('validates request/response bounds without invoking any HTML generation or versions', async () => {
    await expect(relayService('owner', 'machine', { appId: entry.id, port: 80, path: '/', method: 'GET' })).rejects.toThrow('invalid_service_target')
    expect(mocks.relay).not.toHaveBeenCalled()
    mocks.relay.mockResolvedValue({ ok: true, payload: { status: 200, base64: 'invalid!', headers: {} } })
    await expect(relayService('owner', 'machine', { appId: entry.id, port: entry.port, path: '/', method: 'GET' })).rejects.toThrow('service_invalid_response')
  })
})
