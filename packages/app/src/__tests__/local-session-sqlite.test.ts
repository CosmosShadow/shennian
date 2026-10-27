// @covers packages/app/src/storage/db.native.ts
// Unit test: run the native store SQL against SQLite, not an in-memory session-store imitation.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'
import { buildLocalSessionDraft } from '../features/sessions/localSessionDraft'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-sqlite', async () => {
  const sqliteModule = 'node:sqlite'
  const { DatabaseSync } = await import(sqliteModule)
  const connection = new DatabaseSync(':memory:')
  return { openDatabaseAsync: async () => ({
    execAsync: async (sql: string) => { connection.exec(sql) },
    runAsync: async (sql: string, ...args: never[]) => connection.prepare(sql).run(...args),
    getAllAsync: async (sql: string, ...args: never[]) => connection.prepare(sql).all(...args),
    getFirstAsync: async (sql: string, ...args: never[]) => connection.prepare(sql).get(...args) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      connection.exec('BEGIN')
      try { await fn(); connection.exec('COMMIT') } catch (error) { connection.exec('ROLLBACK'); throw error }
    },
  }) }
})
import { db, personalSessionBodyStore } from '../storage/db.native'

const draft = () => buildLocalSessionDraft({ machineId: 'machine', workDir: '/project', agentType: 'codex', modelId: 'gpt-6-astra', sessionMode: 'manager', managerConfig: { defaultWorkerAgentType: 'codex', defaultWorkerModelId: 'gpt-6-astra' } }, 'account', 'sess-unit')

beforeEach(async () => { await personalSessionBodyStore.removeAccount('account'); await db.deleteSession('sess-unit'); await db.deleteSession('remote') })
describe('SQLite local session publication', () => {
  it('recovers user-message ordering from canonical SQLite bodies, including attachments', async () => {
    const session = { ...draft(), bodyRevision: 3, indexRevision: 3, localCreationState: 'created' as const,
      createdAt: '1970-01-01T00:00:00.000Z', lastActivityAt: '1970-01-01T00:00:09.000Z' }
    await db.putSessions([session, { ...session, id: 'remote', bodyRevision: 0,
      createdAt: '1970-01-01T00:00:03.000Z' }])
    await personalSessionBodyStore.applySnapshot('account', {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon', subscriptionId: 'subscription',
      sessionId: session.id, storageMode: 'machine_local', snapshotRevision: 3,
      firstAvailableSeq: 1, lastAvailableSeq: 3, hasOlder: false,
      messages: [
        { sequence: 1, revision: 1, message: { id: 'u', sessionId: session.id, role: 'user', ts: 2000,
          payload: JSON.stringify({ text: '', attachments: [{ type: 'image', uri: 'local-image' }] }) } },
        { sequence: 2, revision: 2, message: { id: 'a', sessionId: session.id, role: 'agent', ts: 9000, payload: 'reply' } },
        { sequence: 3, revision: 3, message: { id: 'old', sessionId: session.id, role: 'user', ts: 1000, payload: 'old import' } },
      ],
    })
    expect(await db.getSession(session.id)).toMatchObject({ lastUserMessageAt: '1970-01-01T00:00:02.000Z' })
    expect((await db.getSessions()).map(s => s.id)).toEqual(['remote', session.id])
    await db.putSession({ ...session, lastUserMessageAt: '1970-01-01T00:00:04.000Z' })
    expect((await db.getSessions()).map(s => s.id)).toEqual([session.id, 'remote'])
  })

  it('does not advance or roll back the remote cursor using local draft timestamps', async () => {
    await db.setSessionSyncCursor(0)
    await db.putSession(draft())
    expect(await db.getSessionSyncCursor()).toBe(1)
    await db.setSessionSyncCursor(12345)
    await db.putSession(draft())
    expect(await db.getSessionSyncCursor()).toBe(12345)
  })
  it('reads an empty draft with all settings even without a published body', async () => {
    await db.putSession(draft())
    expect(await db.getSession('sess-unit')).toMatchObject({ localCreationState: 'draft', agentType: 'codex', modelId: 'gpt-6-astra', sessionMode: 'manager', managerDefaultWorkerAgentType: 'codex', managerDefaultWorkerModelId: 'gpt-6-astra', managerConfig: { defaultWorkerAgentType: 'codex' } })
    expect((await db.getSessions()).map((s) => s.id)).toContain('sess-unit')
  })
  it('does not weaken the remote body-backed publication boundary', async () => {
    const remote: NianSession = { ...draft(), id: 'remote', localCreationState: undefined, bodyRevision: 5 }
    await db.putSessions([draft(), remote])
    expect((await db.getSessions()).map((s) => s.id)).toEqual(['sess-unit'])
    expect(await db.getSession('remote')).toBeUndefined()
    expect(await db.getSessionSyncTarget!('remote')).toMatchObject({ bodyRevision: 5 })
  })
  it('exposes configuration but not an unbacked remote preview for a promoted draft', async () => {
    await db.putSession({ ...draft(), localCreationState: 'created', bodyRevision: 9, lastMessagePreview: 'not downloaded' })
    expect(await db.getSession('sess-unit')).toMatchObject({ agentType: 'codex', modelId: 'gpt-6-astra', lastMessagePreview: null, bodyRevision: 0 })
  })
  it('keeps a promoted empty session readable until the first body arrives', async () => {
    await db.putSession({ ...draft(), localCreationState: 'created' })
    expect(await db.getSession('sess-unit')).toMatchObject({ localCreationState: 'created', bodyRevision: 0 })
    await db.deleteSession('sess-unit')
    expect(await db.getSession('sess-unit')).toBeUndefined()
  })
  it('persists internal visibility in raw and published SQLite projections without deleting bodies', async () => {
    await db.putSession({ ...draft(), nativeSessionVisibility: 'internal' })
    expect(await db.getSession('sess-unit')).toMatchObject({ nativeSessionVisibility: 'internal' })
    expect(await db.getSessionSyncTarget!('sess-unit')).toMatchObject({ nativeSessionVisibility: 'internal' })
    await db.putSessions([{ ...draft(), nativeSessionVisibility: 'internal', title: 'updated' }])
    expect((await db.getSessions()).find(s => s.id === 'sess-unit')).toMatchObject({ nativeSessionVisibility: 'internal' })
    await db.putSession({ ...draft(), nativeSessionVisibility: 'user' })
    expect(await db.getSession('sess-unit')).toMatchObject({ nativeSessionVisibility: 'internal' })
    expect(await db.getSessionDeletion('sess-unit')).toBeUndefined()
  })

})
