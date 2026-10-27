// @covers open-source/packages/server/src/routes/organizations.ts
// @covers open-source/packages/server/src/services/organizations.ts

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const now = new Date('2026-05-28T00:00:00Z')

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    organizationMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organizationInvite: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    machine: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    machineGrant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    billingSubscription: {
      findMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    device: { findUnique: vi.fn() },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return ops(mockPrisma)
      return Promise.all(ops as Promise<unknown>[])
    }),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/jwt.js', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'owner-token') return { userId: 'owner1', deviceId: 'dev1' }
    if (token === 'member-token') return { userId: 'member1', deviceId: 'dev2' }
    return null
  }),
  verifyMachineToken: vi.fn(() => null),
  signToken: vi.fn(),
  signRefreshToken: vi.fn(),
}))

vi.mock('../services/entitlements.js', async () => {
  const actual = await vi.importActual<typeof import('../services/entitlements.js')>('../services/entitlements.js')
  return {
    ...actual,
    requireEntitlement: vi.fn(async (userId: string) => {
      if (userId === 'member1') throw new actual.EntitlementError()
    }),
  }
})

import { organizationRoutes } from '../routes/organizations.js'

const ORG = {
  id: 'org1',
  name: '神念研发',
  ownerId: 'owner1',
  inviteCode: 'ORGCODE',
  createdAt: now,
  updatedAt: now,
  members: [{ id: 'om1', userId: 'owner1', role: 'owner' }],
}

function member(overrides: Partial<{ id: string; userId: string; role: string }> = {}) {
  return {
    id: overrides.id ?? 'om2',
    organizationId: 'org1',
    userId: overrides.userId ?? 'member1',
    role: overrides.role ?? 'member',
    createdAt: now,
    updatedAt: now,
    user: { name: '成员', phone: null, email: null },
  }
}

describe('organization routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma.device.findUnique.mockResolvedValue({ id: 'dev1', tokenExpiry: new Date(Date.now() + 3_600_000) })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner1', name: 'Owner' })
    mockPrisma.machine.findMany.mockResolvedValue([])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])
    mockPrisma.billingSubscription.findMany.mockResolvedValue([])
    app = Fastify()
    await app.register(organizationRoutes, { prefix: '/organizations' })
    await app.ready()
  })

  afterEach(async () => {
    delete process.env.BILLING_FEATURE_MODE
    await app.close()
  })

  it('does not auto-create organizations while listing organizations', async () => {
    mockPrisma.organization.findMany.mockResolvedValue([ORG])

    const res = await app.inject({
      method: 'GET',
      url: '/organizations',
      headers: { authorization: 'Bearer owner-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.organization.create).not.toHaveBeenCalled()
    expect(JSON.parse(res.payload).organizations[0].name).toBe('神念研发')
  })

  it('requires enterprise entitlement to create an organization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: { authorization: 'Bearer member-token' },
      payload: { name: '普通用户组织' },
    })

    expect(res.statusCode).toBe(403)
    expect(mockPrisma.organization.create).not.toHaveBeenCalled()
  })

  it('lets enterprise users create their first organization', async () => {
    mockPrisma.organization.findFirst.mockResolvedValue(null)
    mockPrisma.organization.create.mockResolvedValue(ORG)

    const res = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: { authorization: 'Bearer owner-token' },
      payload: { name: '神念研发' },
    })

    expect(res.statusCode).toBe(201)
    expect(mockPrisma.organization.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerId: 'owner1', name: '神念研发' }),
    }))
  })

  it('reuses the existing organization instead of creating a second one', async () => {
    mockPrisma.organization.findFirst.mockResolvedValue(ORG)

    const res = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: { authorization: 'Bearer owner-token' },
      payload: { name: '第二个组织' },
    })

    expect(res.statusCode).toBe(201)
    expect(mockPrisma.organization.create).not.toHaveBeenCalled()
    expect(JSON.parse(res.payload).organization).toMatchObject({
      id: 'org1',
      name: '神念研发',
    })
  })

  it('redeems an organization invite code with no default resource permissions', async () => {
    mockPrisma.organizationInvite.findUnique.mockResolvedValue(null)
    mockPrisma.organization.findUnique.mockResolvedValue(ORG)
    mockPrisma.organizationMember.upsert.mockResolvedValue(member())

    const res = await app.inject({
      method: 'POST',
      url: '/organizations/invites/redeem',
      headers: { authorization: 'Bearer member-token' },
      payload: { code: 'ORGCODE' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.organizationMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ role: 'member' }),
    }))
  })

  it('refreshes Team seats immediately after invite redeem in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    const expiresAt = new Date('2026-06-28T00:00:00Z')
    mockPrisma.organizationInvite.findUnique.mockResolvedValue(null)
    mockPrisma.organization.findUnique.mockResolvedValue(ORG)
    mockPrisma.organizationMember.upsert.mockResolvedValue(member())
    mockPrisma.billingSubscription.findMany.mockResolvedValue([
      { id: 'sub-team', productId: 'team_monthly', seatCount: 0, expiresAt },
    ])
    mockPrisma.organization.findMany.mockResolvedValue([
      { id: 'org1', members: [member({ id: 'om1', userId: 'owner1', role: 'owner' }), member()] },
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/organizations/invites/redeem',
      headers: { authorization: 'Bearer member-token' },
      payload: { code: 'ORGCODE' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.organizationMember.update).toHaveBeenCalled()
  })

  it('lets admins update a member role', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ id: 'om1', role: 'owner', organization: ORG })
    mockPrisma.organizationMember.findFirst.mockResolvedValue(member())
    mockPrisma.organizationMember.update.mockResolvedValue(member({ role: 'admin' }))

    const res = await app.inject({
      method: 'PATCH',
      url: '/organizations/org1/members/om2',
      headers: { authorization: 'Bearer owner-token' },
      payload: { role: 'admin' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).member.role).toBe('admin')
  })

  it('lists organization machines with assigned members', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ id: 'om1', role: 'owner', organization: ORG })
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      member({ id: 'om1', userId: 'owner1', role: 'owner' }),
      member({ id: 'om2', userId: 'member1', role: 'member' }),
    ])
    mockPrisma.machine.findMany.mockResolvedValue([
      {
        id: 'm1',
        name: 'Mac',
        os: 'macos',
        online: true,
        paired: true,
        lastSeen: now,
        cliVersion: '0.2.30',
        userId: 'owner1',
        user: { name: 'Owner', phone: null, email: null },
        grants: [
          {
            id: 'g1',
            granteeId: 'member1',
            permission: 'use',
            grantee: { name: '成员', phone: null, email: null },
          },
        ],
      },
    ])
    mockPrisma.machineGrant.findMany.mockResolvedValue([])

    const res = await app.inject({
      method: 'GET',
      url: '/organizations/org1/machines',
      headers: { authorization: 'Bearer owner-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.machines[0]).toMatchObject({
      id: 'm1',
      name: 'Mac',
      assignedMembers: [
        expect.objectContaining({ memberId: 'om2', userId: 'member1', permission: 'use' }),
      ],
    })
  })

  it('rejects new organization machine assignments while preserving old grants', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ id: 'om1', role: 'owner', organization: ORG })
    mockPrisma.organizationMember.findFirst.mockResolvedValue(member())
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'owner1',
      paired: true,
    })
    mockPrisma.machineGrant.findFirst.mockResolvedValue(null)
    mockPrisma.machineGrant.create.mockResolvedValue({ id: 'g1' })

    const res = await app.inject({
      method: 'POST',
      url: '/organizations/org1/machines/m1/members/om2',
      headers: { authorization: 'Bearer owner-token' },
      payload: { permission: 'use' },
    })

    expect(res.statusCode).toBe(410)
    expect(JSON.parse(res.payload).error).toBe('machine_sharing_retired')
    expect(mockPrisma.machineGrant.create).not.toHaveBeenCalled()
  })

  it('removes a Team member and revokes organization machine grants', async () => {
    mockPrisma.organizationMember.findUnique.mockResolvedValue({ id: 'om1', role: 'owner', organization: ORG })
    mockPrisma.organizationMember.findFirst.mockResolvedValue(member({ id: 'om2', userId: 'member1', role: 'member' }))
    mockPrisma.machineGrant.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.organizationMember.delete.mockResolvedValue({})

    const res = await app.inject({
      method: 'DELETE',
      url: '/organizations/org1/members/om2',
      headers: { authorization: 'Bearer owner-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPrisma.machineGrant.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        granteeId: 'member1',
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mockPrisma.organizationMember.delete).toHaveBeenCalledWith({ where: { id: 'om2' } })
  })

})
