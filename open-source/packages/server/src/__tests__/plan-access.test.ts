// @covers open-source/packages/server/src/services/plan-access.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    billingSubscription: { findMany: mocks.findMany },
    $transaction: (run: (tx: unknown) => unknown) =>
      run({
        billingSubscription: { findFirst: mocks.findFirst, create: mocks.create },
        user: { update: mocks.update },
      }),
  },
}))

describe('plan access', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.BILLING_FEATURE_MODE = 'live'
  })

  it('grants every new phone account one complete seven-day Pro trial', async () => {
    mocks.findFirst.mockResolvedValue(null)
    mocks.create.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
    const { grantInitialProTrial } = await import('../services/plan-access.js')
    const now = new Date('2026-08-23T00:00:00.000Z')

    await expect(grantInitialProTrial('user-1', now)).resolves.toEqual({
      allowed: true,
      status: 'trial',
      expiresAt: new Date('2026-08-30T00:00:00.000Z'),
    })
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        productId: 'signup_trial',
        kind: 'grant:pro',
        status: 'active',
      }),
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { accountTier: 'pro' },
    })
  })

  it('requires Pro after the trial or subscription expires', async () => {
    mocks.findMany.mockResolvedValue([])
    const { getPlanAccess, requirePlanAccess } = await import('../services/plan-access.js')

    await expect(getPlanAccess('user-1')).resolves.toEqual({
      allowed: false,
      status: 'expired',
      expiresAt: null,
    })
    await expect(requirePlanAccess('user-1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'pro_required',
    })
  })

  it('does not extend the one-time trial on later logins', async () => {
    const expiresAt = new Date('2026-08-30T00:00:00.000Z')
    mocks.findFirst.mockResolvedValue({ status: 'active', expiresAt })
    const { grantInitialProTrial } = await import('../services/plan-access.js')

    await expect(grantInitialProTrial('user-1', new Date('2026-08-24T00:00:00.000Z'))).resolves.toEqual({
      allowed: true,
      status: 'trial',
      expiresAt,
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('keeps shadow and off modes unmetered for safe rollout', async () => {
    process.env.BILLING_FEATURE_MODE = 'shadow'
    const { getPlanAccess } = await import('../services/plan-access.js')

    await expect(getPlanAccess('user-1')).resolves.toEqual({
      allowed: true,
      status: 'unmetered',
      expiresAt: null,
    })
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
