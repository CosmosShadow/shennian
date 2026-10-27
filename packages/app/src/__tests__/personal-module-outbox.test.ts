// @covers src/features/personal-modules/localStore.ts
// Real in-memory SQLite through a test-only adapter; no files, backend or native device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
// Node 24 supplies SQLite at test runtime; the mobile project's Node 20 types do not.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const auth = vi.hoisted(() => ({ user: { id: 'alice' }, token: 'fixture-alice' }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => auth } }))
vi.mock('../config/api', () => ({ getApiBaseUrl: () => 'https://unit.invalid/api' }))
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const sql = new DatabaseSync(':memory:')
    const adapter = {
      execAsync: async (query: string) => {
        sql.exec(query)
      },
      runAsync: async (query: string, ...args: any[]) => sql.prepare(query).run(...args),
      getAllAsync: async (query: string, ...args: any[]) => sql.prepare(query).all(...args),
      getFirstAsync: async (query: string, ...args: any[]) =>
        sql.prepare(query).get(...args) ?? null,
      withExclusiveTransactionAsync: async (run: (tx: any) => Promise<void>) => {
        sql.exec('BEGIN')
        try {
          await run(adapter)
          sql.exec('COMMIT')
        } catch (e) {
          sql.exec('ROLLBACK')
          throw e
        }
      },
    }
    return adapter
  },
}))
import { PersonalModuleStore } from '../features/personal-modules/localStore'
const sample = {
  key: 'u',
  sessionKey: 's',
  revision: 1,
  text: 'private fixture',
  timezone: 'Asia/Shanghai',
  day: '2026-10-22',
  startAt: '2026-10-22T00:00:00Z',
  endAt: '2026-10-22T00:00:01Z',
}
beforeEach(() => {
  auth.user = { id: 'alice' }
  auth.token = 'fixture-alice'
})
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('durable local recording outbox', () => {
  it('uploads and clears saved text on Hermes shells without AbortSignal.timeout', async () => {
    vi.stubGlobal('AbortSignal', { timeout: undefined })
    const store = await PersonalModuleStore.open('alice')
    await store.saveTranscript(sample)
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.signal?.aborted).toBe(false)
      return { ok: true, json: async () => ({ saved: true }) }
    })
    vi.stubGlobal('fetch', fetch)
    await store.flush()
    expect(fetch).toHaveBeenCalledOnce()
    expect(await store.pendingCount()).toBe(0)
    expect((await store.transcripts(sample.day))[0]?.text).toBe(sample.text)
  })

  it('distinguishes queued text and closed archives from a recording still being captured', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.beginAudioBatch({ key: 'open', sessionKey: 's', machineId: 'main', targetRevision: 1, startAt: sample.startAt })
    expect(await store.pendingSyncCounts()).toEqual({ records: 0, transcripts: 0, audio: 0 })
    await store.saveTranscript(sample)
    await store.finishAudioBatch('open', sample.endAt, 32000)
    expect(await store.pendingSyncCounts()).toEqual({ records: 1, transcripts: 1, audio: 1 })
  })
  it('persists account-bound raw audio batch target, short final size and receiver acknowledgement state', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.beginAudioBatch({ key: 'batch', sessionKey: 'session', machineId: 'old-main', targetRevision: 7, startAt: sample.startAt })
    expect(await store.pendingCount()).toBe(1)
    await store.finishAudioBatch('batch', sample.endAt, 32000)
    expect((await store.audioBatches())[0]).toMatchObject({ machineId: 'old-main', targetRevision: 7, endAt: sample.endAt, size: 32000, synced: false })
    await store.confirmOldAudioTarget(8)
    expect((await store.audioBatches())[0]?.confirmedRevision).toBe(8)
    const other = await PersonalModuleStore.open('bob')
    expect(await other.audioBatches()).toEqual([])
    await store.markAudioSynced('batch')
    expect(await store.pendingCount()).toBe(0)
  })
  it('keeps recognized text when sync fails and replays operations in order', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.queue('/recording/sessions', 'POST', { key: 's', startAt: sample.startAt })
    await store.saveTranscript(sample)
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(store.flush()).rejects.toThrow('offline')
    expect((await store.transcripts(sample.day))[0]?.text).toBe(sample.text)
    expect(await store.pendingCount()).toBe(2)
    fetch.mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
    await store.flush()
    expect(fetch.mock.calls.slice(1).map((c) => c[0])).toEqual([
      'https://unit.invalid/api/personal-modules/recording/sessions',
      'https://unit.invalid/api/personal-modules/recording/transcripts',
    ])
    expect(await store.pendingCount()).toBe(0)
  })
  it('binds a request to its original token and stops the queue on account change', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.saveTranscript(sample)
    await store.saveTranscript({ ...sample, key: 'u2' })
    let release!: (response: any) => void
    const fetch = vi.fn(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const draining = store.flush()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect((fetch.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer fixture-alice')
    auth.user = { id: 'bob' }
    auth.token = 'fixture-bob'
    release({ ok: true, json: async () => ({ saved: true }) })
    await draining
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await store.pendingCount()).toBe(1)
  })
  it('does not restore a deleted day from late recognition or a cloud deletion response', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.saveTranscript(sample)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ deleted: true }) })),
    )
    await store.flush()
    expect(await store.isDayDeleted(sample.day)).toBe(true)
    await store.saveTranscript({ ...sample, revision: 2 })
    expect(await store.transcripts(sample.day)).toEqual([])
    expect(await store.pendingCount()).toBe(0)
  })
})

it('keeps AI spoken feedback in the day timeline and archive with a separate sync route and deletion barrier', async () => {
  const store = await PersonalModuleStore.open('alice')
  const feedback = { ...sample, key: 'ai-feedback', kind: 'recording-feedback', speaker: 'assistant' as const, text: 'Apple means 苹果。' }
  await store.saveTranscript(feedback)
  expect(await store.transcripts(sample.day)).toEqual([feedback])
  expect(await store.days()).toContain(sample.day)
  expect(await store.transcriptsForBatch('s', sample.startAt, '2026-10-22T00:05:00Z')).toEqual([feedback])
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true, json: async () => ({ saved: true }) }))
  vi.stubGlobal('fetch', fetch)
  await store.flush()
  expect(fetch.mock.calls[0]![0]).toBe('https://unit.invalid/api/personal-modules/recording/feedback')
  expect(JSON.parse((fetch.mock.calls[0] as any)[1].body)).toMatchObject({ kind: 'recording-feedback', speaker: 'assistant' })
  await store.applyDeletedDay(sample.day)
  await store.saveTranscript(feedback)
  expect(await store.transcripts(sample.day)).toEqual([])
})


describe('recognition acknowledgement transaction', () => {
  it('blocks archive manifest until transcript and job acknowledgement commit together', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.saveValue('recognition-audio', 'u', { key: 'u', sessionKey: 's', startAt: Date.parse(sample.startAt), size: 32000, sealed: true })
    expect(await store.hasPendingRecognition('s', sample.startAt, sample.endAt)).toBe(true)
    expect(await store.hasPendingRecognition('other', sample.startAt, sample.endAt)).toBe(false)
    await store.saveTranscript(sample, 'u')
    expect(await store.hasPendingRecognition('s', sample.startAt, sample.endAt)).toBe(false)
    expect(await store.transcripts(sample.day)).toEqual([sample])
    expect((await store.pendingSyncCounts()).transcripts).toBe(1)
  })
  it('does not resurrect a deleted day when delayed ASR is acknowledged', async () => {
    const store = await PersonalModuleStore.open('alice')
    await store.saveValue('recognition-audio', 'u', { key: 'u', sessionKey: 's', startAt: Date.parse(sample.startAt), size: 32000, sealed: true })
    await store.applyDeletedDay(sample.day)
    await store.saveTranscript(sample, 'u')
    expect(await store.values('recognition-audio')).toEqual([])
    expect(await store.transcripts(sample.day)).toEqual([])
    expect((await store.pendingSyncCounts()).transcripts).toBe(0)
  })
})
