// @covers src/features/personal-modules/durableRecognition.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DurableRecognition, type RecognitionJob, type RecognitionStorage } from '../features/personal-modules/durableRecognition'
import type { Transcript } from '../features/personal-modules/types'
function setup(options: { enrich?: (job: RecognitionJob, transcript: Transcript) => Promise<Transcript> } = {}) {
  const files = new Map<string, number[]>(), metadata = new Map<string, RecognitionJob>()
  const committed: Transcript[] = [], attempts: number[][] = []
  let online = true, valid = true, deleted = false, sequence = 0
  const waiting = vi.fn(), fatal = vi.fn(), partial = vi.fn()
  const storage: RecognitionStorage = {
    recover: async () => [...metadata.values()].map(job => ({ ...job, size: files.get(job.key)!.length, sealed: true })),
    create: async job => { metadata.set(job.key, { ...job }); files.set(job.key, []) },
    append: async (job, data) => { files.get(job.key)!.push(...data) },
    seal: async job => { metadata.set(job.key, { ...job, sealed: true }) },
    read: async (job, offset, length) => new Uint8Array(files.get(job.key)!.slice(offset, offset + length)),
    complete: async (job, transcript) => { if (transcript) committed.push(transcript); metadata.delete(job.key); files.delete(job.key) },
    deleted: async () => deleted,
  }
  const make = (windowBytes = 100000) => new DurableRecognition({
    ...options, storage, key: () => `job-${++sequence}`, valid: () => valid, waiting, fatal, partial,
    open: (job, events) => {
      const received: number[] = []
      attempts.push(received)
      queueMicrotask(() => {
        if (online) events.ready()
        else { events.failed(); events.closed() }
      })
      return {
        send: data => { received.push(...data) },
        finish: () => {
          if (received.some(value => value !== 0)) events.save({ key: job.key, sessionKey: job.sessionKey, revision: 3, startAt: new Date(job.startAt).toISOString(), endAt: new Date(job.startAt + job.size / 32).toISOString(), day: '2026-10-24', timezone: 'UTC', text: 'recovered speech' })
          events.closed()
        },
        abort: () => { events.failed(); events.closed() },
      }
    },
  }, windowBytes)
  return { make, storage, files, metadata, committed, attempts, waiting, fatal, setOnline: (value: boolean) => { online = value }, setValid: (value: boolean) => { valid = value }, setDeleted: () => { deleted = true } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
describe('disk-backed continuous recognition', () => {
  it('keeps more than the old 12-second limit offline and replays every frame after stop', async () => {
    const test = setup(), live = test.make(2000000)
    test.setOnline(false)
    await live.initialize()
    live.begin('session')
    const expected: number[] = []
    for (let i = 0; i < 400; i++) {
      const frame = new Uint8Array(1280).fill(i % 255)
      expected.push(...frame)
      live.send(frame, Date.now())
      await vi.advanceTimersByTimeAsync(40)
    }
    await live.finish()
    await vi.advanceTimersByTimeAsync(100)
    expect([...test.files.values()].flat()).toEqual(expected)
    expect(test.committed).toEqual([])
    expect(test.waiting).toHaveBeenCalledWith(true)
    test.setOnline(true)
    await vi.advanceTimersByTimeAsync(6000)
    live.tick()
    await vi.advanceTimersByTimeAsync(5000)
    expect(test.attempts.at(-1)).toEqual(expected)
    expect(test.committed).toHaveLength(1)
    expect(test.committed[0]).toMatchObject({ sessionKey: 'session', revision: 1 })
    expect(test.metadata.size).toBe(0)
    expect(test.fatal).not.toHaveBeenCalled()
    expect(test.waiting).toHaveBeenLastCalledWith(false)
    await live.abort()
  })
  it('recovers an unsealed journal on restart without starting capture', async () => {
    const test = setup(), first = test.make()
    test.setOnline(false)
    await first.initialize()
    first.begin('old-session')
    for (let i = 0; i < 5; i++) first.send(new Uint8Array([4, 0]), Date.now())
    await vi.advanceTimersByTimeAsync(100)
    expect([...test.metadata.values()][0]?.sealed).toBe(false)
    await first.abort()
    // Simulate metadata left by a process kill, not a normal stop.
    for (const job of test.metadata.values()) job.sealed = false
    test.setOnline(true)
    const restarted = test.make()
    await restarted.initialize()
    await vi.advanceTimersByTimeAsync(500)
    expect(test.attempts.at(-1)).toEqual(Array.from({ length: 5 }, () => [4, 0]).flat())
    expect(test.committed[0]?.sessionKey).toBe('old-session')
    expect(test.metadata.size).toBe(0)
    await restarted.abort()
  })
  it('rotates without losing boundary frames, finishes short tails, and acknowledges silence', async () => {
    const test = setup(), live = test.make(12)
    await live.initialize()
    live.begin('session')
    for (let i = 1; i <= 15; i++) live.send(new Uint8Array([i, 0]), Date.now() + i * 40)
    await live.finish()
    await vi.advanceTimersByTimeAsync(1500)
    expect(test.attempts.flat()).toEqual(Array.from({ length: 15 }, (_, i) => [i + 1, 0]).flat())
    expect(test.committed).toHaveLength(3)
    live.begin('silent-session')
    live.send(new Uint8Array([0, 0]), Date.now())
    await live.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(test.metadata.size).toBe(0)
    expect(test.committed).toHaveLength(3)
    await live.abort()
  })
  it('never acknowledges incomplete/failed recognition or replays after account invalidation', async () => {
    const test = setup(), live = test.make()
    test.setOnline(false)
    await live.initialize()
    live.begin('session')
    live.send(new Uint8Array([1, 0]), Date.now())
    await live.finish()
    await vi.advanceTimersByTimeAsync(100)
    test.setValid(false)
    test.setOnline(true)
    const attempts = test.attempts.length
    await vi.advanceTimersByTimeAsync(6000)
    live.tick()
    await vi.advanceTimersByTimeAsync(100)
    expect(test.attempts).toHaveLength(attempts)
    expect(test.metadata.size).toBe(1)
    expect(test.committed).toEqual([])
    await live.abort()
  })
  it('seals the human window before AI feedback and starts a fresh timestamp afterwards', async () => {
    const test = setup(), live = test.make()
    await live.initialize()
    live.begin('session')
    live.send(new Uint8Array([1, 0]), Date.now())
    live.boundary()
    await vi.advanceTimersByTimeAsync(2000)
    live.send(new Uint8Array([2, 0]), Date.now())
    await live.finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.attempts).toEqual([[1, 0], [2, 0]])
    expect(Date.parse(test.committed[1]!.startAt) - Date.parse(test.committed[0]!.startAt)).toBe(2000)
    await live.abort()
  })
  it('does not recreate a deleted day from pending audio', async () => {
    const test = setup(), live = test.make()
    test.setOnline(false)
    await live.initialize()
    live.begin('session')
    live.send(new Uint8Array([1, 0]), Date.now())
    await live.finish()
    await vi.advanceTimersByTimeAsync(100)
    test.setDeleted()
    await vi.advanceTimersByTimeAsync(6000)
    live.tick()
    await vi.advanceTimersByTimeAsync(100)
    expect(test.metadata.size).toBe(0)
    expect(test.committed).toEqual([])
    await live.abort()
  })
})

// @covers src/features/personal-modules/segment.ts
vi.mock('../config/server', () => ({ getServerUrl: () => 'https://shennian.net' }))
import { recordingSegment } from '../features/personal-modules/segment'
it('replays a dropped real segment adapter from disk and commits only after its end acknowledgement', async () => {
  const sockets: UnitSocket[] = []
  class UnitSocket {
    static OPEN = 1
    readyState = 1
    binaryType = ''
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    received: number[] = []
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()) }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
    send(data: string | ArrayBuffer) {
      if (typeof data !== 'string') { this.received.push(...new Uint8Array(data)); return }
      const message = JSON.parse(data)
      if (message.type === 'start') queueMicrotask(() => this.receive({ type: 'ready' }))
      if (message.type === 'stop') queueMicrotask(() => {
        this.receive({ type: 'final', index: 0, text: 'complete fixture' })
        this.receive({ type: 'end', transcript: 'complete fixture' })
      })
    }
    close() { this.readyState = 3; this.onclose?.() }
  }
  vi.stubGlobal('WebSocket', UnitSocket)
  const test = setup(), fatal = vi.fn()
  const live = new DurableRecognition({
    storage: test.storage, key: () => 'wire-job', valid: () => true,
    waiting: vi.fn(), partial: vi.fn(), fatal,
    open: (job, events) => recordingSegment({ token: 'unit-fixture', key: job.key, sessionKey: job.sessionKey, startAt: job.startAt, ...events }),
  })
  try {
    await live.initialize()
    live.begin('wire-session')
    for (let i = 0; i < 5; i++) live.send(new Uint8Array([1, 0]), Date.now())
    await vi.advanceTimersByTimeAsync(300)
    expect(sockets[0]!.received).toHaveLength(10)
    sockets[0]!.receive({ type: 'final', index: 0, text: 'incomplete fixture' })
    expect(test.committed).toEqual([])
    sockets[0]!.onerror?.()
    for (let i = 0; i < 5; i++) live.send(new Uint8Array([2, 0]), Date.now())
    await live.finish()
    expect(test.metadata.size).toBe(1)
    await vi.advanceTimersByTimeAsync(6000)
    live.tick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets[1]!.received).toEqual([...Array(5).fill([1, 0]).flat(), ...Array(5).fill([2, 0]).flat()])
    expect(test.committed).toHaveLength(1)
    expect(test.committed[0]).toMatchObject({ key: 'wire-job', text: 'complete fixture', revision: 1 })
    expect(test.metadata.size).toBe(0)
    expect(fatal).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally { await live.abort(); vi.unstubAllGlobals() }
})

// Enrichment runs only after a complete ASR result, without discarding audio
// on an account switch, nor treating provider failures as lost transcription.
describe('automatic speaker annotation journal', () => {
  it('automatically enriches every new sealed window and retains original text', async () => {
    const enrich = vi.fn(async (job: RecognitionJob, item: Transcript) => {
      expect(job.sealed).toBe(true)
      return { ...item, speakerStatus: 'done' as const, speakerSentences: [{ beginMs: 0, endMs: 1, speakerId: 0, text: 'speaker text' }] }
    })
    const test = setup({ enrich }), live = test.make()
    await live.initialize(); live.begin('session')
    live.send(new Uint8Array([1, 0]), Date.now()); await live.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(enrich).toHaveBeenCalledOnce()
    expect(test.committed[0]).toMatchObject({ text: 'recovered speech', speakerStatus: 'done' })
    live.begin('session'); live.send(new Uint8Array([2, 0]), Date.now()); await live.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(enrich).toHaveBeenCalledTimes(2)
    expect(test.committed[1]).toMatchObject({ speakerStatus: 'done' })
    await live.abort()
  })
  it('commits original transcription with an explicit unavailable status if annotation fails', async () => {
    const test = setup({ enrich: async () => { throw new Error('provider unavailable') } }), live = test.make()
    await live.initialize(); live.begin('session'); live.send(new Uint8Array([1, 0]), Date.now()); await live.finish()
    await vi.advanceTimersByTimeAsync(500)
    expect(test.committed[0]).toMatchObject({ text: 'recovered speech', speakerStatus: 'unavailable' })
    expect(test.metadata.size).toBe(0)
    expect(test.fatal).not.toHaveBeenCalled()
    await live.abort()
  })
  it('does not commit after account invalidation, or resurrect a day deleted during annotation', async () => {
    for (const invalidAccount of [true, false]) {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const test = setup({ enrich: async (_job, item) => { await gate; return item } }), live = test.make()
      await live.initialize(); live.begin('session'); live.send(new Uint8Array([1, 0]), Date.now()); await live.finish()
      await vi.advanceTimersByTimeAsync(200)
      if (invalidAccount) test.setValid(false); else test.setDeleted()
      release(); await vi.advanceTimersByTimeAsync(500)
      expect(test.committed).toEqual([])
      expect(test.metadata.size).toBe(invalidAccount ? 1 : 0)
      await live.abort()
    }
  })
})
