// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/home-entry-preference.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect } from 'react'
import { create } from 'zustand'

export const HOME_ENTRY_KEYS = ['recording', 'schedules', 'diary', 'folders'] as const
export type HomeEntryKey = typeof HOME_ENTRY_KEYS[number]
export type HomeEntries = Record<HomeEntryKey, boolean>
export const DEFAULT_HOME_ENTRIES: HomeEntries = { recording: true, schedules: true, diary: true, folders: true }
export const HOME_ENTRIES_STORAGE_KEY = 'shennian:homeEntriesByAccount:v1'
export function normalizeHomeEntries(value: unknown): HomeEntries {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(HOME_ENTRY_KEYS.map(key => [key,
    typeof source[key] === 'boolean' ? source[key] : true,
  ])) as HomeEntries
}
const useStore = create<{ hydrated: boolean; byAccount: Record<string, HomeEntries> }>(() => ({ hydrated: false, byAccount: {} }))
let hydration: Promise<void> | undefined
let writes = Promise.resolve()
export function hydrateHomeEntries() {
  return hydration ??= AsyncStorage.getItem(HOME_ENTRIES_STORAGE_KEY).then(raw => {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    useStore.setState({ byAccount: Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, normalizeHomeEntries(value)])) })
  }).catch(() => {}).finally(() => useStore.setState({ hydrated: true }))
}
export function useHomeEntries(accountId: string | null | undefined) {
  useEffect(() => { void hydrateHomeEntries() }, [])
  const entries = useStore(state => accountId ? state.byAccount[accountId] ?? DEFAULT_HOME_ENTRIES : DEFAULT_HOME_ENTRIES)
  const hydrated = useStore(state => state.hydrated)
  return { entries, hydrated }
}
/** Persist before publishing; a failed write leaves the previous visibility intact. */
export async function saveHomeEntry(accountId: string, key: HomeEntryKey, enabled: boolean) {
  await hydrateHomeEntries()
  const write = writes.then(async () => {
    const byAccount = useStore.getState().byAccount
    const next = { ...byAccount, [accountId]: { ...(byAccount[accountId] ?? DEFAULT_HOME_ENTRIES), [key]: enabled } }
    await AsyncStorage.setItem(HOME_ENTRIES_STORAGE_KEY, JSON.stringify(next))
    useStore.setState({ byAccount: next })
  })
  writes = write.catch(() => {})
  await write
}
