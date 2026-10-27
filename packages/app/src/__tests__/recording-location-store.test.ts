// @covers src/features/personal-modules/locationStore.ts
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const fixture = vi.hoisted(() => ({ db: null as any }))
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => fixture.db }))
import { locationStore } from '../features/personal-modules/locationStore'
import { locationDay } from '../features/personal-modules/locationModel'
const db = new DatabaseSync(path.join(mkdtempSync(path.join(tmpdir(), 'location-')), 'test.sqlite'))
const adapter = {
  execAsync: async (sql: string) => {
    db.exec(sql)
  },
  runAsync: async (sql: string, ...params: any[]) => db.prepare(sql).run(...params),
  getFirstAsync: async (sql: string, ...params: any[]) => db.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql: string, ...params: any[]) => db.prepare(sql).all(...params),
  withExclusiveTransactionAsync: async (fn: any) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      await fn(adapter)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  },
}
fixture.db = adapter
afterAll(() => {
  vi.useRealTimers()
  db.close()
})
const now = Date.now(),
  day = locationDay(now)
const sample = (timestamp = Date.now()) => ({
  timestamp,
  latitude: 30,
  longitude: 120,
  accuracy: 5,
  speed: null,
})
describe('real SQLite route persistence', () => {
  it('defaults off and isolates preferences', async () => {
    expect(await locationStore.enabled('alice')).toBe(false)
    await locationStore.preference('alice', true)
    expect(await locationStore.enabled('alice')).toBe(true)
    expect(await locationStore.enabled('bob')).toBe(false)
  })
  it('persists idempotently for the bound account and rejects stale batches', async () => {
    await locationStore.bind('alice', 'a')
    const p = sample(Date.now() + 1)
    await locationStore.append([p, p, sample(now - 60000), { ...p, accuracy: 101 }])
    expect(await locationStore.points('alice', day)).toHaveLength(1)
    expect(await locationStore.points('bob', day)).toEqual([])
    await locationStore.clear()
    expect(await locationStore.append([sample()])).toBe(true)
    expect(await locationStore.points('alice', day)).toHaveLength(1)
  })
  it('deleting a day is tombstoned against late points and preserves another account', async () => {
    await locationStore.deleteDay('alice', day)
    await locationStore.bind('alice', 'a2')
    await locationStore.append([sample(Date.now() + 2)])
    expect(await locationStore.points('alice', day)).toEqual([])
    await locationStore.bind('bob', 'b')
    await locationStore.append([sample(Date.now() + 3)])
    expect(await locationStore.points('bob', day)).toHaveLength(1)
  })
  it('fails closed when audio heartbeat expires, and does not attribute old points to a new session', async () => {
    await locationStore.bind('carol', 'c')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 121000)
    expect(await locationStore.append([sample()])).toBe(true)
    expect(await locationStore.points('carol', day)).toEqual([])
    vi.useRealTimers()
  })
})
