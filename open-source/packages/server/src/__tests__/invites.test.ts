// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/services/invites.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    inviteCode: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    creditBucket: { create: vi.fn() },
    creditLedger: { create: vi.fn() },
    inviteReward: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    billingAuditLog: { create: vi.fn() },
    promotionSubmission: { create: vi.fn() },
    billingSubscription: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  awardPromotionReward,
  awardInviteReferralProDays,
  bootstrapExistingUserBillingBenefits,
  bootstrapLegacyEnterpriseBillingBenefits,
  cappedInviteRewardDays,
  createInviteCodeToken,
  ensureDefaultInviteCodes,
  INVITE_REWARD_PRO_DAYS_CAP,
  referralProDaysForEvent,
  validateInviteForSignup,
} from '../services/invites.js'

describe('invite billing gates', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
  })

  afterEach(() => {
    delete process.env.BILLING_FEATURE_MODE
  })

  it('does not require invite codes in shadow mode', async () => {
    delete process.env.BILLING_FEATURE_MODE
    await expect(validateInviteForSignup(null)).resolves.toEqual({ required: false, allowed: true })
    expect(mockPrisma.inviteCode.findUnique).not.toHaveBeenCalled()
  })

  it('allows signups without invite codes in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    await expect(validateInviteForSignup(null)).resolves.toEqual({ required: false, allowed: true })
    expect(mockPrisma.inviteCode.findUnique).not.toHaveBeenCalled()
  })

  it('accepts active invite codes in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteCode.findUnique.mockResolvedValue({
      id: 'invite-1',
      issuerId: 'inviter-1',
      status: 'active',
      usedCount: 0,
      maxRedemptions: 1,
      expiresAt: null,
    })

    await expect(validateInviteForSignup(' sn-abcd ')).resolves.toMatchObject({
      required: false,
      allowed: true,
      inviteCodeId: 'invite-1',
      inviterId: 'inviter-1',
    })
    expect(mockPrisma.inviteCode.findUnique).toHaveBeenCalledWith({ where: { code: 'SNABCD' } })
  })

  it('rejects invalid optional invite codes in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteCode.findUnique.mockResolvedValue(null)

    await expect(validateInviteForSignup('bad-code')).resolves.toMatchObject({
      required: false,
      allowed: false,
      reason: 'invite_invalid',
    })
    expect(mockPrisma.inviteCode.findUnique).toHaveBeenCalledWith({ where: { code: 'BADCODE' } })
  })

  it('caps referral pro-day rewards and keeps the public reward table simple', () => {
    expect(referralProDaysForEvent('activation')).toBe(3)
    expect(referralProDaysForEvent('pro_purchase')).toBe(7)
    expect(referralProDaysForEvent('team_purchase')).toBe(15)
    expect(cappedInviteRewardDays(28, 15)).toBe(2)
    expect(cappedInviteRewardDays(INVITE_REWARD_PRO_DAYS_CAP, 3)).toBe(0)
  })

  it('generates compact uppercase invite tokens', () => {
    expect(createInviteCodeToken()).toMatch(/^[A-Z0-9]{1,10}$/)
  })



  it('awards referral pro days for invited user purchase events', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findFirst
      .mockResolvedValueOnce({ inviteCodeId: 'code-1', inviterId: 'inviter-1' })
      .mockResolvedValueOnce(null)
    mockPrisma.inviteReward.findMany.mockResolvedValue([])
    mockPrisma.billingSubscription.findMany.mockResolvedValue([])
    mockPrisma.billingSubscription.create.mockResolvedValue({})
    mockPrisma.inviteReward.create.mockResolvedValue({})
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'free' })
    mockPrisma.user.update.mockResolvedValue({})

    const result = await awardInviteReferralProDays({ inviteeId: 'invitee-1', event: 'pro_purchase' })

    expect(result).toMatchObject({ inviteeId: 'invitee-1', inviterId: 'inviter-1', event: 'pro_purchase', applied: true, requestedDays: 7, awardedDays: 7 })
    expect(mockPrisma.billingSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'inviter-1', productId: 'invite_referral_pro_purchase', kind: 'grant:pro' }),
    })
    expect(mockPrisma.inviteReward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ inviteCodeId: 'code-1', inviterId: 'inviter-1', inviteeId: 'invitee-1', recipientId: 'inviter-1', event: 'pro_purchase', proDays: 7, credits: 0 }),
    })
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'inviter-1' }, data: { accountTier: 'pro' } })
  })

  it('does not award referral days without signup referral or for duplicate events', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findFirst.mockResolvedValueOnce(null)
    await expect(awardInviteReferralProDays({ inviteeId: 'invitee-1', event: 'pro_purchase' })).resolves.toMatchObject({ applied: false, reason: 'no_referral' })

    mockPrisma.inviteReward.findFirst
      .mockResolvedValueOnce({ inviteCodeId: 'code-1', inviterId: 'inviter-1' })
      .mockResolvedValueOnce({ id: 'reward-1' })
    await expect(awardInviteReferralProDays({ inviteeId: 'invitee-1', event: 'team_purchase' })).resolves.toMatchObject({ applied: false, reason: 'already_awarded' })
    expect(mockPrisma.billingSubscription.create).not.toHaveBeenCalled()
  })

  it('caps referral award days at thirty total days', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findFirst
      .mockResolvedValueOnce({ inviteCodeId: 'code-1', inviterId: 'inviter-1' })
      .mockResolvedValueOnce(null)
    mockPrisma.inviteReward.findMany.mockResolvedValue([{ proDays: 28 }])
    mockPrisma.billingSubscription.findMany.mockResolvedValue([])
    mockPrisma.billingSubscription.create.mockResolvedValue({})
    mockPrisma.inviteReward.create.mockResolvedValue({})
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'pro' })

    const result = await awardInviteReferralProDays({ inviteeId: 'invitee-1', event: 'team_purchase' })

    expect(result).toMatchObject({ applied: true, requestedDays: 15, awardedDays: 2 })
    expect(mockPrisma.inviteReward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event: 'team_purchase', proDays: 2, metadata: { requestedDays: 15 } }),
    })
  })

  it('does not bootstrap existing users outside live mode', async () => {
    delete process.env.BILLING_FEATURE_MODE

    await expect(bootstrapExistingUserBillingBenefits('user-1')).resolves.toEqual({
      userId: 'user-1',
      applied: false,
      reason: 'billing_not_live',
    })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('bootstraps existing users once in live mode', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findFirst.mockResolvedValue(null)
    mockPrisma.inviteCode.count.mockResolvedValue(3)
    mockPrisma.inviteCode.create.mockResolvedValue({})
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })
    mockPrisma.billingSubscription.create.mockResolvedValue({})
    mockPrisma.inviteReward.create.mockResolvedValue({})
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'free' })
    mockPrisma.user.update.mockResolvedValue({})

    const result = await bootstrapExistingUserBillingBenefits('user-1')

    expect(result).toMatchObject({ userId: 'user-1', applied: true, credits: 200, inviteCodesCreated: 2 })
    expect(mockPrisma.inviteCode.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', source: 'existing_user_bootstrap', amountGranted: 200, amountRemaining: 200 }),
    })
    expect(mockPrisma.billingSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', productId: 'existing_user_bootstrap_trial', kind: 'grant:pro' }),
    })
    expect(mockPrisma.inviteReward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 'user-1', event: 'existing_user_bootstrap', proDays: 7, credits: 200 }),
    })
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { accountTier: 'pro' } })
  })

  it('does not bootstrap an already awarded existing user again', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findFirst.mockResolvedValue({ id: 'reward-1' })

    await expect(bootstrapExistingUserBillingBenefits('user-1')).resolves.toEqual({
      userId: 'user-1',
      applied: false,
      reason: 'already_bootstrapped',
    })
    expect(mockPrisma.creditBucket.create).not.toHaveBeenCalled()
    expect(mockPrisma.billingSubscription.create).not.toHaveBeenCalled()
  })

  it('bootstraps legacy enterprise users once with 7 days Team and 1000 credits', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'enterprise' })
    mockPrisma.inviteReward.findFirst.mockResolvedValue(null)
    mockPrisma.inviteCode.count.mockResolvedValue(0)
    mockPrisma.inviteCode.create.mockResolvedValue({})
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })
    mockPrisma.billingSubscription.create.mockResolvedValue({})
    mockPrisma.inviteReward.create.mockResolvedValue({})
    mockPrisma.user.update.mockResolvedValue({})

    const result = await bootstrapLegacyEnterpriseBillingBenefits('user-1')

    expect(result).toMatchObject({ userId: 'user-1', applied: true, credits: 1000, inviteCodesCreated: 20 })
    expect(mockPrisma.inviteCode.create).toHaveBeenCalledTimes(20)
    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', source: 'legacy_enterprise_bootstrap', amountGranted: 1000, amountRemaining: 1000 }),
    })
    expect(mockPrisma.billingSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', productId: 'legacy_enterprise_bootstrap_trial', kind: 'tier:enterprise', seatCount: 5 }),
    })
    expect(mockPrisma.inviteReward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 'user-1', event: 'legacy_enterprise_bootstrap', proDays: 7, credits: 1000 }),
    })
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { accountTier: 'enterprise' } })
  })

  it('tops active invite codes up to the default count', async () => {
    mockPrisma.inviteCode.count.mockResolvedValue(3)
    mockPrisma.inviteCode.create.mockResolvedValue({})
    mockPrisma.inviteCode.findMany.mockResolvedValue([{ code: 'A' }, { code: 'B' }, { code: 'C' }, { code: 'D' }, { code: 'E' }])

    await expect(ensureDefaultInviteCodes('user-1')).resolves.toHaveLength(5)
    expect(mockPrisma.inviteCode.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.inviteCode.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { issuerId: 'user-1' } }))
  })

  it('awards manual promotion rewards with capped pro days and ledger credits', async () => {
    process.env.BILLING_FEATURE_MODE = 'live'
    mockPrisma.inviteReward.findMany.mockResolvedValue([{ proDays: 28 }])
    mockPrisma.billingSubscription.findMany.mockResolvedValue([])
    mockPrisma.promotionSubmission.create.mockResolvedValue({ id: 'promo-1' })
    mockPrisma.billingSubscription.create.mockResolvedValue({})
    mockPrisma.inviteReward.create.mockResolvedValue({})
    mockPrisma.creditBucket.create.mockResolvedValue({ id: 'bucket-1' })
    mockPrisma.user.findUnique.mockResolvedValue({ accountTier: 'free' })
    mockPrisma.user.update.mockResolvedValue({})

    const result = await awardPromotionReward({
      userId: 'user-1',
      channel: 'xiaohongshu',
      url: 'https://example.com/post',
      description: 'public post',
      proDays: 15,
      credits: 300,
      reviewedBy: 'ops',
      reviewNote: 'good quality',
    })

    expect(result).toMatchObject({ userId: 'user-1', applied: true, requestedProDays: 15, awardedProDays: 2, awardedCredits: 300, promotionSubmissionId: 'promo-1' })
    expect(mockPrisma.promotionSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        channel: 'xiaohongshu',
        status: 'awarded',
        suggestedProDays: 15,
        suggestedCredits: 300,
        awardedProDays: 2,
        awardedCredits: 300,
        reviewedBy: 'ops',
      }),
      select: { id: true },
    })
    expect(mockPrisma.inviteReward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recipientId: 'user-1', event: 'promotion_reward', proDays: 2, credits: 300 }),
    })
    expect(mockPrisma.creditBucket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', source: 'promotion_reward', amountGranted: 300, amountRemaining: 300 }),
    })
    expect(mockPrisma.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', bucketId: 'bucket-1', delta: 300, reason: 'promotion_reward', refType: 'promotion_submission', refId: 'promo-1' }),
    })
    expect(mockPrisma.billingAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', action: 'promotion_reward_awarded', refType: 'promotion_submission', refId: 'promo-1', actor: 'ops' }),
    })
  })

  it('validates manual promotion reward bounds and live mode', async () => {
    delete process.env.BILLING_FEATURE_MODE
    await expect(awardPromotionReward({ userId: 'user-1', channel: 'x', proDays: 3, credits: 100 })).resolves.toMatchObject({ applied: false, reason: 'billing_not_live' })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()

    process.env.BILLING_FEATURE_MODE = 'live'
    await expect(awardPromotionReward({ userId: 'user-1', channel: 'x', proDays: 7, credits: 100 })).resolves.toMatchObject({ applied: false, reason: 'invalid_pro_days' })
    await expect(awardPromotionReward({ userId: 'user-1', channel: 'x', proDays: 3, credits: 501 })).resolves.toMatchObject({ applied: false, reason: 'invalid_credits' })
  })
})
