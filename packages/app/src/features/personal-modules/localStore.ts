import { locationStore } from './locationStore'
// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import * as SQLite from 'expo-sqlite'
import { ApiError } from '@shennian/shared'
import { getApiBaseUrl } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import type { Transcript } from './types'
export type AudioBatch = { key: string; sessionKey: string; machineId: string; targetRevision: number; startAt: string; endAt: string | null; size: number; confirmedRevision: number | null; synced: boolean; failed: boolean }
export class PersonalModuleStore {
  private constructor(
    readonly userId: string,
    readonly db: SQLite.SQLiteDatabase,
  ) {}
  private flushing: Promise<void> | null = null
  static async open(userId: string) {
    const db = await SQLite.openDatabaseAsync(
      `personal-modules-${encodeURIComponent(userId)}.sqlite`,
    )
    await db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,key));
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT NOT NULL,method TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_days(day TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS audio_batches(key TEXT PRIMARY KEY,session_key TEXT NOT NULL,machine_id TEXT NOT NULL,target_revision INTEGER NOT NULL,start_at TEXT NOT NULL,end_at TEXT,size INTEGER NOT NULL DEFAULT 0,confirmed_revision INTEGER,synced INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0);`)
    return new PersonalModuleStore(userId, db)
  }
  async queue(
    path: string,
    method: string,
    body: unknown,
    document?: { kind: string; key: string },
  ) {
    const raw = JSON.stringify(body)
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (document)
        await tx.runAsync(
          'INSERT OR REPLACE INTO documents VALUES(?,?,?)',
          document.kind,
          document.key,
          raw,
        )
      await tx.runAsync('INSERT INTO outbox(path,method,body) VALUES(?,?,?)', path, method, raw)
    })
  }
  async saveTranscript(item: Transcript, recognitionKey?: string) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (recognitionKey) await tx.runAsync("DELETE FROM documents WHERE kind='recognition-audio' AND key=?", recognitionKey)
      if (await tx.getFirstAsync('SELECT day FROM deleted_days WHERE day=?', item.day)) return
      const raw = JSON.stringify(item)
      await tx.runAsync(
        'INSERT OR REPLACE INTO documents VALUES(?,?,?)',
        item.kind === 'recording-feedback' ? 'recording-feedback' : 'transcript',
        item.key,
        raw,
      )
      await tx.runAsync(
        'INSERT INTO outbox(path,method,body) VALUES(?,?,?)',
        item.kind === 'recording-feedback' ? '/recording/feedback' : '/recording/transcripts',
        'POST',
        raw,
      )
    })
  }
  async latestTranscript(): Promise<Transcript | null> {
    const row = await this.db.getFirstAsync<{ payload: string }>(`
      SELECT payload FROM (
        SELECT payload FROM documents WHERE kind='transcript'
        UNION ALL
        SELECT j.value AS payload FROM documents d,json_each(d.payload) j
          WHERE d.kind='cache' AND d.key LIKE 'day:%'
      ) WHERE COALESCE(json_extract(payload,'$.kind'),'transcript')='transcript'
        AND TRIM(COALESCE(json_extract(payload,'$.text'),''))<>''
        AND json_extract(payload,'$.day') NOT IN (SELECT day FROM deleted_days)
      ORDER BY json_extract(payload,'$.startAt') DESC,json_extract(payload,'$.revision') DESC LIMIT 1
    `)
    return row ? JSON.parse(row.payload) as Transcript : null
  }
  async transcripts(day: string): Promise<Transcript[]> {
    const rows = await this.db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM documents WHERE kind IN ('transcript','recording-feedback') AND json_extract(payload,'$.day')=? ORDER BY json_extract(payload,'$.startAt')",
      day,
    )
    return rows.map((r) => JSON.parse(r.payload) as Transcript)
  }
  async transcriptsForBatch(sessionKey: string, startAt: string, endAt: string): Promise<Transcript[]> {
    const rows = await this.db.getAllAsync<{ payload: string }>("SELECT payload FROM documents WHERE kind IN ('transcript','recording-feedback') AND json_extract(payload,'$.sessionKey')=? AND json_extract(payload,'$.startAt')>=? AND json_extract(payload,'$.startAt')<? ORDER BY json_extract(payload,'$.startAt')", sessionKey, startAt, endAt)
    return rows.map(r => JSON.parse(r.payload) as Transcript)
  }
  async days(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ day: string }>(
      "SELECT DISTINCT json_extract(payload,'$.day') AS day FROM documents WHERE kind IN ('transcript','recording-feedback') ORDER BY day DESC LIMIT 100",
    )
    return rows.map((r) => r.day)
  }
  async values<T>(kind: string): Promise<T[]> {
    const rows = await this.db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM documents WHERE kind=? ORDER BY key',
      kind,
    )
    return rows.map((r) => JSON.parse(r.payload) as T)
  }
  async saveValue(kind: string, key: string, value: unknown) {
    await this.db.runAsync('INSERT OR REPLACE INTO documents VALUES(?,?,?)', kind, key, JSON.stringify(value))
  }
  async removeValue(kind: string, key: string) {
    await this.db.runAsync('DELETE FROM documents WHERE kind=? AND key=?', kind, key)
  }
  async hasPendingRecognition(sessionKey: string, startAt: string, endAt: string) {
    return Boolean(await this.db.getFirstAsync(
      "SELECT key FROM documents WHERE kind='recognition-audio' AND json_extract(payload,'$.sessionKey')=? AND json_extract(payload,'$.startAt')<? AND (json_extract(payload,'$.startAt') + json_extract(payload,'$.size')/32)>? LIMIT 1",
      sessionKey, Date.parse(endAt), Date.parse(startAt),
    ))
  }
  async cache(key: string, value: unknown) {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO documents VALUES(?,?,?)',
      'cache',
      key,
      JSON.stringify(value),
    )
  }
  async cached<T>(key: string): Promise<T | null> {
    const r = await this.db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM documents WHERE kind=? AND key=?',
      'cache',
      key,
    )
    return r ? (JSON.parse(r.payload) as T) : null
  }
  async pendingSyncCounts() {
    const row = await this.db.getFirstAsync<{ records: number; transcripts: number }>(
      "SELECT COUNT(*) AS records,COALESCE(SUM(CASE WHEN path IN ('/recording/transcripts','/recording/feedback') THEN 1 ELSE 0 END),0) AS transcripts FROM outbox",
    )
    const audio = (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM audio_batches WHERE synced=0 AND end_at IS NOT NULL'))?.n ?? 0
    return { records: row?.records ?? 0, transcripts: row?.transcripts ?? 0, audio }
  }
  async pendingCount() {
    const normal = (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox'))?.n ?? 0
    const audio = (await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM audio_batches WHERE synced=0'))?.n ?? 0
    return normal + audio
  }
  async beginAudioBatch(batch: Omit<AudioBatch, 'endAt' | 'size' | 'confirmedRevision' | 'synced' | 'failed'>) {
    await this.db.runAsync('INSERT INTO audio_batches(key,session_key,machine_id,target_revision,start_at) VALUES(?,?,?,?,?)', batch.key, batch.sessionKey, batch.machineId, batch.targetRevision, batch.startAt)
  }
  async finishAudioBatch(key: string, endAt: string, size: number) {
    await this.db.runAsync('UPDATE audio_batches SET end_at=?,size=? WHERE key=? AND end_at IS NULL', endAt, size, key)
  }
  async removeEmptyAudioBatch(key: string) { await this.db.runAsync('DELETE FROM audio_batches WHERE key=? AND end_at IS NULL', key) }
  async markAudioFailed(key: string) { await this.db.runAsync('UPDATE audio_batches SET failed=1 WHERE key=?', key) }
  async audioBatches(): Promise<AudioBatch[]> {
    const rows = await this.db.getAllAsync<{ key: string; session_key: string; machine_id: string; target_revision: number; start_at: string; end_at: string | null; size: number; confirmed_revision: number | null; synced: number; failed: number }>('SELECT * FROM audio_batches ORDER BY start_at')
    return rows.map(r => ({ key: r.key, sessionKey: r.session_key, machineId: r.machine_id, targetRevision: r.target_revision, startAt: r.start_at, endAt: r.end_at, size: r.size, confirmedRevision: r.confirmed_revision, synced: !!r.synced, failed: !!r.failed }))
  }
  async confirmOldAudioTarget(revision: number) { await this.db.runAsync('UPDATE audio_batches SET confirmed_revision=? WHERE synced=0 AND end_at IS NOT NULL', revision) }
  async markAudioSynced(key: string) { await this.db.runAsync('UPDATE audio_batches SET synced=1 WHERE key=?', key) }
  async isDayDeleted(day: string) {
    return Boolean(await this.db.getFirstAsync('SELECT day FROM deleted_days WHERE day=?', day))
  }
  async applyDeletedDay(day: string) {
    await locationStore.deleteDay(this.userId, day)
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      if (await tx.getFirstAsync('SELECT day FROM deleted_days WHERE day=?', day)) return
      await tx.runAsync('INSERT OR IGNORE INTO deleted_days VALUES(?)', day)
      await tx.runAsync(
        "DELETE FROM documents WHERE kind IN ('transcript','recording-feedback','gap') AND json_extract(payload,'$.day')=?",
        day,
      )
      await tx.runAsync(
        "DELETE FROM documents WHERE kind='cache' AND key IN (?,?)",
        `day:${day}`,
        'overview',
      )
    })
  }
  async deleteDay(day: string) {
    await this.applyDeletedDay(day)
    await this.queue(`/recording/days/${day}`, 'DELETE', {})
  }
  flush() {
    if (this.flushing) return this.flushing
    this.flushing = this.drain().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }
  private async drain() {
    for (;;) {
      if (useAuthStore.getState().user?.id !== this.userId || !useAuthStore.getState().token) return
      const row = await this.db.getFirstAsync<{
        id: number
        path: string
        method: string
        body: string
      }>('SELECT * FROM outbox ORDER BY id LIMIT 1')
      if (!row) return
      // Capture the token: refresh must not replay an old account's outbox as a new user.
      const token = useAuthStore.getState().token
      if (!token || useAuthStore.getState().user?.id !== this.userId) return
      // Hermes in supported development shells has AbortController but no AbortSignal.timeout.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      try {
        const response = await fetch(`${getApiBaseUrl()}/personal-modules${row.path}`, {
          method: row.method,
          body: row.body,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new ApiError(response.status, await response.text().catch(() => 'personal_module_sync_failed'))
        const result = (await response.json()) as { deleted?: boolean }
        if (result.deleted && ['/recording/transcripts', '/recording/feedback'].includes(row.path))
          await this.applyDeletedDay((JSON.parse(row.body) as Transcript).day)
        await this.db.runAsync('DELETE FROM outbox WHERE id=?', row.id)
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}
