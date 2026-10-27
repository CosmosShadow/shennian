// @arch open-source/docs/enterprise-ota.md
// @test open-source/deploy/enterprise-ota/ota.test.mjs
/* global URL, module */
/** Public build policy. No official service, account or publishing credentials. */
function selfHostedOtaConfig(env) {
  const mode = env.SHENNIAN_OTA_MODE || 'disabled'
  if (mode === 'disabled') return { enabled: false }
  if (mode !== 'self-hosted') throw new Error('SHENNIAN_OTA_MODE must be disabled or self-hosted')
  let url
  try { url = new URL(env.SHENNIAN_OTA_URL || '') }
  catch { throw new Error('SHENNIAN_OTA_URL is required') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('SHENNIAN_OTA_URL must be a credential-free HTTPS URL')
  }
  const certificate = env.SHENNIAN_OTA_CODE_SIGNING_CERTIFICATE?.trim()
  if (!certificate) throw new Error('SHENNIAN_OTA_CODE_SIGNING_CERTIFICATE is required')
  const keyid = env.SHENNIAN_OTA_KEY_ID || 'main'
  const channel = env.SHENNIAN_OTA_CHANNEL || 'production'
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyid)) throw new Error('Invalid SHENNIAN_OTA_KEY_ID')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(channel)) throw new Error('Invalid SHENNIAN_OTA_CHANNEL')
  return {
    enabled: true,
    url: url.href,
    fallbackToCacheTimeout: 0,
    requestHeaders: { 'expo-channel-name': channel },
    codeSigningCertificate: certificate,
    codeSigningMetadata: { keyid, alg: 'rsa-v1_5-sha256' },
  }
}

module.exports = { selfHostedOtaConfig }
