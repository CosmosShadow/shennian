// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pi-rpc-client.test.ts

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

export type PiRpcRecord = Record<string, unknown> & { type?: string }

type PendingRequest = {
  command: string
  resolve: (record: PiRpcRecord) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type PiRpcClientEvents = {
  event: [record: PiRpcRecord]
  protocolError: [error: Error]
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024

function safeRpcError(record: PiRpcRecord, command: string): string {
  const message = typeof record.error === 'string' ? record.error : ''
  return message.trim().slice(0, 1_000) || `Pi RPC command failed: ${command}`
}

/** Strict LF-only JSONL transport. Node readline is intentionally not used:
 * Pi allows U+2028/U+2029 inside JSON strings and documents that generic line
 * readers can split those characters incorrectly. */
export class PiRpcClient extends EventEmitter<PiRpcClientEvents> {
  private readonly pending = new Map<string, PendingRequest>()
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private nextId = 1
  private closed = false

  constructor(
    private readonly process: ChildProcess,
    private readonly options: {
      requestTimeoutMs?: number
      maxFrameBytes?: number
    } = {},
  ) {
    super()
    process.stdout?.on('data', (chunk: Buffer | string) => this.consume(chunk))
    process.stdout?.on('end', () => this.consumeEnd())
    process.once('close', () => this.close(new Error('Pi RPC process closed')))
    process.once('error', (error) => this.close(error))
  }

  request(command: string, fields: Record<string, unknown> = {}): Promise<PiRpcRecord> {
    if (this.closed) return Promise.reject(new Error('Pi RPC process is closed'))
    if (!this.process.stdin?.writable) return Promise.reject(new Error('Pi RPC stdin unavailable'))
    const id = `shennian-${this.nextId++}`
    return new Promise<PiRpcRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC request timed out: ${command}`))
      }, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { command, resolve, reject, timeout })
      const payload = `${JSON.stringify({ id, type: command, ...fields })}\n`
      this.process.stdin!.write(payload, (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  notify(command: string, fields: Record<string, unknown> = {}): void {
    if (this.closed || !this.process.stdin?.writable) return
    this.process.stdin.write(`${JSON.stringify({ type: command, ...fields })}\n`)
  }

  close(error = new Error('Pi RPC client closed')): void {
    if (this.closed) return
    this.closed = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private consume(chunk: Buffer | string): void {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next]) : next
    const max = this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
    if (this.buffer.length > max && this.buffer.indexOf(0x0a) === -1) {
      this.protocolFailure(new Error('Pi RPC frame exceeds size limit'))
      return
    }

    let newline = this.buffer.indexOf(0x0a)
    while (newline !== -1) {
      let frame = this.buffer.subarray(0, newline)
      this.buffer = this.buffer.subarray(newline + 1)
      if (frame.length && frame[frame.length - 1] === 0x0d) frame = frame.subarray(0, -1)
      if (frame.length) this.parseFrame(frame)
      if (this.closed) return
      if (this.buffer.length > max && this.buffer.indexOf(0x0a) === -1) {
        this.protocolFailure(new Error('Pi RPC frame exceeds size limit'))
        return
      }
      newline = this.buffer.indexOf(0x0a)
    }
  }

  private consumeEnd(): void {
    if (!this.buffer.length || this.closed) return
    this.buffer = Buffer.alloc(0)
    this.protocolFailure(new Error('Pi RPC stream ended with an unterminated JSONL record'))
  }

  private parseFrame(frame: Buffer): void {
    let record: PiRpcRecord
    try {
      const parsed = JSON.parse(frame.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('record must be a JSON object')
      }
      record = parsed as PiRpcRecord
    } catch {
      this.protocolFailure(new Error('Invalid Pi RPC JSON record'))
      return
    }

    if (record.type === 'response' && typeof record.id === 'string') {
      const pending = this.pending.get(record.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(record.id)
      if (record.success === false) pending.reject(new Error(safeRpcError(record, pending.command)))
      else pending.resolve(record)
      return
    }
    this.emit('event', record)
  }

  private protocolFailure(error: Error): void {
    this.emit('protocolError', error)
    this.close(error)
  }
}
