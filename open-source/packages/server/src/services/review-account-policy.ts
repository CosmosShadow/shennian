// @arch open-source/docs/server-runtime.md
// @test src/__tests__/review-account-policy.test.ts

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'

export const REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR = 'review_account_machine_access_forbidden'

export function reviewAccountPhones(): string[] {
  return [...new Set((process.env.SHENNIAN_REVIEW_ACCOUNT_PHONES ?? '')
    .split(',').map(value => value.trim()).filter(value => /^\+[1-9]\d{6,14}$/.test(value)))]
}

export function isReviewAccountPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && reviewAccountPhones().includes(phone)
}

export async function isReviewAccountUserId(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  })
  return isReviewAccountPhone(user?.phone)
}

/**
 * Server-side fail-closed boundary for every authenticated machine surface.
 * UI hiding is deliberately insufficient even when review credentials are shared with a reviewer.
 */
export async function requireNonReviewMachineAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (await isReviewAccountUserId(request.userId)) {
    return reply.code(403).send({ error: REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR })
  }
}
