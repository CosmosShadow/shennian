// @arch open-source/docs/mobile-app.md
// @test src/__tests__/native-push-policy.test.ts
import { getServerUrl, isSelfHostedSelection, SERVERS } from '../config/server'

/** Native transports are optional; in-app unread does not depend on them. */
export function nativePushEnabled(): boolean {
  const mode = process.env.EXPO_PUBLIC_SHENNIAN_PUSH_MODE?.trim()
  if (mode === 'off') return false
  if (mode === 'providers') return true
  if (mode) return false // Unknown build settings fail closed.
  return !isSelfHostedSelection() && getServerUrl().replace(/\/+$/, '') === SERVERS.cn.url
}
