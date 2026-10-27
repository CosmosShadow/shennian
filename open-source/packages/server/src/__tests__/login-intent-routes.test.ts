// @covers open-source/packages/server/src/routes/device-authorizations.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, service } = vi.hoisted(() => ({
  mockPrisma: {
    device: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  service: {
    verifyPhoneIdentity: vi.fn(),
    createLoginIntent: vi.fn(),
    getPublicLoginIntent: vi.fn(),
    getLoginIntentApproval: vi.fn(),
    approveLoginIntent: vi.fn(),
    denyLoginIntent: vi.fn(),
    getPrivateLoginIntentStatus: vi.fn(),
    claimLoginIntent: vi.fn(),
    cancelLoginIntent: vi.fn(),
  },
}))

vi.mock('../services/auth-session.js', () => ({
  verifyPhoneIdentity: service.verifyPhoneIdentity,
  AuthRouteError: class extends Error {
    constructor(public statusCode: number, message: string) { super(message) }
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) =>
    token === 'user-token' ? { userId: 'user_1', deviceId: 'device_1' } : null,
  ),
  verifyMachineToken: vi.fn(() => null),
}))
vi.mock('../services/login-intents.js', async () => {
  const actual = await vi.importActual<typeof import('../services/login-intents.js')>('../services/login-intents.js')
  return { ...actual, ...service }
})

import { AuthRouteError } from '../services/auth-session.js'
import { deviceAuthorizationRoutes } from '../routes/device-authorizations.js'
import { LoginIntentError } from '../services/login-intents.js'

describe('Device Authorization routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '654321')
    vi.clearAllMocks()
    process.env.PUBLIC_BASE_URL = 'https://shennian.net'
    mockPrisma.device.findUnique.mockResolvedValue({
      id: 'device_1',
      tokenExpiry: new Date(Date.now() + 60_000),
    })
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8613900000000' })
    service.createLoginIntent.mockResolvedValue({ id: 'intent_1', expiresAt: new Date('2026-08-23T01:00:00Z') })
    service.getPublicLoginIntent.mockResolvedValue({ id: 'intent_1', machineName: 'Mac', expired: false })
    app = Fastify()
    await app.register(deviceAuthorizationRoutes, { prefix: '/auth/device-authorizations' })
    await app.ready()
  })

  afterEach(async () => {
    delete process.env.PUBLIC_BASE_URL
    await app.close()
  })

  it('creates a public URL containing only the non-secret intent id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations',
      payload: {
        deviceSecretHash: 'b'.repeat(64),
        daemonInstallationId: 'installation-1',
        machineName: 'Mac',
        machineOs: 'darwin',
        actionType: 'room.create',
        actionSummary: '创建群聊',
        actionPayloadHash: 'a'.repeat(64),
      },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      loginIntentId: 'intent_1',
      publicLoginUrl: 'https://shennian.net/authorize/intent_1',
    })
    expect(response.body).not.toContain('deviceSecret')
    expect(response.body).not.toContain('machineToken')
    expect(service.createLoginIntent).toHaveBeenCalledWith(expect.objectContaining({
      daemonInstallationId: 'installation-1',
    }))
  })

  it('points an unconfigured local server at the Web development app instead of the API port', async () => {
    delete process.env.PUBLIC_BASE_URL
    const response = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations',
      headers: { host: '127.0.0.1:3000' },
      payload: {},
    })
    expect(response.json().publicLoginUrl).toBe('http://127.0.0.1:8081/authorize/intent_1')
  })

  it('allows public display metadata but requires login to approve', async () => {
    const publicResponse = await app.inject({
      method: 'GET',
      url: '/auth/device-authorizations/intent_1/public',
    })
    const approvalResponse = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations/intent_1/approve',
    })
    expect(publicResponse.statusCode).toBe(200)
    expect(approvalResponse.statusCode).toBe(401)
  })

  it('does not let a restricted review account inspect or approve a machine authorization', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })

    const approval = await app.inject({
      method: 'GET',
      url: '/auth/device-authorizations/intent_1/approval',
      headers: { authorization: 'Bearer user-token' },
    })
    const approve = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations/intent_1/approve',
      headers: { authorization: 'Bearer user-token' },
    })

    expect(approval.statusCode).toBe(403)
    expect(approve.statusCode).toBe(403)
    expect(service.getLoginIntentApproval).not.toHaveBeenCalled()
    expect(service.approveLoginIntent).not.toHaveBeenCalled()
  })

  it('requires login to deny and forwards the authenticated user id', async () => {
    service.denyLoginIntent.mockResolvedValue({ id: 'intent_1', status: 'denied' })
    const anonymous = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations/intent_1/deny',
    })
    const authenticated = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations/intent_1/deny',
      headers: { authorization: 'Bearer user-token' },
    })
    expect(anonymous.statusCode).toBe(401)
    expect(authenticated.statusCode).toBe(200)
    expect(service.denyLoginIntent).toHaveBeenCalledWith('intent_1', 'user_1')
  })

  it('authorizes the freshly verified phone even with an unrelated browser credential', async () => {
    service.verifyPhoneIdentity.mockResolvedValue({ id: 'fresh_user' })
    service.approveLoginIntent.mockResolvedValue({ status: 'approved', approvedByCurrentUser: true })
    const response = await app.inject({
      method: 'POST', url: '/auth/device-authorizations/intent_1/verify-phone',
      headers: { authorization: 'Bearer stale-review-token', cookie: 'old-browser-session=stale' },
      payload: { phone: '+8613900000000', code: '123456' },
    })
    expect(response.statusCode).toBe(200)
    expect(service.verifyPhoneIdentity).toHaveBeenCalledWith({ phone: '+8613900000000', code: '123456' })
    expect(service.approveLoginIntent).toHaveBeenCalledWith('intent_1', 'fresh_user')
    expect(response.json()).toEqual({ status: 'approved' })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('no-store')
    expect(mockPrisma.device.findUnique).not.toHaveBeenCalled()
  })

  it('requires a fresh phone challenge instead of accepting browser authentication', async () => {
    const response = await app.inject({
      method: 'POST', url: '/auth/device-authorizations/intent_1/verify-phone',
      headers: { authorization: 'Bearer user-token' }, payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(service.verifyPhoneIdentity).not.toHaveBeenCalled()
    expect(service.approveLoginIntent).not.toHaveBeenCalled()
  })

  it('does not approve after an invalid verification code', async () => {
    service.verifyPhoneIdentity.mockRejectedValue(new AuthRouteError(400, 'Invalid or expired code'))
    const response = await app.inject({
      method: 'POST', url: '/auth/device-authorizations/intent_1/verify-phone',
      payload: { phone: '+8613900000000', code: '000000' },
    })
    expect(response.statusCode).toBe(400)
    expect(service.approveLoginIntent).not.toHaveBeenCalled()
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('rejects expired requests before consuming the phone challenge', async () => {
    service.getPublicLoginIntent.mockResolvedValue({ expired: true })
    const response = await app.inject({
      method: 'POST', url: '/auth/device-authorizations/intent_1/verify-phone',
      payload: { phone: '+8613900000000', code: '123456' },
    })
    expect(response.statusCode).toBe(410)
    expect(service.verifyPhoneIdentity).not.toHaveBeenCalled()
  })

  it('preserves the review-account boundary for the freshly verified identity', async () => {
    service.verifyPhoneIdentity.mockResolvedValue({ id: 'review_user' })
    service.approveLoginIntent.mockRejectedValue(new LoginIntentError(
      'review_account_machine_access_forbidden', 403, 'Review accounts cannot pair.',
    ))
    const response = await app.inject({
      method: 'POST', url: '/auth/device-authorizations/intent_1/verify-phone',
      payload: { phone: '+8619900000002', code: '123456' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('review_account_machine_access_forbidden')
  })

  it('reads the device secret only from a private header', async () => {
    service.getPrivateLoginIntentStatus.mockResolvedValue({ status: 'approved', actionPayloadHash: 'a'.repeat(64) })
    const response = await app.inject({
      method: 'GET',
      url: '/auth/device-authorizations/intent_1/status',
      headers: { 'x-shennian-device-secret': 'private-secret' },
    })
    expect(response.statusCode).toBe(200)
    expect(service.getPrivateLoginIntentStatus).toHaveBeenCalledWith('intent_1', 'private-secret')
  })

  it('uses stable machine-readable errors without leaking credentials', async () => {
    service.claimLoginIntent.mockRejectedValue(
      new LoginIntentError('invalid_device_authorization', 401, 'Invalid device authorization.'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/auth/device-authorizations/intent_1/claim',
      headers: { 'x-shennian-device-secret': 'wrong-secret' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      error: 'invalid_device_authorization',
      message: 'Invalid device authorization.',
    })
  })
})

afterEach(() => vi.unstubAllEnvs())
