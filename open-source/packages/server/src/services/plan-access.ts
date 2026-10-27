// @arch open-source/docs/server-runtime.md
// @test src/__tests__/plan-access.test.ts

import { prisma } from '../lib/prisma.js'
import { isBillingLive } from './billing-mode.js'

export const INITIAL_PRO_TRIAL_DAYS = 7
export const INITIAL_PRO_TRIAL_PRODUCT_ID = 'signup_trial'

export type PlanAccessStatus = 'unmetered' | 'trial' | 'subscribed' | 'expired'

export type PlanAccess = {
  allowed: boolean
  status: PlanAccessStatus
  expiresAt: Date | null
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export async function grantInitialProTrial(userId: string, now = new Date()): Promise<PlanAccess> {
  if (!isBillingLive()) return { allowed: true, status: 'unmetered', expiresAt: null }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.billingSubscription.findFirst({
      where: { userId, productId: INITIAL_PRO_TRIAL_PRODUCT_ID },
      orderBy: { createdAt: 'desc' },
      select: { status: true, expiresAt: true },
    })
    if (existing) {
      const allowed =
        existing.status === 'active' && (!existing.expiresAt || existing.expiresAt > now)
      return {
        allowed,
        status: allowed ? 'trial' : 'expired',
        expiresAt: existing.expiresAt,
      }
    }

    const expiresAt = addDays(now, INITIAL_PRO_TRIAL_DAYS)
    await tx.billingSubscription.create({
      data: {
        userId,
        productId: INITIAL_PRO_TRIAL_PRODUCT_ID,
        kind: 'grant:pro',
        status: 'active',
        startsAt: now,
        expiresAt,
      },
    })
    await tx.user.update({ where: { id: userId }, data: { accountTier: 'pro' } })
    return { allowed: true, status: 'trial', expiresAt }
  })
}

export async function getPlanAccess(userId: string, now = new Date()): Promise<PlanAccess> {
  if (!isBillingLive()) return { allowed: true, status: 'unmetered', expiresAt: null }

  const subscriptions = await prisma.billingSubscription.findMany({
    where: {
      userId,
      status: 'active',
      kind: { in: ['grant:pro', 'tier:pro', 'tier:enterprise'] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { expiresAt: 'desc' },
    select: { productId: true, expiresAt: true },
  })

  if (subscriptions.length === 0) return { allowed: false, status: 'expired', expiresAt: null }
  const subscribed = subscriptions.some(
    (subscription) =>
      !subscription.productId.endsWith('_trial') &&
      subscription.productId !== INITIAL_PRO_TRIAL_PRODUCT_ID,
  )
  const relevantSubscriptions = subscribed
    ? subscriptions.filter(
        (subscription) =>
          !subscription.productId.endsWith('_trial') &&
          subscription.productId !== INITIAL_PRO_TRIAL_PRODUCT_ID,
      )
    : subscriptions
  const expiresAt = relevantSubscriptions.some((subscription) => subscription.expiresAt == null)
    ? null
    : (relevantSubscriptions[0]?.expiresAt ?? null)
  return { allowed: true, status: subscribed ? 'subscribed' : 'trial', expiresAt }
}

export class PlanAccessError extends Error {
  statusCode = 402
  code = 'pro_required'

  constructor() {
    super('Pro subscription required')
    this.name = 'PlanAccessError'
  }
}

export async function requirePlanAccess(userId: string): Promise<PlanAccess> {
  const access = await getPlanAccess(userId)
  if (!access.allowed) throw new PlanAccessError()
  return access
}
