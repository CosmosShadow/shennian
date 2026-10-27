// @arch open-source/docs/mobile-app.md
// @test open-source/config/app-profile.test.mjs
/* global module, require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo evaluates build configuration through CommonJS.
const { selfHostedOtaConfig } = require('./ota.cjs')
function resolveAppDistribution(env, fallback = 'self-hosted') {
  const value = env.SHENNIAN_DISTRIBUTION || fallback
  if (value !== 'official' && value !== 'self-hosted')
    throw new Error('Invalid SHENNIAN_DISTRIBUTION')
  return value
}
function resolveOtaChannel(value) {
  if (!value || value === 'production') return 'production'
  if (value === 'preview') return 'preview'
  throw new Error('SHENNIAN_OTA_CHANNEL must be production or preview')
}
function resolveOtaBackend(value) {
  if (!value || value === 'eas') return 'eas'
  if (value === 'oss') return 'oss'
  throw new Error('SHENNIAN_OTA_BACKEND must be eas or oss')
}
/** A build-time composition seam, not a second App or a runtime plugin discovery mechanism. */
function resolveAppBuildProfile(env, official, fallback = 'self-hosted') {
  const distribution = resolveAppDistribution(env, fallback)
  if (distribution === 'self-hosted') return { distribution, updates: selfHostedOtaConfig(env) }
  if (
    !official?.officialAppIdentity?.owner ||
    !official.officialAppIdentity.eas?.projectId ||
    typeof official.officialOtaConfig !== 'function'
  ) {
    throw new Error('official_app_composition_required')
  }
  return {
    distribution,
    owner: official.officialAppIdentity.owner,
    eas: { ...official.officialAppIdentity.eas },
    updates: official.officialOtaConfig(
      env,
      resolveOtaChannel(env.SHENNIAN_OTA_CHANNEL),
      resolveOtaBackend(env.SHENNIAN_OTA_BACKEND),
    ),
  }
}
module.exports = {
  resolveAppDistribution,
  resolveAppBuildProfile,
  resolveOtaChannel,
  resolveOtaBackend,
}
