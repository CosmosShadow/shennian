// @arch docs/features/agent-local-first-persistence.md
// @test src/__tests__/client-local-persistence.test.ts

import {
  incrementRuntimeMetric,
  type ClientDataStore,
  type ClientIndexStore,
  type LocalSessionDeletion,
} from '@shennian/shared'
import type { AgentInfo, Machine, NianProject, NianSession } from '@shennian/wire'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'
import * as SQLite from 'expo-sqlite'
import { Platform } from 'react-native'
import {
  createPersonalSessionBodyStore,
  initializePersonalSessionBodySchema,
  publishSessionIndexIfBodyReady,
} from './personal-session-body-store.native'
import { createRoomAgentStore, initializeRoomAgentSchema } from './room-agent-store.native'
import { withWrite, withWriteTransaction } from './sqlite-write-queue.native'

const DB_NAME = 'shennian.db'

let database: SQLite.SQLiteDatabase | null = null
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null

type SessionRow = {
  id: string
  localCreationState: NianSession['localCreationState'] | null
  nativeSessionVisibility: NianSession['nativeSessionVisibility'] | null
  sessionScope: string | null
  sessionMode: NianSession['sessionMode'] | null
  managerConfig: string | null
  agentIdentityId: string | null
  machineId: string
  userId: string
  agentType: string
  agentSessionId: string | null
  sourceMode: string | null
  modelId: string | null
  modelSource: string | null
  agentDefaultModelId: string | null
  agentSystemPrompt: string | null
  title: string
  status: string
  workDir: string
  lastMessagePreview: string | null
  lastMessagePreviewMessageId: string | null
  lastMessagePreviewAt: string | null
  lastUserMessageAt: string | null
  lastVisibleEventAt: string | null
  lastActivityAt: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  machineName: string | null
  userState: string | null
  activity: string | null
  externalChannel: string | null
  bodyStorageMode: string | null
  localReady: number
  bodyRevision: number
  indexRevision: number
  lastBodyCommittedAt: string | null
  titleSource: string | null
  titleRevision: number
  titleLockedByUser: number
  titleOriginEventId: string | null
  firstAvailableSeq: number | null
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  attentionCount: number
  lastAttentionId: string | null
  deletionRevision: number
}

type PublishedSessionRow = SessionRow & {
  derivedLastUserMessageAt: string | null
  publishedIndexRevision: number | null
  publishedBodyRevision: number | null
  publishedLastMessagePreview: string | null
  publishedLastMessagePreviewMessageId: string | null
  publishedLastMessagePreviewAt: string | null
  publishedLastVisibleEventAt: string | null
  publishedLastActivityAt: string | null
  publishedLastBodyCommittedAt: string | null
  publishedFirstAvailableSeq: number | null
  publishedVisibleMessageCount: number | null
  publishedLastVisibleMessageId: string | null
  publishedAttentionCount: number | null
  publishedLastAttentionId: string | null
  publishedUpdatedAt: string | null
}

type ProjectRow = Omit<NianProject, 'machineOnline'> & { machineOnline: number }

function mapSessionRow(row: SessionRow): NianSession {
  const managerConfig: NianSession['managerConfig'] = row.managerConfig ? JSON.parse(row.managerConfig) : null
  return {
    id: row.id,
    localCreationState: row.localCreationState ?? undefined,
    sessionMode: row.sessionMode ?? undefined,
    nativeSessionVisibility: row.nativeSessionVisibility ?? 'user',
    ...(row.sessionScope === 'steward' ? { sessionScope: 'steward' as const } : {}),
    managerConfig,
    managerDefaultWorkerAgentType: managerConfig?.defaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: managerConfig?.defaultWorkerModelId ?? null,
    agentIdentityId: row.agentIdentityId,
    machineId: row.machineId,
    userId: row.userId,
    agentType: row.agentType as NianSession['agentType'],
    agentSessionId: row.agentSessionId,
    sourceMode: row.sourceMode as NianSession['sourceMode'],
    modelId: row.modelId,
    modelSource: row.modelSource === 'agent' ? 'agent' : 'session',
    agentDefaultModelId: row.agentDefaultModelId,
    agentSystemPrompt: row.agentSystemPrompt,
    title: row.title,
    status: row.status as NianSession['status'],
    workDir: row.workDir ?? '',
    lastMessagePreview: row.lastMessagePreview,
    lastMessagePreviewMessageId: row.lastMessagePreviewMessageId,
    lastMessagePreviewAt: row.lastMessagePreviewAt,
    lastUserMessageAt: row.lastUserMessageAt,
    lastVisibleEventAt: row.lastVisibleEventAt,
    lastActivityAt: row.lastActivityAt || row.updatedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    machineName: row.machineName ?? null,
    userState: row.userState ? JSON.parse(row.userState) : null,
    activity: row.activity ? JSON.parse(row.activity) : null,
    externalChannel: row.externalChannel ? JSON.parse(row.externalChannel) : null,
    bodyStorageMode: row.bodyStorageMode === 'machine_local' ? 'machine_local' : undefined,
    localReady: row.localReady === 1,
    bodyRevision: row.bodyRevision,
    indexRevision: row.indexRevision,
    lastBodyCommittedAt: row.lastBodyCommittedAt,
    titleSource: row.titleSource as NianSession['titleSource'],
    titleRevision: row.titleRevision,
    titleLockedByUser: row.titleLockedByUser === 1,
    titleOriginEventId: row.titleOriginEventId,
    firstAvailableSeq: row.firstAvailableSeq,
    visibleMessageCount: row.visibleMessageCount,
    lastVisibleMessageId: row.lastVisibleMessageId,
    attentionCount: row.attentionCount,
    lastAttentionId: row.lastAttentionId,
    deletionRevision: row.deletionRevision,
  }
}

function mapPublishedSessionRow(row: PublishedSessionRow): NianSession {
  const session = {
    ...mapSessionRow(row),
    lastUserMessageAt: row.derivedLastUserMessageAt || row.lastUserMessageAt || null,
  }
  if (row.publishedIndexRevision === null) {
    // Local lifecycle grants access to configuration, not unpublished remote text.
    return {
      ...session, bodyRevision: 0, indexRevision: 0,
      lastMessagePreview: null, lastMessagePreviewMessageId: null, lastMessagePreviewAt: null,
      lastVisibleEventAt: null, lastBodyCommittedAt: null, firstAvailableSeq: null,
      visibleMessageCount: 0, lastVisibleMessageId: null, attentionCount: 0, lastAttentionId: null,
    }
  }
  return {
    ...session,
    indexRevision: row.publishedIndexRevision,
    bodyRevision: row.publishedBodyRevision ?? 0,
    lastMessagePreview: row.publishedLastMessagePreview,
    lastMessagePreviewMessageId: row.publishedLastMessagePreviewMessageId,
    lastMessagePreviewAt: row.publishedLastMessagePreviewAt,
    lastVisibleEventAt: row.publishedLastVisibleEventAt,
    lastActivityAt: row.publishedLastActivityAt ?? session.lastActivityAt,
    lastBodyCommittedAt: row.publishedLastBodyCommittedAt,
    firstAvailableSeq: row.publishedFirstAvailableSeq,
    visibleMessageCount: row.publishedVisibleMessageCount ?? 0,
    lastVisibleMessageId: row.publishedLastVisibleMessageId,
    attentionCount: row.publishedAttentionCount ?? 0,
    lastAttentionId: row.publishedLastAttentionId,
    updatedAt: row.publishedUpdatedAt ?? session.updatedAt,
  }
}

const PUBLISHED_SESSION_SELECT = `
  SELECT sessions.*,
         MAX(COALESCE(sessions.lastUserMessageAt, ''), COALESCE((
           SELECT strftime('%Y-%m-%dT%H:%M:%fZ', message.ts / 1000.0, 'unixepoch')
           FROM personal_session_messages message
           WHERE message.accountId = sessions.userId AND message.sessionId = sessions.id
             AND message.role = 'user'
           ORDER BY message.ts DESC LIMIT 1
         ), '')) AS derivedLastUserMessageAt,
         published.indexRevision AS publishedIndexRevision,
         published.bodyRevision AS publishedBodyRevision,
         published.lastMessagePreview AS publishedLastMessagePreview,
         published.lastMessagePreviewMessageId AS publishedLastMessagePreviewMessageId,
         published.lastMessagePreviewAt AS publishedLastMessagePreviewAt,
         published.lastVisibleEventAt AS publishedLastVisibleEventAt,
         published.lastActivityAt AS publishedLastActivityAt,
         published.lastBodyCommittedAt AS publishedLastBodyCommittedAt,
         published.firstAvailableSeq AS publishedFirstAvailableSeq,
         published.visibleMessageCount AS publishedVisibleMessageCount,
         published.lastVisibleMessageId AS publishedLastVisibleMessageId,
         published.attentionCount AS publishedAttentionCount,
         published.lastAttentionId AS publishedLastAttentionId,
         published.updatedAt AS publishedUpdatedAt
    FROM sessions
    LEFT JOIN personal_session_published_index published
      ON published.accountId = sessions.userId AND published.sessionId = sessions.id`

function sessionParams(session: NianSession) {
  const now = new Date().toISOString()
  return [
    session.id,
    session.agentIdentityId ?? null,
    session.machineId,
    session.userId,
    session.agentType ?? 'claude',
    session.agentSessionId ?? null,
    session.sourceMode ?? null,
    session.modelId ?? null,
    session.modelSource ?? 'session',
    session.agentDefaultModelId ?? null,
    session.agentSystemPrompt ?? null,
    session.title ?? '',
    session.status ?? 'active',
    session.workDir ?? '',
    session.lastMessagePreview ?? null,
    session.lastMessagePreviewMessageId ?? null,
    session.lastMessagePreviewAt ?? null,
    session.lastVisibleEventAt ?? null,
    session.lastUserMessageAt ?? null,
    session.lastActivityAt || session.updatedAt || now,
    session.deletedAt ?? null,
    session.createdAt || now,
    session.updatedAt || now,
    session.machineName ?? null,
    session.userState ? JSON.stringify(session.userState) : null,
    session.activity ? JSON.stringify(session.activity) : null,
    session.externalChannel ? JSON.stringify(session.externalChannel) : null,
    session.bodyStorageMode ?? 'machine_local',
    session.localReady ? 1 : 0,
    session.bodyRevision ?? 0,
    session.indexRevision ?? 0,
    session.lastBodyCommittedAt ?? null,
    session.titleSource ?? 'first_user_fallback',
    session.titleRevision ?? 0,
    session.titleLockedByUser ? 1 : 0,
    session.titleOriginEventId ?? null,
    session.firstAvailableSeq ?? null,
    session.visibleMessageCount ?? 0,
    session.lastVisibleMessageId ?? null,
    session.attentionCount ?? 0,
    session.lastAttentionId ?? null,
    session.deletionRevision ?? 0,
    session.localCreationState ?? null,
    session.sessionMode ?? null,
    session.managerConfig ? JSON.stringify(session.managerConfig) : null,
    session.nativeSessionVisibility ?? 'user',
  ] as const
}

async function initializeDraftSyncCursor(db: SQLite.SQLiteDatabase, session: NianSession): Promise<void> {
  if (session.localCreationState !== 'draft') return
  // Local creation time is not a remote sync watermark. Initialize atomically,
  // without rolling back a cursor advanced by a concurrent sync transaction.
  await db.runAsync(`INSERT INTO meta (key, value) VALUES ('sessionSyncCursor', '1')
    ON CONFLICT(key) DO UPDATE SET value = CASE
      WHEN CAST(meta.value AS INTEGER) = 0 THEN '1' ELSE meta.value END`)
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  // The connection is assigned before schema migrations finish. While an
  // initialization promise exists, every caller must wait for that full chain.
  if (!databasePromise) {
    if (database) return database
    const pending = initializeDb()
    databasePromise = pending
    void pending.catch(() => {
      if (databasePromise !== pending) return
      database = null
      databasePromise = null
    })
  }
  return databasePromise
}

async function initializeDb(): Promise<SQLite.SQLiteDatabase> {
  database = await SQLite.openDatabaseAsync(
    DB_NAME,
    Platform.OS === 'android' ? { useNewConnection: true } : undefined,
  )
  await database.execAsync(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    DROP TABLE IF EXISTS messages;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      machineId TEXT NOT NULL,
      userId TEXT NOT NULL,
      agentType TEXT NOT NULL,
      agentSessionId TEXT,
      sourceMode TEXT,
      modelId TEXT,
      modelSource TEXT NOT NULL DEFAULT 'session',
      agentDefaultModelId TEXT,
      agentSystemPrompt TEXT,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      workDir TEXT NOT NULL DEFAULT '',
      lastMessagePreview TEXT,
      lastMessagePreviewMessageId TEXT,
      lastMessagePreviewAt TEXT,
      lastVisibleEventAt TEXT,
      lastUserMessageAt TEXT,
      lastActivityAt TEXT NOT NULL DEFAULT '',
      deletedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      machineName TEXT,
      userState TEXT,
      activity TEXT,
      externalChannel TEXT
      ,bodyStorageMode TEXT NOT NULL DEFAULT 'machine_local'
      ,localReady INTEGER NOT NULL DEFAULT 0
      ,bodyRevision INTEGER NOT NULL DEFAULT 0
      ,indexRevision INTEGER NOT NULL DEFAULT 0
      ,lastBodyCommittedAt TEXT
      ,titleSource TEXT NOT NULL DEFAULT 'first_user_fallback'
      ,titleRevision INTEGER NOT NULL DEFAULT 0
      ,titleLockedByUser INTEGER NOT NULL DEFAULT 0
      ,titleOriginEventId TEXT
      ,firstAvailableSeq INTEGER
      ,visibleMessageCount INTEGER NOT NULL DEFAULT 0
      ,lastVisibleMessageId TEXT
      ,attentionCount INTEGER NOT NULL DEFAULT 0
      ,lastAttentionId TEXT
      ,deletionRevision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(lastActivityAt);
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      os TEXT NOT NULL,
      agentList TEXT NOT NULL DEFAULT '[]',
      agents TEXT,
      paired INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 0,
      lastSeen TEXT NOT NULL,
      cliVersion TEXT,
      autoUpgrade TEXT NOT NULL DEFAULT 'none',
      sessionSyncProtocolVersion INTEGER,
      sessionSyncDataEpoch INTEGER,
      sessionSyncCapabilities TEXT,
      daemonInstallationId TEXT
      ,remoteAccessDisabledAt TEXT
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      machineId TEXT NOT NULL,
      machineName TEXT NOT NULL,
      machineOnline INTEGER NOT NULL DEFAULT 0,
      workDir TEXT NOT NULL,
      displayName TEXT NOT NULL,
      lastActivityAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_machine_workdir ON projects(machineId, workDir);
    CREATE INDEX IF NOT EXISTS idx_projects_activity ON projects(lastActivityAt);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_deletions (
      sessionId TEXT PRIMARY KEY,
      deletedAt TEXT NOT NULL,
      state TEXT NOT NULL,
      nativeCleanupPolicy TEXT NOT NULL DEFAULT 'none'
    );
    CREATE INDEX IF NOT EXISTS idx_session_deletions_state ON session_deletions(state);
  `)
  await initializeRoomAgentSchema(database)
  await initializePersonalSessionBodySchema(database)
  await database
    .execAsync(
      `ALTER TABLE session_deletions ADD COLUMN nativeCleanupPolicy TEXT NOT NULL DEFAULT 'none';`,
    )
    .catch(() => {
      /* column already exists, ignore */
    })
  // Safe migration: add lastMessagePreview column if it doesn't exist yet
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN lastMessagePreview TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN lastMessagePreviewMessageId TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN lastMessagePreviewAt TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN lastUserMessageAt TEXT;`).catch(() => {
    /* column already exists */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN lastVisibleEventAt TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN modelId TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN agentIdentityId TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database
    .execAsync(`ALTER TABLE sessions ADD COLUMN modelSource TEXT NOT NULL DEFAULT 'session';`)
    .catch(() => {
      /* column already exists, ignore */
    })
  await database
    .execAsync(`ALTER TABLE sessions ADD COLUMN agentDefaultModelId TEXT;`)
    .catch(() => {
      /* column already exists, ignore */
    })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN agentSystemPrompt TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN sourceMode TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database
    .execAsync(`ALTER TABLE sessions ADD COLUMN lastActivityAt TEXT NOT NULL DEFAULT '';`)
    .catch(() => {
      /* column already exists, ignore */
    })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN deletedAt TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN machineName TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN userState TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN activity TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE sessions ADD COLUMN externalChannel TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  for (const migration of [
    `ALTER TABLE sessions ADD COLUMN bodyStorageMode TEXT NOT NULL DEFAULT 'machine_local';`,
    `ALTER TABLE sessions ADD COLUMN localReady INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN bodyRevision INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN indexRevision INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN lastBodyCommittedAt TEXT;`,
    `ALTER TABLE sessions ADD COLUMN titleSource TEXT NOT NULL DEFAULT 'first_user_fallback';`,
    `ALTER TABLE sessions ADD COLUMN titleRevision INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN titleLockedByUser INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN titleOriginEventId TEXT;`,
    `ALTER TABLE sessions ADD COLUMN firstAvailableSeq INTEGER;`,
    `ALTER TABLE sessions ADD COLUMN visibleMessageCount INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN lastVisibleMessageId TEXT;`,
    `ALTER TABLE sessions ADD COLUMN attentionCount INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE sessions ADD COLUMN lastAttentionId TEXT;`,
    `ALTER TABLE sessions ADD COLUMN deletionRevision INTEGER NOT NULL DEFAULT 0;`,
  ]) {
    await database.execAsync(migration).catch(() => {
      /* one-time hard-cut schema may already be installed */
    })
  }
  await database
    .execAsync(
      `UPDATE sessions SET lastActivityAt = updatedAt WHERE lastActivityAt IS NULL OR lastActivityAt = '';`,
    )
    .catch(() => {
      /* ignore */
    })

  for (const column of ['localCreationState', 'sessionMode', 'managerConfig', 'nativeSessionVisibility', 'sessionScope']) {
    await database.execAsync(`ALTER TABLE sessions ADD COLUMN ${column} TEXT;`).catch(() => {})
  }

  // Safe migration: add cliVersion column to machines
  await database.execAsync(`ALTER TABLE machines ADD COLUMN cliVersion TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database.execAsync(`ALTER TABLE machines ADD COLUMN agents TEXT;`).catch(() => {
    /* column already exists, ignore */
  })
  await database
    .execAsync(`ALTER TABLE machines ADD COLUMN autoUpgrade TEXT NOT NULL DEFAULT 'none';`)
    .catch(() => {
      /* column already exists, ignore */
    })
  for (const migration of [
    `ALTER TABLE machines ADD COLUMN sessionSyncProtocolVersion INTEGER;`,
    `ALTER TABLE machines ADD COLUMN sessionSyncDataEpoch INTEGER;`,
    `ALTER TABLE machines ADD COLUMN sessionSyncCapabilities TEXT;`,
    `ALTER TABLE machines ADD COLUMN daemonInstallationId TEXT;`,
    `ALTER TABLE machines ADD COLUMN remoteAccessDisabledAt TEXT;`,
  ]) {
    await database.execAsync(migration).catch(() => {
      /* column already exists, ignore */
    })
  }

  const publishable = await database.getAllAsync<{ id: string }>(
    `SELECT sessions.id FROM sessions
       LEFT JOIN personal_session_body_state body
         ON body.accountId = sessions.userId AND body.sessionId = sessions.id
      WHERE sessions.bodyRevision > 0
        AND body.deleted = 0 AND body.cachedBodyRevision >= sessions.bodyRevision`,
  )
  for (const row of publishable) await publishSessionIndexIfBodyReady(database, row.id)

  return database
}

class MobileSQLiteStore implements ClientIndexStore {
  // --- Sessions ---

  async getSessions(): Promise<NianSession[]> {
    const db = await getDb()
    const rows = await db.getAllAsync<PublishedSessionRow>(
      `${PUBLISHED_SESSION_SELECT}
       WHERE sessions.deletedAt IS NULL
         AND (published.sessionId IS NOT NULL OR sessions.localCreationState IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM session_deletions deletion WHERE deletion.sessionId = sessions.id
         )
       ORDER BY COALESCE(NULLIF(derivedLastUserMessageAt, ''), sessions.createdAt) DESC,
                sessions.createdAt DESC, sessions.id ASC`,
    )
    incrementRuntimeMetric('sqlite.read_queries')
    return rows.map(mapPublishedSessionRow)
  }

  async getSession(id: string): Promise<NianSession | undefined> {
    const db = await getDb()
    const row = await db.getFirstAsync<PublishedSessionRow | null>(
      `${PUBLISHED_SESSION_SELECT}
        WHERE sessions.id = ?
          AND sessions.deletedAt IS NULL
          AND (published.sessionId IS NOT NULL OR sessions.localCreationState IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM session_deletions deletion WHERE deletion.sessionId = sessions.id
          )`,
      id,
    )
    incrementRuntimeMetric('sqlite.read_queries')
    return row ? mapPublishedSessionRow(row) : undefined
  }

  async getSessionSyncTargets(): Promise<NianSession[]> {
    incrementRuntimeMetric('sqlite.session_target_full_scans')
    const db = await getDb()
    const rows = await db.getAllAsync<SessionRow>(
      `SELECT * FROM sessions WHERE deletedAt IS NULL
       ORDER BY COALESCE(lastVisibleEventAt, lastMessagePreviewAt, lastActivityAt) DESC,
                updatedAt DESC`,
    )
    incrementRuntimeMetric('sqlite.read_queries')
    return rows.map(mapSessionRow)
  }

  async getSessionSyncTarget(id: string): Promise<NianSession | undefined> {
    incrementRuntimeMetric('sqlite.session_target_reads')
    const db = await getDb()
    const row = await db.getFirstAsync<SessionRow | null>('SELECT * FROM sessions WHERE id = ?', id)
    incrementRuntimeMetric('sqlite.read_queries')
    return row ? mapSessionRow(row) : undefined
  }

  async putSession(session: NianSession): Promise<void> {
    const db = await getDb()
    const params = sessionParams(session)
    try {
      await withWriteTransaction(db, async () => {
        await db.runAsync(
          `INSERT OR REPLACE INTO sessions
         (id, agentIdentityId, machineId, userId, agentType, agentSessionId, sourceMode, modelId, modelSource, agentDefaultModelId, agentSystemPrompt, title, status, workDir, lastMessagePreview, lastMessagePreviewMessageId, lastMessagePreviewAt, lastVisibleEventAt, lastUserMessageAt, lastActivityAt, deletedAt, createdAt, updatedAt, machineName, userState, activity, externalChannel, bodyStorageMode, localReady, bodyRevision, indexRevision, lastBodyCommittedAt, titleSource, titleRevision, titleLockedByUser, titleOriginEventId, firstAvailableSeq, visibleMessageCount, lastVisibleMessageId, attentionCount, lastAttentionId, deletionRevision, localCreationState, sessionMode, managerConfig, nativeSessionVisibility, sessionScope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'internal' OR (SELECT nativeSessionVisibility FROM sessions WHERE id = ?) = 'internal' THEN 'internal' ELSE 'user' END, CASE WHEN ? = 'steward' OR (SELECT sessionScope FROM sessions WHERE id = ?) = 'steward' THEN 'steward' ELSE 'personal' END)`,
          ...params,
          session.id,
          session.sessionScope ?? 'personal',
          session.id,
        )
        await initializeDraftSyncCursor(db, session)
        await publishSessionIndexIfBodyReady(db, session.id)
      })
      incrementRuntimeMetric('sqlite.write_statements')
    } catch (err) {
      const undefinedIdx = params.findIndex((p) => p === undefined)
      if (undefinedIdx !== -1) {
        console.error(
          `[db] putSession: undefined param at index ${undefinedIdx}`,
        )
      } else {
        console.error('[db] putSession failed:', err)
      }
      throw err
    }
  }

  async putSessions(sessions: NianSession[]): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      for (const s of sessions) {
        const params = sessionParams(s)
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO sessions
             (id, agentIdentityId, machineId, userId, agentType, agentSessionId, sourceMode, modelId, modelSource, agentDefaultModelId, agentSystemPrompt, title, status, workDir, lastMessagePreview, lastMessagePreviewMessageId, lastMessagePreviewAt, lastVisibleEventAt, lastUserMessageAt, lastActivityAt, deletedAt, createdAt, updatedAt, machineName, userState, activity, externalChannel, bodyStorageMode, localReady, bodyRevision, indexRevision, lastBodyCommittedAt, titleSource, titleRevision, titleLockedByUser, titleOriginEventId, firstAvailableSeq, visibleMessageCount, lastVisibleMessageId, attentionCount, lastAttentionId, deletionRevision, localCreationState, sessionMode, managerConfig, nativeSessionVisibility, sessionScope)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'internal' OR (SELECT nativeSessionVisibility FROM sessions WHERE id = ?) = 'internal' THEN 'internal' ELSE 'user' END, CASE WHEN ? = 'steward' OR (SELECT sessionScope FROM sessions WHERE id = ?) = 'steward' THEN 'steward' ELSE 'personal' END)`,
            ...params,
            s.id,
            s.sessionScope ?? 'personal',
            s.id,
          )
          await initializeDraftSyncCursor(db, s)
          await publishSessionIndexIfBodyReady(db, s.id)
        } catch (err) {
          const undefinedIdx = params.findIndex((p) => p === undefined)
          console.error(
            `[db] putSessions failed, undefinedIdx=${undefinedIdx}:`,
            err,
          )
          throw err
        }
      }
    })
    incrementRuntimeMetric('sqlite.transactions')
    incrementRuntimeMetric('sqlite.write_statements', sessions.length)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM sessions WHERE id = ?', sessionId)
      await db.runAsync('DELETE FROM personal_session_published_index WHERE sessionId = ?', sessionId)
    })
  }

  async getSessionDeletion(sessionId: string): Promise<LocalSessionDeletion | undefined> {
    const db = await getDb()
    const row = await db.getFirstAsync<LocalSessionDeletion | null>(
      'SELECT sessionId, deletedAt, state, nativeCleanupPolicy FROM session_deletions WHERE sessionId = ?',
      sessionId,
    )
    return row ?? undefined
  }

  async getPendingSessionDeletions(): Promise<LocalSessionDeletion[]> {
    const db = await getDb()
    return db.getAllAsync<LocalSessionDeletion>(
      "SELECT sessionId, deletedAt, state, nativeCleanupPolicy FROM session_deletions WHERE state = 'pending' ORDER BY deletedAt ASC",
    )
  }

  async putSessionDeletion(deletion: LocalSessionDeletion): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'INSERT OR REPLACE INTO session_deletions (sessionId, deletedAt, state, nativeCleanupPolicy) VALUES (?, ?, ?, ?)',
      deletion.sessionId,
      deletion.deletedAt,
      deletion.state,
      deletion.nativeCleanupPolicy ?? 'none',
    ))
  }

  async removeSessionDeletion(sessionId: string): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync('DELETE FROM session_deletions WHERE sessionId = ?', sessionId))
  }

  async getSessionSyncCursor(): Promise<number> {
    const db = await getDb()
    const row = await db.getFirstAsync<{ value: string } | null>(
      'SELECT value FROM meta WHERE key = ?',
      'sessionSyncCursor',
    )
    const value = Number(row?.value ?? 0)
    return Number.isFinite(value) ? value : 0
  }

  async setSessionSyncCursor(cursor: number): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'sessionSyncCursor',
      String(cursor),
    ))
  }

  async getSessionBackfillComplete(): Promise<boolean> {
    const db = await getDb()
    const row = await db.getFirstAsync<{ value: string } | null>(
      'SELECT value FROM meta WHERE key = ?',
      'sessionBackfillComplete',
    )
    return row?.value === '1'
  }

  async setSessionBackfillComplete(complete: boolean): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'sessionBackfillComplete',
      complete ? '1' : '0',
    ))
  }

  async getSessionBackfillCursor(): Promise<number> {
    const db = await getDb()
    const row = await db.getFirstAsync<{ value: string } | null>(
      'SELECT value FROM meta WHERE key = ?',
      'sessionBackfillCursor',
    )
    const value = Number(row?.value ?? 0)
    return Number.isFinite(value) ? value : 0
  }

  async setSessionBackfillCursor(cursor: number): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'sessionBackfillCursor',
      String(cursor),
    ))
  }

  async getSyncCacheVersion(): Promise<string | null> {
    const db = await getDb()
    const row = await db.getFirstAsync<{ value: string } | null>(
      'SELECT value FROM meta WHERE key = ?',
      'syncCacheVersion',
    )
    return row?.value ?? null
  }

  async setSyncCacheVersion(version: string): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'syncCacheVersion',
      version,
    ))
  }

  async resetPersonalData(): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM sessions')
      await db.runAsync('DELETE FROM projects')
      await db.runAsync('DELETE FROM session_deletions')
      await db.runAsync('DELETE FROM personal_session_messages')
      await db.runAsync('DELETE FROM personal_session_message_tombstones')
      await db.runAsync('DELETE FROM personal_session_body_state')
      await db.runAsync('DELETE FROM personal_session_published_index')
      await db.runAsync(
        `DELETE FROM meta WHERE key IN (
          'sessionSyncCursor', 'sessionBackfillComplete', 'sessionBackfillCursor', 'syncCacheVersion'
        )`,
      )
    })
  }

  // --- Projects ---

  async getProjects(): Promise<NianProject[]> {
    const db = await getDb()
    const rows = await db.getAllAsync<ProjectRow>(
      'SELECT * FROM projects ORDER BY lastActivityAt DESC, createdAt DESC',
    )
    return rows.map((project) => ({ ...project, machineOnline: project.machineOnline === 1 }))
  }

  async putProjects(projects: NianProject[]): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM projects')
      for (const project of projects) {
        await db.runAsync(
          `INSERT INTO projects
           (id, machineId, machineName, machineOnline, workDir, displayName, lastActivityAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project.id,
          project.machineId,
          project.machineName,
          project.machineOnline ? 1 : 0,
          project.workDir,
          project.displayName,
          project.lastActivityAt,
          project.createdAt,
          project.updatedAt,
        )
      }
    })
  }

  // --- Machines ---

  async getMachines(): Promise<Machine[]> {
    const db = await getDb()
    const rows = await db.getAllAsync<{
      id: string
      name: string
      os: string
      agentList: string
      agents: string | null
      paired: number
      online: number
      lastSeen: string
      cliVersion: string | null
      autoUpgrade: string | null
      sessionSyncProtocolVersion: number | null
      sessionSyncDataEpoch: number | null
      sessionSyncCapabilities: string | null
      daemonInstallationId: string | null
      remoteAccessDisabledAt: string | null
    }>('SELECT * FROM machines ORDER BY lastSeen DESC')
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      os: r.os,
      agentList: JSON.parse(r.agentList) as string[],
      ...(r.agents ? { agents: JSON.parse(r.agents) as AgentInfo[] } : {}),
      paired: r.paired === 1,
      online: r.online === 1,
      lastSeen: r.lastSeen,
      ...(r.cliVersion ? { cliVersion: r.cliVersion } : {}),
      autoUpgrade: r.autoUpgrade === 'patch' ? 'patch' : 'none',
      ...(r.sessionSyncProtocolVersion === SESSION_SYNC_PROTOCOL_VERSION
        ? { sessionSyncProtocolVersion: r.sessionSyncProtocolVersion }
        : {}),
      ...(r.sessionSyncDataEpoch === SESSION_SYNC_DATA_EPOCH
        ? { sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH }
        : {}),
      ...(r.sessionSyncCapabilities
        ? { sessionSyncCapabilities: JSON.parse(r.sessionSyncCapabilities) as Machine['sessionSyncCapabilities'] }
        : {}),
      ...(r.daemonInstallationId ? { daemonInstallationId: r.daemonInstallationId } : {}),
      remoteAccessDisabledAt: r.remoteAccessDisabledAt ?? null,
    }))
  }

  async updateMachineStatus(
    machineId: string,
    online: boolean,
    extra?: {
      cliVersion?: string
      region?: string
      autoUpgrade?: 'none' | 'patch'
      sessionSyncProtocolVersion?: Machine['sessionSyncProtocolVersion']
      sessionSyncDataEpoch?: Machine['sessionSyncDataEpoch']
      sessionSyncCapabilities?: Machine['sessionSyncCapabilities']
      daemonInstallationId?: string
      remoteAccessDisabledAt?: string | null
    },
  ): Promise<void> {
    const db = await getDb()
    if (extra?.cliVersion || extra?.autoUpgrade || extra?.sessionSyncProtocolVersion
      || extra?.sessionSyncDataEpoch
      || extra?.sessionSyncCapabilities || extra?.daemonInstallationId
      || (extra && Object.prototype.hasOwnProperty.call(extra, 'remoteAccessDisabledAt'))) {
      await withWrite(() => db.runAsync(
        'UPDATE machines SET online = ?, lastSeen = ?, cliVersion = COALESCE(?, cliVersion), autoUpgrade = COALESCE(?, autoUpgrade), sessionSyncProtocolVersion = COALESCE(?, sessionSyncProtocolVersion), sessionSyncDataEpoch = COALESCE(?, sessionSyncDataEpoch), sessionSyncCapabilities = COALESCE(?, sessionSyncCapabilities), daemonInstallationId = COALESCE(?, daemonInstallationId), remoteAccessDisabledAt = CASE WHEN ? = 1 THEN ? ELSE remoteAccessDisabledAt END WHERE id = ?',
        online ? 1 : 0,
        new Date().toISOString(),
        extra?.cliVersion ?? null,
        extra?.autoUpgrade ?? null,
        extra?.sessionSyncProtocolVersion ?? null,
        extra?.sessionSyncDataEpoch ?? null,
        extra?.sessionSyncCapabilities ? JSON.stringify(extra.sessionSyncCapabilities) : null,
        extra?.daemonInstallationId ?? null,
        extra && Object.prototype.hasOwnProperty.call(extra, 'remoteAccessDisabledAt') ? 1 : 0,
        extra?.remoteAccessDisabledAt ?? null,
        machineId,
      ))
    } else {
      await withWrite(() => db.runAsync(
        'UPDATE machines SET online = ?, lastSeen = ? WHERE id = ?',
        online ? 1 : 0,
        new Date().toISOString(),
        machineId,
      ))
    }
  }

  async updateMachineAgents(
    machineId: string,
    agentList: string[],
    agents: AgentInfo[],
  ): Promise<void> {
    const db = await getDb()
    await withWrite(() => db.runAsync(
      'UPDATE machines SET agentList = ?, agents = ? WHERE id = ?',
      JSON.stringify(agentList),
      JSON.stringify(agents),
      machineId,
    ))
  }

  async putMachines(machines: Machine[]): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM machines')
      for (const m of machines) {
        await db.runAsync(
          'INSERT OR REPLACE INTO machines (id, name, os, agentList, agents, paired, online, lastSeen, cliVersion, autoUpgrade, sessionSyncProtocolVersion, sessionSyncDataEpoch, sessionSyncCapabilities, daemonInstallationId, remoteAccessDisabledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          m.id,
          m.name,
          m.os,
          JSON.stringify(m.agentList ?? []),
          m.agents ? JSON.stringify(m.agents) : null,
          m.paired ? 1 : 0,
          m.online ? 1 : 0,
          m.lastSeen || new Date().toISOString(),
          m.cliVersion ?? null,
          m.autoUpgrade === 'patch' ? 'patch' : 'none',
          m.sessionSyncProtocolVersion ?? null,
          m.sessionSyncDataEpoch ?? null,
          m.sessionSyncCapabilities ? JSON.stringify(m.sessionSyncCapabilities) : null,
          m.daemonInstallationId ?? null,
          m.remoteAccessDisabledAt ?? null,
        )
      }
    })
  }

  async clearAll(): Promise<void> {
    const db = await getDb()
    await withWriteTransaction(db, async () => {
      await db.runAsync('DELETE FROM sessions')
      await db.runAsync('DELETE FROM machines')
      await db.runAsync('DELETE FROM projects')
      await db.runAsync('DELETE FROM session_deletions')
      await db.runAsync('DELETE FROM room_summaries')
      await db.runAsync('DELETE FROM room_messages')
      await db.runAsync('DELETE FROM room_members')
      await db.runAsync('DELETE FROM room_sync_state')
      await db.runAsync('DELETE FROM room_join_requests')
      await db.runAsync('DELETE FROM agent_workspaces')
      await db.runAsync('DELETE FROM agent_private_configs')
      await db.runAsync('DELETE FROM agent_session_links')
      await db.runAsync('DELETE FROM personal_session_messages')
      await db.runAsync('DELETE FROM personal_session_message_tombstones')
      await db.runAsync('DELETE FROM personal_session_body_state')
      await db.runAsync('DELETE FROM personal_session_published_index')
      await db.runAsync('DELETE FROM meta')
    })
  }
}

const coreStore = new MobileSQLiteStore()
export const db: ClientDataStore = Object.assign(coreStore, createRoomAgentStore(getDb))
export const personalSessionBodyStore = createPersonalSessionBodyStore(getDb)
