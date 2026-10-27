// @covers packages/app/app.config.ts
import { describe, expect, it } from 'vitest'
import { locationNativeConfig } from '../../app.config'
import app from '../../app.json'
import type { ExpoConfig } from 'expo/config'
describe('location binary boundary', () => {
  const base = app.expo as ExpoConfig
  it('does not change existing OTA runtimes or permissions by default', () => {
    expect(locationNativeConfig(base, false)).toBe(base)
    expect(base.ios?.runtimeVersion).toBe('0.5.0')
    expect(base.android?.runtimeVersion).toBe('0.5.1')
    expect(base.android?.blockedPermissions).toContain('android.permission.ACCESS_FINE_LOCATION')
  })
  it('isolates the opt-in binary runtime without mutating the legacy configuration', () => {
    const next = locationNativeConfig(base, true)
    expect(next.ios?.runtimeVersion).toBe('0.6.0')
    expect(next.android?.runtimeVersion).toBe('0.6.0')
    expect(next.extra?.recordingLocationNative).toBe(true)
    expect(next.android?.blockedPermissions).not.toContain(
      'android.permission.ACCESS_FINE_LOCATION',
    )
    expect(next.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-location')).toEqual([
      'expo-location',
      expect.objectContaining({
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      }),
    ])
    expect(base.ios?.runtimeVersion).toBe('0.5.0')
  })
})

// @covers packages/app/plugins/with-recording-location.js
it('repairs historical manifest remove directives without broadening unrelated permissions', async () => {
  const { createRequire } = await import('node:module')
  const plugin = createRequire(import.meta.url)('../../plugins/with-recording-location.js')
  const config = plugin({ name: 'fixture', slug: 'fixture' })
  const modResults = {
    manifest: {
      'uses-permission': [
        {
          $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION', 'tools:node': 'remove' },
        },
        { $: { 'android:name': 'android.permission.READ_PHONE_STATE', 'tools:node': 'remove' } },
      ],
    },
  }
  const result = await config.mods.android.manifest({
    ...config,
    modResults,
    modRequest: { platform: 'android', modName: 'manifest', introspect: true },
  })
  const permissions = result.modResults.manifest['uses-permission']
  expect(
    permissions.find((p: any) => p.$['android:name'] === 'android.permission.ACCESS_FINE_LOCATION')
      .$['tools:node'],
  ).toBeUndefined()
  expect(
    permissions.find(
      (p: any) => p.$['android:name'] === 'android.permission.ACCESS_BACKGROUND_LOCATION',
    ).$['tools:node'],
  ).toBeUndefined()
  expect(
    permissions.find((p: any) => p.$['android:name'] === 'android.permission.READ_PHONE_STATE').$[
      'tools:node'
    ],
  ).toBe('remove')
})
