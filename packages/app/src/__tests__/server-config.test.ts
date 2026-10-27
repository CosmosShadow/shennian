// @arch docs/architecture/app/modular-features.md
// @covers packages/app/src/config/server.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

function resetServerConfigTestContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importWebServerConfig(hostname: string) {
  const store = new Map<string, string>()

  vi.doMock('react-native', () => ({
    Platform: { OS: 'web' },
  }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
  })
  vi.stubGlobal('window', {
    location: { hostname, origin: `https://${hostname}` },
  })
  vi.stubGlobal('process', { env: {} })

  return import('../config/server')
}

async function importWebServerConfigWithEnv(hostname: string, env: Record<string, string>) {
  const store = new Map<string, string>()

  vi.doMock('react-native', () => ({
    Platform: { OS: 'web' },
  }))
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
  })
  vi.stubGlobal('window', {
    location: { hostname, origin: `https://${hostname}` },
  })
  vi.stubGlobal('process', { env })

  return import('../config/server')
}

async function importNativeServerConfig(env: Record<string, string>) {
  const store = new Map<string, string>()

  vi.doMock('react-native', () => ({
    Platform: { OS: 'ios' },
  }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      }),
    },
  }))
  vi.stubGlobal('process', { env })

  return import('../config/server')
}

afterEach(() => {
  resetServerConfigTestContext()
})

describe('server config docs url', () => {
  it('derives the docs page from the current cn hostname on web', async () => {
    const module = await importWebServerConfig('shennian.net')
    expect(module.getDocsUrl()).toBe('https://shennian.net/docs')
  })

  it('routes the global hostname to the cn docs page while global is offline', async () => {
    const module = await importWebServerConfig('shennian.ai')
    expect(module.getDocsUrl()).toBe('https://shennian.net/docs')
  })

  it('keeps the API on the root domain while identifying the canonical app host', async () => {
    const module = await importWebServerConfig('app.shennian.net')

    expect(module.getServerUrl()).toBe('https://shennian.net')
    expect(module.getPublicSiteUrl()).toBe('https://shennian.net')
    expect(module.getWebAppUrl()).toBe('https://app.shennian.net')
    expect(module.isCanonicalWebAppHost()).toBe(true)
  })

  it('uses the current origin for both web surfaces during local development', async () => {
    const module = await importWebServerConfig('localhost')

    expect(module.getPublicSiteUrl()).toBe('https://localhost')
    expect(module.getWebAppUrl()).toBe('https://localhost')
    expect(module.isCanonicalWebAppHost()).toBe(false)
  })

  it('prefers the explicit test server override when provided', async () => {
    const module = await importWebServerConfigWithEnv('localhost', {
      EXPO_PUBLIC_SHENNIAN_SERVER_URL: 'http://127.0.0.1:3000',
    })

    expect(module.getServerUrl()).toBe('http://127.0.0.1:3000')
    expect(module.getDocsUrl()).toBe('http://127.0.0.1:3000/docs')
  })

  it('ignores local server overrides in native production builds', async () => {
    const module = await importNativeServerConfig({
      NODE_ENV: 'production',
      EXPO_PUBLIC_SHENNIAN_SERVER_URL: 'http://192.168.2.68:3000',
    })

    expect(module.getServerUrl()).not.toBe('http://192.168.2.68:3000')
    expect(module.getServerUrl()).toBe('https://shennian.net')
  })
})
