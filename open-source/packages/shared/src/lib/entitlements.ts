// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/entitlements.test.ts

export type AccountTier = 'personal' | 'free' | 'pro' | 'enterprise'

export type EntitlementKey =
  | 'manager_agent'
  | 'managed_wecom'
  | 'machine_sharing'
  | 'external_channels'

export type EntitlementCapabilities = Record<EntitlementKey, boolean>

export type UserEntitlements = {
  tier: AccountTier
  capabilities: EntitlementCapabilities
}

export type EntitledUser = {
  accountTier?: AccountTier | string | null
  entitlementFlags?: unknown
  entitlements?: UserEntitlements | null
}

export const PERSONAL_CAPABILITIES: EntitlementCapabilities = {
  manager_agent: true,
  managed_wecom: false,
  machine_sharing: false,
  external_channels: false,
}

export const PRO_CAPABILITIES: EntitlementCapabilities = {
  manager_agent: true,
  managed_wecom: false,
  machine_sharing: false,
  external_channels: false,
}

export function normalizeAccountTier(value: unknown): AccountTier {
  if (value === 'enterprise') return 'enterprise'
  if (value === 'pro') return 'pro'
  if (value === 'free') return 'free'
  return 'personal'
}

export function buildEntitlements(tierInput: unknown): UserEntitlements {
  const tier = normalizeAccountTier(tierInput)
  const proOrLegacyEnterprise = tier === 'pro' || tier === 'enterprise'
  return {
    tier,
    capabilities: proOrLegacyEnterprise ? PRO_CAPABILITIES : PERSONAL_CAPABILITIES,
  }
}

export function hasCapability(user: EntitledUser | null | undefined, key: EntitlementKey): boolean {
  if (!user) return false
  const explicit = user.entitlements?.capabilities?.[key]
  if (typeof explicit === 'boolean') return explicit
  return buildEntitlements(user.accountTier).capabilities[key]
}
