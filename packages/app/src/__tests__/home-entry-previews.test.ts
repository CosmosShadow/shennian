// @arch docs/architecture/mobile-navigation.md
// @covers src/features/mobile-navigation/homeEntryPreviews.ts
// @covers src/features/personal-modules/localStore.ts
import { createRequire } from 'node:module'
// Node 22+ can exercise the native query with real SQLite; older Node runners retain the pure preview coverage.
const DatabaseSync = (() => { try { return createRequire(import.meta.url)('node:sqlite').DatabaseSync } catch { return null } })()
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Reminder } from '../features/personal-modules/types'
import { diaryHomePreview, folderHomePreview, homePreviewTime, scheduleHomePreview } from '../features/mobile-navigation/homeEntryPreviews'
const fixture = vi.hoisted(() => ({ db: null as any }))
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({
  execAsync: async (sql: string) => fixture.db!.exec(sql),
  runAsync: async (sql: string, ...values: any[]) => fixture.db!.prepare(sql).run(...values),
  getAllAsync: async (sql: string, ...values: any[]) => fixture.db!.prepare(sql).all(...values),
  getFirstAsync: async (sql: string, ...values: any[]) => fixture.db!.prepare(sql).get(...values),
}) }))
vi.mock('../features/personal-modules/locationStore', () => ({ locationStore: {} }))
vi.mock('../config/api', () => ({ getApiBaseUrl: () => 'https://unit.invalid/api' }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: 'unit-preview' } }) } }))
import { PersonalModuleStore } from '../features/personal-modules/localStore'
beforeEach(() => { if (DatabaseSync) fixture.db = new DatabaseSync(':memory:') })
afterEach(() => { fixture.db?.close(); fixture.db = null })
it.skipIf(!DatabaseSync)('selects the latest saved transcript across local segments and remote-day caches without deleted, feedback or empty entries', async () => {
  const store = await PersonalModuleStore.open('unit-preview')
  const segment = (key: string, day: string, text: string, revision = 1) => ({ key, day, text, startAt: `${day}T10:00:00Z`, endAt: `${day}T10:00:10Z`, sessionKey: 'session', revision, timezone: 'UTC', kind: 'transcript' })
  await store.saveValue('transcript', 'old', segment('old', '2026-10-23', 'old text'))
  await store.cache('day:2026-10-24', [segment('latest', '2026-10-24', 'cached text'), segment('latest', '2026-10-24', 'revised text', 2)])
  await store.saveValue('transcript', 'deleted', segment('deleted', '2026-10-25', 'deleted text'))
  fixture.db!.prepare('INSERT INTO deleted_days VALUES(?)').run('2026-10-25')
  await store.cache('day:2026-10-26', [{ ...segment('feedback', '2026-10-26', 'assistant feedback'), kind: 'recording-feedback' }, segment('empty', '2026-10-26', '  ')])
  expect(await store.latestTranscript()).toMatchObject({ key: 'latest', text: 'revised text', revision: 2 })
})
it('uses the nearest active schedule rather than a deleted or completed event', () => {
  const reminder = (key: string, state: string, dueAt: string): Reminder => ({ key, state, dueAt, revision: 1, payload: { content: key, when: dueAt, timezone: 'UTC' } })
  const items = [reminder('later', 'active', '2026-11-01T10:00:00Z'), reminder('done', 'completed', '2026-10-20T10:00:00Z'), reminder('next', 'active', '2026-10-26T10:00:00Z'), reminder('gone', 'deleted', '2026-10-19T10:00:00Z')]
  expect(scheduleHomePreview(items)).toMatchObject({ text: 'next', at: '2026-10-26T10:00:00.000Z' })
  expect(items[0].key).toBe('later')
  expect(scheduleHomePreview(items.filter(item => item.state !== 'active'))).toBeNull()
})
it('uses the latest diary summary, and does not invent a timestamp for a date-only entry', () => {
  const result = diaryHomePreview([
    { path: '2026/2026-10-23.md', date: '2026-10-23', revision: 'a', title: 'old' },
    { path: '2026/2026-10-25.md', date: '2026-10-25', revision: 'b', title: '2026-10-25 New diary', summary: 'Actual latest summary' },
  ])!
  expect(result).toEqual({ text: 'Actual latest summary', at: '2026-10-25' })
  expect(homePreviewTime(result.at, 'en')).not.toContain(':')
  expect(homePreviewTime('invalid', 'en')).toBe('')
})
it('previews the most recently added folder and its actual computer without exposing a full path', () => {
  expect(folderHomePreview([{ machineId: 'a', path: '/private/first' }, { machineId: 'b', path: '/private/work' }], id => id === 'b' ? 'My computer' : undefined)).toEqual({ text: 'My computer · work' })
  expect(folderHomePreview([], () => undefined)).toBeNull()
})
