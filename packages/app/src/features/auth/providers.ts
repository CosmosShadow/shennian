// @arch docs/architecture/app/modular-features.md#登录-provider-注册表
// @test src/__tests__/auth-providers.test.ts

import type {
  IdentityProviderSpec,
  PlatformName,
  PublicAuthConfig,
} from './types'

function hasGoogleClient(config: PublicAuthConfig, platform: PlatformName): boolean {
  switch (platform) {
    case 'web':
      return Boolean(config.googleWebClientId)
    case 'ios':
      return Boolean(config.googleIosClientId)
    case 'android':
      return Boolean(config.googleAndroidClientId)
  }
}

export function getPlatformName(os: string): PlatformName {
  if (os === 'ios' || os === 'android') return os
  return 'web'
}

export function buildIdentityProviderSpecs(
  config: PublicAuthConfig,
  platform: PlatformName,
): IdentityProviderSpec[] {
  return [
    {
      id: 'google',
      status: hasGoogleClient(config, platform) ? 'ready' : 'disabled',
      supportedPlatforms: ['web', 'ios', 'android'],
    },
    {
      id: 'apple',
      status:
        (platform === 'ios' || platform === 'web') && config.appleEnabled && config.appleBundleId
          ? 'ready'
          : 'disabled',
      supportedPlatforms: ['ios', 'web'],
    },
  ]
}

export function getVisibleIdentityProviderSpecs(
  specs: IdentityProviderSpec[],
): IdentityProviderSpec[] {
  return specs.filter((spec) => spec.status === 'ready')
}
