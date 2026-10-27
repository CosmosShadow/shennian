// @covers open-source/packages/server/src/services/review-account-policy.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  isReviewAccountPhone,
  isReviewAccountUserId,
} from '../services/review-account-policy.js'

describe('review account policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
  })

  it('recognizes only the centrally configured review phones', () => {
    expect(isReviewAccountPhone('+8619900000002')).toBe(true)
    expect(isReviewAccountPhone('+8619900000003')).toBe(false)
    expect(isReviewAccountPhone('+8613900000000')).toBe(false)
    expect(isReviewAccountPhone(null)).toBe(false)
  })

  it('has no default review account and rejects malformed configuration', () => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '')
    expect(isReviewAccountPhone('+8619900000002')).toBe(false)
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', 'invalid, +8619900000002, +8619900000002')
    expect(isReviewAccountPhone('+8619900000002')).toBe(true)
    expect(isReviewAccountPhone('invalid')).toBe(false)
  })

  it('resolves a user through the server-side account record', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ phone: '+8619900000002' })
    await expect(isReviewAccountUserId('review-user')).resolves.toBe(true)
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'review-user' },
      select: { phone: true },
    })
  })
})

afterEach(() => vi.unstubAllEnvs())
