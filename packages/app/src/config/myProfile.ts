// @test src/__tests__/my-profile-cache.test.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { peopleAccountClient, type PersonProfileResponse } from '../features/contacts/peopleAccountClient'

type MyProfileCacheState = {
  userId: string | null
  profile: PersonProfileResponse | null
  loaded: boolean
}

const STORAGE_PREFIX = 'shennian_my_profile:'
// Background refocus refetches within this window reuse the cached value
// instead of hitting the network again, so switching tabs back and forth
// doesn't spam `/people/me`.
const MIN_REFRESH_INTERVAL_MS = 30_000
const pendingRefreshes = new Map<string, Promise<PersonProfileResponse | null>>()
const lastFetchedAt = new Map<string, number>()

export const useMyProfileStore = create<MyProfileCacheState>(() => ({
  userId: null,
  profile: null,
  loaded: false,
}))

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

async function readCache(userId: string): Promise<PersonProfileResponse | null> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(storageKey(userId)) ?? null
      : await AsyncStorage.getItem(storageKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as PersonProfileResponse
  } catch {
    return null
  }
}

async function writeCache(userId: string, profile: PersonProfileResponse): Promise<void> {
  try {
    const raw = JSON.stringify(profile)
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(storageKey(userId), raw)
    else await AsyncStorage.setItem(storageKey(userId), raw)
  } catch {
    // A storage failure must not hide fresh server data.
  }
}

/** Loads the last-known profile from disk so the first paint shows it instead of a blank/placeholder state. */
export async function hydrateMyProfile(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  const current = useMyProfileStore.getState()
  if (current.userId === userId && current.loaded) return
  if (current.userId !== userId) {
    useMyProfileStore.setState({ userId, profile: null, loaded: false })
  }
  const cached = await readCache(userId)
  const latest = useMyProfileStore.getState()
  if (latest.userId !== userId || latest.loaded) return
  useMyProfileStore.setState({ profile: cached, loaded: cached !== null })
}

export function seedMyProfile(userId: string, profile: PersonProfileResponse): void {
  useMyProfileStore.setState({ userId, profile, loaded: true })
  lastFetchedAt.set(userId, Date.now())
  void writeCache(userId, profile)
}

export function refreshMyProfile(
  userId: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<PersonProfileResponse | null> {
  if (!userId) return Promise.resolve(null)
  if (!options.force) {
    const last = lastFetchedAt.get(userId)
    if (last !== undefined && Date.now() - last < MIN_REFRESH_INTERVAL_MS) {
      return Promise.resolve(useMyProfileStore.getState().profile)
    }
  }
  const pending = pendingRefreshes.get(userId)
  if (pending) return pending
  const request = peopleAccountClient.getMine()
    .then((profile) => {
      seedMyProfile(userId, profile)
      return profile
    })
    .finally(() => {
      pendingRefreshes.delete(userId)
    })
  pendingRefreshes.set(userId, request)
  return request
}

export async function clearMyProfileCache(userId: string | null | undefined): Promise<void> {
  if (!userId) return
  lastFetchedAt.delete(userId)
  if (useMyProfileStore.getState().userId === userId) {
    useMyProfileStore.setState({ userId: null, profile: null, loaded: false })
  }
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(storageKey(userId))
    else await AsyncStorage.removeItem(storageKey(userId))
  } catch {
    // Best-effort privacy cleanup; auth state is cleared independently.
  }
}
