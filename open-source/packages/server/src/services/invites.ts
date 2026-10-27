// @arch open-source/docs/server-runtime.md
// @test src/__tests__/invites.test.ts

import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { isBillingLive } from "./billing-mode.js";
import { grantCredits } from "./credits.js";
import { recordBillingAuditLog } from "./billing-audit.js";
import { getUserEntitlements } from "./entitlements.js";

export const EXISTING_USER_BOOTSTRAP_PRO_DAYS = 7;
export const EXISTING_USER_BOOTSTRAP_CREDITS = 200;
export const LEGACY_ENTERPRISE_BOOTSTRAP_DAYS = 7;
export const LEGACY_ENTERPRISE_BOOTSTRAP_CREDITS = 1000;
export const INVITEE_SIGNUP_PRO_DAYS = 3;
export const INVITEE_SIGNUP_CREDITS = 100;
export const REFERRAL_ACTIVATION_PRO_DAYS = 3;
export const REFERRAL_PRO_PURCHASE_PRO_DAYS = 7;
export const REFERRAL_TEAM_PURCHASE_PRO_DAYS = 15;
export const INVITE_REWARD_PRO_DAYS_CAP = 30;
export const DEFAULT_INVITE_CODE_GRANT_COUNT = 5;
export const TEAM_INVITE_CODE_GRANT_COUNT = 20;
export const PROMOTION_REWARD_PRO_DAY_OPTIONS = [3, 5, 15] as const;
export const PROMOTION_REWARD_MAX_CREDITS = 500;


export type ExistingUserBootstrapResult = {
  userId: string;
  applied: boolean;
  reason?: "billing_not_live" | "already_bootstrapped";
  expiresAt?: Date;
  credits?: number;
  inviteCodesCreated?: number;
};

export type LegacyEnterpriseBootstrapResult = {
  userId: string;
  applied: boolean;
  reason?: "billing_not_live" | "already_bootstrapped" | "not_legacy_enterprise";
  expiresAt?: Date;
  credits?: number;
  inviteCodesCreated?: number;
};

export type InviteReferralRewardEvent = "activation" | "pro_purchase" | "team_purchase";
export type PromotionRewardInput = {
  userId: string;
  channel: string;
  url?: string | null;
  description?: string | null;
  proDays: number;
  credits: number;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  evidence?: unknown;
};
export type PromotionRewardResult = {
  userId: string;
  applied: boolean;
  reason?: "billing_not_live" | "invalid_pro_days" | "invalid_credits" | "cap_reached";
  requestedProDays: number;
  awardedProDays: number;
  awardedCredits: number;
  expiresAt?: Date;
  promotionSubmissionId?: string;
};
export type InviteReferralRewardResult = {
  inviteeId: string;
  inviterId?: string;
  event: InviteReferralRewardEvent;
  applied: boolean;
  reason?: "billing_not_live" | "no_referral" | "already_awarded" | "cap_reached";
  requestedDays?: number;
  awardedDays?: number;
  expiresAt?: Date;
};

type InviteRewardTx = Pick<typeof prisma, "billingAuditLog" | "billingSubscription" | "creditBucket" | "creditLedger" | "inviteReward" | "promotionSubmission" | "user">;

const INVITER_REWARD_EVENTS = ["activation", "pro_purchase", "team_purchase", "promotion_reward"];

export type InviteRedemptionPlan = {
  required: boolean;
  allowed: boolean;
  reason?: "invite_required" | "invite_invalid" | "invite_exhausted" | "invite_expired";
  inviteCodeId?: string;
  inviterId?: string;
};

type InviteCodeRow = {
  id: string;
  issuerId: string;
  status: string;
  maxRedemptions: number;
  usedCount: number;
  expiresAt: Date | null;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeInviteCode(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized || null;
}

export function createInviteCodeToken(bytes = 5): string {
  return crypto.randomBytes(bytes).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export function isInviteGateLive(): boolean {
  return isBillingLive();
}

export function referralProDaysForEvent(event: InviteReferralRewardEvent): number {
  if (event === "activation") return REFERRAL_ACTIVATION_PRO_DAYS;
  if (event === "pro_purchase") return REFERRAL_PRO_PURCHASE_PRO_DAYS;
  return REFERRAL_TEAM_PURCHASE_PRO_DAYS;
}

export function cappedInviteRewardDays(currentAwardedDays: number, requestedDays: number): number {
  return Math.max(0, Math.min(requestedDays, INVITE_REWARD_PRO_DAYS_CAP - Math.max(0, currentAwardedDays)));
}

export function isValidPromotionRewardProDays(days: number): days is typeof PROMOTION_REWARD_PRO_DAY_OPTIONS[number] {
  return PROMOTION_REWARD_PRO_DAY_OPTIONS.includes(days as typeof PROMOTION_REWARD_PRO_DAY_OPTIONS[number]);
}

export async function validateInviteForSignup(code: string | null | undefined): Promise<InviteRedemptionPlan> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { required: false, allowed: true };
  if (!isInviteGateLive()) return { required: false, allowed: true };

  const invite = await prisma.inviteCode.findUnique({ where: { code: normalized } }) as InviteCodeRow | null;
  if (!invite || invite.status !== "active") return { required: false, allowed: false, reason: "invite_invalid" };
  if (invite.expiresAt && invite.expiresAt <= new Date()) return { required: false, allowed: false, reason: "invite_expired" };
  if (invite.usedCount >= invite.maxRedemptions) return { required: false, allowed: false, reason: "invite_exhausted" };

  return { required: false, allowed: true, inviteCodeId: invite.id, inviterId: invite.issuerId };
}

export async function redeemSignupInvite(params: { userId: string; inviteCodeId?: string; inviterId?: string }) {
  if (!isInviteGateLive() || !params.inviteCodeId || !params.inviterId) return null;
  const now = new Date();
  const expiresAt = addDays(now, INVITEE_SIGNUP_PRO_DAYS);
  return prisma.$transaction(async (tx) => {
    await tx.inviteCode.update({
      where: { id: params.inviteCodeId },
      data: { usedCount: { increment: 1 } },
    });
    const bucket = await tx.creditBucket.create({
      data: {
        userId: params.userId,
        source: "invite_signup",
        amountGranted: INVITEE_SIGNUP_CREDITS,
        amountRemaining: INVITEE_SIGNUP_CREDITS,
        expiresAt,
      },
    });
    await tx.creditLedger.create({
      data: {
        userId: params.userId,
        bucketId: bucket.id,
        delta: INVITEE_SIGNUP_CREDITS,
        reason: "invite_signup_bonus",
        refType: "invite_code",
        refId: params.inviteCodeId,
      },
    });
    await tx.inviteReward.create({
      data: {
        inviteCodeId: params.inviteCodeId,
        inviterId: params.inviterId,
        inviteeId: params.userId,
        recipientId: params.userId,
        event: "invitee_signup",
        proDays: INVITEE_SIGNUP_PRO_DAYS,
        credits: INVITEE_SIGNUP_CREDITS,
        awardedAt: now,
      },
    });
    await tx.billingSubscription.create({
      data: {
        userId: params.userId,
        productId: "invitee_signup_trial",
        kind: "grant:pro",
        status: "active",
        startsAt: now,
        expiresAt,
      },
    });
    await tx.user.update({ where: { id: params.userId }, data: { accountTier: "pro" } });
    return { expiresAt, credits: INVITEE_SIGNUP_CREDITS };
  });
}

export async function grantDefaultInviteCodes(userId: string, count = DEFAULT_INVITE_CODE_GRANT_COUNT) {
  const created: string[] = [];
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createInviteCodeToken();
      try {
        await prisma.inviteCode.create({ data: { code, issuerId: userId } });
        created.push(code);
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
  }
  return created;
}

export async function listInviteCodes(userId: string) {
  return prisma.inviteCode.findMany({
    where: { issuerId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      status: true,
      maxRedemptions: true,
      usedCount: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

export async function listInviteRewardsForUser(userId: string) {
  return prisma.inviteReward.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      event: true,
      status: true,
      proDays: true,
      credits: true,
      awardedAt: true,
      createdAt: true,
      inviteeId: true,
      inviterId: true,
      metadata: true,
    },
  });
}

export async function getInviteRewardSummary(userId: string) {
  const rewards = await prisma.inviteReward.findMany({
    where: {
      recipientId: userId,
      status: "awarded",
      event: { in: INVITER_REWARD_EVENTS },
    },
    select: { proDays: true },
  }) as Array<{ proDays: number }>;
  const awardedProDays = rewards.reduce((sum, reward) => sum + reward.proDays, 0);
  return {
    awardedProDays,
    capProDays: INVITE_REWARD_PRO_DAYS_CAP,
    remainingProDays: Math.max(0, INVITE_REWARD_PRO_DAYS_CAP - awardedProDays),
  };
}

export async function ensureDefaultInviteCodes(userId: string, targetCount = DEFAULT_INVITE_CODE_GRANT_COUNT) {
  const existing = await prisma.inviteCode.count({ where: { issuerId: userId, status: "active" } });
  const missing = Math.max(0, targetCount - existing);
  if (missing > 0) await grantDefaultInviteCodes(userId, missing);
  return listInviteCodes(userId);
}

export async function ensurePlanInviteCodes(userId: string) {
  const entitlements = await getUserEntitlements(userId);
  if (entitlements.tier !== "pro" && entitlements.tier !== "enterprise") {
    const error = new Error("Pro or Team required to generate invite codes");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  const targetCount = entitlements.tier === "enterprise" ? TEAM_INVITE_CODE_GRANT_COUNT : DEFAULT_INVITE_CODE_GRANT_COUNT;
  return ensureDefaultInviteCodes(userId, targetCount);
}


export async function bootstrapExistingUserBillingBenefits(userId: string): Promise<ExistingUserBootstrapResult> {
  if (!isBillingLive()) return { userId, applied: false, reason: "billing_not_live" };
  const now = new Date();
  const expiresAt = addDays(now, EXISTING_USER_BOOTSTRAP_PRO_DAYS);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.inviteReward.findFirst({
      where: {
        recipientId: userId,
        event: "existing_user_bootstrap",
        status: "awarded",
      },
      select: { id: true },
    });
    if (existing) return { userId, applied: false, reason: "already_bootstrapped" };

    const activeInviteCount = await tx.inviteCode.count({ where: { issuerId: userId, status: "active" } });
    const missingInviteCount = Math.max(0, DEFAULT_INVITE_CODE_GRANT_COUNT - activeInviteCount);
    for (let i = 0; i < missingInviteCount; i += 1) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createInviteCodeToken();
        try {
          await tx.inviteCode.create({ data: { code, issuerId: userId } });
          break;
        } catch (error) {
          if (attempt === 4) throw error;
        }
      }
    }

    await grantCredits({
      tx,
      userId,
      amount: EXISTING_USER_BOOTSTRAP_CREDITS,
      source: "existing_user_bootstrap",
      refType: "invite_reward",
      refId: userId,
      expiresAt,
      metadata: { proDays: EXISTING_USER_BOOTSTRAP_PRO_DAYS },
    });
    await tx.billingSubscription.create({
      data: {
        userId,
        productId: "existing_user_bootstrap_trial",
        kind: "grant:pro",
        status: "active",
        startsAt: now,
        expiresAt,
      },
    });
    await tx.inviteReward.create({
      data: {
        recipientId: userId,
        event: "existing_user_bootstrap",
        proDays: EXISTING_USER_BOOTSTRAP_PRO_DAYS,
        credits: EXISTING_USER_BOOTSTRAP_CREDITS,
        metadata: { inviteCodesCreated: missingInviteCount },
        awardedAt: now,
      },
    });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { accountTier: true } });
    const tier = user?.accountTier === "enterprise" ? "enterprise" : "pro";
    await tx.user.update({ where: { id: userId }, data: { accountTier: tier } });

    return {
      userId,
      applied: true,
      expiresAt,
      credits: EXISTING_USER_BOOTSTRAP_CREDITS,
      inviteCodesCreated: missingInviteCount,
    };
  });
}

export async function bootstrapLegacyEnterpriseBillingBenefits(userId: string): Promise<LegacyEnterpriseBootstrapResult> {
  if (!isBillingLive()) return { userId, applied: false, reason: "billing_not_live" };
  const now = new Date();
  const expiresAt = addDays(now, LEGACY_ENTERPRISE_BOOTSTRAP_DAYS);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { accountTier: true } });
    if (user?.accountTier !== "enterprise") return { userId, applied: false, reason: "not_legacy_enterprise" };

    const existing = await tx.inviteReward.findFirst({
      where: {
        recipientId: userId,
        event: "legacy_enterprise_bootstrap",
        status: "awarded",
      },
      select: { id: true },
    });
    if (existing) return { userId, applied: false, reason: "already_bootstrapped" };

    const activeInviteCount = await tx.inviteCode.count({ where: { issuerId: userId, status: "active" } });
    const missingInviteCount = Math.max(0, TEAM_INVITE_CODE_GRANT_COUNT - activeInviteCount);
    for (let i = 0; i < missingInviteCount; i += 1) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = createInviteCodeToken();
        try {
          await tx.inviteCode.create({ data: { code, issuerId: userId } });
          break;
        } catch (error) {
          if (attempt === 4) throw error;
        }
      }
    }

    await grantCredits({
      tx,
      userId,
      amount: LEGACY_ENTERPRISE_BOOTSTRAP_CREDITS,
      source: "legacy_enterprise_bootstrap",
      refType: "invite_reward",
      refId: userId,
      expiresAt,
      metadata: { teamDays: LEGACY_ENTERPRISE_BOOTSTRAP_DAYS },
    });
    await tx.billingSubscription.create({
      data: {
        userId,
        productId: "legacy_enterprise_bootstrap_trial",
        kind: "tier:enterprise",
        status: "active",
        seatCount: 5,
        startsAt: now,
        expiresAt,
      },
    });
    await tx.inviteReward.create({
      data: {
        recipientId: userId,
        event: "legacy_enterprise_bootstrap",
        proDays: LEGACY_ENTERPRISE_BOOTSTRAP_DAYS,
        credits: LEGACY_ENTERPRISE_BOOTSTRAP_CREDITS,
        metadata: { inviteCodesCreated: missingInviteCount, tier: "enterprise" },
        awardedAt: now,
      },
    });
    await tx.user.update({ where: { id: userId }, data: { accountTier: "enterprise" } });

    return {
      userId,
      applied: true,
      expiresAt,
      credits: LEGACY_ENTERPRISE_BOOTSTRAP_CREDITS,
      inviteCodesCreated: missingInviteCount,
    };
  });
}


async function latestProEntitlementExpiry(client: InviteRewardTx, userId: string, now: Date): Promise<Date | null> {
  const subscriptions = await client.billingSubscription.findMany({
    where: {
      userId,
      status: "active",
      kind: { in: ["grant:pro", "tier:pro", "tier:enterprise"] },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
    take: 1,
    select: { expiresAt: true },
  }) as Array<{ expiresAt: Date | null }>;
  return subscriptions[0]?.expiresAt ?? null;
}

async function currentInviteRewardDays(client: InviteRewardTx, recipientId: string): Promise<number> {
  const rewards = await client.inviteReward.findMany({
    where: {
      recipientId,
      status: "awarded",
      event: { in: INVITER_REWARD_EVENTS },
    },
    select: { proDays: true },
  }) as Array<{ proDays: number }>;
  return rewards.reduce((sum, reward) => sum + reward.proDays, 0);
}

export async function awardInviteReferralProDays(params: {
  tx?: InviteRewardTx;
  inviteeId: string;
  event: InviteReferralRewardEvent;
}): Promise<InviteReferralRewardResult> {
  if (!isBillingLive()) return { inviteeId: params.inviteeId, event: params.event, applied: false, reason: "billing_not_live" };
  const client = params.tx ?? prisma;
  const signupReward = await client.inviteReward.findFirst({
    where: {
      inviteeId: params.inviteeId,
      event: "invitee_signup",
      status: "awarded",
      inviterId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { inviteCodeId: true, inviterId: true },
  }) as { inviteCodeId: string | null; inviterId: string | null } | null;
  if (!signupReward?.inviterId) return { inviteeId: params.inviteeId, event: params.event, applied: false, reason: "no_referral" };

  const already = await client.inviteReward.findFirst({
    where: {
      inviterId: signupReward.inviterId,
      inviteeId: params.inviteeId,
      recipientId: signupReward.inviterId,
      event: params.event,
      status: "awarded",
    },
    select: { id: true },
  });
  if (already) {
    return { inviteeId: params.inviteeId, inviterId: signupReward.inviterId, event: params.event, applied: false, reason: "already_awarded" };
  }

  const requestedDays = referralProDaysForEvent(params.event);
  const awardedDays = cappedInviteRewardDays(await currentInviteRewardDays(client, signupReward.inviterId), requestedDays);
  if (awardedDays <= 0) {
    return {
      inviteeId: params.inviteeId,
      inviterId: signupReward.inviterId,
      event: params.event,
      applied: false,
      reason: "cap_reached",
      requestedDays,
      awardedDays: 0,
    };
  }

  const now = new Date();
  const latestExpiry = await latestProEntitlementExpiry(client, signupReward.inviterId, now);
  const startsAt = latestExpiry && latestExpiry > now ? latestExpiry : now;
  const expiresAt = addDays(startsAt, awardedDays);

  await client.billingSubscription.create({
    data: {
      userId: signupReward.inviterId,
      productId: `invite_referral_${params.event}`,
      kind: "grant:pro",
      status: "active",
      startsAt,
      expiresAt,
    },
  });
  await client.inviteReward.create({
    data: {
      inviteCodeId: signupReward.inviteCodeId,
      inviterId: signupReward.inviterId,
      inviteeId: params.inviteeId,
      recipientId: signupReward.inviterId,
      event: params.event,
      proDays: awardedDays,
      credits: 0,
      metadata: { requestedDays },
      awardedAt: now,
    },
  });

  const inviter = await client.user.findUnique({ where: { id: signupReward.inviterId }, select: { accountTier: true } });
  if (startsAt <= now && inviter?.accountTier !== "enterprise") {
    await client.user.update({ where: { id: signupReward.inviterId }, data: { accountTier: "pro" } });
  }

  return {
    inviteeId: params.inviteeId,
    inviterId: signupReward.inviterId,
    event: params.event,
    applied: true,
    requestedDays,
    awardedDays,
    expiresAt,
  };
}

export async function awardPromotionReward(params: PromotionRewardInput): Promise<PromotionRewardResult> {
  const requestedProDays = Math.trunc(params.proDays);
  const requestedCredits = Math.trunc(params.credits);
  if (!isValidPromotionRewardProDays(requestedProDays)) {
    return {
      userId: params.userId,
      applied: false,
      reason: "invalid_pro_days",
      requestedProDays,
      awardedProDays: 0,
      awardedCredits: 0,
    };
  }
  if (requestedCredits < 0 || requestedCredits > PROMOTION_REWARD_MAX_CREDITS) {
    return {
      userId: params.userId,
      applied: false,
      reason: "invalid_credits",
      requestedProDays,
      awardedProDays: 0,
      awardedCredits: 0,
    };
  }
  if (!isBillingLive()) {
    return {
      userId: params.userId,
      applied: false,
      reason: "billing_not_live",
      requestedProDays,
      awardedProDays: 0,
      awardedCredits: 0,
    };
  }

  return prisma.$transaction(async (tx) => {
    const awardedProDays = cappedInviteRewardDays(await currentInviteRewardDays(tx, params.userId), requestedProDays);
    if (awardedProDays <= 0) {
      return {
        userId: params.userId,
        applied: false,
        reason: "cap_reached" as const,
        requestedProDays,
        awardedProDays: 0,
        awardedCredits: 0,
      };
    }

    const now = new Date();
    const latestExpiry = await latestProEntitlementExpiry(tx, params.userId, now);
    const startsAt = latestExpiry && latestExpiry > now ? latestExpiry : now;
    const expiresAt = addDays(startsAt, awardedProDays);
    const evidence = {
      ...(typeof params.evidence === "object" && params.evidence !== null ? params.evidence as Record<string, unknown> : {}),
      reviewNote: params.reviewNote ?? null,
    };

    const submission = await tx.promotionSubmission.create({
      data: {
        userId: params.userId,
        channel: params.channel,
        url: params.url ?? null,
        description: params.description ?? null,
        status: "awarded",
        suggestedProDays: requestedProDays,
        suggestedCredits: requestedCredits,
        awardedProDays,
        awardedCredits: requestedCredits,
        evidence,
        reviewedBy: params.reviewedBy ?? null,
        reviewedAt: now,
      },
      select: { id: true },
    });

    await tx.billingSubscription.create({
      data: {
        userId: params.userId,
        productId: "promotion_reward",
        kind: "grant:pro",
        status: "active",
        startsAt,
        expiresAt,
      },
    });
    await tx.inviteReward.create({
      data: {
        recipientId: params.userId,
        event: "promotion_reward",
        proDays: awardedProDays,
        credits: requestedCredits,
        metadata: {
          requestedProDays,
          channel: params.channel,
          promotionSubmissionId: submission.id,
          reviewNote: params.reviewNote ?? null,
          url: params.url ?? null,
        },
        awardedAt: now,
      },
    });
    if (requestedCredits > 0) {
      await grantCredits({
        tx,
        userId: params.userId,
        amount: requestedCredits,
        source: "promotion_reward",
        refType: "promotion_submission",
        refId: submission.id,
        expiresAt,
        metadata: { requestedProDays, awardedProDays, channel: params.channel },
      });
    }
    await recordBillingAuditLog({
      tx,
      userId: params.userId,
      action: "promotion_reward_awarded",
      refType: "promotion_submission",
      refId: submission.id,
      actor: params.reviewedBy ?? "manual",
      metadata: {
        channel: params.channel,
        url: params.url ?? null,
        requestedProDays,
        awardedProDays,
        awardedCredits: requestedCredits,
        reviewNote: params.reviewNote ?? null,
      },
    });

    const user = await tx.user.findUnique({ where: { id: params.userId }, select: { accountTier: true } });
    if (startsAt <= now && user?.accountTier !== "enterprise") {
      await tx.user.update({ where: { id: params.userId }, data: { accountTier: "pro" } });
    }

    return {
      userId: params.userId,
      applied: true,
      requestedProDays,
      awardedProDays,
      awardedCredits: requestedCredits,
      expiresAt,
      promotionSubmissionId: submission.id,
    };
  });
}
