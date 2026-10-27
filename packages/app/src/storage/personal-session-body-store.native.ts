// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/personal-session-body-store.test.ts

import type { SQLiteDatabase } from 'expo-sqlite'
import type {
  Envelope,
  SessionBodyDeltaEvent,
  SessionDeliveryState,
  SessionHistoryPage,
  SessionHistorySnapshot,
} from '@shennian/wire'
import { buildUserMessagePayload, parseUserMessagePayload } from '@shennian/wire'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'
import { withWriteTransaction } from './sqlite-write-queue.native'

type GetDb = () => Promise<SQLiteDatabase>

export type PersonalSessionBodyState = {
  accountId: string
  sessionId: string
  cachedBodyRevision: number
  firstCachedSeq: number | null
  lastCachedSeq: number | null
  hasOlder: boolean
  lastSyncedAt: string | null
  lastAccessedAt: string
  deletionRevision: number
  deleted: boolean
}

type StateRow = Omit<PersonalSessionBodyState, 'hasOlder' | 'deleted'> & {
  hasOlder: number
  deleted: number
}

type MessageRow = {
  messageId: string
  sequence: number
  role: Envelope['role']
  ts: number
  payload: string
  deliveryState: SessionDeliveryState | null
}

export type PersonalSessionBodyMessage = Envelope & {
  deliveryState?: SessionDeliveryState
  /** SQLite paging cursor; never serialized back to the daemon. */
  localSequence?: number
}

export type PersonalSessionBodyStore = {
  getState(accountId: string, sessionId: string): Promise<PersonalSessionBodyState | null>
  getStates(accountId: string): Promise<PersonalSessionBodyState[]>
  getMessages(
    accountId: string,
    sessionId: string,
    options?: { limit?: number; beforeSequence?: number; messageIds?: string[] },
  ): Promise<PersonalSessionBodyMessage[]>
  getMessagesByUserTurns(
    accountId: string,
    sessionId: string,
    options: { turnLimit: number; beforeSequence?: number; messageLimit?: number },
  ): Promise<PersonalSessionBodyMessage[]>
  applySnapshot(
    accountId: string,
    snapshot: SessionHistorySnapshot,
    options?: { replaceCachedRevision?: number },
  ): Promise<PersonalSessionBodyState>
  applyPage(accountId: string, page: SessionHistoryPage): Promise<PersonalSessionBodyState>
  applyDelta(accountId: string, delta: SessionBodyDeltaEvent): Promise<PersonalSessionBodyState>
  restoreSession(accountId: string, sessionId: string, deletionRevision: number): Promise<void>
  markDeleted(accountId: string, sessionId: string, deletionRevision: number): Promise<void>
  removeAccount(accountId: string): Promise<void>
  subscribe(
    accountId: string,
    sessionId: string,
    listener: (state: PersonalSessionBodyState) => void,
  ): () => void
}

export class PersonalBodyRevisionError extends Error {
  constructor(
    readonly code: 'revision_gap' | 'stale_snapshot' | 'session_deleted' | 'invalid_payload',
    message: string,
  ) {
    super(message)
    this.name = 'PersonalBodyRevisionError'
  }
}

export async function initializePersonalSessionBodySchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS personal_session_body_state (
      accountId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      cachedBodyRevision INTEGER NOT NULL DEFAULT 0,
      firstCachedSeq INTEGER,
      lastCachedSeq INTEGER,
      hasOlder INTEGER NOT NULL DEFAULT 0,
      lastSyncedAt TEXT,
      lastAccessedAt TEXT NOT NULL,
      deletionRevision INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (accountId, sessionId)
    );
    DROP INDEX IF EXISTS idx_personal_body_state_lru;
    CREATE INDEX IF NOT EXISTS idx_personal_body_state_account
      ON personal_session_body_state(accountId, deleted, sessionId);
    CREATE TABLE IF NOT EXISTS personal_session_messages (
      accountId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      role TEXT NOT NULL,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL,
      deliveryState TEXT,
      PRIMARY KEY (accountId, sessionId, messageId),
      UNIQUE (accountId, sessionId, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_personal_messages_window
      ON personal_session_messages(accountId, sessionId, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_personal_messages_user_turns
      ON personal_session_messages(accountId, sessionId, role, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_personal_messages_user_time
      ON personal_session_messages(accountId, sessionId, role, ts DESC);
    CREATE TABLE IF NOT EXISTS personal_session_message_tombstones (
      accountId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      revision INTEGER NOT NULL,
      PRIMARY KEY (accountId, sessionId, messageId)
    );
    CREATE TABLE IF NOT EXISTS personal_session_published_index (
      accountId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      indexRevision INTEGER NOT NULL,
      bodyRevision INTEGER NOT NULL,
      lastMessagePreview TEXT,
      lastMessagePreviewMessageId TEXT,
      lastMessagePreviewAt TEXT,
      lastVisibleEventAt TEXT,
      lastActivityAt TEXT NOT NULL,
      lastBodyCommittedAt TEXT,
      firstAvailableSeq INTEGER,
      visibleMessageCount INTEGER NOT NULL DEFAULT 0,
      lastVisibleMessageId TEXT,
      attentionCount INTEGER NOT NULL DEFAULT 0,
      lastAttentionId TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (accountId, sessionId)
    );
    CREATE INDEX IF NOT EXISTS idx_personal_published_index_session
      ON personal_session_published_index(sessionId);
  `)
  await db.execAsync(
    'ALTER TABLE personal_session_messages ADD COLUMN deliveryState TEXT;',
  ).catch(() => {
    /* column already exists */
  })
  await db.execAsync(
    'ALTER TABLE personal_session_published_index ADD COLUMN lastVisibleEventAt TEXT;',
  ).catch(() => {
    /* column already exists */
  })
}

/**
 * Publish a body-backed list tuple only when the durable local body covers it.
 * Callers invoke this inside the same SQLite transaction as either side of the
 * barrier, making index-first and body-first arrival orders equivalent.
 */
export async function publishSessionIndexIfBodyReady(
  db: SQLiteDatabase,
  sessionId: string,
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO personal_session_published_index
       (accountId, sessionId, indexRevision, bodyRevision, lastMessagePreview,
        lastMessagePreviewMessageId, lastMessagePreviewAt, lastVisibleEventAt, lastActivityAt,
        lastBodyCommittedAt, firstAvailableSeq, visibleMessageCount,
        lastVisibleMessageId, attentionCount, lastAttentionId, updatedAt)
     SELECT s.userId, s.id, s.indexRevision, s.bodyRevision, s.lastMessagePreview,
            s.lastMessagePreviewMessageId, s.lastMessagePreviewAt, s.lastVisibleEventAt, s.lastActivityAt,
            s.lastBodyCommittedAt, s.firstAvailableSeq, s.visibleMessageCount,
            s.lastVisibleMessageId, s.attentionCount, s.lastAttentionId, s.updatedAt
       FROM sessions s
       LEFT JOIN personal_session_body_state body
         ON body.accountId = s.userId AND body.sessionId = s.id
      WHERE s.id = ? AND s.deletedAt IS NULL
        AND s.bodyRevision > 0
        AND body.deleted = 0 AND body.cachedBodyRevision >= s.bodyRevision
     ON CONFLICT(accountId, sessionId) DO UPDATE SET
       indexRevision = excluded.indexRevision,
       bodyRevision = excluded.bodyRevision,
       lastMessagePreview = excluded.lastMessagePreview,
       lastMessagePreviewMessageId = excluded.lastMessagePreviewMessageId,
       lastMessagePreviewAt = excluded.lastMessagePreviewAt,
       lastVisibleEventAt = excluded.lastVisibleEventAt,
       lastActivityAt = excluded.lastActivityAt,
       lastBodyCommittedAt = excluded.lastBodyCommittedAt,
       firstAvailableSeq = excluded.firstAvailableSeq,
       visibleMessageCount = excluded.visibleMessageCount,
       lastVisibleMessageId = excluded.lastVisibleMessageId,
       attentionCount = excluded.attentionCount,
       lastAttentionId = excluded.lastAttentionId,
       updatedAt = excluded.updatedAt
     WHERE excluded.indexRevision >= personal_session_published_index.indexRevision`,
    sessionId,
  )
  return (result?.changes ?? 0) > 0
}

function mapState(row: StateRow): PersonalSessionBodyState {
  return { ...row, hasOlder: row.hasOlder === 1, deleted: row.deleted === 1 }
}

function assertIdentity(accountId: string, sessionId: string): void {
  if (!accountId || !sessionId) {
    throw new PersonalBodyRevisionError('invalid_payload', 'accountId and sessionId are required')
  }
}

function assertAuthorityIdentity(value: {
  protocolVersion?: unknown
  dataEpoch?: unknown
  daemonInstallationId?: unknown
}): void {
  if (
    value.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    value.dataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    typeof value.daemonInstallationId !== 'string' ||
    !value.daemonInstallationId
  ) throw new PersonalBodyRevisionError('invalid_payload', 'invalid personal authority identity')
}

function assertEnvelope(message: Envelope, sessionId: string): void {
  if (
    !message?.id ||
    message.sessionId !== sessionId ||
    (message.role !== 'user' && message.role !== 'agent') ||
    !Number.isSafeInteger(message.ts)
  ) {
    throw new PersonalBodyRevisionError('invalid_payload', 'invalid canonical message')
  }
}

function mapMessageRows(
  rows: MessageRow[],
  sessionId: string,
): PersonalSessionBodyMessage[] {
  return rows.map((row) => ({
    id: row.messageId,
    sessionId,
    role: row.role,
    ts: row.ts,
    payload: row.payload,
    localSequence: row.sequence,
    ...(row.deliveryState ? { deliveryState: row.deliveryState } : {}),
  }))
}

function metadataOnlyEnvelope(message: Envelope): Envelope {
  if (message.role !== 'user') return message
  const parsed = parseUserMessagePayload(message.payload)
  if (!parsed?.attachments?.length) return message
  const attachments = parsed.attachments.map((attachment) => {
    // A transcript can reference a machine-local attachment before its bytes
    // are requested. Size and digest belong to the transfer contract, not to
    // basic message rendering; malformed optional integrity metadata must not
    // make the entire authoritative snapshot unreadable.
    const byteSize =
      typeof attachment.byteSize === 'number' && Number.isSafeInteger(attachment.byteSize) &&
      attachment.byteSize >= 0
        ? attachment.byteSize
        : undefined
    const sha256 =
      typeof attachment.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(attachment.sha256)
        ? attachment.sha256.toLowerCase()
        : undefined
    return {
      path: attachment.path,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      ...(byteSize !== undefined ? { byteSize } : {}),
      ...(sha256 ? { sha256 } : {}),
    }
  })
  return { ...message, payload: buildUserMessagePayload(parsed.content, attachments) }
}

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PersonalBodyRevisionError('invalid_payload', `${label} must be a non-negative integer`)
  }
}

const DELIVERY_STATES = new Set<SessionDeliveryState>([
  'queued',
  'committed',
  'executing',
  'completed',
  'failed',
  'cancelled',
])

function assertDeliveryState(value: SessionDeliveryState | undefined): void {
  if (value !== undefined && !DELIVERY_STATES.has(value)) {
    throw new PersonalBodyRevisionError('invalid_payload', 'invalid delivery state')
  }
}

async function readState(
  db: SQLiteDatabase,
  accountId: string,
  sessionId: string,
): Promise<PersonalSessionBodyState | null> {
  const row = await db.getFirstAsync<StateRow | null>(
    `SELECT accountId, sessionId, cachedBodyRevision, firstCachedSeq, lastCachedSeq,
            hasOlder, lastSyncedAt, lastAccessedAt, deletionRevision, deleted
       FROM personal_session_body_state WHERE accountId = ? AND sessionId = ?`,
    accountId,
    sessionId,
  )
  return row ? mapState(row) : null
}

async function requireWritableState(
  db: SQLiteDatabase,
  accountId: string,
  sessionId: string,
): Promise<PersonalSessionBodyState | null> {
  const state = await readState(db, accountId, sessionId)
  if (state?.deleted) {
    throw new PersonalBodyRevisionError('session_deleted', 'late personal body data rejected')
  }
  return state
}

async function upsertMessage(
  db: SQLiteDatabase,
  accountId: string,
  sessionId: string,
  message: Envelope,
  sequence: number,
  revision: number,
  deliveryState?: SessionDeliveryState,
): Promise<void> {
  assertEnvelope(message, sessionId)
  assertDeliveryState(deliveryState)
  const storedMessage = metadataOnlyEnvelope(message)
  assertRevision(sequence, 'sequence')
  const tombstone = await db.getFirstAsync<{ revision: number } | null>(
    `SELECT revision FROM personal_session_message_tombstones
      WHERE accountId = ? AND sessionId = ? AND messageId = ?`,
    accountId,
    sessionId,
    storedMessage.id,
  )
  if (tombstone && tombstone.revision >= revision) return
  await db.runAsync(
    `INSERT INTO personal_session_messages
       (accountId, sessionId, messageId, sequence, revision, role, ts, payload, deliveryState)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(accountId, sessionId, messageId) DO UPDATE SET
       sequence = excluded.sequence,
       revision = excluded.revision,
       role = excluded.role,
       ts = excluded.ts,
       payload = excluded.payload,
       deliveryState = excluded.deliveryState
     WHERE excluded.revision >= personal_session_messages.revision`,
    accountId,
    sessionId,
    message.id,
    sequence,
    revision,
    storedMessage.role,
    storedMessage.ts,
    storedMessage.payload,
    deliveryState ?? null,
  )
}

async function refreshBounds(
  db: SQLiteDatabase,
  accountId: string,
  sessionId: string,
): Promise<{ first: number | null; last: number | null }> {
  const bounds = await db.getFirstAsync<{ first: number | null; last: number | null } | null>(
    `SELECT MIN(sequence) AS first, MAX(sequence) AS last
       FROM personal_session_messages WHERE accountId = ? AND sessionId = ?`,
    accountId,
    sessionId,
  )
  return { first: bounds?.first ?? null, last: bounds?.last ?? null }
}

async function writeState(
  db: SQLiteDatabase,
  state: PersonalSessionBodyState,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO personal_session_body_state
       (accountId, sessionId, cachedBodyRevision, firstCachedSeq, lastCachedSeq,
        hasOlder, lastSyncedAt, lastAccessedAt, deletionRevision, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(accountId, sessionId) DO UPDATE SET
       cachedBodyRevision = excluded.cachedBodyRevision,
       firstCachedSeq = excluded.firstCachedSeq,
       lastCachedSeq = excluded.lastCachedSeq,
       hasOlder = excluded.hasOlder,
       lastSyncedAt = excluded.lastSyncedAt,
       lastAccessedAt = excluded.lastAccessedAt,
       deletionRevision = excluded.deletionRevision,
       deleted = excluded.deleted`,
    state.accountId,
    state.sessionId,
    state.cachedBodyRevision,
    state.firstCachedSeq,
    state.lastCachedSeq,
    state.hasOlder ? 1 : 0,
    state.lastSyncedAt,
    state.lastAccessedAt,
    state.deletionRevision,
    state.deleted ? 1 : 0,
  )
}

export function validateBodyDelta(
  cachedRevision: number,
  delta: SessionBodyDeltaEvent,
): void {
  assertRevision(delta.fromRevision, 'fromRevision')
  assertRevision(delta.toRevision, 'toRevision')
  if (delta.fromRevision !== cachedRevision) {
    throw new PersonalBodyRevisionError(
      'revision_gap',
      `expected delta from ${cachedRevision}, received ${delta.fromRevision}`,
    )
  }
  let expected = cachedRevision + 1
  for (const mutation of delta.mutations) {
    if (mutation.sessionId !== delta.sessionId || mutation.subscriptionId !== delta.subscriptionId) {
      throw new PersonalBodyRevisionError('invalid_payload', 'delta mutation identity mismatch')
    }
    if (
      mutation.protocolVersion !== delta.protocolVersion ||
      mutation.dataEpoch !== delta.dataEpoch ||
      mutation.daemonInstallationId !== delta.daemonInstallationId
    ) {
      throw new PersonalBodyRevisionError('invalid_payload', 'delta authority identity mismatch')
    }
    if (mutation.revision !== expected) {
      throw new PersonalBodyRevisionError('revision_gap', `expected mutation revision ${expected}`)
    }
    if (mutation.mutation !== 'tombstone' && !mutation.message) {
      throw new PersonalBodyRevisionError('invalid_payload', 'visible mutation requires message')
    }
    expected++
  }
  if (delta.mutations.length === 0 || expected - 1 !== delta.toRevision) {
    throw new PersonalBodyRevisionError('revision_gap', 'delta range does not match mutations')
  }
}

export function createPersonalSessionBodyStore(getDb: GetDb): PersonalSessionBodyStore {
  const listeners = new Map<string, Set<(state: PersonalSessionBodyState) => void>>()
  const notify = (state: PersonalSessionBodyState) => {
    const set = listeners.get(`${state.accountId}\u0000${state.sessionId}`)
    if (!set) return
    for (const listener of set) listener(state)
  }
  return {
    async getState(accountId, sessionId) {
      assertIdentity(accountId, sessionId)
      const db = await getDb()
      return readState(db, accountId, sessionId)
    },

    async getStates(accountId) {
      if (!accountId) return []
      const db = await getDb()
      const rows = await db.getAllAsync<StateRow>(
        `SELECT accountId, sessionId, cachedBodyRevision, firstCachedSeq, lastCachedSeq,
                hasOlder, lastSyncedAt, lastAccessedAt, deletionRevision, deleted
           FROM personal_session_body_state WHERE accountId = ?`,
        accountId,
      )
      return rows.map((row) => ({
        ...row,
        hasOlder: row.hasOlder === 1,
        deleted: row.deleted === 1,
      }))
    },

    async getMessages(accountId, sessionId, options) {
      assertIdentity(accountId, sessionId)
      const db = await getDb()
      const state = await readState(db, accountId, sessionId)
      if (state?.deleted) return []
      let sql = `SELECT messageId, sequence, role, ts, payload, deliveryState FROM personal_session_messages
                  WHERE accountId = ? AND sessionId = ?`
      const params: Array<string | number> = [accountId, sessionId]
      if (options?.messageIds) {
        if (!options.messageIds.length) return []
        sql += ` AND messageId IN (${options.messageIds.map(() => '?').join(',')})`
        params.push(...options.messageIds)
      }
      if (options?.beforeSequence !== undefined) {
        sql += ' AND sequence < ?'
        params.push(options.beforeSequence)
      }
      sql += ' ORDER BY sequence DESC'
      if (options?.limit !== undefined) {
        if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
          throw new PersonalBodyRevisionError('invalid_payload', 'limit must be positive')
        }
        sql += ' LIMIT ?'
        params.push(options.limit)
      }
      const rows = await db.getAllAsync<MessageRow>(sql, ...params)
      return mapMessageRows(rows.reverse(), sessionId)
    },

    async getMessagesByUserTurns(accountId, sessionId, options) {
      assertIdentity(accountId, sessionId)
      if (!Number.isSafeInteger(options.turnLimit) || options.turnLimit < 1) {
        throw new PersonalBodyRevisionError('invalid_payload', 'turnLimit must be positive')
      }
      if (
        options.beforeSequence !== undefined &&
        (!Number.isSafeInteger(options.beforeSequence) || options.beforeSequence < 1)
      ) {
        throw new PersonalBodyRevisionError(
          'invalid_payload',
          'beforeSequence must be positive',
        )
      }
      if (options.messageLimit !== undefined && (!Number.isSafeInteger(options.messageLimit) || options.messageLimit < 1)) {
        throw new PersonalBodyRevisionError('invalid_payload', 'messageLimit must be positive')
      }
      const db = await getDb()
      const state = await readState(db, accountId, sessionId)
      if (state?.deleted) return []

      let boundarySql = `SELECT sequence FROM personal_session_messages
                          WHERE accountId = ? AND sessionId = ? AND role = 'user'`
      const boundaryParams: Array<string | number> = [accountId, sessionId]
      if (options.beforeSequence !== undefined) {
        boundarySql += ' AND sequence < ?'
        boundaryParams.push(options.beforeSequence)
      }
      boundarySql += ' ORDER BY sequence DESC LIMIT 1 OFFSET ?'
      boundaryParams.push(options.turnLimit - 1)
      const boundary = await db.getFirstAsync<{ sequence: number }>(
        boundarySql,
        ...boundaryParams,
      )

      let sql = `SELECT messageId, sequence, role, ts, payload, deliveryState
                   FROM personal_session_messages
                  WHERE accountId = ? AND sessionId = ?`
      const params: Array<string | number> = [accountId, sessionId]
      if (options.beforeSequence !== undefined) {
        sql += ' AND sequence < ?'
        params.push(options.beforeSequence)
      }
      if (boundary && Number.isSafeInteger(boundary.sequence)) {
        sql += ' AND sequence >= ?'
        params.push(boundary.sequence)
      }
      // Keep the newest records; older ones remain reachable by the existing cursor.
      sql += options.messageLimit === undefined ? ' ORDER BY sequence ASC' : ' ORDER BY sequence DESC LIMIT ?'
      if (options.messageLimit !== undefined) params.push(options.messageLimit)
      const rows = await db.getAllAsync<MessageRow>(sql, ...params)
      return mapMessageRows(options.messageLimit === undefined ? rows : rows.reverse(), sessionId)
    },

    async applySnapshot(accountId, snapshot, options) {
      assertIdentity(accountId, snapshot.sessionId)
      assertAuthorityIdentity(snapshot)
      assertRevision(snapshot.snapshotRevision, 'snapshotRevision')
      const db = await getDb()
      const existing = await readState(db, accountId, snapshot.sessionId)
      if (
        existing && !existing.deleted && !existing.hasOlder &&
        existing.cachedBodyRevision === snapshot.snapshotRevision
      ) return existing
      let result: PersonalSessionBodyState | null = null
      await withWriteTransaction(db, async () => {
        const current = await requireWritableState(db, accountId, snapshot.sessionId)
        if (current && snapshot.snapshotRevision < current.cachedBodyRevision) {
          if (options?.replaceCachedRevision !== current.cachedBodyRevision) {
            throw new PersonalBodyRevisionError('stale_snapshot', 'snapshot is older than local cache')
          }
          // A repeated snapshot from the same machine authority proves that the
          // phone replica is ahead of its origin. Replace only this session in
          // the same transaction that commits the authoritative snapshot.
          await db.runAsync(
            'DELETE FROM personal_session_messages WHERE accountId = ? AND sessionId = ?',
            accountId,
            snapshot.sessionId,
          )
          await db.runAsync(
            'DELETE FROM personal_session_message_tombstones WHERE accountId = ? AND sessionId = ?',
            accountId,
            snapshot.sessionId,
          )
        }
        for (const entry of snapshot.messages) {
          assertEnvelope(entry.message, snapshot.sessionId)
          assertRevision(entry.sequence, 'sequence')
          assertRevision(entry.revision, 'message revision')
          if (entry.revision > snapshot.snapshotRevision) {
            throw new PersonalBodyRevisionError('invalid_payload', 'message exceeds snapshot revision')
          }
          assertDeliveryState(entry.deliveryState)
        }
        if (snapshot.messages.length === 0) {
          await db.runAsync(
            'DELETE FROM personal_session_messages WHERE accountId = ? AND sessionId = ?',
            accountId,
            snapshot.sessionId,
          )
        } else {
          const first = Math.min(...snapshot.messages.map((entry) => entry.sequence))
          await db.runAsync(
            `DELETE FROM personal_session_messages
              WHERE accountId = ? AND sessionId = ? AND sequence >= ? AND revision <= ?`,
            accountId,
            snapshot.sessionId,
            first,
            snapshot.snapshotRevision,
          )
          for (const entry of snapshot.messages) {
            await upsertMessage(
              db,
              accountId,
              snapshot.sessionId,
              entry.message,
              entry.sequence,
              entry.revision,
              entry.deliveryState,
            )
          }
        }
        const bounds = await refreshBounds(db, accountId, snapshot.sessionId)
        const now = new Date().toISOString()
        result = {
          accountId,
          sessionId: snapshot.sessionId,
          cachedBodyRevision: snapshot.snapshotRevision,
          firstCachedSeq: bounds.first,
          lastCachedSeq: bounds.last,
          hasOlder: snapshot.hasOlder && (
            bounds.first === null || snapshot.firstAvailableSeq === null ||
            bounds.first > snapshot.firstAvailableSeq
          ),
          lastSyncedAt: now,
          lastAccessedAt: now,
          deletionRevision: current?.deletionRevision ?? 0,
          deleted: false,
        }
        await writeState(db, result)
        await publishSessionIndexIfBodyReady(db, snapshot.sessionId)
      })
      notify(result!)
      return result!
    },

    async applyPage(accountId, page) {
      assertIdentity(accountId, page.sessionId)
      assertAuthorityIdentity(page)
      const db = await getDb()
      let result: PersonalSessionBodyState | null = null
      await withWriteTransaction(db, async () => {
        const current = await requireWritableState(db, accountId, page.sessionId)
        if (!current || page.snapshotRevision > current.cachedBodyRevision) {
          throw new PersonalBodyRevisionError('revision_gap', 'page has no matching open snapshot')
        }
        const first = page.firstAvailableSeq
        if (page.messages.length > 0 && first === null) {
          throw new PersonalBodyRevisionError('invalid_payload', 'page sequence is missing')
        }
        for (const entry of page.messages) {
          if (entry.revision > page.snapshotRevision) {
            throw new PersonalBodyRevisionError('invalid_payload', 'page message exceeds snapshot revision')
          }
          assertDeliveryState(entry.deliveryState)
          await upsertMessage(
            db,
            accountId,
            page.sessionId,
            entry.message,
            entry.sequence,
            entry.revision,
            entry.deliveryState,
          )
        }
        const bounds = await refreshBounds(db, accountId, page.sessionId)
        result = {
          ...current,
          firstCachedSeq: bounds.first,
          lastCachedSeq: bounds.last,
          hasOlder: page.hasOlder && (
            bounds.first === null || page.firstAvailableSeq === null ||
            bounds.first > page.firstAvailableSeq
          ),
          lastAccessedAt: new Date().toISOString(),
        }
        await writeState(db, result)
      })
      notify(result!)
      return result!
    },

    async applyDelta(accountId, delta) {
      assertIdentity(accountId, delta.sessionId)
      assertAuthorityIdentity(delta)
      const db = await getDb()
      let result: PersonalSessionBodyState | null = null
      await withWriteTransaction(db, async () => {
        const current = await requireWritableState(db, accountId, delta.sessionId)
        validateBodyDelta(current?.cachedBodyRevision ?? 0, delta)
        for (const mutation of delta.mutations) {
          if (mutation.mutation === 'tombstone') {
            await db.runAsync(
              `INSERT INTO personal_session_message_tombstones
                 (accountId, sessionId, messageId, revision) VALUES (?, ?, ?, ?)
               ON CONFLICT(accountId, sessionId, messageId) DO UPDATE SET revision = excluded.revision
               WHERE excluded.revision > personal_session_message_tombstones.revision`,
              accountId,
              delta.sessionId,
              mutation.messageId,
              mutation.revision,
            )
            await db.runAsync(
              `DELETE FROM personal_session_messages
                WHERE accountId = ? AND sessionId = ? AND messageId = ? AND revision <= ?`,
              accountId,
              delta.sessionId,
              mutation.messageId,
              mutation.revision,
            )
          } else {
            await upsertMessage(
              db,
              accountId,
              delta.sessionId,
              mutation.message!,
              mutation.sequence,
              mutation.revision,
              mutation.deliveryState,
            )
          }
        }
        const bounds = await refreshBounds(db, accountId, delta.sessionId)
        const now = new Date().toISOString()
        result = {
          accountId,
          sessionId: delta.sessionId,
          cachedBodyRevision: delta.toRevision,
          firstCachedSeq: bounds.first,
          lastCachedSeq: bounds.last,
          hasOlder: current?.hasOlder ?? false,
          lastSyncedAt: now,
          lastAccessedAt: now,
          deletionRevision: current?.deletionRevision ?? 0,
          deleted: false,
        }
        await writeState(db, result)
        await publishSessionIndexIfBodyReady(db, delta.sessionId)
      })
      notify(result!)
      return result!
    },

    async restoreSession(accountId, sessionId, deletionRevision) {
      assertIdentity(accountId, sessionId)
      assertRevision(deletionRevision, 'deletionRevision')
      const db = await getDb()
      let result: PersonalSessionBodyState | null = null
      await withWriteTransaction(db, async () => {
        const current = await readState(db, accountId, sessionId)
        if (!current?.deleted) return
        if (deletionRevision < current.deletionRevision) {
          throw new PersonalBodyRevisionError(
            'session_deleted',
            'session restoration is older than the local deletion',
          )
        }
        const now = new Date().toISOString()
        result = {
          accountId,
          sessionId,
          cachedBodyRevision: 0,
          firstCachedSeq: null,
          lastCachedSeq: null,
          hasOlder: false,
          lastSyncedAt: null,
          lastAccessedAt: now,
          deletionRevision,
          deleted: false,
        }
        await writeState(db, result)
      })
      if (result) notify(result)
    },

    async markDeleted(accountId, sessionId, deletionRevision) {
      assertIdentity(accountId, sessionId)
      assertRevision(deletionRevision, 'deletionRevision')
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        const current = await readState(db, accountId, sessionId)
        if (current && deletionRevision < current.deletionRevision) return
        await db.runAsync(
          'DELETE FROM personal_session_messages WHERE accountId = ? AND sessionId = ?',
          accountId,
          sessionId,
        )
        await db.runAsync(
          'DELETE FROM personal_session_message_tombstones WHERE accountId = ? AND sessionId = ?',
          accountId,
          sessionId,
        )
        const now = new Date().toISOString()
        await writeState(db, {
          accountId,
          sessionId,
          cachedBodyRevision: current?.cachedBodyRevision ?? 0,
          firstCachedSeq: null,
          lastCachedSeq: null,
          hasOlder: false,
          lastSyncedAt: current?.lastSyncedAt ?? null,
          lastAccessedAt: now,
          deletionRevision,
          deleted: true,
        })
        await db.runAsync(
          'DELETE FROM personal_session_published_index WHERE accountId = ? AND sessionId = ?',
          accountId,
          sessionId,
        )
      })
    },

    async removeAccount(accountId) {
      if (!accountId) return
      const db = await getDb()
      await withWriteTransaction(db, async () => {
        await db.runAsync('DELETE FROM personal_session_messages WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM personal_session_message_tombstones WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM personal_session_body_state WHERE accountId = ?', accountId)
        await db.runAsync('DELETE FROM personal_session_published_index WHERE accountId = ?', accountId)
      })
    },

    subscribe(accountId, sessionId, listener) {
      assertIdentity(accountId, sessionId)
      const key = `${accountId}\u0000${sessionId}`
      const set = listeners.get(key) ?? new Set()
      set.add(listener)
      listeners.set(key, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },
  }
}
