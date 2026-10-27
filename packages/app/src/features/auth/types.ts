// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import type { AccountTier, UserEntitlements } from '@shennian/shared'

export type AuthUser = {
  id: string
  phone: string
  email: string | null
  name: string
  nameSetupRequired?: boolean
  avatar?: {
    version: string
    smallUrl: string
    mediumUrl: string
    updatedAt: string
  } | null
  accountTier?: AccountTier
  entitlements?: UserEntitlements
}

export type AuthResponse = {
  token: string
  refreshToken: string
  user: AuthUser
}

export type QrCreateResponse = {
  qrId: string
  qrUrl: string
}

export type QrStatus = 'pending' | 'scanned' | 'confirmed' | 'expired'

export type QrStatusResponse = {
  status: QrStatus
  token?: string
  refreshToken?: string
  user?: AuthUser
}

export type PublicAuthConfig = {
  tencentCaptchaAppId: string | null
  googleWebClientId: string | null
  googleIosClientId: string | null
  googleAndroidClientId: string | null
  appleEnabled: boolean
  appleServiceId: string | null
  appleBundleId: string | null
}

export type IdentityProviderId = 'google' | 'apple'
export type IdentityProviderStatus = 'ready' | 'planned' | 'disabled'
export type PlatformName = 'web' | 'ios' | 'android'

export type IdentityProviderSpec = {
  id: IdentityProviderId
  status: IdentityProviderStatus
  supportedPlatforms: PlatformName[]
}

export type TabKey = 'phone' | 'qr'

export function emptyPublicAuthConfig(): PublicAuthConfig {
  return {
    tencentCaptchaAppId: null,
    googleWebClientId: null,
    googleIosClientId: null,
    googleAndroidClientId: null,
    appleEnabled: false,
    appleServiceId: null,
    appleBundleId: null,
  }
}
