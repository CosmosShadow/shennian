// @arch docs/features/project-coordination.md
// @test src/__tests__/project-coordination-local-state.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  projectCoordinationRequest,
  type CoordinationSnapshot,
  type CoordinationTask,
} from './client'

/**
 * The phone keeps the last readable coordination snapshot per account,
 * machine and project. It is display state only: every command still goes to
 * the Client that owns the queue.
 */
export const COORDINATION_REFRESH_MS = 30_000

const STORAGE_PREFIX = 'shennian:project-coordination:v1:'
const STORAGE_VERSION = 1
const MAX_PERSISTED_MESSAGES = 60
const MAX_PERSISTED_RECENT = 50

export type CoordinationIdentity = {
  accountId: string
  machineId: string
  workDir: string
}

export type CoordinationEntry = {
  snapshot: CoordinationSnapshot | null
  savedAt: number
  error: string
}

const EMPTY_ENTRY: CoordinationEntry = Object.freeze({ snapshot: null, savedAt: 0, error: '' })
const entries = new Map<string, CoordinationEntry>()
const listeners = new Map<string, Set<() => void>>()
const hydrating = new Map<string, Promise<void>>()
const hydrated = new Set<string>()
const refreshing = new Map<string, Promise<CoordinationSnapshot>>()

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function task(value: unknown): CoordinationTask | null {
  const item = record(value)
  if (!item) return null
  if (
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.status !== 'string' ||
    typeof item.agentType !== 'string' ||
    typeof item.priority !== 'number'
  ) {
    return null
  }
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    agentType: item.agentType,
    priority: item.priority,
    ...(typeof item.waitingReason === 'string' ? { waitingReason: item.waitingReason } : {}),
    ...(typeof item.result === 'string' ? { result: item.result } : {}),
  }
}

function message(value: unknown): CoordinationSnapshot['messages'][number] | null {
  const item = record(value)
  if (!item) return null
  if (
    typeof item.id !== 'string' ||
    (item.role !== 'user' && item.role !== 'agent') ||
    typeof item.text !== 'string' ||
    typeof item.at !== 'number'
  ) {
    return null
  }
  return { id: item.id, role: item.role, text: item.text, at: item.at }
}

function recent(value: unknown): NonNullable<CoordinationSnapshot['recent']>[number] | null {
  const item = record(value)
  if (!item) return null
  if (
    typeof item.sequence !== 'number' ||
    typeof item.at !== 'number' ||
    typeof item.kind !== 'string'
  ) {
    return null
  }
  return { sequence: item.sequence, at: item.at, kind: item.kind }
}

function cleanSnapshot(value: unknown): CoordinationSnapshot | null {
  const item = record(value)
  if (!item) return null
  if (
    typeof item.enabled !== 'boolean' ||
    typeof item.paused !== 'boolean' ||
    (item.mode !== 'serial' &&
      item.mode !== 'research_parallel' &&
      item.mode !== 'parallel') ||
    typeof item.automatic !== 'boolean' ||
    typeof item.instructionRevision !== 'number' ||
    typeof item.instructions !== 'string' ||
    typeof item.revision !== 'number' ||
    typeof item.managerBusy !== 'boolean' ||
    !Array.isArray(item.tasks) ||
    !Array.isArray(item.messages)
  ) {
    return null
  }
  return {
    enabled: item.enabled,
    paused: item.paused,
    mode: item.mode,
    automatic: item.automatic,
    instructionRevision: item.instructionRevision,
    instructions: item.instructions,
    revision: item.revision,
    tasks: item.tasks.map(task).filter((value): value is CoordinationTask => Boolean(value)),
    messages: item.messages
      .map(message)
      .filter((value): value is CoordinationSnapshot['messages'][number] => Boolean(value)),
    managerBusy: item.managerBusy,
    ...(typeof item.managerError === 'string' ? { managerError: item.managerError } : {}),
    ...(Array.isArray(item.recent)
      ? {
          recent: item.recent
            .map(recent)
            .filter((value): value is NonNullable<CoordinationSnapshot['recent']>[number] =>
              Boolean(value),
            ),
        }
      : {}),
  }
}

/** Keep a bounded readable copy without changing the live in-memory snapshot. */
function compactSnapshot(snapshot: CoordinationSnapshot): CoordinationSnapshot {
  return {
    ...snapshot,
    messages: Array.isArray(snapshot.messages)
      ? snapshot.messages.slice(-MAX_PERSISTED_MESSAGES)
      : [],
    ...(Array.isArray(snapshot.recent)
      ? { recent: snapshot.recent.slice(-MAX_PERSISTED_RECENT) }
      : {}),
  }
}

function emit(key: string): void {
  const set = listeners.get(key)
  if (set) for (const listener of set) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'coordination_unavailable'
}

export function coordinationIdentityKey(identity: CoordinationIdentity): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(identity.accountId)}:${encodeURIComponent(identity.machineId)}:${encodeURIComponent(identity.workDir)}`
}

export function coordinationEntry(key: string): CoordinationEntry {
  return entries.get(key) ?? EMPTY_ENTRY
}

export function subscribeCoordination(key: string, listener: () => void): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(key)
    if (!current) return
    current.delete(listener)
    if (!current.size) listeners.delete(key)
  }
}

/** Returns true when the caller should read the Client again. */
export function needsCoordinationRefresh(
  key: string,
  now = Date.now(),
  maxAgeMs = COORDINATION_REFRESH_MS,
): boolean {
  const entry = entries.get(key)
  return !entry?.snapshot || now - entry.savedAt >= maxAgeMs
}

export function rememberCoordination(
  key: string,
  snapshot: CoordinationSnapshot,
  savedAt = Date.now(),
): CoordinationEntry {
  const previous = entries.get(key)
  if (
    previous?.snapshot &&
    Number.isFinite(previous.snapshot.revision) &&
    Number.isFinite(snapshot.revision) &&
    snapshot.revision < previous.snapshot.revision
  ) {
    return previous
  }
  const next: CoordinationEntry = {
    snapshot: snapshot.recent
      ? snapshot
      : previous?.snapshot?.recent
        ? { ...snapshot, recent: previous.snapshot.recent }
        : snapshot,
    savedAt,
    error: '',
  }
  entries.set(key, next)
  emit(key)
  if (next.snapshot) {
    void AsyncStorage.setItem(
      key,
      JSON.stringify({ version: STORAGE_VERSION, savedAt, snapshot: compactSnapshot(next.snapshot) }),
    ).catch(() => {
      // A cache write is a convenience. The live Client state remains authoritative.
    })
  }
  return next
}

export function reportCoordinationError(
  key: string,
  error: unknown,
  startedAt = Date.now(),
): CoordinationEntry {
  const previous = entries.get(key) ?? EMPTY_ENTRY
  // A newer successful read (or a successful mutation) already corrected the UI.
  if (previous.savedAt > startedAt) return previous
  const message = errorMessage(error)
  if (previous.error === message) return previous
  const next = { ...previous, error: message }
  entries.set(key, next)
  emit(key)
  return next
}

/** Restore the persisted snapshot once per key; never overwrite live memory with disk. */
export function hydrateCoordination(key: string): Promise<void> {
  const running = hydrating.get(key)
  if (running) return running
  if (entries.get(key)?.snapshot || hydrated.has(key)) return Promise.resolve()
  const promise = (async () => {
    if (entries.get(key)?.snapshot) return
    let raw: string | null = null
    try {
      raw = await AsyncStorage.getItem(key)
    } catch {
      return
    }
    if (!raw) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const stored = record(parsed)
    if (!stored || stored.version !== STORAGE_VERSION || typeof stored.savedAt !== 'number') return
    const snapshot = cleanSnapshot(stored.snapshot)
    if (!snapshot) return
    const current = entries.get(key)
    if (current?.snapshot) return
    entries.set(key, {
      snapshot: compactSnapshot(snapshot),
      savedAt: stored.savedAt,
      error: current?.error ?? '',
    })
    emit(key)
  })()
  hydrating.set(key, promise)
  void promise.then(
    () => {
      hydrated.add(key)
      if (hydrating.get(key) === promise) hydrating.delete(key)
    },
    () => {
      hydrated.add(key)
      if (hydrating.get(key) === promise) hydrating.delete(key)
    },
  )
  return promise
}

/** Read the Client and share the result with every visible project surface. */
export function refreshCoordination(identity: CoordinationIdentity): Promise<CoordinationSnapshot> {
  const key = coordinationIdentityKey(identity)
  const running = refreshing.get(key)
  if (running) return running
  const startedAt = Date.now()
  const promise = Promise.resolve()
    .then(() => projectCoordinationRequest(identity.machineId, identity.workDir, { command: 'get' }))
    .then((snapshot) => {
      rememberCoordination(key, snapshot)
      return snapshot
    })
    .catch((error: unknown) => {
      reportCoordinationError(key, error, startedAt)
      throw error
    })
    .finally(() => {
      if (refreshing.get(key) === promise) refreshing.delete(key)
    })
  refreshing.set(key, promise)
  return promise
}

/** Drop one project's local record (for example after removing the project). */
export function clearCoordinationCache(key: string): void {
  entries.delete(key)
  hydrated.delete(key)
  emit(key)
  void AsyncStorage.removeItem(key).catch(() => {})
}

/** Logout/account switch must not leave another account's project copy on disk. */
export async function clearCoordinationAccountCache(accountId: string): Promise<void> {
  if (!accountId) return
  const prefix = `${STORAGE_PREFIX}${encodeURIComponent(accountId)}:`
  for (const key of [...entries.keys()]) {
    if (!key.startsWith(prefix)) continue
    entries.delete(key)
    hydrated.delete(key)
    emit(key)
  }
  try {
    const keys = await AsyncStorage.getAllKeys()
    const owned = keys.filter((key) => key.startsWith(prefix))
    if (owned.length) await AsyncStorage.multiRemove(owned)
  } catch {
    // Account-scoped keys keep a stale copy unreadable by the next account.
  }
}
