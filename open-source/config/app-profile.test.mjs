// @arch open-source/docs/mobile-app.md
// @covers open-source/config/app-profile.cjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolveAppBuildProfile, resolveAppDistribution } = require('./app-profile.cjs')
const official = {
  officialAppIdentity: { owner: 'test-owner', eas: { projectId: 'test-project' } },
  officialOtaConfig: (_env, channel, backend) => ({
    url: 'https://updates.example/' + backend,
    requestHeaders: { 'expo-channel-name': channel },
  }),
}
test('public build defaults to self-hosted with OTA disabled and no official identity', () => {
  assert.deepEqual(resolveAppBuildProfile({}), {
    distribution: 'self-hosted',
    updates: { enabled: false },
  })
})
test('self-hosted does not inspect or execute an official composition', () => {
  const forbidden = {
    get officialAppIdentity() {
      throw new Error('must_not_read')
    },
  }
  assert.deepEqual(resolveAppBuildProfile({ SHENNIAN_DISTRIBUTION: 'self-hosted' }, forbidden), {
    distribution: 'self-hosted',
    updates: { enabled: false },
  })
})
test('official mode fails closed without explicit composition', () => {
  assert.throws(
    () => resolveAppBuildProfile({ SHENNIAN_DISTRIBUTION: 'official' }),
    /official_app_composition_required/,
  )
})
test('the integrated official bridge can preserve its existing default without changing public defaults', () => {
  const profile = resolveAppBuildProfile({}, official, 'official')
  assert.equal(profile.owner, 'test-owner')
  assert.deepEqual(profile.eas, { projectId: 'test-project' })
  assert.equal(profile.updates.url, 'https://updates.example/eas')
  assert.equal(resolveAppDistribution({}), 'self-hosted')
})
test('official settings validate channel and backend instead of accepting misspelled configuration', () => {
  assert.throws(
    () => resolveAppBuildProfile({ SHENNIAN_OTA_CHANNEL: 'typo' }, official, 'official'),
    /SHENNIAN_OTA_CHANNEL/,
  )
  assert.throws(
    () => resolveAppBuildProfile({ SHENNIAN_OTA_BACKEND: 'typo' }, official, 'official'),
    /SHENNIAN_OTA_BACKEND/,
  )
  assert.throws(
    () => resolveAppDistribution({ SHENNIAN_DISTRIBUTION: 'typo' }),
    /SHENNIAN_DISTRIBUTION/,
  )
})
test('enterprise OTA trust is configured explicitly, never derived from the business server', () => {
  const env = {
    SHENNIAN_OTA_MODE: 'self-hosted',
    SHENNIAN_OTA_URL: 'https://updates.example/channel',
    SHENNIAN_OTA_CODE_SIGNING_CERTIFICATE: './public.pem',
  }
  assert.deepEqual(
    resolveAppBuildProfile(env),
    resolveAppBuildProfile({ ...env, EXPO_PUBLIC_SHENNIAN_SERVER_URL: 'https://another.example' }),
  )
})
