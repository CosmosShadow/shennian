// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/instance-auth.ts
// @covers open-source/packages/server/src/routes/instance.ts
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  create: vi.fn(), findUnique: vi.fn(), issue: vi.fn(), eval: vi.fn(async () => 1),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { instanceAccount: { create: mocks.create, findUnique: mocks.findUnique } } }))
vi.mock('../lib/redis.js', () => ({ redis: { eval: mocks.eval } }))
vi.mock('../services/auth-session.js', () => ({
  AuthRouteError: class extends Error { constructor(public statusCode: number, message: string) { super(message) } },
  issueDeviceSession: mocks.issue,
}))
import { hashInstancePassword, verifyInstancePassword, localInstanceAuth } from '../services/instance-auth.js'
import { instanceRoutes } from '../routes/instance.js'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('self-hosted password identity', () => {
  it('salts and verifies passwords without storing plaintext', async () => {
    const a = await hashInstancePassword('a-long-test-password')
    const b = await hashInstancePassword('a-long-test-password')
    expect(a).not.toBe(b)
    expect(await verifyInstancePassword('a-long-test-password', a)).toBe(true)
    expect(await verifyInstancePassword('wrong-password', a)).toBe(false)
    expect(await verifyInstancePassword('a-long-test-password', 'bad')).toBe(false)
  })
  it('rejects official instance registration before touching persistence', async () => {
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'official')
    await expect(localInstanceAuth({ username: 'tester', password: 'a-long-test-password' }, true)).rejects.toThrow('Not found')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('enforces invitation registration and creates an independent identity', async () => {
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('SHENNIAN_REGISTRATION_POLICY', 'invite')
    vi.stubEnv('SHENNIAN_REGISTRATION_INVITE', 'unit-invitation-with-enough-entropy')
    await expect(localInstanceAuth({ username: 'tester', password: 'a-long-test-password', invite: 'wrong' }, true)).rejects.toThrow('invalid_invite')
    mocks.create.mockResolvedValue({ userId: 'local-user' })
    mocks.issue.mockResolvedValue({ deviceId: 'device', token: 'local-access', refreshToken: 'local-refresh', user: { id: 'local-user' } })
    const session = await localInstanceAuth({ username: 'Tester', password: 'a-long-test-password', invite: 'unit-invitation-with-enough-entropy', platform: 'ios' }, true)
    expect(mocks.create.mock.calls[0]![0].data.username).toBe('tester')
    expect(session).toEqual({ token: 'local-access', refreshToken: 'local-refresh', user: { id: 'local-user' } })
  })
  it('exposes safe discovery and rate-limits before KDF / database work', async () => {
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'self-hosted')
    vi.stubEnv('SHENNIAN_INSTANCE_ID', 'unit-instance-1234567890')
    vi.stubEnv('SHENNIAN_REGISTRATION_POLICY', 'closed')
    const app = Fastify(); await app.register(instanceRoutes)
    try {
      const discovery = await app.inject('/public/instance')
      expect(discovery.headers['cache-control']).toBe('no-store')
      expect(discovery.json().auth).toEqual({ password: true, registration: 'closed' })
      mocks.eval.mockResolvedValueOnce(100)
      const response = await app.inject({ method: 'POST', url: '/auth/local/login', payload: { username: 'tester', password: 'a-long-test-password' } })
      expect(response.statusCode).toBe(429)
      expect(mocks.findUnique).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
