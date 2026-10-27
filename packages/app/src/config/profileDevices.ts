// @test src/__tests__/profile-devices-cache.test.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { profileAccountClient } from '../features/account/profileAccountClient'
import type { ProfileDevice } from '../features/account/profileAccountClient.types'

export type DeviceInfo = ProfileDevice

type DeviceCacheState = {
  userId: string | null
  devices: DeviceInfo[]
  loaded: boolean
  refreshing: boolean
}

const STORAGE_PREFIX = 'shennian_profile_devices:'
const pendingRefreshes = new Map<string, Promise<DeviceInfo[]>>()

export const useProfileDevicesStore = create<DeviceCacheState>(() => ({
  userId: null,
  devices: [],
  loaded: false,
  refreshing: false,
}))

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

async function readCache(userId: string): Promise<DeviceInfo[] | null> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(storageKey(userId)) ?? null
      : await AsyncStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? (parsed as DeviceInfo[]).filter((device) => device.platform !== 'web')
      : null
  } catch {
    return null
  }
}

async function writeCache(userId: string, devices: DeviceInfo[]): Promise<void> {
  try {
    const raw = JSON.stringify(devices)
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(storageKey(userId), raw)
    else await AsyncStorage.setItem(storageKey(userId), raw)
  } catch {
    // A storage failure must not hide fresh server data.
  }
}

export async function hydrateProfileDevices(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  const current = useProfileDevicesStore.getState()
  if (current.userId === userId && current.loaded) return
  if (current.userId !== userId) {
    useProfileDevicesStore.setState({ userId, devices: [], loaded: false, refreshing: false })
  }
  const cached = await readCache(userId)
  const latest = useProfileDevicesStore.getState()
  if (latest.userId !== userId || latest.loaded) return
  useProfileDevicesStore.setState({ devices: cached ?? [], loaded: cached !== null })
}

export function seedProfileDevices(userId: string, devices: DeviceInfo[]): void {
  const visibleDevices = devices.filter((device) => device.platform !== 'web')
  useProfileDevicesStore.setState({ userId, devices: visibleDevices, loaded: true, refreshing: false })
  void writeCache(userId, visibleDevices)
}

export function refreshProfileDevices(userId: string | null | undefined): Promise<DeviceInfo[]> {
  if (!userId) return Promise.resolve([])
  const pending = pendingRefreshes.get(userId)
  if (pending) return pending
  const state = useProfileDevicesStore.getState()
  useProfileDevicesStore.setState(
    state.userId === userId
      ? { refreshing: true }
      : { userId, devices: [], loaded: false, refreshing: true },
  )
  const request = profileAccountClient.listDevices()
    .then((devices) => {
      seedProfileDevices(userId, devices)
      return devices
    })
    .finally(() => {
      pendingRefreshes.delete(userId)
      if (useProfileDevicesStore.getState().userId === userId) {
        useProfileDevicesStore.setState({ refreshing: false })
      }
    })
  pendingRefreshes.set(userId, request)
  return request
}

export function removeCachedProfileDevice(userId: string, deviceId: string): void {
  const state = useProfileDevicesStore.getState()
  if (state.userId !== userId) return
  seedProfileDevices(userId, state.devices.filter((device) => device.id !== deviceId))
}

export async function clearProfileDevices(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  if (useProfileDevicesStore.getState().userId === userId) {
    useProfileDevicesStore.setState({ userId: null, devices: [], loaded: false, refreshing: false })
  }
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(storageKey(userId))
    else await AsyncStorage.removeItem(storageKey(userId))
  } catch {
    // Best-effort privacy cleanup; auth state is cleared independently.
  }
}
