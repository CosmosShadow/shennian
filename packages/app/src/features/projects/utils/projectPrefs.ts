// @arch docs/features/free-growth-phase.md
// @arch docs/architecture/session-organization.md

import { Platform } from 'react-native'
import { collectMapped, isRecord } from '../../../utils/runtimeValues'

export type ProjectPref = {
  pinnedAt?: string | null
  resolvedProject?: { id: string; workDir: string }
}

type ProjectPrefsMap = Record<string, ProjectPref>
type Subscriber = () => void
type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

const PROJECT_PREFS_KEY = 'shennian:projectPrefs'
const subscribers = new Set<Subscriber>()

function emit(): void {
  subscribers.forEach((listener) => listener())
}

function parsePrefs(raw: string | null): ProjectPrefsMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(collectMapped(Object.entries(parsed), ([key, entry]) => {
      if (!isRecord(entry)) return []
      const pref: ProjectPref = {}
      if (entry.pinnedAt === null || typeof entry.pinnedAt === 'string') pref.pinnedAt = entry.pinnedAt
      if (isRecord(entry.resolvedProject) && typeof entry.resolvedProject.id === 'string' && typeof entry.resolvedProject.workDir === 'string') {
        pref.resolvedProject = { id: entry.resolvedProject.id, workDir: entry.resolvedProject.workDir }
      }
      return [[key, pref]]
    }))
  } catch {
    return {}
  }
}

function getWebStorage(): { get(key: string): string | null; set(key: string, value: string): void } {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    }
  }
  const store: Record<string, string> = {}
  return {
    get: (key) => store[key] ?? null,
    set: (key, value) => { store[key] = value },
  }
}

const webStorage = getWebStorage()
let webPrefs: ProjectPrefsMap = parsePrefs(webStorage.get(PROJECT_PREFS_KEY))
let nativeStorage: NativeStorage | null = null
let nativePrefs: ProjectPrefsMap = {}
let nativeHydrated = Platform.OS === 'web'
let nativeHydration: Promise<void> | null = null

async function ensureNativeStorage(): Promise<NativeStorage | null> {
  if (Platform.OS === 'web') return null
  if (nativeStorage) return nativeStorage
  try {
    const mod = await import('@react-native-async-storage/async-storage')
    nativeStorage = mod.default as NativeStorage
  } catch {
    nativeStorage = null
  }
  return nativeStorage
}

function getNativeStorage(): NativeStorage | null {
  if (Platform.OS === 'web') return null
  return nativeStorage
}

function readPrefs(): ProjectPrefsMap {
  if (Platform.OS !== 'web') return nativePrefs
  return webPrefs
}

function persistPrefs(next: ProjectPrefsMap): void {
  const raw = JSON.stringify(next)
  if (Platform.OS === 'web') {
    webPrefs = next
    webStorage.set(PROJECT_PREFS_KEY, raw)
    emit()
    return
  }
  nativePrefs = next
  nativeHydrated = true
  emit()
  const store = getNativeStorage()
  if (!store) return
  void store.setItem(PROJECT_PREFS_KEY, raw).catch(() => {})
}

export async function hydrateProjectPrefs(): Promise<void> {
  if (Platform.OS === 'web' || nativeHydrated) return
  if (nativeHydration) return nativeHydration

  nativeHydration = (async () => {
    const store = await ensureNativeStorage()
    if (!store) {
      nativePrefs = {}
      nativeHydrated = true
      emit()
      return
    }
    const raw = await store.getItem(PROJECT_PREFS_KEY).catch(() => null)
    nativePrefs = parsePrefs(raw)
    nativeHydrated = true
    emit()
  })().finally(() => {
    nativeHydration = null
  })

  return nativeHydration
}

export function subscribeProjectPrefs(listener: Subscriber): () => void {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

export function getProjectPrefsSnapshot(): ProjectPrefsMap {
  return readPrefs()
}

export function isProjectPinned(projectKey: string): boolean {
  return Boolean(readPrefs()[projectKey]?.pinnedAt)
}

export function setProjectPinned(projectKey: string, pinned: boolean): void {
  const prefs = readPrefs()
  const previous = prefs[projectKey] ?? {}
  const next: ProjectPrefsMap = {
    ...prefs,
    [projectKey]: {
      ...previous,
      pinnedAt: pinned ? new Date().toISOString() : null,
    },
  }
  persistPrefs(next)
}

/** Account-scoped, machine-verified alias; never rewrites project records or defaults. */
export function rememberProjectAlias(accountId: string, aliasKey: string, canonicalKey: string, target: { id: string; workDir: string }): void {
  if (!accountId || aliasKey === canonicalKey) return
  const prefs = readPrefs()
  const key = `${accountId}\u0000${aliasKey}`
  const next = { ...prefs, [key]: { ...prefs[key], resolvedProject: target } }
  // Preserve an explicit canonical pin/unpin. Otherwise inherit the alias bookmark.
  if (!prefs[canonicalKey] && prefs[aliasKey]?.pinnedAt) {
    next[canonicalKey] = { pinnedAt: prefs[aliasKey].pinnedAt }
  }
  persistPrefs(next)
}
