// @covers src/storage/personal-session-body-store.native.ts

import { describe, expect, it, vi } from 'vitest'
import type { SessionBodyDeltaEvent, SessionHistorySnapshot } from '@shennian/wire'
import {
  createPersonalSessionBodyStore,
  initializePersonalSessionBodySchema,
  PersonalBodyRevisionError,
  validateBodyDelta,
} from '../storage/personal-session-body-store.native'

const stateRow = {
  accountId: 'account-1',
  sessionId: 'session-1',
  cachedBodyRevision: 2,
  firstCachedSeq: 1,
  lastCachedSeq: 2,
  hasOlder: 0,
  lastSyncedAt: '2026-09-01T00:00:00.000Z',
  lastAccessedAt: '2026-09-01T00:00:00.000Z',
  deletionRevision: 0,
  deleted: 0,
}

function delta(fromRevision = 2): SessionBodyDeltaEvent {
  return {
    protocolVersion: 2,
    dataEpoch: 2,
    daemonInstallationId: 'daemon-1',
    sessionId: 'session-1',
    subscriptionId: 'subscription-1',
    fromRevision,
    toRevision: fromRevision + 1,
    mutations: [
      {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'session-1',
        subscriptionId: 'subscription-1',
        revision: fromRevision + 1,
        mutation: 'append',
        messageId: 'message-3',
        sequence: 3,
        deliveryState: 'queued',
        message: {
          id: 'message-3',
          sessionId: 'session-1',
          role: 'user',
          ts: 3,
          payload: 'hello',
        },
      },
    ],
  }
}

function fakeDb(options?: {
  state?: typeof stateRow
  failMessageWrite?: boolean
  messageRows?: Array<{
    messageId: string
    sequence: number
    role: 'user' | 'agent'
    ts: number
    payload: string
    deliveryState: 'queued' | 'executing' | null
  }>
  stateRows?: Array<typeof stateRow>
  turnBoundarySequence?: number | null
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = {
    execAsync: vi.fn(async (_sql: string) => undefined),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
    getFirstAsync: vi.fn(async (sql: string, ..._params: unknown[]) => {
      if (sql.includes("role = 'user'")) {
        return options?.turnBoundarySequence == null
          ? null
          : { sequence: options.turnBoundarySequence }
      }
      if (sql.includes('FROM personal_session_body_state')) return options?.state ?? stateRow
      if (sql.includes('FROM personal_session_message_tombstones')) return null
      if (sql.includes('MIN(sequence)')) return { first: 1, last: 3 }
      return null
    }),
    getAllAsync: vi.fn(async (sql: string, ..._params: unknown[]) =>
      sql.includes('FROM personal_session_body_state')
        ? options?.stateRows ?? []
        : options?.messageRows ?? []),
    runAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params })
      if (options?.failMessageWrite && sql.includes('INSERT INTO personal_session_messages')) {
        throw new Error('disk full')
      }
      return undefined
    }),
  }
  return { db, calls }
}

describe('personal session body SQLite store', () => {
  it('looks up pending identities with bound account/session/message parameters without a history window', async () => {
    const { db } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await store.getMessages('account-1', 'session-1', { messageIds: ["id'quoted", 'old-message'] })
    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('messageId IN (?,?)'), 'account-1', 'session-1', "id'quoted", 'old-message',
    )
    db.getAllAsync.mockClear()
    await expect(store.getMessages('account-1', 'session-1', { messageIds: [] })).resolves.toEqual([])
    expect(db.getAllAsync).not.toHaveBeenCalled()
  })

  it('creates account-scoped revision, message and tombstone tables', async () => {
    const { db } = fakeDb()
    await initializePersonalSessionBodySchema(db as never)
    const schema = db.execAsync.mock.calls[0]?.[0] as string
    expect(schema).toContain('personal_session_body_state')
    expect(schema).toContain('personal_session_messages')
    expect(schema).toContain('personal_session_message_tombstones')
    expect(schema).toContain('personal_session_published_index')
    expect(schema).toContain('lastVisibleEventAt TEXT')
    expect(schema).toContain('PRIMARY KEY (accountId, sessionId)')
    expect(schema).toContain('idx_personal_messages_user_turns')
  })

  it('rejects a revision gap before applying any mutation', () => {
    expect(() => validateBodyDelta(2, delta(4))).toThrowError(PersonalBodyRevisionError)
  })

  it('commits messages before advancing cachedBodyRevision in one transaction', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const result = await store.applyDelta('account-1', delta())

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1)
    const messageWrite = calls.findIndex((call) => call.sql.includes('INSERT INTO personal_session_messages'))
    const stateWrite = calls.findIndex((call) => call.sql.includes('INSERT INTO personal_session_body_state'))
    const publicationWrite = calls.findIndex((call) =>
      call.sql.includes('INSERT INTO personal_session_published_index'))
    expect(messageWrite).toBeGreaterThanOrEqual(0)
    expect(stateWrite).toBeGreaterThan(messageWrite)
    expect(publicationWrite).toBeGreaterThan(stateWrite)
    expect(calls[publicationWrite]?.sql).toContain(
      'body.cachedBodyRevision >= s.bodyRevision',
    )
    expect(result.cachedBodyRevision).toBe(3)
  })

  it.each([120, 500])('commits a %i-message authoritative snapshot in one transaction', async (count) => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: count,
      firstAvailableSeq: 1, lastAvailableSeq: count, hasOlder: false,
      messages: Array.from({ length: count }, (_, index) => ({
        sequence: index + 1,
        revision: index + 1,
        message: {
          id: `message-${index + 1}`, sessionId: 'session-1',
          role: index % 2 ? 'agent' as const : 'user' as const,
          ts: index + 1, payload: `body-${index + 1}`,
        },
      })),
    }

    await store.applySnapshot('account-1', snapshot)

    expect(db.withTransactionAsync).toHaveBeenCalledOnce()
    expect(calls.filter((call) => call.sql.includes('INSERT INTO personal_session_messages')))
      .toHaveLength(count)
    expect(calls.find((call) => call.sql.includes('INSERT INTO personal_session_body_state'))?.params[2])
      .toBe(count)
  })

  it('does not reintroduce remote hasOlder after SQLite already contains the first sequence', async () => {
    const { db } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: 3,
      firstAvailableSeq: 1, lastAvailableSeq: 3, hasOlder: true,
      messages: [{
        sequence: 3, revision: 3,
        message: {
          id: 'message-3', sessionId: 'session-1', role: 'agent', ts: 3, payload: 'latest',
        },
      }],
    }

    await expect(store.applySnapshot('account-1', snapshot)).resolves.toMatchObject({
      firstCachedSeq: 1,
      hasOlder: false,
    })
  })

  it('does not rewrite an already complete snapshot at the same revision', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: stateRow.cachedBodyRevision,
      firstAvailableSeq: 1, lastAvailableSeq: 2, hasOlder: false,
      messages: [{
        sequence: 2, revision: 2,
        message: {
          id: 'message-2', sessionId: 'session-1', role: 'agent', ts: 2, payload: 'answer',
        },
      }],
    }

    await expect(store.applySnapshot('account-1', snapshot)).resolves.toMatchObject({
      cachedBodyRevision: 2,
      hasOlder: false,
    })
    expect(db.withTransactionAsync).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('revives a server-confirmed session with an empty body cache', async () => {
    const { db, calls } = fakeDb({
      state: { ...stateRow, cachedBodyRevision: 9, deleted: 1 },
    })
    const store = createPersonalSessionBodyStore(async () => db as never)

    await store.restoreSession('account-1', 'session-1', 0)

    const stateWrite = calls.find((call) =>
      call.sql.includes('INSERT INTO personal_session_body_state'))
    expect(stateWrite?.params[2]).toBe(0)
    expect(stateWrite?.params[3]).toBeNull()
    expect(stateWrite?.params[4]).toBeNull()
    expect(stateWrite?.params[9]).toBe(0)
    expect(calls.some((call) => call.sql.includes('DELETE FROM personal_session_messages')))
      .toBe(false)
  })

  it('atomically replaces only the session cache after a confirmed authoritative rollback', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: 1,
      firstAvailableSeq: 1, lastAvailableSeq: 1, hasOlder: false,
      messages: [{
        sequence: 1, revision: 1,
        message: {
          id: 'authoritative-1', sessionId: 'session-1',
          role: 'user', ts: 1, payload: 'authoritative',
        },
      }],
    }

    await store.applySnapshot('account-1', snapshot, { replaceCachedRevision: 2 })

    expect(db.withTransactionAsync).toHaveBeenCalledOnce()
    const cacheDeletes = calls.filter((call) => call.sql.includes('DELETE FROM personal_session'))
    expect(cacheDeletes).toHaveLength(3)
    expect(cacheDeletes.every((call) => call.params.slice(0, 2).join(':') === 'account-1:session-1'))
      .toBe(true)
    expect(calls.some((call) => call.sql.includes('DELETE FROM sessions'))).toBe(false)
    expect(calls.find((call) => call.sql.includes('INSERT INTO personal_session_body_state'))?.params[2])
      .toBe(1)
  })

  it('does not replace a session cache whose revision changed after confirmation', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: 1,
      firstAvailableSeq: null, lastAvailableSeq: null, hasOlder: false, messages: [],
    }

    await expect(store.applySnapshot(
      'account-1', snapshot, { replaceCachedRevision: 3 },
    )).rejects.toMatchObject({ code: 'stale_snapshot' })
    expect(calls).toEqual([])
  })

  it('rolls back a snapshot without advancing state when a message write fails', async () => {
    const { db, calls } = fakeDb({ failMessageWrite: true })
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
      sessionId: 'session-1', subscriptionId: 'subscription-1',
      storageMode: 'machine_local', snapshotRevision: 3,
      firstAvailableSeq: 3, lastAvailableSeq: 3, hasOlder: true,
      messages: [{
        sequence: 3, revision: 3,
        message: {
          id: 'message-3', sessionId: 'session-1', role: 'agent', ts: 3, payload: 'answer',
        },
      }],
    }

    await expect(store.applySnapshot('account-1', snapshot)).rejects.toThrow('disk full')
    expect(db.withTransactionAsync).toHaveBeenCalledOnce()
    expect(calls.some((call) => call.sql.includes('INSERT INTO personal_session_body_state'))).toBe(false)
  })

  it('reconstructs complete envelopes from normalized message columns', async () => {
    const { db } = fakeDb({
      messageRows: [
        { messageId: 'message-2', sequence: 2, role: 'agent', ts: 2, payload: 'answer', deliveryState: null },
        { messageId: 'message-1', sequence: 1, role: 'user', ts: 1, payload: 'question', deliveryState: 'queued' },
      ],
    })
    const store = createPersonalSessionBodyStore(async () => db as never)

    await expect(store.getMessages('account-1', 'session-1')).resolves.toEqual([
      {
        id: 'message-1', sessionId: 'session-1', role: 'user', ts: 1, payload: 'question',
        deliveryState: 'queued', localSequence: 1,
      },
      {
        id: 'message-2', sessionId: 'session-1', role: 'agent', ts: 2,
        payload: 'answer', localSequence: 2,
      },
    ])
    expect(db.getAllAsync.mock.calls[0]?.[0]).toContain(
      'SELECT messageId, sequence, role, ts, payload, deliveryState',
    )
  })

  it('reads complete pages by user-turn boundary instead of raw message count', async () => {
    const { db } = fakeDb({
      turnBoundarySequence: 41,
      messageRows: [
        {
          messageId: 'user-41', sequence: 41, role: 'user', ts: 41,
          payload: 'question', deliveryState: null,
        },
        {
          messageId: 'tool-42', sequence: 42, role: 'agent', ts: 42,
          payload: 'tool', deliveryState: 'executing',
        },
        {
          messageId: 'answer-43', sequence: 43, role: 'agent', ts: 43,
          payload: 'answer', deliveryState: null,
        },
      ],
    })
    const store = createPersonalSessionBodyStore(async () => db as never)

    await expect(store.getMessagesByUserTurns('account-1', 'session-1', {
      beforeSequence: 100,
      turnLimit: 20,
    })).resolves.toEqual([
      expect.objectContaining({ id: 'user-41', localSequence: 41 }),
      expect.objectContaining({ id: 'tool-42', localSequence: 42 }),
      expect.objectContaining({ id: 'answer-43', localSequence: 43 }),
    ])
    const boundaryCall = db.getFirstAsync.mock.calls.find(
      ([sql]) => String(sql).includes("role = 'user'"),
    )
    expect(boundaryCall?.[1]).toBe('account-1')
    expect(boundaryCall?.[2]).toBe('session-1')
    expect(boundaryCall?.[3]).toBe(100)
    expect(boundaryCall?.[4]).toBe(19)
    const pageCall = db.getAllAsync.mock.calls[0]
    expect(pageCall?.[0]).toContain('sequence >= ?')
    expect(pageCall?.slice(1)).toEqual(['account-1', 'session-1', 100, 41])
  })

  it('updates queued to executing under the same canonical message key', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await store.applyDelta('account-1', delta())

    const executing = delta()
    executing.mutations[0] = {
      ...executing.mutations[0]!,
      mutation: 'upsert',
      messageId: 'message-3',
      sequence: 3,
      deliveryState: 'executing',
    }
    await store.applyDelta('account-1', executing)

    const writes = calls.filter((call) => call.sql.includes('INSERT INTO personal_session_messages'))
    expect(writes).toHaveLength(2)
    expect(writes.map((write) => write.params[2])).toEqual(['message-3', 'message-3'])
    expect(writes.map((write) => write.params[3])).toEqual([3, 3])
    expect(writes.map((write) => write.params.at(-1))).toEqual(['queued', 'executing'])
    expect(writes[1]!.sql).toContain('ON CONFLICT(accountId, sessionId, messageId) DO UPDATE')
  })

  it('does not advance cachedBodyRevision when the message write fails', async () => {
    const { db, calls } = fakeDb({ failMessageWrite: true })
    const store = createPersonalSessionBodyStore(async () => db as never)

    await expect(store.applyDelta('account-1', delta())).rejects.toThrow('disk full')
    expect(calls.some((call) => call.sql.includes('INSERT INTO personal_session_body_state'))).toBe(false)
  })

  it('stores personal attachment metadata without preview bytes', async () => {
    const event = delta()
    event.mutations[0]!.message!.payload = JSON.stringify({
      v: 1,
      type: 'user',
      content: 'see attachment',
      attachments: [{
        path: '/project/.uploads/shot.png',
        name: 'shot.png',
        mimeType: 'image/png',
        kind: 'image',
        byteSize: 123,
        sha256: 'a'.repeat(64),
        previewData: 'base64-must-not-enter-sqlite',
      }],
    })
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await store.applyDelta('account-1', event)
    const write = calls.find((call) => call.sql.includes('INSERT INTO personal_session_messages'))
    const payload = String(write?.params.at(-2))
    expect(payload).toContain('"byteSize":123')
    expect(payload).toContain('"sha256"')
    expect(payload).not.toContain('previewData')
    expect(payload).not.toContain('base64-must-not-enter-sqlite')
  })

  it('keeps transcript messages when optional attachment integrity metadata is absent', async () => {
    const event = delta()
    event.mutations[0]!.message!.payload = JSON.stringify({
      v: 1,
      type: 'user',
      content: 'invalid attachment',
      attachments: [{
        path: '/project/.uploads/shot.png', name: 'shot.png', mimeType: 'image/png', kind: 'image',
      }],
    })
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await expect(store.applyDelta('account-1', event)).resolves.toMatchObject({
      cachedBodyRevision: event.toRevision,
    })
    const write = calls.find((call) => call.sql.includes('INSERT INTO personal_session_messages'))
    const payload = String(write?.params.at(-2))
    expect(payload).toContain('invalid attachment')
    expect(payload).toContain('/project/.uploads/shot.png')
    expect(payload).not.toContain('byteSize')
    expect(payload).not.toContain('sha256')
  })

  it('keeps a 92-message snapshot when one attachment has malformed optional integrity fields', async () => {
    const event = delta()
    event.mutations[0]!.message!.id = 'message-with-local-image'
    event.mutations[0]!.message!.payload = JSON.stringify({
      v: 1,
      type: 'user',
      content: 'keep this message',
      attachments: [{
        path: '/project/.uploads/shot.png',
        name: 'shot.png',
        mimeType: 'image/png',
        kind: 'image',
        byteSize: -1,
        sha256: 'not-a-digest',
        previewData: 'base64-must-not-enter-sqlite',
      }],
    })
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2,
      dataEpoch: 2,
      daemonInstallationId: 'daemon-1',
      sessionId: 'session-1',
      subscriptionId: 'subscription-1',
      storageMode: 'machine_local',
      snapshotRevision: 92,
      firstAvailableSeq: 1,
      lastAvailableSeq: 92,
      hasOlder: false,
      messages: Array.from({ length: 92 }, (_, index) => ({
        sequence: index + 1,
        revision: index + 1,
        message: index === 22
          ? event.mutations[0]!.message!
          : {
              id: `message-${index + 1}`,
              sessionId: 'session-1',
              role: index % 2 ? 'agent' as const : 'user' as const,
              ts: index + 1,
              payload: `body-${index + 1}`,
            },
      })),
    }
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await expect(store.applySnapshot('account-1', snapshot)).resolves.toMatchObject({
      cachedBodyRevision: snapshot.snapshotRevision,
    })
    const writes = calls.filter((call) => call.sql.includes('INSERT INTO personal_session_messages'))
    expect(writes).toHaveLength(92)
    const write = writes.find((call) => String(call.params.at(-2)).includes('keep this message'))
    const payload = String(write?.params.at(-2))
    expect(payload).toContain('keep this message')
    expect(payload).not.toContain('byteSize')
    expect(payload).not.toContain('sha256')
    expect(payload).not.toContain('previewData')
  })

  it('keeps a session tombstone as a barrier against late snapshots and deltas', async () => {
    const deleted = { ...stateRow, deletionRevision: 7, deleted: 1 }
    const { db, calls } = fakeDb({ state: deleted })
    const store = createPersonalSessionBodyStore(async () => db as never)
    const snapshot: SessionHistorySnapshot = {
      protocolVersion: 2,
      dataEpoch: 2,
      daemonInstallationId: 'daemon-1',
      sessionId: 'session-1',
      subscriptionId: 'subscription-1',
      storageMode: 'machine_local',
      snapshotRevision: 8,
      firstAvailableSeq: 1,
      lastAvailableSeq: 1,
      hasOlder: false,
      messages: [
        {
          sequence: 1,
          revision: 1,
          message: {
            id: 'message-1', sessionId: 'session-1', role: 'user', ts: 1, payload: 'late',
          },
        },
      ],
    }

    await expect(store.applySnapshot('account-1', snapshot)).rejects.toMatchObject({
      code: 'session_deleted',
    })
    await expect(store.applyDelta('account-1', delta(7))).rejects.toMatchObject({
      code: 'session_deleted',
    })
    expect(calls).toEqual([])
  })

  it('persists the deletion barrier and clears cached messages atomically', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)
    await store.markDeleted('account-1', 'session-1', 9)

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1)
    expect(calls.filter((call) => call.sql.includes('DELETE FROM personal_session')).length).toBe(3)
    const stateWrite = calls.find((call) => call.sql.includes('INSERT INTO personal_session_body_state'))
    expect(stateWrite?.params.at(-1)).toBe(1)
    expect(stateWrite?.params.at(-2)).toBe(9)
  })

  it('lists every account-scoped body watermark without a 64-session cutoff', async () => {
    const states = Array.from({ length: 65 }, (_, index) => ({
      ...stateRow,
      sessionId: `session-${index + 1}`,
      cachedBodyRevision: index,
    }))
    const { db, calls } = fakeDb({ stateRows: states })
    const store = createPersonalSessionBodyStore(async () => db as never)

    await expect(store.getStates('account-1')).resolves.toHaveLength(65)
    expect(db.getAllAsync.mock.calls[0]?.[0]).not.toContain('LIMIT')
    expect(calls.some((call) => call.sql.includes('DELETE FROM personal_session'))).toBe(false)
  })

  it('never trims durable rows after a snapshot or delta commit', async () => {
    const { db, calls } = fakeDb()
    const store = createPersonalSessionBodyStore(async () => db as never)

    await store.applyDelta('account-1', delta())

    expect(calls.some((call) => call.sql.includes('OFFSET'))).toBe(false)
    expect(calls.some((call) =>
      call.sql.includes('DELETE FROM personal_session_body_state'))).toBe(false)
  })
})
