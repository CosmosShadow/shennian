// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/reasoning-effort-storage.test.ts

import { Platform } from 'react-native'
import type { AgentType } from '@shennian/wire'

export type ReasoningEffortPreference = {
  agentType: AgentType
  modelId: string
  effort: string
  savedAt: number
}

const REASONING_EFFORT_KEY = 'shennian:chatReasoningEfforts'
const MAX_ENTRIES = 240
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

type ReasoningEffortPreferenceMap = Record<string, ReasoningEffortPreference>

type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

function parsePreference(value: unknown): ReasoningEffortPreference | null {
  if (typeof value !== 'object' || value === null) return null

  const entry = value as Record<string, unknown>
  if (typeof entry.agentType !== 'string') return null
  if (typeof entry.modelId !== 'string' || !entry.modelId.trim()) return null
  if (typeof entry.effort !== 'string' || !entry.effort.trim()) return null
  const savedAt = typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt)
    ? entry.savedAt
    : Date.now()

  return {
    agentType: entry.agentType as AgentType,
    modelId: entry.modelId,
    effort: entry.effort,
    savedAt,
  }
}

function preferenceKey(agentType: AgentType, modelId: string): string {
  return `${agentType}:${modelId}`
}

function parsePreferenceMap(raw: string | null): ReasoningEffortPreferenceMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}

    const map: ReasoningEffortPreferenceMap = {}
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const preference = parsePreference(value)
      if (!preference) continue

      // Older clients keyed this local preference by session. Normalize those
      // entries to an agent/model key so the latest explicit choice becomes the
      // default in every conversation on this device.
      const key = preferenceKey(preference.agentType, preference.modelId)
      if (!map[key] || map[key].savedAt < preference.savedAt) map[key] = preference
    }
    return map
  } catch {
    return {}
  }
}

function prunePreferenceMap(
  map: ReasoningEffortPreferenceMap,
  now = Date.now(),
): ReasoningEffortPreferenceMap {
  const freshEntries = Object.entries(map)
    .filter(([, value]) => now - value.savedAt <= MAX_AGE_MS)
    .sort((left, right) => right[1].savedAt - left[1].savedAt)
    .slice(0, MAX_ENTRIES)

  return Object.fromEntries(freshEntries)
}

function getMemoryStorage(): {
  get(key: string): string | null
  set(key: string, value: string): void
} {
  const store: Record<string, string> = {}
  return {
    get: (key) => store[key] ?? null,
    set: (key, value) => {
      store[key] = value
    },
  }
}

function getWebStorage() {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      get: (key: string) => localStorage.getItem(key),
      set: (key: string, value: string) => localStorage.setItem(key, value),
    }
  }
  return getMemoryStorage()
}

const storage = getWebStorage()
let nativeStorage: NativeStorage | null = null
let nativePreferenceMap: ReasoningEffortPreferenceMap = {}
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

function readPreferenceMap(): ReasoningEffortPreferenceMap {
  if (Platform.OS !== 'web') return nativePreferenceMap
  return parsePreferenceMap(storage.get(REASONING_EFFORT_KEY))
}

function persistPreferenceMap(map: ReasoningEffortPreferenceMap): void {
  const nextMap = prunePreferenceMap(map)
  const raw = JSON.stringify(nextMap)

  if (Platform.OS === 'web') {
    storage.set(REASONING_EFFORT_KEY, raw)
    return
  }

  nativePreferenceMap = nextMap
  nativeHydrated = true
  void ensureNativeStorage()
    .then((store) => store?.setItem(REASONING_EFFORT_KEY, raw))
    .catch(() => {})
}

export async function hydrateReasoningEffortStorage(): Promise<void> {
  if (Platform.OS === 'web' || nativeHydrated) return
  if (nativeHydration) return nativeHydration

  nativeHydration = (async () => {
    const store = await ensureNativeStorage()
    if (!store) {
      nativePreferenceMap = {}
      nativeHydrated = true
      return
    }

    const raw = await store.getItem(REASONING_EFFORT_KEY).catch(() => null)
    nativePreferenceMap = prunePreferenceMap(parsePreferenceMap(raw))
    nativeHydrated = true
  })().finally(() => {
    nativeHydration = null
  })

  return nativeHydration
}

export function getReasoningEffortPreference(
  agentType: AgentType,
  modelId?: string | null,
): string | null {
  try {
    if (!modelId) return null
    const preference = readPreferenceMap()[preferenceKey(agentType, modelId)]
    if (!preference) return null
    if (preference.agentType !== agentType) return null
    if (preference.modelId !== modelId) return null
    return preference.effort
  } catch {
    return null
  }
}

export function saveReasoningEffortPreference(
  agentType: AgentType,
  modelId: string,
  effort: string,
): void {
  const trimmedEffort = effort.trim()
  const trimmedModelId = modelId.trim()
  if (!trimmedModelId || !trimmedEffort) return

  try {
    persistPreferenceMap({
      ...readPreferenceMap(),
      [preferenceKey(agentType, trimmedModelId)]: {
        agentType,
        modelId: trimmedModelId,
        effort: trimmedEffort,
        savedAt: Date.now(),
      },
    })
  } catch {
    /* noop */
  }
}

export async function clearAllReasoningEffortPreferences(): Promise<void> {
  nativePreferenceMap = {}
  nativeHydrated = true
  if (Platform.OS === 'web') storage.set(REASONING_EFFORT_KEY, '{}')
  else {
    const store = await ensureNativeStorage()
    await store?.setItem(REASONING_EFFORT_KEY, '{}')
  }
}
