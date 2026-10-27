// @arch open-source/docs/server-runtime.md
// @test src/__tests__/source-build.test.ts
/** Transitional official integration surface. Core does not import this entry.
 * Legacy billing/entitlement implementations still need a separate ports migration.
 */
export { getDeploymentMode } from './services/instance-settings.js'
export { registerAuthDecorators, requireAuth } from './middleware/auth.js'
export { getBillingFeatureMode, isBillingOrderEnabled } from './services/billing-mode.js'
export {
  ensurePlanInviteCodes, getInviteRewardSummary, listInviteCodes, listInviteRewardsForUser,
} from './services/invites.js'
export { createInviteAccessRequest } from './services/invite-requests.js'

export { prisma } from './lib/prisma.js'
export { publicEntitledUser, normalizeAccountTier, type AccountTier } from './services/entitlements.js'
export { isBillingLive } from './services/billing-mode.js'
export { getCreditBalance, grantPurchasedCredits, grantSubscriptionCredits } from './services/credits.js'
export { awardInviteReferralProDays } from './services/invites.js'
export { recordBillingAuditLog } from './services/billing-audit.js'
export { refreshTeamSeatsForOwner } from './services/team-seats.js'
export { getPlanAccess } from './services/plan-access.js'
export { withDistributedLease } from './services/distributed-lease.js'
