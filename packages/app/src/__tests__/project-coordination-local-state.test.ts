// @covers packages/app/src/features/projects/coordination/localState.ts
import { beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, string>())
const request = vi.hoisted(() => vi.fn())
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key) }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach(key => storage.delete(key)) }),
  },
}))
vi.mock('../features/projects/coordination/client', () => ({ projectCoordinationRequest: request }))

import type { CoordinationSnapshot } from '../features/projects/coordination/client'
import {
  clearCoordinationAccountCache,
  clearCoordinationCache,
  coordinationEntry,
  coordinationIdentityKey,
  hydrateCoordination,
  needsCoordinationRefresh,
  refreshCoordination,
  rememberCoordination,
  COORDINATION_REFRESH_MS,
} from '../features/projects/coordination/localState'

function snapshot(overrides: Partial<CoordinationSnapshot> = {}): CoordinationSnapshot {
  return {
    enabled: true,
    paused: false,
    mode: 'serial',
    automatic: true,
    instructionRevision: 0,
    instructions: '',
    revision: 1,
    tasks: [],
    messages: [],
    managerBusy: false,
    ...overrides,
  }
}

function identity(accountId: string, machineId: string, workDir: string) {
  return { accountId, machineId, workDir }
}

beforeEach(() => {
  storage.clear()
  request.mockReset()
})

it('restores a persisted snapshot but bounds the cached message history', async () => {
  const item = identity('restore', 'machine', '/project')
  const key = coordinationIdentityKey(item)
  const messages = Array.from({ length: 80 }, (_, index) => ({
    id: `message-${index}`, role: 'user' as const, text: `text-${index}`, at: index,
  }))
  storage.set(key, JSON.stringify({
    version: 1,
    savedAt: 123,
    snapshot: { ...snapshot({ enabled: true }), messages, recent: Array.from({ length: 60 }, (_, index) => ({ sequence: index, at: index, kind: 'enqueue' })) },
  }))

  await hydrateCoordination(key)

  const entry = coordinationEntry(key)
  expect(entry.snapshot?.enabled).toBe(true)
  expect(entry.savedAt).toBe(123)
  expect(entry.snapshot?.messages).toHaveLength(60)
  expect(entry.snapshot?.messages[0]?.id).toBe('message-20')
  expect(entry.snapshot?.recent).toHaveLength(50)
})

it('ignores corrupt or incomplete local records', async () => {
  const corrupt = coordinationIdentityKey(identity('corrupt', 'machine', '/project'))
  storage.set(corrupt, '{not-json')
  await hydrateCoordination(corrupt)
  expect(coordinationEntry(corrupt).snapshot).toBeNull()

  const incomplete = coordinationIdentityKey(identity('incomplete', 'machine', '/project'))
  storage.set(incomplete, JSON.stringify({ version: 1, savedAt: 1, snapshot: { enabled: true } }))
  await hydrateCoordination(incomplete)
  expect(coordinationEntry(incomplete).snapshot).toBeNull()
})

it('keeps a newer revision and marks the local record stale after the refresh window', () => {
  const item = identity('revision', 'machine', '/project')
  const key = coordinationIdentityKey(item)
  const now = 1_000_000
  rememberCoordination(key, snapshot({ revision: 5 }), now)
  rememberCoordination(key, snapshot({ revision: 4, enabled: false }), now + 1)

  expect(coordinationEntry(key).snapshot?.revision).toBe(5)
  expect(coordinationEntry(key).snapshot?.enabled).toBe(true)
  expect(needsCoordinationRefresh(key, now + COORDINATION_REFRESH_MS - 1)).toBe(false)
  expect(needsCoordinationRefresh(key, now + COORDINATION_REFRESH_MS)).toBe(true)
})

it('shares one Client read between visible project surfaces', async () => {
  const item = identity('dedupe', 'machine', '/project')
  const key = coordinationIdentityKey(item)
  let resolve!: (value: CoordinationSnapshot) => void
  request.mockReturnValueOnce(new Promise<CoordinationSnapshot>((done) => { resolve = done }))

  const first = refreshCoordination(item)
  const second = refreshCoordination(item)
  expect(first).toBe(second)
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))

  resolve(snapshot({ enabled: true, revision: 9 }))
  await expect(first).resolves.toMatchObject({ revision: 9 })
  expect(coordinationEntry(key).snapshot?.revision).toBe(9)
  expect(coordinationEntry(key).error).toBe('')
})

it('retains the local snapshot while reporting a failed read', async () => {
  const item = identity('failure', 'machine', '/project')
  const key = coordinationIdentityKey(item)
  rememberCoordination(key, snapshot({ enabled: true, revision: 3 }))
  request.mockRejectedValueOnce(new Error('coordination_machine_offline'))

  await expect(refreshCoordination(item)).rejects.toThrow('coordination_machine_offline')

  expect(coordinationEntry(key).snapshot?.enabled).toBe(true)
  expect(coordinationEntry(key).error).toBe('coordination_machine_offline')
})

it('drops one account locally without touching another account', async () => {
  const first = identity('account-a', 'machine', '/project')
  const second = identity('account-b', 'machine', '/project')
  const firstKey = coordinationIdentityKey(first)
  const secondKey = coordinationIdentityKey(second)
  rememberCoordination(firstKey, snapshot({ enabled: true }))
  rememberCoordination(secondKey, snapshot({ enabled: false }))
  await vi.waitFor(() => expect(storage.size).toBe(2))

  await clearCoordinationAccountCache('account-a')

  expect(coordinationEntry(firstKey).snapshot).toBeNull()
  expect(storage.has(firstKey)).toBe(false)
  expect(coordinationEntry(secondKey).snapshot?.enabled).toBe(false)
  expect(storage.has(secondKey)).toBe(true)

  clearCoordinationCache(secondKey)
  expect(coordinationEntry(secondKey).snapshot).toBeNull()
})
