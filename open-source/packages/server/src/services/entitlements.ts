// @arch open-source/docs/server-runtime.md
// @test src/__tests__/entitlements.test.ts src/__tests__/sessions-messages.test.ts src/__tests__/grants.test.ts

import { prisma } from "../lib/prisma.js";
import { isBillingLive } from "./billing-mode.js";
import { hasActiveTeamSeat } from "./team-seats.js";
import { publicUserAvatar, type PublicUserAvatar } from "./user-avatar.js";

export type AccountTier = "personal" | "free" | "pro" | "enterprise";
export type EntitlementKey = "manager_agent" | "managed_wecom" | "machine_sharing" | "external_channels";
export type UserEntitlements = {
  tier: AccountTier;
  capabilities: Record<EntitlementKey, boolean>;
};

const FREE_GROWTH_CAPABILITIES: Record<EntitlementKey, boolean> = {
  manager_agent: true,
  external_channels: false,
  machine_sharing: false,
  managed_wecom: false,
};

export type PublicEntitledUser = {
  id: string;
  phone: string;
  email: string | null;
  name: string;
  nameSetupRequired: boolean;
  avatar: PublicUserAvatar | null;
  /** @deprecated Kept temporarily so older mobile clients do not fail while the setting is retired. */
  pushPreviewEnabled: boolean;
  accountTier: AccountTier;
  entitlements: UserEntitlements;
};

type UserLike = {
  id: string;
  phone: string | null;
  email: string | null;
  name: string;
  nameSetupRequired?: boolean;
  avatarVersion?: string | null;
  avatarUpdatedAt?: Date | null;
  accountTier?: string | null;
  entitlementFlags?: unknown;
};

export class EntitlementError extends Error {
  constructor(message = "Enterprise entitlement required") {
    super(message);
    this.name = "EntitlementError";
  }
}

export function normalizeAccountTier(value: unknown): AccountTier {
  if (value === "enterprise") return "enterprise";
  if (value === "pro") return "pro";
  if (value === "free") return "free";
  return "personal";
}

export function buildEntitlements(tierInput: unknown, _flagsInput?: unknown): UserEntitlements {
  const tier = normalizeAccountTier(tierInput);
  const enterprise = tier === "enterprise";
  const proOrAbove = tier === "pro" || enterprise;
  return {
    tier,
    capabilities: {
      manager_agent: proOrAbove,
      external_channels: false,
      machine_sharing: proOrAbove,
      managed_wecom: false,
    },
  };
}

export function publicEntitledUser(user: UserLike): PublicEntitledUser {
  const tierInput = normalizeAccountTier(user.accountTier) === "enterprise" ? "pro" : user.accountTier;
  const entitlements = isBillingLive()
    ? buildEntitlements(tierInput, user.entitlementFlags)
    : { tier: normalizeAccountTier(tierInput), capabilities: FREE_GROWTH_CAPABILITIES };
  return {
    id: user.id,
    phone: user.phone ?? "",
    email: user.email,
    name: user.name,
    nameSetupRequired: user.nameSetupRequired === true,
    avatar: publicUserAvatar(user),
    pushPreviewEnabled: true,
    accountTier: entitlements.tier,
    entitlements,
  };
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountTier: true, entitlementFlags: true },
  });
  const ownEntitlements = buildEntitlements(user?.accountTier, user?.entitlementFlags);
  if (!isBillingLive()) {
    return { tier: ownEntitlements.tier, capabilities: FREE_GROWTH_CAPABILITIES };
  }
  if (ownEntitlements.tier === "pro" || ownEntitlements.tier === "enterprise") return ownEntitlements;
  if (!(await hasActiveTeamSeat(userId))) return ownEntitlements;
  return buildEntitlements("pro", user?.entitlementFlags);
}

export async function isEnterpriseAccount(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountTier: true },
  });
  return normalizeAccountTier(user?.accountTier) === "enterprise";
}

export async function requireEnterpriseAccount(userId: string): Promise<void> {
  if (!(await isEnterpriseAccount(userId))) {
    throw new EntitlementError("Enterprise account required");
  }
}

export async function requireEntitlement(userId: string, key: EntitlementKey): Promise<void> {
  const entitlements = await getUserEntitlements(userId);
  if (!entitlements.capabilities[key]) {
    throw new EntitlementError();
  }
}
