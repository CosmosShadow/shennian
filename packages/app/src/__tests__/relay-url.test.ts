// @arch docs/architecture/data-sync.md#六、WS连接管理
// @covers packages/app/src/platform/relay-url.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

function resetRelayUrlTestContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importRelayUrl(serverUrl: string, relayOverride?: string) {
  vi.doMock('../config/server', () => ({
    getServerUrl: () => serverUrl,
  }))
  vi.stubGlobal('process', {
    env: relayOverride ? { EXPO_PUBLIC_SHENNIAN_RELAY_URL: relayOverride } : {},
  })
  vi.doMock('expo-application', () => ({
    nativeBuildVersion: '51',
  }))
  vi.doMock('expo-constants', () => ({
    default: { platform: { ios: {} }, expoConfig: { version: '0.4.0', extra: { deliveryVersion: '0.4.10' } } },
  }))

  return import('../platform/relay-url')
}

afterEach(() => {
  resetRelayUrlTestContext()
})

describe('buildRelayUrl', () => {
  function expectRelayUrl(actual: string, expectedPath: string) {
    const url = new URL(actual)
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(expectedPath)
    expect(url.searchParams.get('syncProtocol')).toBe('2')
    expect(url.searchParams.get('dataEpoch')).toBe('2')
    expect(url.searchParams.get('syncCapabilities')).toContain('local_canonical_v1')
    expect(url.searchParams.get('appBuild')).toBe('51')
    expect(url.searchParams.get('platform')).toBe('ios')
    expect(url.searchParams.get('deliveryVersion')).toBe('0.4.10')
  }

  it('uses ws for local http relay targets', async () => {
    const module = await importRelayUrl('http://127.0.0.1:3000')
    expectRelayUrl(module.buildRelayUrl('machine-1'), 'ws://127.0.0.1:3000/relay/machine-1')
    expectRelayUrl(module.buildRelayClientUrl(), 'ws://127.0.0.1:3000/relay/client')
  })

  it('uses wss for production https relay targets', async () => {
    const module = await importRelayUrl('https://shennian.ai')
    expectRelayUrl(module.buildRelayUrl('machine-1'), 'wss://shennian.ai/relay/machine-1')
    expectRelayUrl(module.buildRelayClientUrl(), 'wss://shennian.ai/relay/client')
  })

  it('prefers an explicit relay override when provided', async () => {
    const module = await importRelayUrl('http://127.0.0.1:3000', 'ws://10.0.0.5:3010')
    expectRelayUrl(module.buildRelayUrl('machine-1'), 'ws://10.0.0.5:3010/relay/machine-1')
    expectRelayUrl(module.buildRelayClientUrl(), 'ws://10.0.0.5:3010/relay/client')
  })

  it('preserves a secure websocket relay override', async () => {
    const module = await importRelayUrl('https://shennian.net', 'wss://shennian.net')
    expectRelayUrl(module.buildRelayUrl('machine-1'), 'wss://shennian.net/relay/machine-1')
    expectRelayUrl(module.buildRelayClientUrl(), 'wss://shennian.net/relay/client')
  })

  it('identifies the explicit Desktop control surface without enabling ordinary web', async () => {
    vi.doMock('../config/server', () => ({ getServerUrl: () => 'https://shennian.net' }))
    vi.doMock('expo-application', () => ({ nativeBuildVersion: null }))
    vi.doMock('expo-constants', () => ({
      default: {
        platform: {},
        expoConfig: {
          version: '0.4.0',
          extra: { controlSurface: 'desktop', deliveryVersion: '0.4.31', desktopVersion: '0.4.0' },
        },
      },
    }))

    const module = await import('../platform/relay-url')
    const url = new URL(module.buildRelayClientUrl())
    expect(url.searchParams.get('platform')).toBe('desktop')
    expect(url.searchParams.get('desktopVersion')).toBe('0.4.0')
    expect(url.searchParams.get('appBuild')).toBe('0')
  })

  it('uses the immutable native binary build instead of update manifest metadata', async () => {
    vi.doMock('../config/server', () => ({ getServerUrl: () => 'https://shennian.net' }))
    vi.doMock('expo-application', () => ({ nativeBuildVersion: '12' }))
    vi.doMock('expo-constants', () => ({
      default: { platform: { android: { versionCode: 11 } }, expoConfig: { android: { versionCode: 11 } } },
    }))

    const module = await import('../platform/relay-url')
    expect(new URL(module.buildRelayClientUrl()).searchParams.get('appBuild')).toBe('12')
  })
})
