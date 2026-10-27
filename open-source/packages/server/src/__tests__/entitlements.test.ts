// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/entitlements.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
    },
    billingSubscription: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import { buildEntitlements, getUserEntitlements, normalizeAccountTier, publicEntitledUser } from '../services/entitlements.js'

describe('billing plan entitlements', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.BILLING_FEATURE_MODE
  })

  it('never projects retired external-channel capabilities', () => {
    expect(normalizeAccountTier('personal')).toBe('personal')
    expect(buildEntitlements('personal').capabilities.manager_agent).toBe(false)
    expect(buildEntitlements('enterprise').capabilities.manager_agent).toBe(true)
    expect(buildEntitlements('enterprise').capabilities.managed_wecom).toBe(false)
    expect(buildEntitlements('enterprise').capabilities.external_channels).toBe(false)
  })

  it('uses new tier and add-on semantics only in live mode', () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    expect(buildEntitlements('free').capabilities.manager_agent).toBe(false)
    expect(buildEntitlements('pro').capabilities.manager_agent).toBe(true)
    expect(buildEntitlements('pro').capabilities.machine_sharing).toBe(true)
    expect(buildEntitlements('enterprise').capabilities.machine_sharing).toBe(true)
    expect(buildEntitlements('enterprise').capabilities.managed_wecom).toBe(false)
    expect(buildEntitlements('free', { managed_wecom: true }).capabilities.managed_wecom).toBe(false)
  })

  it('serializes the public user entitlement shape in shadow mode', () => {
    expect(publicEntitledUser({
      id: 'user-1',
      phone: null,
      email: 'u@example.test',
      name: 'User',
      accountTier: 'enterprise',
    })).toMatchObject({
      id: 'user-1',
      phone: '',
      pushPreviewEnabled: true,
      accountTier: 'pro',
      entitlements: {
        tier: 'pro',
        capabilities: { manager_agent: true, machine_sharing: false, managed_wecom: false },
      },
    })
  })

  it('opens Manager to personal users outside live billing mode', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'personal', entitlementFlags: {} })

    const entitlements = await getUserEntitlements('user-1')

    expect(entitlements.capabilities.manager_agent).toBe(true)
    expect(entitlements.capabilities.machine_sharing).toBe(false)
  })

  it('lets Team members inherit Pro capabilities from an active owner Team subscription in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'free', entitlementFlags: {} })
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { organization: { ownerId: 'owner-1' } },
    ])
    mockPrisma.billingSubscription.findFirst.mockResolvedValue({ id: 'sub-1' })

    const entitlements = await getUserEntitlements('member-1')

    expect(mockPrisma.billingSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { in: ['owner-1'] },
        status: 'active',
        kind: 'tier:enterprise',
      }),
    }))
    expect(entitlements.tier).toBe('pro')
    expect(entitlements.capabilities.manager_agent).toBe(true)
    expect(entitlements.capabilities.external_channels).toBe(false)
    expect(entitlements.capabilities.machine_sharing).toBe(true)
    expect(entitlements.capabilities.managed_wecom).toBe(false)
  })

  it('does not grant Team capabilities when owner Team subscription is inactive', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'free', entitlementFlags: {} })
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { organization: { ownerId: 'owner-1' } },
    ])
    mockPrisma.billingSubscription.findFirst.mockResolvedValue(null)

    const entitlements = await getUserEntitlements('member-1')

    expect(entitlements.tier).toBe('free')
    expect(entitlements.capabilities.manager_agent).toBe(false)
  })
})
