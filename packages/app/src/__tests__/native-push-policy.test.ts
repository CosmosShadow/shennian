// @covers packages/app/src/lib/native-push-policy.ts
// @covers packages/app/src/hooks/usePushNotifications.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const instance = vi.hoisted(() => ({ manual: false, url: 'https://shennian.net' }))
vi.mock('../config/server', () => ({ getServerUrl: () => instance.url, isSelfHostedSelection: () => instance.manual, SERVERS: { cn: { url: 'https://shennian.net' } } }))
import { nativePushEnabled } from '../lib/native-push-policy'
afterEach(() => { vi.unstubAllEnvs(); instance.manual = false; instance.url = 'https://shennian.net' })
it('preserves official behavior, but defaults self-hosted and development overrides to off', () => {
  vi.stubEnv('EXPO_PUBLIC_SHENNIAN_PUSH_MODE', '')
  expect(nativePushEnabled()).toBe(true)
  instance.manual = true
  expect(nativePushEnabled()).toBe(false)
  instance.manual = false; instance.url = 'https://company.example'
  expect(nativePushEnabled()).toBe(false)
})
it('allows explicit provider setup and fails closed for unknown settings', () => {
  instance.manual = true
  vi.stubEnv('EXPO_PUBLIC_SHENNIAN_PUSH_MODE', 'providers'); expect(nativePushEnabled()).toBe(true)
  vi.stubEnv('EXPO_PUBLIC_SHENNIAN_PUSH_MODE', 'off'); expect(nativePushEnabled()).toBe(false)
  vi.stubEnv('EXPO_PUBLIC_SHENNIAN_PUSH_MODE', 'typo'); expect(nativePushEnabled()).toBe(false)
})
it('guards permission requests, native module loading and badge side effects, not in-app unread calculations', () => {
  const hook = readFileSync(resolve(__dirname, '../hooks/usePushNotifications.ts'), 'utf8')
  const effect = hook.slice(hook.indexOf("if (Platform.OS === 'web' || !token || !nativePushEnabled()) return"))
  expect(effect.indexOf('!nativePushEnabled()')).toBeLessThan(effect.indexOf("require('expo-notifications')"))
  const badge = readFileSync(resolve(__dirname, '../lib/push-badge.ts'), 'utf8')
  expect(badge.indexOf('!nativePushEnabled()')).toBeLessThan(badge.indexOf("import('expo-notifications')"))
})
