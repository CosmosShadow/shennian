// @covers src/features/steward/holdToSpeak.ts
import { HoldToSpeak } from '../features/steward/holdToSpeak'
// @covers src/features/chat/audio/shared-recording-source.ts
import { borrowSharedRecording, createSharedRecordingSource, hasSharedRecordingSource } from '../features/chat/audio/shared-recording-source'
import { createRequire } from 'node:module'
import { canSpeakFeedback, notificationSpeechKind } from '../features/personal-modules/feedback'
// @covers src/features/personal-modules/energyGate.ts
// @covers src/features/chat/audio/pcm-lease.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnergyGate } from '../features/personal-modules/energyGate'
import { acquirePcmLease, releasePcmLease } from '../features/chat/audio/pcm-lease'
function frame(value: number) {
  const data = new Uint8Array(1280),
    view = new DataView(data.buffer)
  for (let i = 0; i < data.length; i += 2) view.setInt16(i, value, true)
  return data
}
describe('continuous capture energy gate', () => {
  it('never opens a stream during sustained silence and keeps bounded pre-roll', () => {
    const gate = new EnergyGate()
    for (let i = 0; i < 10000; i++) expect(gate.consume(frame(0), i * 40)).toEqual([])
    gate.consume(frame(3000), 400000)
    const opened = gate.consume(frame(3000), 400040)[0]!
    expect(opened.type).toBe('open')
    if (opened.type === 'open') expect(opened.frames.length).toBeLessThanOrEqual(21)
  })
  it('closes at a pause and rotates long speech without unlimited buffering', () => {
    const gate = new EnergyGate()
    let opens = 0,
      closes = 0
    for (let i = 0; i < 2600; i++)
      for (const e of gate.consume(frame(3000), i * 40)) {
        if (e.type === 'open') opens++
        if (e.type === 'end') closes++
      }
    expect(opens).toBe(3)
    expect(closes).toBe(2)
    let paused = false
    for (let i = 0; i < 50; i++)
      paused ||= gate.consume(frame(0), 104000 + i * 40).some((e) => e.type === 'end')
    expect(paused).toBe(true)
  })
  it('does not let another voice recorder steal or release the microphone', () => {
    const recording = Symbol(),
      call = Symbol()
    acquirePcmLease(recording)
    expect(() => acquirePcmLease(call)).toThrow('microphone_in_use')
    releasePcmLease(call)
    expect(() => acquirePcmLease(call)).toThrow('microphone_in_use')
    releasePcmLease(recording)
    acquirePcmLease(call)
    releasePcmLease(call)
  })
})

describe('two-way feedback during continuous recording', () => {
  const quiet = {
    active: true,
    enabled: true,
    speaking: false,
    userSpeaking: false,
    now: 10000,
    quietSince: 7000,
    lastFrameAt: 9990,
  }
  it('waits for a real pause and stops speaking when recording or feedback is disabled', () => {
    expect(canSpeakFeedback(quiet)).toBe(true)
    expect(canSpeakFeedback({ ...quiet, userSpeaking: true })).toBe(false)
    expect(canSpeakFeedback({ ...quiet, quietSince: 9000 })).toBe(false)
    expect(canSpeakFeedback({ ...quiet, enabled: false })).toBe(false)
    expect(canSpeakFeedback({ ...quiet, active: false })).toBe(false)
    expect(canSpeakFeedback({ ...quiet, lastFrameAt: 1000 })).toBe(false)
  })
  it('ignores ordinary messages and task results, preserving only non-silent reminders', () => {
    expect(notificationSpeechKind({})).toBeNull()
    expect(notificationSpeechKind({ sessionId: 'task' })).toBeNull()
    expect(notificationSpeechKind({ roomId: 'room' })).toBeNull()
    expect(notificationSpeechKind({ personalReminderKey: 'r', sensitive: true })).toBeNull()
    expect(notificationSpeechKind({ silent: 'true' })).toBeNull()
    expect(notificationSpeechKind({ personalReminderKey: 'r' })).toBe('reminder')
  })
})

describe('mobile bundle dependency resolution', () => {
  it('resolves markdown-it entities against the actual nested compatible version', () => {
    const require = createRequire(import.meta.url)
    const { resolveMarkdownEntities } = require('../../scripts/markdown-entities-resolver.cjs')
    const originModulePath = require.resolve('markdown-it/lib/common/entities.js')
    const result = resolveMarkdownEntities({ originModulePath }, 'entities/lib/maps/entities.json')
    expect(result.type).toBe('sourceFile')
    expect(require(result.filePath)).toHaveProperty('amp')
    expect(
      resolveMarkdownEntities(
        { originModulePath: '/other/file.js' },
        'entities/lib/maps/entities.json',
      ),
    ).toBeNull()
  })
})

// @covers src/features/personal-modules/audioArchive.ts
const state = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: [] as boolean[], api: vi.fn(), userId: 'alice' }))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///unit/', EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: async (uri: string, base64: string, options: { append?: boolean }) => {
    state.writes.push(options.append === true)
    const incoming = new Uint8Array(Buffer.from(base64, 'base64'))
    const old = options.append ? state.files.get(uri) ?? new Uint8Array() : new Uint8Array()
    const next = new Uint8Array(old.length + incoming.length)
    next.set(old); next.set(incoming, old.length); state.files.set(uri, next)
  },
  getInfoAsync: async (uri: string) => state.files.has(uri) ? { exists: true, size: state.files.get(uri)!.length } : { exists: false },
  readAsStringAsync: async (uri: string, options: { position: number; length: number }) => Buffer.from(state.files.get(uri)!.slice(options.position, options.position + options.length)).toString('base64'),
}))
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: async (_: string, value: Uint8Array) => { if (!ArrayBuffer.isView(value)) throw new Error('native_digest_requires_typed_array'); return Uint8Array.from((await import('node:crypto')).createHash('sha256').update(value).digest()).buffer } }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: state.userId } }) } }))
vi.mock('../config/api', () => ({ authApi: (...args: unknown[]) => state.api(...args) }))
import { appendAudio, audioBatchMs, finishAudioBatch, startAudioBatch, syncAudioBatches } from '../features/personal-modules/audioArchive'
import type { AudioBatch, PersonalModuleStore } from '../features/personal-modules/localStore'
beforeEach(() => { state.files.clear(); state.writes.length = 0; state.api.mockReset(); state.userId = 'alice' })
const fixture = () => {
  const batch: AudioBatch = { key: 'batch', sessionKey: 'session', machineId: 'main', targetRevision: 1, startAt: '2026-10-23T00:00:00.000Z', endAt: '2026-10-23T00:05:00.000Z', size: 0, confirmedRevision: null, synced: false, failed: false }
  const mark = vi.fn(async () => { batch.synced = true })
  const store = { userId: 'alice', beginAudioBatch: vi.fn(), finishAudioBatch: vi.fn(async (_key: string, endAt: string, size: number) => { batch.endAt = endAt; batch.size = size }), audioBatches: async () => [batch], hasPendingRecognition: vi.fn(async () => false), transcriptsForBatch: async () => [{ key: 't', sessionKey: 'session', startAt: batch.startAt, text: '原始转写', revision: 1 }], markAudioSynced: mark } as unknown as PersonalModuleStore
  return { store, batch, mark }
}
describe('phone audio durable outbox', () => {
  it('writes original bytes before enqueueing sync; retries only until persistent receiver commit', async () => {
    const { store, batch, mark } = fixture()
    const active = await startAudioBatch(store, 'session', { machineId: 'main', revision: 1 }, 'batch', batch.startAt)
    expect(audioBatchMs).toBe(300000)
    await appendAudio(store, active, [new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    await appendAudio(store, active, [new Uint8Array([5])])
    await finishAudioBatch(store, active, '2026-10-23T00:02:00.000Z')
    expect(batch).toMatchObject({ endAt: '2026-10-23T00:02:00.000Z', size: 5 })
    expect(state.writes).toEqual([false, true])
    expect([...state.files.values()][0]).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    state.api.mockResolvedValueOnce({ persisted: false })
    await expect(syncAudioBatches(store, { machineId: 'main', revision: 1 })).rejects.toThrow('recording_ack_invalid')
    expect(mark).not.toHaveBeenCalled()
    state.api.mockResolvedValueOnce({ persisted: true }).mockResolvedValueOnce({ machine: { id: 'main' }, revision: 1 }).mockResolvedValueOnce({ persisted: true, complete: true })
    expect(await syncAudioBatches(store, { machineId: 'main', revision: 1 })).toBe('ok')
    expect(mark).toHaveBeenCalledWith('batch')
    expect(state.api.mock.calls.at(-2)![0]).toBe('/personal-workspace/primary-machine')
    expect(JSON.parse(state.api.mock.calls.at(-1)![1].body)).toMatchObject({ initialMachineId: 'main', initialPrimaryRevision: 1, confirmedPrimaryRevision: null, transcript: [{ text: '原始转写' }] })
  })
  it('does not silently forward a pending batch after the primary computer changes', async () => {
    const { store, batch, mark } = fixture()
    batch.size = 5
    expect(await syncAudioBatches(store, { machineId: 'new-main', revision: 2 })).toBe('target_changed')
    expect(state.api).not.toHaveBeenCalled()
    expect(mark).not.toHaveBeenCalled()
    expect(await syncAudioBatches(store, { machineId: 'main', revision: 2 })).toBe('target_changed')
    expect(state.api).not.toHaveBeenCalled()
    batch.confirmedRevision = 2
    expect(await syncAudioBatches(store, { machineId: 'third-main', revision: 3 })).toBe('target_changed')
  })
  it('does not commit after account or target changes during transfer', async () => {
    const { store, batch, mark } = fixture()
    const active = await startAudioBatch(store, 'session', { machineId: 'main', revision: 1 }, 'batch', batch.startAt)
    await appendAudio(store, active, [new Uint8Array([1, 2, 3])])
    await finishAudioBatch(store, active, batch.endAt!)
    state.api.mockImplementationOnce(async () => { state.userId = 'bob'; return { persisted: true } })
    expect(await syncAudioBatches(store, { machineId: 'main', revision: 1 })).toBe('ok')
    expect(state.api).toHaveBeenCalledTimes(1)
    expect(mark).not.toHaveBeenCalled()
    state.userId = 'alice'
    state.api.mockReset().mockResolvedValueOnce({ persisted: true }).mockResolvedValueOnce({ machine: { id: 'new-main' }, revision: 2 })
    expect(await syncAudioBatches(store, { machineId: 'main', revision: 1 })).toBe('target_changed')
    expect(state.api).toHaveBeenCalledTimes(2)
    expect(mark).not.toHaveBeenCalled()
  })
  it('waits for delayed recognition before committing an immutable computer manifest', async () => {
    const { store, mark } = fixture()
    vi.mocked(store.hasPendingRecognition).mockResolvedValue(true)
    expect(await syncAudioBatches(store, { machineId: 'main', revision: 1 })).toBe('ok')
    expect(state.api).not.toHaveBeenCalled()
    expect(mark).not.toHaveBeenCalled()
  })
  it('keeps an outbox batch pending if its original local file is missing', async () => {
    const { store, batch, mark } = fixture()
    batch.size = 32000
    await expect(syncAudioBatches(store, { machineId: 'main', revision: 1 })).rejects.toThrow('recording_local_file_missing')
    expect(mark).not.toHaveBeenCalled()
    expect(state.api).not.toHaveBeenCalled()
  })
})

describe('all-day recording dictation windows', () => {
  it('borrows only current-window frames; stopping dictation leaves all-day owner running', async () => {
    const ownerLease = Symbol('all-day'), competingLease = Symbol('call')
    acquirePcmLease(ownerLease)
    const source = createSharedRecordingSource()
    const frame = new Uint8Array([1, 2])
    source.publish(frame)
    const draft = borrowSharedRecording()!
    const receive = vi.fn()
    draft.onFrame(receive)
    expect(await draft.requestPermission()).toBe(true)
    await draft.start()
    expect(source.borrowed).toBe(true)
    expect(receive).not.toHaveBeenCalled()
    source.publish(frame)
    expect(receive).toHaveBeenCalledExactlyOnceWith(frame)
    await draft.stop()
    expect(source.borrowed).toBe(false)
    expect(hasSharedRecordingSource()).toBe(true)
    expect(() => acquirePcmLease(competingLease)).toThrow('microphone_in_use')
    source.publish(frame)
    expect(receive).toHaveBeenCalledTimes(1)
    const second = borrowSharedRecording()!
    const next = vi.fn()
    second.onFrame(next)
    await second.start()
    expect(next).not.toHaveBeenCalled()
    source.publish(frame)
    expect(next).toHaveBeenCalledOnce()
    source.close()
    expect(borrowSharedRecording()).toBeNull()
    releasePcmLease(ownerLease)
  })
  it('interrupts borrowers on stop/account change and rejects stale starts', async () => {
    const source = createSharedRecordingSource()
    const active = source.borrow(), pending = source.borrow()
    const interrupted = vi.fn()
    active.onError(interrupted)
    await active.start()
    source.close()
    expect(interrupted).toHaveBeenCalledOnce()
    expect(source.borrowed).toBe(false)
    expect(await pending.requestPermission()).toBe(false)
    await expect(pending.start()).rejects.toThrow('recording_interrupted')
    await active.stop()
  })
  it('a stale owner cannot close a new owner, and replacing it interrupts old consumers', async () => {
    const first = createSharedRecordingSource()
    const draft = first.borrow(), interrupted = vi.fn()
    draft.onError(interrupted)
    await draft.start()
    const second = createSharedRecordingSource()
    expect(interrupted).toHaveBeenCalledOnce()
    first.close()
    expect(hasSharedRecordingSource()).toBe(true)
    expect(await second.borrow().isAvailable()).toBe(true)
    second.close()
  })
})

describe('tap / hold dictation lifecycle', () => {
  it('starts only on long press and sends once on release', async () => {
    const start = vi.fn(async () => true), send = vi.fn(async () => {}), cancel = vi.fn()
    const hold = new HoldToSpeak({ start, send, cancel })
    expect(start).not.toHaveBeenCalled()
    hold.start()
    hold.start()
    await Promise.resolve()
    const released = hold.release()
    await hold.release()
    await released
    expect(start).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    expect(hold.active).toBe(false)
  })
  it('release during permission/consent cannot start a late recording or send', async () => {
    let permit!: () => void
    const permission = new Promise<void>(resolve => { permit = resolve })
    const send = vi.fn(async () => {})
    const hold = new HoldToSpeak({ start: async held => { await permission; return held() }, send, cancel: vi.fn() })
    hold.start()
    const released = hold.release()
    permit()
    await released
    expect(send).not.toHaveBeenCalled()
    expect(hold.active).toBe(false)
  })
  it('slide-away, system cancellation and unmount cancel rather than send', async () => {
    for (const dispose of [false, true]) {
      const send = vi.fn(async () => {}), cancel = vi.fn()
      const hold = new HoldToSpeak({ start: async () => true, send, cancel })
      hold.start()
      await Promise.resolve()
      if (dispose) hold.dispose()
      else await hold.release(true)
      await hold.release()
      expect(cancel).toHaveBeenCalledOnce()
      expect(send).not.toHaveBeenCalled()
    }
  })
  it('failed startup does not send a pre-existing text draft', async () => {
    const send = vi.fn(async () => {})
    const hold = new HoldToSpeak({ start: async () => { throw new Error('permission') }, send, cancel: vi.fn() })
    hold.start()
    await hold.release()
    expect(send).not.toHaveBeenCalled()
  })
})

// @covers src/features/personal-modules/recordingSync.ts
import { ApiError } from '@shennian/shared'
import { createRecordingSync, type RecordingSyncState } from '../features/personal-modules/recordingSync'
describe('independent recording sync channels', () => {
  function setup() {
    let account = 'alice'
    const counts = { records: 1, transcripts: 1, audio: 1 }
    const store = { userId: 'alice', pendingSyncCounts: async () => ({ ...counts }) }
    const state: RecordingSyncState & { error: string } = { syncError: 'sync_waiting', archiveError: 'archive_waiting', assistanceAvailable: null, pending: 2, error: 'recognition_gap' }
    const cloud = vi.fn(async () => { counts.records = 0; counts.transcripts = 0 })
    const archive = vi.fn(async () => { counts.audio = 0 })
    const preferences = vi.fn(async () => {})
    const sync = createRecordingSync({ store: async () => store, account: () => account, cloud, archive, preferences, update: patch => Object.assign(state, patch) })
    return { state, counts, cloud, archive, preferences, sync, setAccount: (value: string) => { account = value } }
  }
  it('clears recovered sync warnings without clearing recording errors or mistaking optional endpoints for upload failures', async () => {
    const test = setup()
    test.preferences.mockRejectedValue(Object.assign(new Error('Not found'), { name: 'ApiError', status: 404 }))
    await test.sync()
    expect(test.state).toEqual({ syncError: null, archiveError: null, assistanceAvailable: false, pending: 0, error: 'recognition_gap' })
    test.preferences.mockResolvedValue(undefined)
    await test.sync()
    expect(test.state.assistanceAvailable).toBe(true)
  })
  it('keeps uploading new text while an offline-computer request is still pending and does not duplicate archives', async () => {
    const test = setup()
    let finish!: () => void
    test.archive.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const first = test.sync()
    await vi.waitFor(() => expect(test.archive).toHaveBeenCalledOnce())
    expect(test.state.syncError).toBeNull()
    test.counts.records = 1
    const second = test.sync()
    await vi.waitFor(() => expect(test.cloud).toHaveBeenCalledTimes(2))
    expect(test.state.pending).toBe(1)
    expect(test.archive).toHaveBeenCalledOnce()
    finish()
    await Promise.all([first, second])
  })
  it('reports archive and text failures separately and preserves pending work for retry', async () => {
    const test = setup()
    test.cloud.mockRejectedValue(new ApiError(503, 'unavailable'))
    test.archive.mockRejectedValue(new ApiError(503, JSON.stringify({ error: 'recording_machine_offline' })))
    await test.sync()
    expect(test.state).toMatchObject({ syncError: 'sync_waiting', archiveError: 'recording_machine_offline', pending: 2 })
    test.counts.records = 0
    await test.sync()
    expect(test.state.syncError).toBe('sync_unavailable')
    test.counts.audio = 0
    await test.sync()
    expect(test.state.archiveError).toBeNull()
  })
  it('does not apply late account-A results to account B', async () => {
    const test = setup()
    let finish!: () => void
    test.cloud.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const request = test.sync()
    await vi.waitFor(() => expect(test.cloud).toHaveBeenCalledOnce())
    test.setAccount('bob')
    const before = { ...test.state }
    finish()
    await request
    expect(test.state).toEqual(before)
  })
})

// @covers src/features/personal-modules/segment.ts
vi.mock('../config/server', () => ({ getServerUrl: () => 'https://shennian.net' }))
import { recordingSegment } from '../features/personal-modules/segment'
describe('recording segment final transcript revisions', () => {
  it('folds cumulative finals and indexed corrections without duplicating prior speech', () => {
    const wire = { binaryType: '', onmessage: null as any, close: vi.fn() }
    vi.stubGlobal('WebSocket', class { constructor() { return wire } })
    const save = vi.fn(), closed = vi.fn()
    try {
      recordingSegment({ token: 'unit-token', sessionKey: 'unit-session', key: 'unit-segment', startAt: 0, save, closed, failed: vi.fn(), partial: vi.fn() })
      const receive = (data: unknown) => wire.onmessage({ data: JSON.stringify(data) })
      receive({ type: 'final', index: 0, text: '你好。' })
      receive({ type: 'final', index: 1, text: '你好。今天晴天。' })
      expect(save.mock.calls.at(-1)![0].text).toBe('你好。今天晴天。')
      receive({ type: 'final', index: 1, text: '你好。今天阴天。' })
      expect(save.mock.calls.at(-1)![0].text).toBe('你好。今天阴天。')
      receive({ type: 'final', index: 2, text: '带把伞。' })
      expect(save.mock.calls.at(-1)![0].text).toBe('你好。今天阴天。带把伞。')
      receive({ type: 'end', transcript: '' })
      expect(save.mock.calls.at(-1)![0].text).toBe('你好。今天阴天。带把伞。')
      expect(closed).toHaveBeenCalledOnce()
      expect(wire.close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('recording connection liveness', () => {
  it('times out a half-open socket, but accepts pong-only silence and cleans up timers', () => {
    vi.useFakeTimers()
    const wire = { binaryType: '', onmessage: null as any, send: vi.fn(), close: vi.fn() }
    vi.stubGlobal('WebSocket', class { constructor() { return wire } })
    const failed = vi.fn(), closed = vi.fn()
    try {
      recordingSegment({ token: 'unit-token', sessionKey: 'unit-session', key: 'unit-segment', startAt: 0, save: vi.fn(), closed, failed, partial: vi.fn() })
      wire.onmessage({ data: JSON.stringify({ type: 'ready' }) })
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(5000)
        wire.onmessage({ data: JSON.stringify({ type: 'pong' }) })
      }
      expect(failed).not.toHaveBeenCalled()
      expect(wire.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))
      vi.advanceTimersByTime(15000)
      expect(failed).toHaveBeenCalledExactlyOnceWith('asr_response_timeout')
      expect(closed).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      wire.onmessage({ data: JSON.stringify({ type: 'ready' }) })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })
})

// @covers src/features/personal-modules/cloudSpeech.ts
import { createCloudSpeechPlayer } from '../features/personal-modules/cloudSpeech'
function unitSpeechPlayer() {
  let completed: (id: string) => void = () => {}
  const player = {
    start: vi.fn(async (_sampleRate: number) => {}), stop: vi.fn(async () => {}),
    enqueue: vi.fn(async (_id: string, _pcm: Uint8Array) => {}), finish: vi.fn(async (_id: string) => {}),
    flush: vi.fn(async () => {}), setOutputRoute: vi.fn(async () => {}),
    onComplete: vi.fn((fn: (id: string) => void) => { completed = fn; return vi.fn() }),
    onError: vi.fn((_fn: (error: Error) => void) => vi.fn()),
  }
  return { player, complete: (id: string) => completed(id) }
}
describe('cloud feedback native PCM playback', () => {
  it('only marks feedback played after the native completion callback', async () => {
    const fake = unitSpeechPlayer(), done = vi.fn(), failed = vi.fn(), started = vi.fn()
    const speech = createCloudSpeechPlayer(() => fake.player)
    await speech.play({ sampleRate: 24000, pcmBase64: 'AQACAAMA' }, done, failed, started)
    expect(started).toHaveBeenCalledOnce()
    expect(fake.player.start).toHaveBeenCalledWith(24000)
    expect(fake.player.enqueue.mock.calls[0]![1]).toEqual(new Uint8Array([1, 0, 2, 0, 3, 0]))
    expect(done).not.toHaveBeenCalled()
    fake.complete('another-playback')
    expect(done).not.toHaveBeenCalled()
    fake.complete(fake.player.finish.mock.calls[0]![0])
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce())
    expect(failed).not.toHaveBeenCalled()
    expect(fake.player.stop).toHaveBeenCalledOnce()
  })
  it('stop during native startup prevents queued or late speech', async () => {
    const fake = unitSpeechPlayer(), done = vi.fn(), failed = vi.fn()
    let start!: () => void
    fake.player.start.mockImplementation(() => new Promise<void>(resolve => { start = resolve }))
    const speech = createCloudSpeechPlayer(() => fake.player)
    const playing = speech.play({ sampleRate: 24000, pcmBase64: 'AQACAA==' }, done, failed)
    await vi.waitFor(() => expect(fake.player.start).toHaveBeenCalledOnce())
    await speech.stop()
    start(); await playing
    expect(fake.player.enqueue).not.toHaveBeenCalled()
    expect(fake.player.stop).toHaveBeenCalledOnce()
    expect(done).not.toHaveBeenCalled()
  })
})

it('cancels cloud speech before the first async playback step', async () => {
  const fake = unitSpeechPlayer(), create = vi.fn(() => fake.player)
  const speech = createCloudSpeechPlayer(create)
  const playing = speech.play({ sampleRate: 24000, pcmBase64: 'AQACAA==' }, vi.fn(), vi.fn())
  await speech.stop()
  await playing
  expect(create).not.toHaveBeenCalled()
})

// @covers src/features/personal-modules/speechLoudness.ts
import { normalizeSpeechPcm } from '../features/personal-modules/speechLoudness'
function speechSamples(values: number[]) {
  const data = new Uint8Array(values.length * 2), view = new DataView(data.buffer)
  values.forEach((value, index) => view.setInt16(index * 2, value, true))
  return data
}
function readSpeechSamples(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return Array.from({ length: data.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true))
}
describe('bounded recording feedback loudness', () => {
  it('raises quiet synthesized speech without mutating the source', () => {
    const source = speechSamples([1000, -1000, 2000, -2000])
    const raised = readSpeechSamples(normalizeSpeechPcm(source))
    expect(raised[0]).toBeGreaterThan(1000)
    expect(raised[1]).toBeLessThan(-1000)
    expect(readSpeechSamples(source)).toEqual([1000, -1000, 2000, -2000])
    expect(raised.every(sample => Math.abs(sample) <= Math.round(0.89 * 32768))).toBe(true)
  })
  it('limits gain to 12 dB and preserves silence, noise, and already loud audio', () => {
    expect(readSpeechSamples(normalizeSpeechPcm(speechSamples([200, -200])))).toEqual([800, -800])
    for (const values of [[0, 0], [1, -1], [30000, -32768]]) {
      const source = speechSamples(values)
      expect(normalizeSpeechPcm(source)).toBe(source)
    }
  })
  it('uses peak headroom across the entire utterance instead of clipping a transient', () => {
    const raised = readSpeechSamples(normalizeSpeechPcm(speechSamples([20000, ...Array(1000).fill(1000)])))
    expect(raised[0]).toBeGreaterThan(20000)
    expect(Math.max(...raised.map(Math.abs))).toBeLessThanOrEqual(Math.round(0.89 * 32768))
    expect(Math.abs(raised[0]! / raised[1]! - 20)).toBeLessThan(0.02)
  })
})

it('applies feedback loudness before scheduling native PCM chunks', async () => {
  const fake = unitSpeechPlayer(), speech = createCloudSpeechPlayer(() => fake.player)
  const raw = speechSamples([1000, -1000])
  await speech.play({ sampleRate: 24000, pcmBase64: globalThis.btoa(String.fromCharCode(...raw)) }, vi.fn(), vi.fn())
  expect(readSpeechSamples(fake.player.enqueue.mock.calls[0]![1])).toEqual([4000, -4000])
  await speech.stop()
})
