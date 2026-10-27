// @covers src/storage/personal-session-body-store.native.ts
import { createRequire } from 'node:module'
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
import { expect, it } from 'vitest'
import { createPersonalSessionBodyStore } from '../storage/personal-session-body-store.native'
it('bounds a tool-heavy native window in real SQLite and expands without skipping older records', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(`CREATE TABLE personal_session_body_state (
      accountId TEXT, sessionId TEXT, cachedBodyRevision INTEGER, firstCachedSeq INTEGER,
      lastCachedSeq INTEGER, hasOlder INTEGER, lastSyncedAt TEXT, lastAccessedAt TEXT,
      deletionRevision INTEGER, deleted INTEGER);
      CREATE TABLE personal_session_messages (accountId TEXT, sessionId TEXT, messageId TEXT,
        sequence INTEGER, role TEXT, ts INTEGER, payload TEXT, deliveryState TEXT);`)
    const insert = sqlite.prepare('INSERT INTO personal_session_messages VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
    for (let n = 1; n <= 1200; n++) insert.run('owner', 'session', `m-${n}`, n, n === 1 ? 'user' : 'agent', n, 'tool body')
    const db = {
      getFirstAsync: async (sql: string, ...params: any[]) => sqlite.prepare(sql).get(...params) ?? null,
      getAllAsync: async (sql: string, ...params: any[]) => sqlite.prepare(sql).all(...params),
    }
    const store = createPersonalSessionBodyStore(async () => db as never)
    const first = await store.getMessagesByUserTurns('owner', 'session', { turnLimit: 30, messageLimit: 300 })
    expect(first).toHaveLength(300)
    expect(first[0].localSequence).toBe(901)
    expect(first[299].localSequence).toBe(1200)
    const expanded = await store.getMessagesByUserTurns('owner', 'session', { turnLimit: 50, messageLimit: 500 })
    expect(expanded).toHaveLength(500)
    expect(expanded.slice(-300)).toEqual(first)
    const older = await store.getMessagesByUserTurns('owner', 'session', { turnLimit: 30, beforeSequence: 901, messageLimit: 300 })
    expect(older[0].localSequence).toBe(601)
    expect(older[299].localSequence).toBe(900)
    expect(await store.getMessagesByUserTurns('owner', 'session', { turnLimit: 30 })).toHaveLength(1200)
    await expect(store.getMessagesByUserTurns('owner', 'session', { turnLimit: 30, messageLimit: 0 })).rejects.toThrow('messageLimit must be positive')
  } finally { sqlite.close() }
})
