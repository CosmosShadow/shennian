// @arch docs/architecture/app/modular-features.md
// @covers packages/app/src/config/api.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

async function importApiConfig(serverUrl: string, platform = 'ios', selfHosted = false) {
  vi.resetModules()
  vi.doMock('../config/server', () => ({
    getServerUrl: () => serverUrl,
    isSelfHostedSelection: () => selfHosted,
  }))
  vi.doMock('../config/auth', () => ({
    useAuthStore: { getState: () => ({}) },
    getDesktopCredentialBridge: () => null,
  }))
  vi.doMock('@shennian/shared', () => ({
    createApiClient: (options: { getBaseUrl: () => string }) => ({
      api: null,
      authApi: null,
      getBaseUrl: options.getBaseUrl,
    }),
  }))
  vi.doMock('react-native', () => ({
    Platform: { OS: platform },
  }))
  return import('../config/api')
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getApiBaseUrl', () => {
  it('does not add /api for localhost development servers', async () => {
    const module = await importApiConfig('http://127.0.0.1:3000')
    expect(module.getApiBaseUrl()).toBe('http://127.0.0.1:3000')
  })

  it('does not add /api for LAN development servers used by phones', async () => {
    const module = await importApiConfig('http://192.168.2.68:3000')
    expect(module.getApiBaseUrl()).toBe('http://192.168.2.68:3000')
  })

  it('adds /api for production domains', async () => {
    const module = await importApiConfig('https://shennian.net')
    expect(module.getApiBaseUrl()).toBe('https://shennian.net/api')
  })

  it('adds /api for an explicitly selected self-hosted LAN instance', async () => {
    const module = await importApiConfig('https://192.168.2.68:8443', 'ios', true)
    expect(module.getApiBaseUrl()).toBe('https://192.168.2.68:8443/api')
  })

  it('does not route a selected self-hosted instance through the official Metro proxy', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', origin: 'http://localhost:8081' } })
    const module = await importApiConfig('https://company.test', 'web', true)
    expect(module.getApiBaseUrl()).toBe('https://company.test/api')
  })

  it('keeps scoped cookies first-party through Metro when local Web uses production', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', origin: 'http://localhost:8081' } })
    const module = await importApiConfig('https://shennian.net', 'web')
    expect(module.getApiBaseUrl()).toBe('http://localhost:8081/api')
  })

  it('preserves an explicit local backend override for Web', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', origin: 'http://localhost:8081' } })
    const module = await importApiConfig('http://127.0.0.1:3000', 'web')
    expect(module.getApiBaseUrl()).toBe('http://127.0.0.1:3000')
  })
})
