// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/routes/auth.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const {
  mockPrisma,
  mockConnections,
  mockRedis,
  mockPublishDeviceRevoked,
  mockUpdateAvatar,
  mockRemoveAvatar,
  mockBroadcastRoomIdentityUpdated,
  mockGrantInitialProTrial,
} = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    roomMembership: {
      updateMany: vi.fn(),
    },
    device: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    qrSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockConnections: {
    closeByDeviceId: vi.fn(() => 0),
  },
  mockRedis: {
    exists: vi.fn(() => 0),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  },
  mockPublishDeviceRevoked: vi.fn(),
  mockUpdateAvatar: vi.fn(),
  mockRemoveAvatar: vi.fn(),
  mockBroadcastRoomIdentityUpdated: vi.fn(),
  mockGrantInitialProTrial: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../relay/connection-control.js', () => ({
  publishDeviceRevoked: mockPublishDeviceRevoked,
}))
vi.mock('../lib/redis.js', () => ({ redis: mockRedis }))
vi.mock('../services/sms.js', () => ({ sendSmsCode: vi.fn(() => ({ debug: true })) }))
vi.mock('../services/apple-oauth.js', () => ({
  parseAppleBundleId: vi.fn(() => 'net.shengnian.app'),
  verifyAppleIdentityToken: vi.fn(),
}))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user1', deviceId: 'dev1' }
    if (token === 'valid-token-dev2') return { userId: 'user1', deviceId: 'dev2' }
    return null
  }),
  signToken: vi.fn(() => 'new-access-token'),
}))
vi.mock('../services/user-avatar.js', async () => {
  const actual = await vi.importActual<typeof import('../services/user-avatar.js')>(
    '../services/user-avatar.js',
  )
  return { ...actual, updateUserAvatar: mockUpdateAvatar, removeUserAvatar: mockRemoveAvatar }
})
vi.mock('../services/room-events.js', () => ({
  broadcastRoomIdentityUpdated: mockBroadcastRoomIdentityUpdated,
}))
vi.mock('../services/plan-access.js', () => ({
  grantInitialProTrial: mockGrantInitialProTrial,
}))

import { authRoutes } from '../routes/auth.js'
import { verifyAppleIdentityToken } from '../services/apple-oauth.js'

describe('Device Management API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.stubEnv('SHENNIAN_TEST_LOGIN_PHONE', '+8619900000001')
    vi.clearAllMocks()
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomMembership.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.device.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.qrSession.updateMany.mockResolvedValue({ count: 1 })
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.eval.mockImplementation(
      async (_script: string, _keyCount: number, key: string, expected: string) =>
        (await mockRedis.get(key)) === expected ? 1 : 0,
    )

    mockPrisma.device.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'dev1') {
        return Promise.resolve({
          id: 'dev1',
          userId: 'user1',
          tokenExpiry: new Date(Date.now() + 3600000),
          lastActiveAt: new Date(),
        })
      }
      if (where.id === 'dev2') {
        return Promise.resolve({
          id: 'dev2',
          userId: 'user1',
          tokenExpiry: new Date(Date.now() + 3600000),
          lastActiveAt: new Date(),
        })
      }
      if (where.id === 'dev-other') {
        return Promise.resolve({
          id: 'dev-other',
          userId: 'other-user',
          tokenExpiry: new Date(Date.now() + 3600000),
          lastActiveAt: new Date(),
        })
      }
      return Promise.resolve(null)
    })

    app = Fastify()
    await app.register(authRoutes, { prefix: '/auth' })
    await app.ready()
  })

  afterEach(async () => {
    delete process.env.BILLING_FEATURE_MODE
    await app.close()
  })

  describe('GET /auth/devices', () => {
    it('touches stale device activity while authenticating', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'dev1',
        userId: 'user1',
        tokenExpiry: new Date(Date.now() + 3600000),
        lastActiveAt: new Date(Date.now() - 10 * 60 * 1000),
      })
      mockPrisma.device.findMany.mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/auth/devices',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.updateMany).toHaveBeenCalledWith({
        where: { id: 'dev1', lastActiveAt: { lt: expect.any(Date) } },
        data: { lastActiveAt: expect.any(Date) },
      })
    })

    it('returns devices with current flag', async () => {
      mockPrisma.device.findMany.mockResolvedValue([
        {
          id: 'dev1',
          platform: 'ios',
          name: 'iPhone',
          lastActiveAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'dev2',
          platform: 'ios',
          name: 'iPhone',
          lastActiveAt: new Date(),
          createdAt: new Date(),
        },
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/auth/devices',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveLength(2)
      expect(body[0].current).toBe(true)
      expect(body[1].current).toBe(false)
      expect(mockPrisma.device.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          userId: 'user1',
          platform: { not: 'web' },
          refreshExpiry: { gt: expect.any(Date) },
        },
      }))
      expect(mockPrisma.device.updateMany).not.toHaveBeenCalled()
    })

    it('rejects an existing Web device token', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'dev1',
        userId: 'user1',
        platform: 'web',
        tokenExpiry: new Date(Date.now() + 3600000),
        lastActiveAt: new Date(),
      })
      const res = await app.inject({
        method: 'GET',
        url: '/auth/devices',
        headers: { authorization: 'Bearer valid-token' },
      })
      expect(res.statusCode).toBe(401)
      expect(mockPrisma.device.findMany).not.toHaveBeenCalled()
    })

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/devices',
      })

      expect(res.statusCode).toBe(401)
    })
  })

  describe('PATCH /auth/me', () => {
    it('updates the account nickname used by cross-product identity', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: '李辰',
        accountTier: 'personal',
        entitlementFlags: null,
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
        payload: { name: '  李辰  ' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user1' },
        data: { name: '李辰', nameSetupRequired: false },
      })
      expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user1',
          principalType: 'human',
          status: 'active',
          displayAlias: { not: '李辰' },
        },
        data: { displayAlias: '李辰' },
      })
      expect(res.json().user).toMatchObject({ id: 'user1', name: '李辰' })
    })

    it('rejects overly long account nicknames before they enter prompts', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
        payload: { name: '很长'.repeat(30) },
      })

      expect(res.statusCode).toBe(400)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('does not allow a saved nickname to be cleared', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
        payload: { name: '   ' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'profile_name_required' })
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('accepts the retired Push preview preference from older clients without persisting it', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'user1', phone: '+8613800000000', email: null, name: '李辰',
        accountTier: 'personal', entitlementFlags: null,
      })

      const res = await app.inject({
        method: 'PATCH',
        url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
        payload: { pushPreviewEnabled: false },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user1' },
        data: {},
      })
      expect(mockPrisma.roomMembership.updateMany).not.toHaveBeenCalled()
      expect(res.json().user.pushPreviewEnabled).toBe(true)
    })

    it('rejects a non-boolean Push preview preference', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
        payload: { pushPreviewEnabled: 'false' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('profile avatar', () => {
    it('accepts only authenticated binary image uploads', async () => {
      mockUpdateAvatar.mockResolvedValue({
        avatar: {
          version: 'v'.repeat(24),
          smallUrl: '/avatar/96',
          mediumUrl: '/avatar/256',
          updatedAt: '2026-08-23T12:00:00.000Z',
        },
      })
      const body = Buffer.from([0xff, 0xd8, 0xff, 0xd9])

      const res = await app.inject({
        method: 'PUT',
        url: '/auth/me/avatar',
        headers: { authorization: 'Bearer valid-token', 'content-type': 'image/jpeg' },
        payload: body,
      })

      expect(res.statusCode).toBe(200)
      expect(mockUpdateAvatar).toHaveBeenCalledWith({
        userId: 'user1',
        contentType: 'image/jpeg',
        buffer: body,
      })
      expect(mockBroadcastRoomIdentityUpdated).toHaveBeenCalledWith({ ownerUserId: 'user1' })
      expect(res.json().avatar.version).toBe('v'.repeat(24))
    })

    it('removes the current avatar pointer for the authenticated account', async () => {
      mockRemoveAvatar.mockResolvedValue({ avatar: null })

      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/me/avatar',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockRemoveAvatar).toHaveBeenCalledWith('user1')
      expect(mockBroadcastRoomIdentityUpdated).toHaveBeenCalledWith({ ownerUserId: 'user1' })
      expect(res.json()).toEqual({ avatar: null })
    })
  })

  describe('POST /auth/test-login/code', () => {
    it('issues a local debug code only for the configured phone', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/test-login/code',
        payload: { phone: '19900000001' },
        remoteAddress: '127.0.0.1',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.phone).toBe('+8619900000001')
      expect(body.code).toMatch(/^\d{6}$/)
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^sms:debug-code:\+8619900000001:[a-f0-9]{64}$/),
        '1',
        'EX',
        300,
        'NX',
      )
    })

    it('rejects other phones for debug code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/test-login/code',
        payload: { phone: '13800138000' },
        remoteAddress: '127.0.0.1',
      })

      expect(res.statusCode).toBe(403)
    })

    it('requires both the explicit switch and a direct loopback connection in production', async () => {
      const previousNodeEnv = process.env.NODE_ENV
      const previousEnabled = process.env.SHENNIAN_TEST_LOGIN_ENABLED
      process.env.NODE_ENV = 'production'
      delete process.env.SHENNIAN_TEST_LOGIN_ENABLED
      try {
        const disabled = await app.inject({
          method: 'POST',
          url: '/auth/test-login/code',
          payload: { phone: '19900000001' },
          remoteAddress: '127.0.0.1',
        })
        expect(disabled.statusCode).toBe(404)

        process.env.SHENNIAN_TEST_LOGIN_ENABLED = '1'
        const forwardedSpoof = await app.inject({
          method: 'POST',
          url: '/auth/test-login/code',
          headers: { 'x-forwarded-for': '127.0.0.1' },
          payload: { phone: '19900000001' },
          remoteAddress: '203.0.113.10',
        })
        expect(forwardedSpoof.statusCode).toBe(404)

        const enabledLoopback = await app.inject({
          method: 'POST',
          url: '/auth/test-login/code',
          payload: { phone: '19900000001' },
          remoteAddress: '127.0.0.1',
        })
        expect(enabledLoopback.statusCode).toBe(200)
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previousNodeEnv
        if (previousEnabled === undefined) delete process.env.SHENNIAN_TEST_LOGIN_ENABLED
        else process.env.SHENNIAN_TEST_LOGIN_ENABLED = previousEnabled
      }
    })
  })

  describe('DELETE /auth/devices/:id', () => {
    it('revokes device and closes WS connections', async () => {
      mockPrisma.device.delete.mockResolvedValue({})

      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/devices/dev2',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPublishDeviceRevoked).toHaveBeenCalledWith('dev2')
      expect(mockPrisma.device.delete).toHaveBeenCalledWith({ where: { id: 'dev2' } })
      expect(mockPrisma.device.delete.mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishDeviceRevoked.mock.invocationCallOrder[0],
      )
    })

    it('prevents revoking current device', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/devices/dev1',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockPublishDeviceRevoked).not.toHaveBeenCalled()
    })

    it('returns 404 for another user device', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/devices/dev-other',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(404)
    })

    it('returns 404 for non-existent device', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/devices/non-existent',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('Device limit enforcement', () => {
    it('stores the exact target device identity on a QR login session', async () => {
      mockPrisma.qrSession.create.mockResolvedValue({})

      const res = await app.inject({
        method: 'POST',
        url: '/auth/qr/create',
        payload: {
          installationId: 'desktop-install-1',
          platform: 'desktop',
          deviceName: 'Shennian Desktop',
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.qrSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'login',
          deviceInstallationId: 'desktop-install-1',
          targetPlatform: 'desktop',
          targetDeviceName: 'Shennian Desktop',
        }),
      })
    })

    it('rejects an unsupported QR target platform', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/qr/create',
        payload: { platform: 'forged' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockPrisma.qrSession.create).not.toHaveBeenCalled()
    })

    it('rejects a Web QR login target', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/qr/create',
        payload: { platform: 'web', deviceName: 'Desktop Browser' },
      })
      expect(res.statusCode).toBe(400)
      expect(mockPrisma.qrSession.create).not.toHaveBeenCalled()
    })

    it('rejects a new ordinary Web device login', async () => {
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user1', phone: '+8613800000000', name: 'Existing User',
      })
      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: { phone: '+8613800000000', code: '123456', platform: 'web' },
      })
      expect(res.statusCode).toBe(403)
      expect(mockPrisma.device.create).not.toHaveBeenCalled()
    })

    it('backfills an installation id while refreshing a legacy device', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'legacy-device',
        userId: 'user1',
        installationId: null,
        platform: 'ios',
        name: 'iPhone',
        refreshToken: 'legacy-refresh',
        refreshExpiry: new Date(Date.now() + 3600000),
      })
      mockPrisma.device.update.mockResolvedValue({})
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: 'Existing User',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'legacy-refresh', installationId: 'install-1' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: 'legacy-device' },
        data: expect.objectContaining({ installationId: 'install-1' }),
      })
    })

    it('keeps refreshing when an installation backfill conflicts', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'legacy-device',
        userId: 'user1',
        installationId: null,
        platform: 'ios',
        name: 'iPhone',
        refreshToken: 'legacy-refresh',
        refreshExpiry: new Date(Date.now() + 3600000),
      })
      mockPrisma.device.update.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({})
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: 'Existing User',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'legacy-refresh', installationId: 'install-already-used' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.update).toHaveBeenCalledTimes(2)
      expect(mockPrisma.device.update.mock.calls[1]?.[0].data).not.toHaveProperty('installationId')
    })

    it('rejects a refresh request whose platform differs from the stored device', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'web-device', userId: 'user1', installationId: 'web-install-1',
        platform: 'web', name: 'Web Browser', refreshToken: 'web-refresh',
        refreshExpiry: new Date(Date.now() + 3600000),
      })
      mockPrisma.device.update.mockResolvedValue({})
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1', phone: '+8613800000000', email: null, name: 'Existing User',
      })

      const res = await app.inject({
        method: 'POST', url: '/auth/refresh',
        payload: {
          refreshToken: 'web-refresh', platform: 'desktop', deviceName: 'Shennian Desktop',
          installationId: 'web-install-1',
        },
      })

      expect(res.statusCode).toBe(403)
      expect(mockPrisma.device.update).not.toHaveBeenCalled()
    })

    it('refines a legacy generic desktop name during refresh', async () => {
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'desktop-device', userId: 'user1', installationId: 'desktop-install-1',
        platform: 'desktop', name: 'Shennian Desktop', refreshToken: 'desktop-refresh',
        refreshExpiry: new Date(Date.now() + 3600000),
      })
      mockPrisma.device.update.mockResolvedValue({})
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1', phone: '+8613800000000', email: null, name: 'Existing User',
      })

      const res = await app.inject({
        method: 'POST', url: '/auth/refresh',
        payload: {
          refreshToken: 'desktop-refresh', platform: 'desktop', deviceName: 'Mac Desktop',
          installationId: 'desktop-install-1',
        },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: 'desktop-device' },
        data: expect.objectContaining({ name: 'Mac Desktop' }),
      })
    })

    it('reuses the same user installation without consuming another device slot', async () => {
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user1', phone: '+8613800000000', name: 'Existing User' })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: 'Existing User',
      })
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'existing-device',
        userId: 'user1',
        installationId: 'install-1',
        platform: 'ios',
        name: 'iPhone',
        refreshToken: 'existing-refresh',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: {
          phone: '+8613800000000',
          code: '123456',
          platform: 'ios',
          deviceName: 'iPhone',
          installationId: 'install-1',
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ refreshToken: 'existing-refresh' })
      expect(mockPrisma.device.findUnique).toHaveBeenCalledWith({
        where: {
          userId_installationId: { userId: 'user1', installationId: 'install-1' },
        },
      })
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: 'existing-device' },
        data: expect.objectContaining({
          platform: 'ios',
          name: 'iPhone',
          lastActiveAt: expect.any(Date),
        }),
      })
      expect(mockPrisma.device.count).not.toHaveBeenCalled()
      expect(mockPrisma.device.create).not.toHaveBeenCalled()
    })

    it('converges concurrent first logins onto the installation created by the winner', async () => {
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user1', phone: '+8613800000000', name: 'Existing User' })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: 'Existing User',
      })
      mockPrisma.device.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'winner-device',
        userId: 'user1',
        installationId: 'install-1',
        platform: 'ios',
        name: 'iPhone',
        refreshToken: 'winner-refresh',
      })
      mockPrisma.device.count.mockResolvedValue(49)
      mockPrisma.device.create.mockRejectedValue({ code: 'P2002' })
      mockPrisma.device.update.mockResolvedValue({})

      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: {
          phone: '+8613800000000',
          code: '123456',
          platform: 'ios',
          installationId: 'install-1',
        },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ refreshToken: 'winner-refresh' })
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: 'winner-device' },
        data: expect.objectContaining({ lastActiveAt: expect.any(Date) }),
      })
    })

    it('evicts oldest devices when limit reached', async () => {
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user1', phone: '+8613800000000', name: 'Existing User' })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: '',
      })
      mockPrisma.device.count.mockResolvedValue(50)
      mockPrisma.device.findMany.mockResolvedValue([{ id: 'oldest-dev' }])
      mockPrisma.device.deleteMany.mockResolvedValue({ count: 1 })
      mockPrisma.device.create.mockResolvedValue({
        id: 'new-dev',
        userId: 'user1',
        accessToken: 'pending',
        refreshToken: 'rt',
      })
      mockPrisma.device.update.mockResolvedValue({})

      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: { phone: '+8613800000000', code: '123456', platform: 'ios' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['oldest-dev'] } },
      })
      expect(mockPublishDeviceRevoked).toHaveBeenCalledWith('oldest-dev')
    })

    it('does not evict when under limit', async () => {
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user1', phone: '+8613800000000', name: 'Existing User' })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: '',
      })
      mockPrisma.device.count.mockResolvedValue(49)
      mockPrisma.device.create.mockResolvedValue({
        id: 'new-dev',
        userId: 'user1',
        accessToken: 'pending',
        refreshToken: 'rt',
      })
      mockPrisma.device.update.mockResolvedValue({})

      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: { phone: '+8613800000000', code: '123456', platform: 'ios' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.deleteMany).not.toHaveBeenCalled()
    })

    it('enforces the device limit and issues the QR session for its persisted target', async () => {
      mockPrisma.qrSession.findUnique.mockResolvedValue({
        id: 'qr1',
        token: 'qr-token',
        status: 'pending',
        deviceInstallationId: null,
        targetPlatform: 'desktop',
        targetDeviceName: 'Shennian Desktop',
        expiresAt: new Date(Date.now() + 60_000),
      })
      mockPrisma.device.count.mockResolvedValue(50)
      mockPrisma.device.findMany.mockResolvedValue([{ id: 'oldest-dev' }])
      mockPrisma.device.deleteMany.mockResolvedValue({ count: 1 })
      mockPrisma.device.create.mockResolvedValue({ id: 'qr-device' })
      mockPrisma.device.update.mockResolvedValue({})
      mockPrisma.qrSession.update.mockResolvedValue({})
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: 'Existing User',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/qr/confirm',
        headers: { authorization: 'Bearer valid-token' },
        payload: { qrToken: 'qr-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.device.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['oldest-dev'] } },
      })
      expect(mockPublishDeviceRevoked).toHaveBeenCalledWith('oldest-dev')
      expect(mockPrisma.device.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user1',
          platform: 'desktop',
          name: 'Shennian Desktop',
        }),
      })
      expect(mockPrisma.qrSession.update).toHaveBeenCalledWith({
        where: { id: 'qr1' },
        data: { status: 'confirmed', userId: 'user1', deviceId: 'qr-device' },
      })
    })

    it('does not create a second device when another QR confirmation owns the claim', async () => {
      mockPrisma.qrSession.findUnique.mockResolvedValue({
        id: 'qr1',
        token: 'qr-token',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      mockPrisma.qrSession.updateMany.mockResolvedValueOnce({ count: 0 })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/qr/confirm',
        headers: { authorization: 'Bearer valid-token' },
        payload: { qrToken: 'qr-token' },
      })

      expect(res.statusCode).toBe(409)
      expect(mockPrisma.device.create).not.toHaveBeenCalled()
    })

    it('returns the exact device attached to a confirmed QR session', async () => {
      mockPrisma.qrSession.findUnique.mockResolvedValue({
        id: 'qr1',
        token: 'qr-token',
        status: 'confirmed',
        userId: 'user1',
        deviceId: 'qr-device',
        expiresAt: new Date(Date.now() + 60_000),
      })
      mockPrisma.device.findUnique.mockResolvedValueOnce({
        id: 'qr-device',
        accessToken: 'qr-access',
        refreshToken: 'qr-refresh',
        user: {
          id: 'user1',
          phone: '+8613800000000',
          email: null,
          name: 'Existing User',
        },
      })

      const res = await app.inject({
        method: 'GET',
        url: '/auth/qr/status/qr-token',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ status: 'confirmed' })
      expect(mockPrisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'qr-device' },
        include: expect.any(Object),
      })
      expect(mockPrisma.device.findFirst).not.toHaveBeenCalled()
    })

    it('keeps the internal QR claim hidden from polling clients', async () => {
      mockPrisma.qrSession.findUnique.mockResolvedValue({
        id: 'qr1',
        token: 'qr-token',
        status: 'confirming',
        expiresAt: new Date(Date.now() + 60_000),
      })

      const res = await app.inject({
        method: 'GET',
        url: '/auth/qr/status/qr-token',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'pending' })
      expect(mockPrisma.device.findUnique).not.toHaveBeenCalled()
    })

    it('signs a new user in with a stable provisional name without requiring nickname setup', async () => {
      process.env.BILLING_FEATURE_MODE = 'live'
      mockRedis.get.mockResolvedValue('123456')
      mockPrisma.user.findUnique.mockResolvedValue(null)
      let createdUser: Record<string, unknown>
      mockPrisma.user.create.mockImplementation(async ({ data }) => {
        createdUser = { id: 'new-user', email: null, ...data }
        return createdUser
      })
      mockPrisma.user.findUniqueOrThrow.mockImplementation(async () => createdUser)
      mockPrisma.device.count.mockResolvedValue(0)
      mockPrisma.device.create.mockResolvedValue({
        id: 'new-dev',
        userId: 'new-user',
        accessToken: 'pending',
        refreshToken: 'rt',
      })
      mockPrisma.device.update.mockResolvedValue({})

      const first = await app.inject({
        method: 'POST',
        url: '/auth/verify-code',
        payload: { phone: '+8613800000000', code: '123456', platform: 'ios' },
      })

      expect(first.statusCode).toBe(200)
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          phone: '+8613800000000',
          name: expect.stringMatching(/^用户[A-F0-9]{10}$/),
          nameSetupRequired: true,
        },
      })
      const res = first
      expect(res.json().user.nameSetupRequired).toBe(true)
      expect(mockGrantInitialProTrial).toHaveBeenCalledWith('new-user')
      expect(res.json()).toMatchObject({
        token: 'new-access-token',
        user: { id: 'new-user', phone: '+8613800000000' },
      })
    })
  })

  describe('POST /auth/apple', () => {
    it('requires phone registration for a new Apple identity', async () => {
      process.env.APPLE_SIGN_IN_ENABLED = 'true'
      process.env.APPLE_SIGN_IN_BUNDLE_ID = 'net.shengnian.app'
      vi.mocked(verifyAppleIdentityToken).mockResolvedValue({
        sub: 'apple-sub-1',
        email: 'relay@privaterelay.appleid.com',
      })
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: {
          identityToken: 'apple-token',
          nonce: 'nonce-1',
          fullName: 'Shennian User',
          platform: 'ios',
          deviceName: 'ios App',
        },
      })

      expect(res.statusCode).toBe(403)
      expect(verifyAppleIdentityToken).toHaveBeenCalledWith({
        identityToken: 'apple-token',
        audience: 'net.shengnian.app',
        nonce: 'nonce-1',
      })
      expect(res.json()).toEqual({ error: 'phone_login_required' })
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
      expect(mockPrisma.device.create).not.toHaveBeenCalled()
    })

    it('keeps existing Apple accounts able to sign in during migration', async () => {
      process.env.APPLE_SIGN_IN_ENABLED = 'true'
      process.env.APPLE_SIGN_IN_BUNDLE_ID = 'net.shengnian.app'
      vi.mocked(verifyAppleIdentityToken).mockResolvedValue({ sub: 'apple-sub-existing' })
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'apple-user',
        appleSub: 'apple-sub-existing',
        phone: null,
        email: 'relay@privaterelay.appleid.com',
        name: 'Existing User',
      })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'apple-user',
        phone: null,
        email: 'relay@privaterelay.appleid.com',
        name: 'Existing User',
      })
      mockPrisma.device.count.mockResolvedValue(0)
      mockPrisma.device.create.mockResolvedValue({ id: 'apple-device' })
      mockPrisma.device.update.mockResolvedValue({})

      const res = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: { identityToken: 'apple-token', platform: 'ios' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ token: 'new-access-token', user: { id: 'apple-user' } })
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('rejects an invalid Apple credential', async () => {
      process.env.APPLE_SIGN_IN_ENABLED = 'true'
      process.env.APPLE_SIGN_IN_BUNDLE_ID = 'net.shengnian.app'
      vi.mocked(verifyAppleIdentityToken).mockRejectedValue(new Error('bad token'))

      const res = await app.inject({
        method: 'POST',
        url: '/auth/apple',
        payload: {
          identityToken: 'invalid-token',
          nonce: 'nonce-1',
          platform: 'ios',
        },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'Invalid Apple credential' })
    })
  })
})

afterEach(() => vi.unstubAllEnvs())
