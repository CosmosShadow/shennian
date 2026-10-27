// @arch open-source/docs/enterprise-ota.md
// @test open-source/deploy/enterprise-ota/ota.test.mjs
export function selfHostedOtaConfig(env: Record<string, string | undefined>):
  | { enabled: false }
  | {
    enabled: true
    url: string
    fallbackToCacheTimeout: number
    requestHeaders: { 'expo-channel-name': string }
    codeSigningCertificate: string
    codeSigningMetadata: { keyid: string; alg: 'rsa-v1_5-sha256' }
  }
