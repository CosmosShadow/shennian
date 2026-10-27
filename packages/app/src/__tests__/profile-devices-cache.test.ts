// @covers packages/app/src/config/profileDevices.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authApi, storage } = vi.hoisted(() => ({
  authApi: vi.fn(),
  storage: new Map<string, string>(),
}))

vi.mock('../config/api', () => ({ authApi }))
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
})

import {
  clearProfileDevices,
  hydrateProfileDevices,
  refreshProfileDevices,
  seedProfileDevices,
  useProfileDevicesStore,
  type DeviceInfo,
} from '../config/profileDevices'

const cachedDevice: DeviceInfo = {
  id: 'device-1',
  platform: 'ios',
  name: 'iPhone',
  lastActiveAt: '2026-08-31T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  current: true,
}

describe('profile device cache', () => {
  beforeEach(() => {
    authApi.mockReset()
    storage.clear()
    useProfileDevicesStore.setState({
      userId: null,
      devices: [],
      loaded: false,
      refreshing: false,
    })
  })

  it('hydrates the last known device count before a background refresh', async () => {
    storage.set('shennian_profile_devices:user-1', JSON.stringify([cachedDevice]))

    await hydrateProfileDevices('user-1')

    expect(useProfileDevicesStore.getState()).toMatchObject({
      userId: 'user-1',
      devices: [cachedDevice],
      loaded: true,
      refreshing: false,
    })
  })

  it('omits retired Web sessions from stored and refreshed device lists', async () => {
    const webDevice = { ...cachedDevice, id: 'old-web', platform: 'web', name: 'Desktop Browser', current: false }
    storage.set('shennian_profile_devices:user-1', JSON.stringify([cachedDevice, webDevice]))
    await hydrateProfileDevices('user-1')
    expect(useProfileDevicesStore.getState().devices).toEqual([cachedDevice])
    seedProfileDevices('user-1', [cachedDevice, webDevice])
    expect(useProfileDevicesStore.getState().devices).toEqual([cachedDevice])
  })

  it('keeps cached devices visible while refresh is pending', async () => {
    seedProfileDevices('user-1', [cachedDevice])
    let resolveRequest!: (devices: DeviceInfo[]) => void
    authApi.mockReturnValue(new Promise<DeviceInfo[]>((resolve) => { resolveRequest = resolve }))

    const refresh = refreshProfileDevices('user-1')

    expect(useProfileDevicesStore.getState()).toMatchObject({
      devices: [cachedDevice],
      loaded: true,
      refreshing: true,
    })
    resolveRequest([cachedDevice])
    await refresh
    expect(useProfileDevicesStore.getState().devices).toEqual([cachedDevice])
  })

  it('isolates and clears persisted data by account', async () => {
    seedProfileDevices('user-1', [cachedDevice])
    await clearProfileDevices('user-1')
    await hydrateProfileDevices('user-2')

    expect(storage.has('shennian_profile_devices:user-1')).toBe(false)
    expect(useProfileDevicesStore.getState()).toMatchObject({
      userId: 'user-2',
      devices: [],
      loaded: false,
    })
  })
})
