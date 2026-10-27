// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StewardPreferences, StewardSwitchMark } from './stewardModel'

const PREFIX = 'shennian:steward:v1:'
const MARKS_PREFIX = 'shennian:steward:switches:v1:'
/** Enough to cover any conversation a user actually scrolls back through. */
const MAX_MARKS = 80

function key(accountId: string): string {
  return `${PREFIX}${accountId}`
}

function marksKey(accountId: string): string {
  return `${MARKS_PREFIX}${accountId}`
}

function clean(value: unknown): StewardPreferences {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const text = (item: unknown) => (typeof item === 'string' && item.length <= 191 ? item : undefined)
  const flag = (item: unknown) => (typeof item === 'boolean' ? item : undefined)
  return {
    machineId: text(record.machineId),
    agentType: text(record.agentType),
    modelId: text(record.modelId),
    sessionId: text(record.sessionId),
    showModel: flag(record.showModel),
    showEffort: flag(record.showEffort),
    showMachineName: flag(record.showMachineName),
  }
}

/** Per-account, per-device choices: which machine, which AI, which conversation is open. */
export async function readStewardPreferences(accountId: string): Promise<StewardPreferences> {
  if (!accountId) return {}
  try {
    const raw = await AsyncStorage.getItem(key(accountId))
    return raw ? clean(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export async function writeStewardPreferences(
  accountId: string,
  changes: StewardPreferences,
  strict = false,
): Promise<StewardPreferences> {
  if (!accountId) {
    if (strict) throw new Error('steward_account_missing')
    return {}
  }
  const next = { ...(await readStewardPreferences(accountId)), ...changes }
  try {
    await AsyncStorage.setItem(key(accountId), JSON.stringify(next))
  } catch (error) {
    if (strict) throw error
    // Preferences are a convenience; the steward still works without them.
  }
  return next
}

export async function clearStewardPreferences(accountId: string): Promise<void> {
  if (!accountId) return
  try { await AsyncStorage.removeItem(key(accountId)) } catch { /* nothing to clear */ }
  try { await AsyncStorage.removeItem(marksKey(accountId)) } catch { /* nothing to clear */ }
}

function cleanMark(value: unknown): StewardSwitchMark | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  const ts = typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : 0
  if (!sessionId || !ts) return undefined
  return {
    sessionId,
    ts,
    ...(typeof record.agentType === 'string' ? { agentType: record.agentType } : {}),
    ...(typeof record.modelId === 'string' ? { modelId: record.modelId } : {}),
    ...(record.defaultModel === true ? { defaultModel: true as const } : {}),
  }
}

/** Tool/model switches made inside steward conversations, on this device only. */
export async function readStewardSwitchMarks(accountId: string): Promise<StewardSwitchMark[]> {
  if (!accountId) return []
  try {
    const raw = await AsyncStorage.getItem(marksKey(accountId))
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map(cleanMark).filter((mark): mark is StewardSwitchMark => Boolean(mark))
  } catch {
    return []
  }
}

export async function appendStewardSwitchMark(
  accountId: string,
  mark: StewardSwitchMark,
): Promise<StewardSwitchMark[]> {
  if (!accountId) return []
  const next = [...(await readStewardSwitchMarks(accountId)), mark].slice(-MAX_MARKS)
  try {
    await AsyncStorage.setItem(marksKey(accountId), JSON.stringify(next))
  } catch {
    // The rule is a courtesy; losing it never affects the conversation itself.
  }
  return next
}

/** Drops the marks of conversations that no longer exist (cleared history, deleted one). */
export async function pruneStewardSwitchMarks(
  accountId: string,
  keepSessionIds: readonly string[],
): Promise<StewardSwitchMark[]> {
  if (!accountId) return []
  const keep = new Set(keepSessionIds)
  const next = (await readStewardSwitchMarks(accountId)).filter((mark) => keep.has(mark.sessionId))
  try {
    await AsyncStorage.setItem(marksKey(accountId), JSON.stringify(next))
  } catch {
    // Nothing to prune if the store is unavailable.
  }
  return next
}
