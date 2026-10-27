// @arch open-source/docs/server-runtime.md
// @test src/__tests__/credits.test.ts

import { prisma } from "../lib/prisma.js";

export const PRO_MONTHLY_CREDITS = 1000;
export const TEAM_MONTHLY_CREDITS = 8000;
export const TEAM_EXTRA_SEAT_MONTHLY_CREDITS = 1500;

export const CREDIT_PACKS: Record<string, { credits: number; expiresMonths: number }> = {
  credits_1000: { credits: 1000, expiresMonths: 12 },
  credits_3200: { credits: 3200, expiresMonths: 12 },
  credits_11000: { credits: 11000, expiresMonths: 12 },
  credits_60000: { credits: 60000, expiresMonths: 12 },
};

export type CreditOwner = { userId: string };
export type CreditGrantSource = "subscription_grant" | "invite_signup" | "existing_user_bootstrap" | "legacy_enterprise_bootstrap" | "purchase" | "promotion_reward" | "adjustment";

type CreditBucketRow = {
  id: string;
  amountRemaining: number;
  expiresAt: Date | null;
};

export type CreditReservation = {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  refType?: string;
  refId?: string;
  metadata?: unknown;
  allocations: Array<{ bucketId: string; amount: number }>;
};

type CreditTx = {
  creditBucket: {
    create: (args: never) => Promise<{ id: string }>;
  };
  creditLedger: {
    create: (args: never) => Promise<unknown>;
  };
};

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function subscriptionCreditsForProduct(productId: string): number {
  if (productId === "pro_monthly") return PRO_MONTHLY_CREDITS;
  if (productId === "team_monthly") return TEAM_MONTHLY_CREDITS;
  if (productId === "team_extra_seat_monthly") return TEAM_EXTRA_SEAT_MONTHLY_CREDITS;
  return 0;
}

export function purchasedCreditsForProduct(productId: string): number {
  return CREDIT_PACKS[productId]?.credits ?? 0;
}

export function creditPackExpiresMonths(productId: string): number {
  return CREDIT_PACKS[productId]?.expiresMonths ?? 0;
}

export async function getCreditBalance(userId: string): Promise<number> {
  const buckets = await prisma.creditBucket.findMany({
    where: {
      userId,
      amountRemaining: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { amountRemaining: true },
  });
  return buckets.reduce((sum, bucket) => sum + bucket.amountRemaining, 0);
}

export async function ensureCreditsAvailable(userId: string): Promise<{ balance: number }> {
  const balance = await getCreditBalance(userId);
  if (balance <= 0) {
    const error = new Error("insufficient_credits");
    (error as Error & { code?: string; statusCode?: number }).code = "insufficient_credits";
    (error as Error & { code?: string; statusCode?: number }).statusCode = 402;
    throw error;
  }
  return { balance };
}

export async function grantCredits(params: {
  tx?: CreditTx;
  userId: string;
  amount: number;
  source: CreditGrantSource;
  refType?: string;
  refId?: string;
  expiresAt?: Date | null;
  metadata?: unknown;
}) {
  if (params.amount <= 0) return null;
  const client = (params.tx ?? prisma) as {
    creditBucket: { create: (args: unknown) => Promise<{ id: string }> };
    creditLedger: { create: (args: unknown) => Promise<unknown> };
  };
  const bucket = await client.creditBucket.create({
    data: {
      userId: params.userId,
      source: params.source,
      amountGranted: params.amount,
      amountRemaining: params.amount,
      expiresAt: params.expiresAt ?? null,
    },
  }) as { id: string };
  await client.creditLedger.create({
    data: {
      userId: params.userId,
      bucketId: bucket.id,
      delta: params.amount,
      reason: params.source,
      refType: params.refType ?? null,
      refId: params.refId ?? null,
      metadata: params.metadata as never,
    },
  });
  return bucket;
}

export async function grantSubscriptionCredits(params: {
  tx?: CreditTx;
  userId: string;
  productId: string;
  sourceOrderId: string;
  startsAt: Date;
  periodMonths: number;
  multiplier?: number;
}) {
  const amount = subscriptionCreditsForProduct(params.productId) * Math.max(1, params.multiplier ?? 1);
  if (amount <= 0) return null;
  return grantCredits({
    tx: params.tx,
    userId: params.userId,
    amount,
    source: "subscription_grant",
    refType: "billing_order",
    refId: params.sourceOrderId,
    expiresAt: addMonths(params.startsAt, params.periodMonths),
    metadata: { productId: params.productId },
  });
}

export async function grantPurchasedCredits(params: {
  tx?: CreditTx;
  userId: string;
  productId: string;
  sourceOrderId: string;
  purchasedAt: Date;
  customCredits?: number;
}) {
  const amount = params.customCredits && params.customCredits > 0
    ? Math.floor(params.customCredits)
    : purchasedCreditsForProduct(params.productId);
  const expiresMonths = creditPackExpiresMonths(params.productId) || (params.customCredits ? 12 : 0);
  if (amount <= 0 || expiresMonths <= 0) return null;
  return grantCredits({
    tx: params.tx,
    userId: params.userId,
    amount,
    source: "purchase",
    refType: "billing_order",
    refId: params.sourceOrderId,
    expiresAt: addMonths(params.purchasedAt, expiresMonths),
    metadata: { productId: params.productId },
  });
}

export async function consumeCredits(params: {
  userId: string;
  amount: number;
  reason: string;
  refType?: string;
  refId?: string;
  metadata?: unknown;
}) {
  if (params.amount <= 0) return { consumed: 0 };
  return prisma.$transaction(async (tx) => {
    const buckets = await tx.creditBucket.findMany({
      where: {
        userId: params.userId,
        amountRemaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, amountRemaining: true, expiresAt: true },
    }) as CreditBucketRow[];
    const balance = buckets.reduce((sum, bucket) => sum + bucket.amountRemaining, 0);
    if (balance < params.amount) {
      const error = new Error("insufficient_credits");
      (error as Error & { code?: string; statusCode?: number }).code = "insufficient_credits";
      (error as Error & { code?: string; statusCode?: number }).statusCode = 402;
      throw error;
    }

    let remaining = params.amount;
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      const used = Math.min(bucket.amountRemaining, remaining);
      await tx.creditBucket.update({
        where: { id: bucket.id },
        data: { amountRemaining: { decrement: used } },
      });
      await tx.creditLedger.create({
        data: {
          userId: params.userId,
          bucketId: bucket.id,
          delta: -used,
          reason: params.reason,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          metadata: params.metadata as never,
        },
      });
      remaining -= used;
    }
    return { consumed: params.amount };
  });
}

export async function reserveCredits(params: {
  userId: string;
  amount: number;
  reason: string;
  refType?: string;
  refId?: string;
  metadata?: unknown;
}): Promise<CreditReservation | null> {
  if (params.amount <= 0) return null;
  return prisma.$transaction(async (tx) => {
    const buckets = await tx.creditBucket.findMany({
      where: {
        userId: params.userId,
        amountRemaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, amountRemaining: true, expiresAt: true },
    }) as CreditBucketRow[];
    const balance = buckets.reduce((sum, bucket) => sum + bucket.amountRemaining, 0);
    if (balance < params.amount) {
      const error = new Error("insufficient_credits");
      (error as Error & { code?: string; statusCode?: number }).code = "insufficient_credits";
      (error as Error & { code?: string; statusCode?: number }).statusCode = 402;
      throw error;
    }

    let remaining = params.amount;
    const allocations: CreditReservation["allocations"] = [];
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      const used = Math.min(bucket.amountRemaining, remaining);
      await tx.creditBucket.update({
        where: { id: bucket.id },
        data: { amountRemaining: { decrement: used } },
      });
      await tx.creditLedger.create({
        data: {
          userId: params.userId,
          bucketId: bucket.id,
          delta: -used,
          reason: `${params.reason}:reserve`,
          refType: params.refType ?? null,
          refId: params.refId ?? null,
          metadata: params.metadata as never,
        },
      });
      allocations.push({ bucketId: bucket.id, amount: used });
      remaining -= used;
    }
    return {
      id: `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      userId: params.userId,
      amount: params.amount,
      reason: params.reason,
      refType: params.refType,
      refId: params.refId,
      metadata: params.metadata,
      allocations,
    };
  });
}

export async function releaseCreditReservation(reservation: CreditReservation | null | undefined, amount?: number): Promise<{ released: number }> {
  if (!reservation) return { released: 0 };
  const target = Math.max(0, Math.min(reservation.amount, Math.floor(amount ?? reservation.amount)));
  if (target <= 0) return { released: 0 };
  return prisma.$transaction(async (tx) => {
    let remaining = target;
    for (const allocation of reservation.allocations) {
      if (remaining <= 0) break;
      const released = Math.min(allocation.amount, remaining);
      await tx.creditBucket.update({
        where: { id: allocation.bucketId },
        data: { amountRemaining: { increment: released } },
      });
      await tx.creditLedger.create({
        data: {
          userId: reservation.userId,
          bucketId: allocation.bucketId,
          delta: released,
          reason: `${reservation.reason}:release`,
          refType: reservation.refType ?? null,
          refId: reservation.refId ?? null,
          metadata: reservation.metadata as never,
        },
      });
      remaining -= released;
    }
    return { released: target - remaining };
  });
}
