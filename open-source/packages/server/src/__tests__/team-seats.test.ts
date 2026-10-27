// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/team-seats.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    billingSubscription: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    organization: {
      findMany: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import { hasActiveTeamSeat, refreshTeamSeatsForOwner, seatsForSubscription } from '../services/team-seats.js'

describe('team seats', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps Team and extra seat subscriptions to seat capacity', () => {
    expect(seatsForSubscription({ productId: 'team_monthly', seatCount: 0 })).toBe(5)
    expect(seatsForSubscription({ productId: 'team_extra_seat_monthly', seatCount: 0 })).toBe(1)
    expect(seatsForSubscription({ productId: 'team_monthly', seatCount: 8 })).toBe(8)
  })

  it('marks members beyond paid Team capacity as over_limit', async () => {
    const now = new Date('2026-06-16T00:00:00.000Z')
    const expiresAt = new Date('2026-07-16T00:00:00.000Z')
    mockPrisma.billingSubscription.findMany.mockResolvedValue([
      { id: 'sub-team', productId: 'team_monthly', seatCount: 0, expiresAt },
    ])
    mockPrisma.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        members: Array.from({ length: 6 }, (_, index) => ({
          id: `member-${index}`,
          userId: index === 0 ? 'owner-1' : `user-${index}`,
          role: index === 0 ? 'owner' : 'member',
          createdAt: new Date(`2026-06-16T00:00:0${index}.000Z`),
        })),
      },
    ])

    await expect(refreshTeamSeatsForOwner({ ownerId: 'owner-1', now })).resolves.toEqual({
      ownerId: 'owner-1',
      capacity: 5,
      active: 5,
      overLimit: 1,
      expired: 0,
    })
    expect(mockPrisma.organizationMember.update).toHaveBeenCalledTimes(6)
    expect(mockPrisma.organizationMember.update).toHaveBeenLastCalledWith({
      where: { id: 'member-5' },
      data: { seatStatus: 'over_limit', seatSource: 'team_subscription', seatExpiresAt: expiresAt },
    })
  })

  it('requires an active Team seat and owner Team subscription for inherited entitlements', async () => {
    mockPrisma.organizationMember.findMany.mockResolvedValue([
      { organization: { ownerId: 'owner-1' } },
    ])
    mockPrisma.billingSubscription.findFirst.mockResolvedValue({ id: 'sub-team' })

    await expect(hasActiveTeamSeat('member-1', new Date('2026-06-16T00:00:00.000Z'))).resolves.toBe(true)
    expect(mockPrisma.organizationMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'member-1', seatStatus: 'active' }),
    }))
  })
})
