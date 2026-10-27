// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/routes/grants.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const { mockPrisma, publishMachineAccessRevoked } = vi.hoisted(() => {
  const database: any = {
    machineGrant: { create: vi.fn(), count: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    machine: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    organizationMember: { findMany: vi.fn() },
    billingSubscription: { findFirst: vi.fn(), findMany: vi.fn() },
    device: { findUnique: vi.fn() },
  }
  database.$transaction = vi.fn((operation: (tx: typeof database) => unknown) => operation(database))
  return { mockPrisma: database, publishMachineAccessRevoked: vi.fn() }
})

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../relay/connection-control.js', () => ({ publishMachineAccessRevoked }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => token === 'owner-token'
    ? { userId: 'owner1', deviceId: 'dev1' }
    : token === 'grantee-token' ? { userId: 'grantee1', deviceId: 'dev2' } : null),
  verifyMachineToken: vi.fn(() => null), signToken: vi.fn(), signRefreshToken: vi.fn(),
}))

import { grantRoutes } from '../routes/grants.js'
import { machineInviteUrl } from '../services/public-web-url.js'

const MACHINE = { id: 'machine1', name: 'Mac', os: 'darwin', agentList: ['codex'], userId: 'owner1' }
const GRANT = { id: 'grant1', machineId: 'machine1', granterId: 'owner1', granteeId: null, permission: 'use', token: 'x'.repeat(43), expiresAt: null, revokedAt: null, createdAt: new Date('2026-09-08T00:00:00Z') }

describe('machine sharing grants', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    vi.resetAllMocks()
    mockPrisma.device.findUnique.mockResolvedValue({ id: 'dev1', tokenExpiry: new Date(Date.now() + 3_600_000) })
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'enterprise' })
    mockPrisma.organizationMember.findMany.mockResolvedValue([])
    mockPrisma.billingSubscription.findFirst.mockResolvedValue(null)
    mockPrisma.billingSubscription.findMany.mockResolvedValue([{ productId: 'pro_monthly', expiresAt: new Date(Date.now() + 86_400_000) }])
    mockPrisma.machineGrant.count.mockResolvedValue(0)
    app = Fastify()
    await app.register(grantRoutes, { prefix: '/machines' })
    await app.ready()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await app.close()
  })

  it('uses the configured lightweight Web origin and URL-encodes the capability', () => {
    vi.stubEnv('WEB_APP_PUBLIC_BASE_URL', 'https://app.shennian.net/')
    expect(machineInviteUrl({ protocol: 'https', hostname: 'api.internal' }, 'a/b+c'))
      .toBe('https://app.shennian.net/machine-invites/a%2Fb%2Bc')
  })

  it('creates a one-time use invite and returns a canonical URL instead of the token', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(MACHINE)
    mockPrisma.machineGrant.create.mockImplementation(({ data }: any) => ({ id: 'grant1', expiresAt: data.expiresAt }))
    const response = await app.inject({ method: 'POST', url: '/machines/machine1/grants', headers: { authorization: 'Bearer owner-token' }, payload: { permission: 'use' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().inviteUrl).toMatch(/^http:\/\/localhost:8081\/machine-invites\/[A-Za-z0-9_-]+$/)
    expect(response.json()).not.toHaveProperty('shareToken')
    expect(mockPrisma.machineGrant.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ permission: 'use', granterId: 'owner1' }) }))
  })

  it('rejects legacy permission escalation and caps pending invitations', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(MACHINE)
    let response = await app.inject({ method: 'POST', url: '/machines/machine1/grants', headers: { authorization: 'Bearer owner-token' }, payload: { permission: 'admin' } })
    expect(response.json().error).toBe('unsupported_machine_permission')
    mockPrisma.machineGrant.count.mockResolvedValue(10)
    response = await app.inject({ method: 'POST', url: '/machines/machine1/grants', headers: { authorization: 'Bearer owner-token' }, payload: {} })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('too_many_pending_machine_invites')
  })

  it('previews only public invitation facts', async () => {
    mockPrisma.machineGrant.findUnique.mockResolvedValue({ ...GRANT, machine: { name: 'Mac' }, granter: { name: '小王' } })
    const response = await app.inject({ method: 'GET', url: `/machines/grants/${GRANT.token}/preview` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ machineName: 'Mac', ownerName: '小王', expiresAt: null })
    expect(response.payload).not.toContain('machine1')
  })

  it.each([
    [{ ...GRANT, revokedAt: new Date() }, 410, 'machine_invite_cancelled'],
    [{ ...GRANT, expiresAt: new Date(Date.now() - 1000) }, 410, 'machine_invite_expired'],
    [{ ...GRANT, granteeId: 'somebody' }, 409, 'machine_invite_used'],
  ])('reports distinct preview failures', async (grant, status, error) => {
    mockPrisma.machineGrant.findUnique.mockResolvedValue({ ...grant, machine: { name: 'Mac' }, granter: { name: 'Owner' } })
    const response = await app.inject({ method: 'GET', url: `/machines/grants/${GRANT.token}/preview` })
    expect(response.statusCode).toBe(status)
    expect(response.json().error).toBe(error)
  })

  it('atomically redeems once and returns an idempotent result for the same user', async () => {
    mockPrisma.machineGrant.findUnique.mockResolvedValue(GRANT)
    mockPrisma.machineGrant.findFirst.mockResolvedValue(null)
    mockPrisma.machineGrant.updateMany.mockResolvedValue({ count: 1 })
    let response = await app.inject({ method: 'POST', url: '/machines/grants/redeem', headers: { authorization: 'Bearer grantee-token' }, payload: { shareToken: GRANT.token } })
    expect(response.json()).toEqual({ grantId: 'grant1', machineId: 'machine1', alreadyRedeemed: false })
    expect(mockPrisma.machineGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ granteeId: null }), data: { granteeId: 'grantee1' } }))
    mockPrisma.machineGrant.findUnique.mockResolvedValue({ ...GRANT, granteeId: 'grantee1' })
    response = await app.inject({ method: 'POST', url: '/machines/grants/redeem', headers: { authorization: 'Bearer grantee-token' }, payload: { shareToken: GRANT.token } })
    expect(response.json().alreadyRedeemed).toBe(true)
  })

  it('blocks self-redemption and a concurrent second claimant', async () => {
    mockPrisma.machineGrant.findUnique.mockResolvedValue(GRANT)
    let response = await app.inject({ method: 'POST', url: '/machines/grants/redeem', headers: { authorization: 'Bearer owner-token' }, payload: { shareToken: GRANT.token } })
    expect(response.json().error).toBe('cannot_accept_own_machine_invite')
    mockPrisma.machineGrant.findFirst.mockResolvedValue(null)
    mockPrisma.machineGrant.updateMany.mockResolvedValue({ count: 0 })
    response = await app.inject({ method: 'POST', url: '/machines/grants/redeem', headers: { authorization: 'Bearer grantee-token' }, payload: { shareToken: GRANT.token } })
    expect(response.json().error).toBe('machine_invite_used')
  })

  it('returns nicknames and avatars without phone numbers', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(MACHINE)
    mockPrisma.machineGrant.findMany.mockResolvedValue([{ ...GRANT, granteeId: 'grantee1', grantee: { id: 'grantee1', name: '小李', avatarVersion: null, avatarUpdatedAt: null } }])
    const response = await app.inject({ method: 'GET', url: '/machines/machine1/grants', headers: { authorization: 'Bearer owner-token' } })
    expect(response.json().grants[0]).toMatchObject({ granteeName: '小李', granteeAvatar: null, redeemed: true })
    expect(response.payload).not.toContain('phone')
  })

  it('revokes and immediately broadcasts only the redeemed user-machine access', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(MACHINE)
    mockPrisma.machineGrant.findUnique.mockResolvedValue({ ...GRANT, granteeId: 'grantee1' })
    mockPrisma.machineGrant.update.mockResolvedValue({})
    const response = await app.inject({ method: 'DELETE', url: '/machines/machine1/grants/grant1', headers: { authorization: 'Bearer owner-token' } })
    expect(response.statusCode).toBe(200)
    expect(publishMachineAccessRevoked).toHaveBeenCalledWith('machine1', 'grantee1')
  })
})
