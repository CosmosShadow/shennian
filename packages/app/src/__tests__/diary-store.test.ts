// @covers packages/app/src/features/personal-workspace/diaryStore.ts
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('react-native-markdown-display', () => ({ MarkdownIt: createRequire(import.meta.url)('markdown-it') }))
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: state.open }))
import { openDiaryStore } from '../features/personal-workspace/diaryStore'
type Database = { close(): void; exec(sql: string): void; prepare(sql: string): { run(...args: (string | number)[]): unknown; get(...args: (string | number)[]): unknown; all(...args: (string | number)[]): unknown[] } }
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (filename: string) => Database }
const roots: string[] = [], databases: InstanceType<typeof DatabaseSync>[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
it('durably restores a scoped replica, queries one body, and only deletes the explicitly reconciled scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diary-sqlite-')); roots.push(root)
  state.open.mockImplementation(async (filename: string) => {
    const db = new DatabaseSync(path.join(root, filename)); databases.push(db)
    const api = {
      execAsync: async (sql: string) => { db.exec(sql) },
      runAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).run(...args),
      getFirstAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args),
      getAllAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args),
      withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => { db.exec('BEGIN'); try { await fn(api); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } },
    }
    return api
  })
  const store = await openDiaryStore('alice'), doc = { path: '2026/2026-10-23.md', revision: 'v1', content: '正文', title: 'Today' }
  await Promise.all([store.put('mac/1', doc), store.put('mac/1', { ...doc, path: '2026/2026-10-22.md' }), store.put('pc/2', doc)])
  await store.setTarget({ machine: { id: 'mac' }, revision: 1 })
  // Simulate a replica written by the previous App (no derived statistics).
  databases[0].prepare('UPDATE diary SET payload=? WHERE scope=? AND path=?').run(JSON.stringify(doc), 'mac/1', doc.path)
  vi.resetModules()
  const { openDiaryStore: reopen } = await import('../features/personal-workspace/diaryStore')
  const restored = await reopen('alice')
  expect(await restored.get('mac/1', doc.path)).toEqual({ ...doc, characterCount: 2, photoCount: 0 })
  expect(await restored.list('mac/1')).toEqual([{ path: doc.path, revision: 'v1', title: 'Today', characterCount: 2, photoCount: 0 }, { path: '2026/2026-10-22.md', revision: 'v1', title: 'Today', characterCount: 2, photoCount: 0 }])
  expect(await restored.getTarget()).toEqual({ machine: { id: 'mac' }, revision: 1 })
  await restored.retain('mac/1', [doc.path])
  expect(await restored.get('mac/1', '2026/2026-10-22.md')).toBeNull()
  expect(await restored.get('pc/2', doc.path)).toEqual({ ...doc, characterCount: 2, photoCount: 0 })
  expect(await (await openDiaryStore('bob')).list('mac/1')).toEqual([])
  await restored.setTarget(null); expect(await restored.getTarget()).toBeNull()
})
