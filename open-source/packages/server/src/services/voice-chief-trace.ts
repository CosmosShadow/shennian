// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-trace.test.ts

import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'

export type VoiceChiefTraceEvent =
  | 'coordinator_created'
  | 'user_turn'
  | 'phone_transcript'
  | 'model_request'
  | 'model_response'
  | 'history_compacted'
  | 'history_compaction_failed'
  | 'tool_decision'
  | 'turn_outcome'
  | 'coordinator_error'

export function isVoiceChiefTraceEnabled(): boolean {
  const value = process.env.VOICE_SHENNIAN_TRACE_ENABLED?.trim().toLowerCase()
  return ['1', 'true', 'on', 'enabled'].includes(value ?? '')
}

function traceDirectory(): string {
  return process.env.VOICE_SHENNIAN_TRACE_DIR?.trim() || '/app/.voice-traces'
}

function userRef(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16)
}

function traceFileName(now: Date): string {
  return `voice-v5-${now.toISOString().slice(0, 10)}.jsonl`
}

export class VoiceChiefTraceLogger {
  private readonly enabled: boolean
  private readonly callId: string
  private readonly userRef: string
  private readonly directory: string
  private pending: Promise<void> = Promise.resolve()

  constructor(input: { callId: string; userId: string; enabled?: boolean; directory?: string }) {
    this.enabled = input.enabled ?? isVoiceChiefTraceEnabled()
    this.callId = input.callId
    this.userRef = userRef(input.userId)
    this.directory = input.directory ?? traceDirectory()
  }

  write(event: VoiceChiefTraceEvent, data: unknown): void {
    if (!this.enabled) return
    const now = new Date()
    const line = `${JSON.stringify({
      version: 1,
      ts: now.toISOString(),
      callId: this.callId,
      userRef: this.userRef,
      event,
      data,
    })}\n`
    const filePath = path.join(this.directory, traceFileName(now))
    this.pending = this.pending
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        await chmod(this.directory, 0o700)
        await appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 })
        await chmod(filePath, 0o600)
      })
      .catch(() => undefined)
  }

  async flush(): Promise<void> {
    await this.pending
  }
}
