// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-sync.test.ts
import * as SQLite from 'expo-sqlite'
import { diaryStats } from './diaryStats'
import type { DiaryDocument, DiaryEntry, DiaryStore } from './diarySync'
export interface DiaryReplicaStore extends DiaryStore {
  get(scope: string, path: string): Promise<DiaryDocument | null>
  getTarget<T>(): Promise<T | null>
  setTarget(value: unknown): Promise<void>
}
const stores = new Map<string, Promise<DiaryReplicaStore>>()
export function openDiaryStore(namespace: string): Promise<DiaryReplicaStore> {
  const existing = stores.get(namespace)
  if (existing) return existing
  const opening = createDiaryStore(namespace).catch(error => { stores.delete(namespace); throw error })
  stores.set(namespace, opening)
  return opening
}
async function createDiaryStore(namespace: string): Promise<DiaryReplicaStore> {
  const db = await SQLite.openDatabaseAsync(`diary-${encodeURIComponent(namespace)}.sqlite`)
  await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS diary(scope TEXT NOT NULL,path TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,path)); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL);')
  // Backfill existing replicas once without downloading unchanged diaries again.
  while (true) {
    const rows = await db.getAllAsync<{ scope: string; path: string; payload: string }>("SELECT scope,path,payload FROM diary WHERE json_type(payload, '$.photoCount') IS NULL LIMIT 30")
    if (!rows.length) break
    for (const row of rows) {
      const document = JSON.parse(row.payload) as DiaryDocument
      await db.runAsync('UPDATE diary SET payload=? WHERE scope=? AND path=?', JSON.stringify({ ...document, ...diaryStats(document.content) }), row.scope, row.path)
    }
  }
  let tail: Promise<unknown> = Promise.resolve()
  const write = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task); tail = result.catch(() => {}); return result
  }
  return {
    list: async scope => { await tail; return (await db.getAllAsync<{ payload: string }>("SELECT json_remove(payload, '$.content') AS payload FROM diary WHERE scope=? ORDER BY path DESC", scope)).map(r => JSON.parse(r.payload) as DiaryEntry) },
    get: async (scope, path) => { await tail; const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM diary WHERE scope=? AND path=?', scope, path); return row ? JSON.parse(row.payload) as DiaryDocument : null },
    put: (scope, document) => write(async () => { await db.runAsync('INSERT OR REPLACE INTO diary VALUES(?,?,?)', scope, document.path, JSON.stringify({ ...document, ...diaryStats(document.content) })) }),
    retain: (scope, paths) => write(async () => {
      const keep = new Set(paths)
      await db.withExclusiveTransactionAsync(async tx => {
        for (const row of await tx.getAllAsync<{ path: string }>('SELECT path FROM diary WHERE scope=?', scope)) {
          if (!keep.has(row.path)) await tx.runAsync('DELETE FROM diary WHERE scope=? AND path=?', scope, row.path)
        }
      })
    }),
    getTarget: async <T>() => { await tail; const row = await db.getFirstAsync<{ payload: string }>("SELECT payload FROM settings WHERE key='target'"); return row ? JSON.parse(row.payload) as T : null },
    setTarget: value => write(async () => { await db.runAsync("INSERT OR REPLACE INTO settings VALUES('target',?)", JSON.stringify(value)) }),
  }
}
