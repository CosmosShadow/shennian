// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/credits.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    creditBucket: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    creditLedger: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  consumeCredits,
  getCreditBalance,
  grantCredits,
  grantPurchasedCredits,
  purchasedCreditsForProduct,
  releaseCreditReservation,
  reserveCredits,
  grantSubscriptionCredits,
  subscriptionCreditsForProduct,
} from '../services/credits.js'

describe('credit service', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps subscription products and credit packs to credit grants', () => {
    expect(subscriptionCreditsForProduct('pro_monthly')).toBe(1000)
    expect(subscriptionCreditsForProduct('team_monthly')).toBe(8000)
    expect(subscriptionCreditsForProduct('unknown')).toBe(0)
    expect(purchasedCreditsForProduct('credits_1000')).toBe(1000)
    expect(purchasedCreditsForProduct('credits_3200')).toBe(3200)
    expect(purchasedCreditsForProduct('credits_11000')).toBe(11000)
    expect(purchasedCreditsForProduct('credits_60000')).toBe(60000)
  })

  it('grants credits into a bucket and ledger row', async () => {
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })

    await grantCredits({ userId: 'user-1', amount: 100, source: 'adjustment', refId: 'ref-1' })

    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', amountGranted: 100, amountRemaining: 100, source: 'adjustment' }),
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', bucketId: 'bucket-1', delta: 100, reason: 'adjustment', refId: 'ref-1' }),
    })
  })

  it('grants subscription credits with billing order reference', async () => {
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })
    const startsAt = new Date('2026-06-16T00:00:00.000Z')

    await grantSubscriptionCredits({ userId: 'user-1', productId: 'pro_monthly', sourceOrderId: 'order-1', startsAt, periodMonths: 1 })

    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        source: 'subscription_grant',
        amountGranted: 1000,
        amountRemaining: 1000,
        expiresAt: new Date('2026-07-16T00:00:00.000Z'),
      }),
    })
  })

  it('grants purchased credit packs for twelve months', async () => {
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })
    const purchasedAt = new Date('2026-06-16T00:00:00.000Z')

    await grantPurchasedCredits({ userId: 'user-1', productId: 'credits_3200', sourceOrderId: 'order-1', purchasedAt })

    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        source: 'purchase',
        amountGranted: 3200,
        amountRemaining: 3200,
        expiresAt: new Date('2027-06-16T00:00:00.000Z'),
      }),
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', bucketId: 'bucket-1', delta: 3200, reason: 'purchase', refId: 'order-1' }),
    })
  })

  it('returns available balance', async () => {
    mockPrisma.creditBucket.findMany.mockResolvedValue([{ amountRemaining: 10 }, { amountRemaining: 20 }])
    await expect(getCreditBalance('user-1')).resolves.toBe(30)
  })

  it('consumes oldest available credits and records negative ledger rows', async () => {
    mockPrisma.creditBucket.findMany.mockResolvedValue([
      { id: 'bucket-1', amountRemaining: 3, expiresAt: new Date('2026-07-01') },
      { id: 'bucket-2', amountRemaining: 10, expiresAt: null },
    ])

    await expect(consumeCredits({ userId: 'user-1', amount: 5, reason: 'wechat_structure', refId: 'run-1' })).resolves.toEqual({ consumed: 5 })
    expect(mockPrisma.creditBucket.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'bucket-1' },
      data: { amountRemaining: { decrement: 3 } },
    })
    expect(mockPrisma.creditBucket.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'bucket-2' },
      data: { amountRemaining: { decrement: 2 } },
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bucketId: 'bucket-1', delta: -3, reason: 'wechat_structure', refId: 'run-1' }),
    })
  })

  it('rejects consumption when balance is insufficient', async () => {
    mockPrisma.creditBucket.findMany.mockResolvedValue([{ id: 'bucket-1', amountRemaining: 3, expiresAt: null }])
    await expect(consumeCredits({ userId: 'user-1', amount: 5, reason: 'wechat_structure' })).rejects.toMatchObject({
      message: 'insufficient_credits',
      statusCode: 402,
    })
  })

  it('reserves credits and releases them back to original buckets on failure', async () => {
    mockPrisma.creditBucket.findMany.mockResolvedValue([
      { id: 'bucket-1', amountRemaining: 3, expiresAt: new Date('2026-07-01') },
    ])

    const reservation = await reserveCredits({ userId: 'user-1', amount: 1, reason: 'wechat_structure', refId: 'run-1' })
    expect(reservation).toMatchObject({
      userId: 'user-1',
      amount: 1,
      allocations: [{ bucketId: 'bucket-1', amount: 1 }],
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ bucketId: 'bucket-1', delta: -1, reason: 'wechat_structure:reserve', refId: 'run-1' }),
    })

    await expect(releaseCreditReservation(reservation)).resolves.toEqual({ released: 1 })
    expect(mockPrisma.creditBucket.update).toHaveBeenLastCalledWith({
      where: { id: 'bucket-1' },
      data: { amountRemaining: { increment: 1 } },
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ bucketId: 'bucket-1', delta: 1, reason: 'wechat_structure:release', refId: 'run-1' }),
    })
  })
})
