// @arch docs/features/personal-modules.md
// @test src/__tests__/durable-recognition.test.ts
import { localDay, localZone, type Transcript } from './types'
export type RecognitionJob = { key: string; sessionKey: string; startAt: number; size: number; sealed: boolean; day?: string; timezone?: string; separateSpeakers?: boolean }
type Stream = { send(frame: Uint8Array): void; finish(): void; abort(): void }
export type RecognitionStorage = {
  recover(): Promise<RecognitionJob[]>
  create(job: RecognitionJob): Promise<void>
  append(job: RecognitionJob, frame: Uint8Array): Promise<void>
  seal(job: RecognitionJob): Promise<void>
  read(job: RecognitionJob, offset: number, length: number): Promise<Uint8Array>
  complete(job: RecognitionJob, transcript: Transcript | null): Promise<void>
  deleted(job: RecognitionJob): Promise<boolean>
}
/** Disk is the queue; only a short capture tail and one replay chunk live in JS.
 * Network errors never discard a job or stop capture. Only an ASR end followed
 * by a durable transcript commit acknowledges a job (including silent audio).
 */
export class DurableRecognition {
  private jobs: RecognitionJob[] = []
  private current: RecognitionJob | null = null
  private frames: Uint8Array[] = []
  private chain: Promise<void> = Promise.resolve()
  private queued = 0
  private session: string | null = null
  private dead = false
  private storageFailed = false
  private running = false
  private retryAt = 0
  private cancel: (() => void) | null = null
  constructor(private input: {
    storage: RecognitionStorage
    key(): string
    enrich?(job: RecognitionJob, transcript: Transcript): Promise<Transcript>
    valid(): boolean
    open(job: RecognitionJob, events: { ready(): void; save(item: Transcript): void; partial(text: string): void; failed(): void; closed(): void }): Stream
    partial(job: RecognitionJob, text: string): void
    waiting(value: boolean): void
    fatal(error: unknown): void
  }, private windowBytes = 60000 * 32) {}
  async initialize() {
    this.jobs = await this.input.storage.recover()
    if (this.input.valid()) this.input.waiting(this.jobs.length > 0)
    this.tick()
  }
  begin(session: string) {
    if (this.dead || this.storageFailed) throw new Error('local_save_failed')
    this.session = session
  }
  send(frame: Uint8Array, at: number) {
    if (!this.session || this.dead || this.storageFailed) return
    if (!this.current) {
      const job: RecognitionJob = { key: this.input.key(), sessionKey: this.session, startAt: at, size: 0, sealed: false, day: localDay(new Date(at)), timezone: localZone(), separateSpeakers: true }
      this.current = job
      this.enqueue(async () => { await this.input.storage.create(job); this.jobs.push(job) })
    }
    this.frames.push(frame.slice())
    if (this.frames.length >= 5) this.flush()
    // size advances only after disk append, so include the bounded write tail.
    this.captureBytes += frame.byteLength
    if (this.captureBytes >= this.windowBytes) this.boundary()
  }
  private captureBytes = 0
  private enqueue(work: () => Promise<void>) {
    this.queued++
    this.chain = this.chain.then(async () => {
      if (!this.storageFailed) await work()
    }).catch(error => {
      this.storageFailed = true
      this.input.fatal(error)
    }).finally(() => { this.queued--; this.tick() })
    if (this.queued > 100 && !this.storageFailed) {
      this.storageFailed = true
      this.input.fatal(new Error('recording_storage_backlog'))
    }
  }
  private flush() {
    const job = this.current, frames = this.frames
    this.frames = []
    if (!job || !frames.length) return
    const data = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0))
    let offset = 0
    for (const frame of frames) { data.set(frame, offset); offset += frame.length }
    this.enqueue(async () => {
      await this.input.storage.append(job, data)
      job.size += data.length
    })
  }
  boundary() {
    this.flush()
    const job = this.current
    this.current = null
    this.captureBytes = 0
    if (job) this.enqueue(async () => { await this.input.storage.seal(job); job.sealed = true })
  }
  async finish() { this.session = null; this.boundary(); await this.chain }
  async abort() {
    this.dead = true
    this.cancel?.()
    await this.finish()
  }
  tick() {
    if (this.dead || this.running || !this.input.valid() || Date.now() < this.retryAt || !this.jobs.length) return
    this.running = true
    void this.drain().catch(error => {
      // Read/commit failures preserve the disk job, too. They must not become
      // unhandled rejections or incorrectly acknowledge recognition.
      if (!this.dead && this.input.valid()) this.input.fatal(error)
    }).finally(() => { this.running = false })
  }
  private async drain() {
    while (!this.dead && this.input.valid() && this.jobs.length) {
      const job = this.jobs[0]!
      if (await this.input.storage.deleted(job)) {
        // Do not process a still-growing file after a day deletion.
        if (!job.sealed) return
        await this.input.storage.complete(job, null)
        this.jobs.shift()
        continue
      }
      if (this.dead || !this.input.valid()) return
      const result = await this.recognize(job)
      if (this.dead || !this.input.valid()) return
      if (!result.ok) {
        this.retryAt = Date.now() + 5000
        this.input.waiting(true)
        return
      }
      if (result.transcript && job.separateSpeakers && this.input.enrich) {
        try { result.transcript = await this.input.enrich(job, result.transcript) }
        catch { result.transcript = { ...result.transcript, speakerStatus: 'unavailable' } }
      }
      // Account changes, aborts and deletion during the cloud call must never
      // commit to another account or resurrect a deleted day.
      if (this.dead || !this.input.valid()) return
      if (await this.input.storage.deleted(job)) result.transcript = null
      await this.input.storage.complete(job, result.transcript)
      this.jobs.shift()
      this.input.waiting(this.jobs.some(item => item !== this.current))
    }
    if (!this.dead && this.input.valid() && !this.jobs.length) this.input.waiting(false)
  }
  private recognize(job: RecognitionJob): Promise<{ ok: boolean; transcript: Transcript | null }> {
    return new Promise(resolve => {
      let ready = false, closed = false, failed = false, offset = 0, finishing = false
      let transcript: Transcript | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let stream: Stream
      const close = () => {
        if (closed) return
        closed = true
        if (timer) clearTimeout(timer)
        this.cancel = null
        resolve({ ok: !failed && finishing, transcript })
      }
      const pump = async () => {
        if (closed) return
        if (this.dead || !this.input.valid()) { stream.abort(); close(); return }
        try {
          if (ready && offset < job.size) {
            const data = await this.input.storage.read(job, offset, Math.min(6400, job.size - offset))
            if (closed || this.dead || !this.input.valid()) return
            if (!data.length) throw new Error('recording_local_file_missing')
            stream.send(data)
            offset += data.length
          }
          if (ready && job.sealed && offset === job.size && !finishing) { finishing = true; stream.finish() }
          if (!closed) timer = setTimeout(() => void pump(), 50)
        } catch {
          failed = true
          stream.abort()
          close()
        }
      }
      try {
        stream = this.input.open(job, {
          ready: () => { ready = true },
          save: item => { transcript = { ...item, revision: 1, day: job.day ?? item.day, timezone: job.timezone ?? item.timezone }; if (!closed && this.input.valid()) this.input.partial(job, item.text) },
          partial: text => { if (!closed && this.input.valid()) this.input.partial(job, text) },
          failed: () => { failed = true },
          closed: close,
        })
        this.cancel = () => { failed = true; stream.abort(); close() }
        void pump()
      } catch { failed = true; close() }
    })
  }
}
