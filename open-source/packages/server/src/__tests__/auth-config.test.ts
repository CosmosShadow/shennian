/**
 * @covers src/services/auth-session.ts
 */

import { afterEach, describe, expect, it } from 'vitest'
import { buildPublicAuthConfig } from '../services/auth-session.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('buildPublicAuthConfig', () => {
  it('exposes Apple Sign In config for iOS support', () => {
    process.env.APPLE_SIGN_IN_ENABLED = 'true'
    process.env.APPLE_SIGN_IN_SERVICE_ID = 'com.shennian.signin'
    process.env.APPLE_SIGN_IN_BUNDLE_ID = 'net.shengnian.app'

    expect(buildPublicAuthConfig()).toEqual(
      expect.objectContaining({
        appleEnabled: true,
        appleServiceId: 'com.shennian.signin',
        appleBundleId: 'net.shengnian.app',
      }),
    )
  })

  it('defaults Apple Sign In config to disabled when env vars are absent', () => {
    delete process.env.APPLE_SIGN_IN_ENABLED
    delete process.env.APPLE_SIGN_IN_SERVICE_ID
    delete process.env.APPLE_SIGN_IN_BUNDLE_ID

    expect(buildPublicAuthConfig()).toEqual(
      expect.objectContaining({
        appleEnabled: false,
        appleServiceId: null,
        appleBundleId: null,
      }),
    )
  })
})
