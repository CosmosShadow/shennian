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
vi.mock('../services/plan-access.js', () => ({
  grantInitialProTrial: mockGrantInitialProTrial,
}))

import { authRoutes } from '../routes/auth.js'
import { offerScopedNicknameSetup } from '../services/nickname-setup.js'

describe('Nickname setup API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
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

  describe('Existing account nickname compatibility', () => {
    it('gives legacy blank accounts a stable provisional name without touching chosen names', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user1',
        phone: '+8613800000000',
        email: null,
        name: '',
      })
      mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'user1', phone: '+8613800000000', email: null, name: '',
      }).mockResolvedValue({
        id: 'user1', phone: '+8613800000000', email: null,
        name: '用户A123456789', nameSetupRequired: true,
      })

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: 'Bearer valid-token' },
      })

      expect(res.statusCode).toBe(200)
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user1', name: '' },
        data: { name: expect.stringMatching(/^用户[A-F0-9]{10}$/), nameSetupRequired: true },
      })
      expect(res.json().user.name).toBe('用户A123456789')
      expect(res.json().user.nameSetupRequired).toBe(true)
      expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'user1',
          principalType: 'human',
          status: 'active',
        }),
        data: { displayAlias: '用户A123456789' },
      })
    })
  })

  describe('Optional nickname setup', () => {
    it('does not offer setup for a chosen or legacy name; optional storage failures do not fail login', async () => {
      expect(await offerScopedNicknameSetup({ id: 'user1', name: '李辰' })).toBeUndefined()
      expect(await offerScopedNicknameSetup({ id: 'user1', name: '用户A123456789', nameSetupRequired: false })).toBeUndefined()
      expect(mockRedis.set).not.toHaveBeenCalled()
      mockRedis.set.mockRejectedValueOnce(new Error('offline'))
      expect(await offerScopedNicknameSetup({ id: 'user1', name: '用户A123456789', nameSetupRequired: true })).toBeUndefined()
    })

    it('offers a fresh narrow proof on later logins until the nickname is confirmed', async () => {
      const user = { id: 'user1', name: '用户A123456789', nameSetupRequired: true }
      const first = await offerScopedNicknameSetup(user)
      const second = await offerScopedNicknameSetup(user)
      expect(first?.name).toBe(second?.name)
      expect(first?.token).toMatch(/^[a-f0-9]{64}$/)
      expect(first?.token).not.toBe(second?.token)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
      expect(mockRedis.set).toHaveBeenCalledWith(expect.stringMatching(/^nickname-setup:/), 'user1', 'EX', 900)
    })

    it('saves after SMS expiry, synchronizes aliases and safely retries without account credentials', async () => {
      mockRedis.get.mockResolvedValue('user1')
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user1', name: '小林', nameSetupRequired: false })
      const payload = { token: 'a'.repeat(64), name: '  小林  ' }
      const first = await app.inject({ method: 'PATCH', url: '/auth/nickname-setup', payload })
      expect(first.statusCode).toBe(200)
      expect(first.json()).toEqual({ name: '小林', nameSetupRequired: false })
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user1', nameSetupRequired: true }, data: { name: '小林', nameSetupRequired: false },
      })
      expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { displayAlias: '小林' } }))
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 0 })
      const retry = await app.inject({ method: 'PATCH', url: '/auth/nickname-setup', payload: { ...payload, name: 'overwrite' } })
      expect(retry.json()).toEqual({ name: '小林', nameSetupRequired: false })
      expect(mockPrisma.device.create).not.toHaveBeenCalled()
      expect(mockRedis.eval).not.toHaveBeenCalled()
    })

    it('rejects an expired proof without changing the nickname or the existing login', async () => {
      mockRedis.get.mockResolvedValue(null)
      const res = await app.inject({ method: 'PATCH', url: '/auth/nickname-setup', payload: { token: 'a'.repeat(64), name: '小林' } })
      expect(res.statusCode).toBe(401)
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled()
      expect(mockPrisma.device.deleteMany).not.toHaveBeenCalled()
    })
  })

})
