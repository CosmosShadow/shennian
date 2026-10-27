// @arch open-source/docs/server-runtime.md
// @test src/__tests__/entitlements.test.ts private/official-server/src/__tests__/billing.test.ts

export type BillingFeatureMode = "off" | "shadow" | "live";
import { getDeploymentMode } from './instance-settings.js'

// Re-enable only after a new product and compatibility review. Tests may still
// exercise the dormant live implementation so it remains recoverable.
export const COMMERCIALIZATION_ENABLED = false;

export function getBillingFeatureMode(): BillingFeatureMode {
  if (getDeploymentMode() === 'self-hosted') return 'off';
  if (!COMMERCIALIZATION_ENABLED && process.env.NODE_ENV !== "test") return "off";
  const value = process.env.BILLING_FEATURE_MODE?.trim().toLowerCase();
  if (value === "off" || value === "live" || value === "shadow") return value;
  // Default to shadow: code and database can be deployed, but paid entitlements do not affect users.
  return "shadow";
}

export function isBillingOrderEnabled(): boolean {
  const mode = getBillingFeatureMode();
  return mode === "shadow" || mode === "live";
}

export function isBillingLive(): boolean {
  return getBillingFeatureMode() === "live";
}
