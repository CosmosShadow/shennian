// @arch docs/architecture/launch-config.md
// @test src/__tests__/launch-storage.test.ts

import { Platform } from 'react-native'
import { collectMapped, isRecord } from './runtimeValues'
import { normalizeModelId } from './models'
import type { AgentType, SessionMode } from '@shennian/wire'

export type LastLaunchConfig = {
  agentType: AgentType
  workDir: string
  modelId?: string | null
  sessionMode?: SessionMode
  modelPreferences?: Partial<Record<AgentType, string | null>>
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
}

const LAST_LAUNCH_KEY = 'shennian:lastLaunch'
const RECENT_MODELS_KEY = 'shennian:recentLaunchModels'
const MAX_RECENT_MODELS = 3

type LaunchStorageMap = Record<string, LastLaunchConfig>
type RecentModelsMap = Partial<Record<AgentType, string[]>>

type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

function parseLaunchMap(raw: string | null): LaunchStorageMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(collectMapped(Object.entries(parsed), ([key, entry]) => {
      if (!isRecord(entry) || typeof entry.agentType !== 'string' || !entry.agentType || typeof entry.workDir !== 'string') return []
      const config: LastLaunchConfig = { agentType: entry.agentType as AgentType, workDir: entry.workDir }
      if (entry.modelId === null) config.modelId = null
      else config.modelId = normalizeModelId(entry.modelId)
      if (entry.sessionMode === 'standard' || entry.sessionMode === 'manager') config.sessionMode = entry.sessionMode
      if (isRecord(entry.modelPreferences)) config.modelPreferences = Object.fromEntries(
        collectMapped(Object.entries(entry.modelPreferences), ([agent, model]) =>
          model === null || typeof model === 'string' ? [[agent, model]] : []),
      )
      if (entry.managerDefaultWorkerAgentType === null || typeof entry.managerDefaultWorkerAgentType === 'string') {
        config.managerDefaultWorkerAgentType = entry.managerDefaultWorkerAgentType as AgentType | null
      }
      if (entry.managerDefaultWorkerModelId === null) config.managerDefaultWorkerModelId = null
      else config.managerDefaultWorkerModelId = normalizeModelId(entry.managerDefaultWorkerModelId)
      return [[key, config]]
    }))
  } catch {
    return {}
  }
}

function parseRecentModelsMap(raw: string | null): RecentModelsMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as RecentModelsMap
    return Object.fromEntries(
      Object.entries(parsed).map(([agentType, ids]) => [
        agentType,
        Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_MODELS)
          : [],
      ]),
    ) as RecentModelsMap
  } catch {
    return {}
  }
}

function getLaunchStorage(): {
  get(key: string): string | null
  set(key: string, v: string): void
} {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
    }
  }
  const store: Record<string, string> = {}
  return {
    get: (k) => store[k] ?? null,
    set: (k, v) => {
      store[k] = v
    },
  }
}

const storage = getLaunchStorage()
let nativeStorage: NativeStorage | null = null
let nativeLaunchMap: LaunchStorageMap = {}
let nativeRecentModelsMap: RecentModelsMap = {}
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

function readLaunchMap(): LaunchStorageMap {
  if (Platform.OS !== 'web') return nativeLaunchMap
  return parseLaunchMap(storage.get(LAST_LAUNCH_KEY))
}

function persistLaunchMap(map: LaunchStorageMap): void {
  const raw = JSON.stringify(map)
  if (Platform.OS === 'web') {
    storage.set(LAST_LAUNCH_KEY, raw)
    return
  }
  nativeLaunchMap = map
  nativeHydrated = true
  const store = getNativeStorage()
  if (!store) return
  void store.setItem(LAST_LAUNCH_KEY, raw).catch(() => {})
}

function readRecentModelsMap(): RecentModelsMap {
  if (Platform.OS !== 'web') return nativeRecentModelsMap
  return parseRecentModelsMap(storage.get(RECENT_MODELS_KEY))
}

function persistRecentModelsMap(map: RecentModelsMap): void {
  const raw = JSON.stringify(map)
  if (Platform.OS === 'web') {
    storage.set(RECENT_MODELS_KEY, raw)
    return
  }
  nativeRecentModelsMap = map
  const store = getNativeStorage()
  if (!store) return
  void store.setItem(RECENT_MODELS_KEY, raw).catch(() => {})
}

export async function hydrateLaunchStorage(): Promise<void> {
  if (Platform.OS === 'web' || nativeHydrated) return
  if (nativeHydration) return nativeHydration

  nativeHydration = (async () => {
    const store = await ensureNativeStorage()
    if (!store) {
      nativeLaunchMap = {}
      nativeHydrated = true
      return
    }
    const [raw, recentRaw] = await Promise.all([
      store.getItem(LAST_LAUNCH_KEY).catch(() => null),
      store.getItem(RECENT_MODELS_KEY).catch(() => null),
    ])
    nativeLaunchMap = parseLaunchMap(raw)
    nativeRecentModelsMap = parseRecentModelsMap(recentRaw)
    nativeHydrated = true
  })().finally(() => {
    nativeHydration = null
  })

  return nativeHydration
}

export function getLastLaunch(machineId: string): LastLaunchConfig | null {
  try {
    const map = readLaunchMap()
    return map[machineId] ?? null
  } catch {
    return null
  }
}

export function saveLastLaunch(machineId: string, config: LastLaunchConfig): void {
  try {
    const map = readLaunchMap()
    const previous = map[machineId]
    const modelPreferences = {
      ...(previous?.modelPreferences ?? {}),
      ...(config.modelPreferences ?? {}),
    }
    if (config.modelId !== undefined) {
      modelPreferences[config.agentType] = config.modelId ?? null
    }
    persistLaunchMap({
      ...map,
      [machineId]: { ...previous, ...config, modelPreferences },
    })
  } catch {
    /* noop */
  }
}

export function getLastPreferredModel(machineId: string, agentType: AgentType): string | null {
  const config = getLastLaunch(machineId)
  return config?.modelPreferences?.[agentType] ?? null
}

export function getRecentLaunchModels(
  agentType: AgentType,
  availableModelIds?: string[],
): string[] {
  const recent = readRecentModelsMap()[agentType] ?? []
  if (!availableModelIds) return recent
  const available = new Set(availableModelIds)
  return recent.filter((id) => available.has(id))
}

export function recordRecentLaunchModel(
  agentType: AgentType,
  modelId: string,
  defaultModelId?: string,
): string[] {
  const map = readRecentModelsMap()
  const previous = map[agentType] ?? []
  const next =
    modelId === defaultModelId
      ? previous.filter((id) => id !== modelId)
      : [modelId, ...previous.filter((id) => id !== modelId)].slice(0, MAX_RECENT_MODELS)
  persistRecentModelsMap({ ...map, [agentType]: next })
  return next
}
