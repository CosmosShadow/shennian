// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import { Platform } from 'react-native'

export function deviceNameLabel(): string {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mobile')
      ? 'Mobile Browser'
      : 'Desktop Browser'
  }
  if (Platform.OS === 'ios') return 'iOS App'
  if (Platform.OS === 'android') return 'Android App'
  return `${Platform.OS} App`
}
