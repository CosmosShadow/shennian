// @covers packages/app/src/features/auth/utils/installation.ts
// @covers packages/app/app/_layout.tsx
// @covers packages/app/src/config/api.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shennian:installationId'
const FIRST_ID = '018f2d31-3f6d-7a4f-8c2b-0e4d69c4e0a1'
const SECOND_ID = '018f2d31-3f6d-7a4f-8c2b-0e4d69c4e0a2'

function resetContext() {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
}

async function importNativeInstallation(
  store = new Map<string, string>(),
  generatedId = FIRST_ID,
  storageFailures: { reads?: number; writes?: number } = {},
) {
  let readsRemaining = storageFailures.reads ?? 0
  let writesRemaining = storageFailures.writes ?? 0
  const getItem = vi.fn(async (key: string) => {
    if (readsRemaining > 0) {
      readsRemaining -= 1
      throw new Error('storage unavailable')
    }
    return store.get(key) ?? null
  })
  const setItem = vi.fn(async (key: string, value: string) => {
    if (writesRemaining > 0) {
      writesRemaining -= 1
      throw new Error('storage unavailable')
    }
    store.set(key, value)
  })
  const randomUUID = vi.fn(() => generatedId)

  vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem, setItem },
  }))
  vi.doMock('expo-crypto', () => ({ randomUUID }))

  return {
    module: await import('../features/auth/utils/installation'),
    store,
    getItem,
    setItem,
    randomUUID,
  }
}

async function importWebInstallation(
  store = new Map<string, string>(),
  generatedId = FIRST_ID,
) {
  const randomUUID = vi.fn(() => generatedId)
  vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: vi.fn(), setItem: vi.fn() },
  }))
  vi.doMock('expo-crypto', () => ({ randomUUID }))
  vi.stubGlobal('navigator', { userAgent: 'Mobile Test Browser' })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  })

  return {
    module: await import('../features/auth/utils/installation'),
    store,
    randomUUID,
  }
}

afterEach(resetContext)

describe('auth installation identity', () => {
  it('generates once and restores the same native installation across app reloads', async () => {
    const store = new Map<string, string>()
    const first = await importNativeInstallation(store)

    await expect(first.module.hydrateInstallationId()).resolves.toBe(FIRST_ID)
    expect(store.get(STORAGE_KEY)).toBe(FIRST_ID)
    expect(first.setItem).toHaveBeenCalledTimes(1)

    resetContext()
    const second = await importNativeInstallation(store, SECOND_ID)
    await expect(second.module.hydrateInstallationId()).resolves.toBe(FIRST_ID)
    expect(second.randomUUID).not.toHaveBeenCalled()
    expect(second.setItem).not.toHaveBeenCalled()
  })

  it('coalesces concurrent native hydration and exposes login metadata', async () => {
    const loaded = await importNativeInstallation()

    const [left, right, metadata] = await Promise.all([
      loaded.module.hydrateInstallationId(),
      loaded.module.hydrateInstallationId(),
      loaded.module.getAuthDeviceMetadata(),
    ])

    expect(left).toBe(FIRST_ID)
    expect(right).toBe(FIRST_ID)
    expect(metadata).toEqual({
      platform: 'ios',
      deviceName: 'iOS App',
      installationId: FIRST_ID,
    })
    expect(loaded.getItem).toHaveBeenCalledTimes(1)
    expect(loaded.setItem).toHaveBeenCalledTimes(1)
  })

  it('persists and restores the same web installation from localStorage', async () => {
    const store = new Map<string, string>()
    const first = await importWebInstallation(store)
    await expect(first.module.getAuthDeviceMetadata()).resolves.toEqual({
      platform: 'web',
      deviceName: 'Mobile Browser',
      installationId: FIRST_ID,
    })

    resetContext()
    const second = await importWebInstallation(store, SECOND_ID)
    await expect(second.module.hydrateInstallationId()).resolves.toBe(FIRST_ID)
    expect(second.randomUUID).not.toHaveBeenCalled()
  })

  it('retries transient native storage failures before exposing a durable installation', async () => {
    const loaded = await importNativeInstallation(new Map(), FIRST_ID, { reads: 1, writes: 1 })

    await expect(loaded.module.hydrateInstallationId()).resolves.toBe(FIRST_ID)
    expect(loaded.module.getHydratedInstallationId()).toBe(FIRST_ID)
    expect(loaded.getItem).toHaveBeenCalledTimes(2)
    expect(loaded.setItem).toHaveBeenCalledTimes(2)
    expect(loaded.randomUUID).toHaveBeenCalledTimes(1)
  })

  it('does not expose or replace an installation id when persistence remains unavailable', async () => {
    const loaded = await importNativeInstallation(new Map(), FIRST_ID, { writes: 4 })

    await expect(loaded.module.hydrateInstallationId()).rejects.toThrow('storage unavailable')
    expect(loaded.module.getHydratedInstallationId()).toBeNull()
    expect(loaded.setItem).toHaveBeenCalledTimes(3)

    await expect(loaded.module.hydrateInstallationId()).resolves.toBe(FIRST_ID)
    expect(loaded.randomUUID).toHaveBeenCalledTimes(1)
    expect(loaded.store.get(STORAGE_KEY)).toBe(FIRST_ID)
  })

  it('does not invent a new installation when storage reads remain unavailable', async () => {
    const loaded = await importNativeInstallation(new Map(), FIRST_ID, { reads: 3 })

    await expect(loaded.module.hydrateInstallationId()).rejects.toThrow('storage unavailable')
    expect(loaded.randomUUID).not.toHaveBeenCalled()
    expect(loaded.setItem).not.toHaveBeenCalled()
    expect(loaded.module.getHydratedInstallationId()).toBeNull()
  })

  it('hydrates installation identity before validating a restored auth session', () => {
    const root = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8')
    const api = readFileSync(resolve(__dirname, '../config/api.ts'), 'utf8')
    const authSources = [
      '../features/auth/hooks/usePhoneLogin.ts',
      '../features/auth/hooks/useQrLogin.ts',
      '../components/auth/GoogleSignInButton.tsx',
      '../components/auth/AppleSignInButton.native.tsx',
      '../components/auth/AppleSignInButton.web.tsx',
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8'))

    const hydrationIndex = root.indexOf('Promise.all([loadFromStorage(), hydrateInstallationId()])')
    const validationIndex = root.indexOf('validateStoredSession().catch(() => {})')
    expect(hydrationIndex).toBeGreaterThan(-1)
    expect(validationIndex).toBeGreaterThan(hydrationIndex)
    expect(api).toContain('...(installationId ? { installationId } : {})')
    authSources.forEach((source) => expect(source).toContain('getAuthDeviceMetadata()'))
  })
})
