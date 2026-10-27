import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { AgentAdapter, type AgentEvent } from './adapter.js'
import { resolveBuiltinCommand, spawnResolvedCommand } from './command-spec.js'
import { spawnEnoentError } from './spawn-errors.js'
import { buildAgentProcessEnv } from '../agent-env.js'
import { buildInlineChannelPreamble } from './platform-instructions.js'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'

/** Best-effort parse of `openclaw agent --json` stdout; shape may vary by version. */
function extractResponseText(parsed: unknown): string {
  if (parsed == null) return ''
  if (typeof parsed === 'string') return parsed

  if (typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>

    // Primary format: { payloads: [{ text: "..." }] }
    if (Array.isArray(o.payloads)) {
      const parts: string[] = []
      for (const p of o.payloads) {
        if (p && typeof p === 'object') {
          const t = (p as Record<string, unknown>).text
          if (typeof t === 'string') parts.push(t)
        }
      }
      if (parts.join('').trim()) return parts.join('\n')
    }

    const direct = o.response ?? o.message ?? o.text ?? o.output ?? o.content ?? o.result
    if (typeof direct === 'string' && direct.trim()) return direct
  }

  return ''
}

function extractSessionId(parsed: unknown): string | undefined {
  if (parsed == null || typeof parsed !== 'object') return undefined
  const o = parsed as Record<string, unknown>
  const meta = o.meta as Record<string, unknown> | undefined
  const agentMeta = meta?.agentMeta as Record<string, unknown> | undefined
  const id = agentMeta?.sessionId ?? o.sessionId ?? o.session_id
  return typeof id === 'string' && id ? id : undefined
}

function extractUsage(parsed: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (parsed == null || typeof parsed !== 'object') return undefined
  const o = parsed as Record<string, unknown>

  // Primary: meta.agentMeta.usage (openclaw format)
  const meta = o.meta as Record<string, unknown> | undefined
  const agentMeta = meta?.agentMeta as Record<string, unknown> | undefined
  const u = agentMeta?.usage ?? o.usage
  if (!u || typeof u !== 'object') return undefined
  const rec = u as Record<string, unknown>
  const inTok = rec.input ?? rec.inputTokens ?? rec.input_tokens
  const outTok = rec.output ?? rec.outputTokens ?? rec.output_tokens
  if (typeof inTok !== 'number' && typeof outTok !== 'number') return undefined
  return {
    inputTokens: typeof inTok === 'number' ? inTok : 0,
    outputTokens: typeof outTok === 'number' ? outTok : 0,
  }
}

function extractErrorMessage(parsed: unknown): string | undefined {
  if (parsed == null || typeof parsed !== 'object') return undefined
  const o = parsed as Record<string, unknown>
  const err = o.error ?? o.err ?? o.errorMessage
  if (typeof err === 'string' && err.trim()) return err
  return undefined
}

export class OpenClawAdapter extends AgentAdapter {
  readonly type = 'openclaw' as const
  private process: ChildProcess | null = null
  private sessionId: string | null = null
  /** OpenClaw session id from JSON or `resume()`; falls back to app `sessionId`. */
  private agentSessionId: string | null = null
  private currentModelId: string | null = null
  private workDir: string | null = null
  private seq = 0
  private runId = ''
  private externalChannel: ExternalChannelSessionStatus | null = null
  private shennianSessionId: string | null = null
  private extraEnv: NodeJS.ProcessEnv = {}

  configure(options: {
    sessionId?: string
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
  }): void {
    this.shennianSessionId = options.sessionId ?? null
    this.externalChannel = options.externalChannel ?? null
    this.extraEnv = options.env ?? {}
  }

  async start(sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
    this.sessionId = sessionId
    this.workDir = workDir
    this.seq = 0
    if (agentSessionId) this.agentSessionId = agentSessionId
  }

  async send(
    text: string,
    modelId?: string,
    _reasoningEffort?: string,
    _attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
  ): Promise<void> {
    await this.killProcess()
    this.runId = randomUUID()
    this.seq = 0

    const sid = this.agentSessionId ?? this.sessionId
    if (!sid) {
      this.emitEvent({ state: 'error', message: 'openclaw: session not started' })
      return
    }

    // OpenClaw `openclaw agent` uses session-scoped model; `--model` on the same CLI may not apply here.
    // Sending `/model <id>` as a message matches interactive `/model` and updates the session before the user turn.
    if (modelId && modelId !== this.currentModelId) {
      const modelSwitch = await this.runAgentCommand([
        '--message',
        `/model ${modelId}`,
        '--session-id',
        sid,
      ])
      if (!modelSwitch.ok) {
        this.emitEvent({
          state: 'error',
          message: modelSwitch.error ?? 'openclaw model switch failed',
        })
        return
      }
      this.currentModelId = modelId
    }

    const outgoing = `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
    this.spawnAgent(['--message', outgoing, '--session-id', sid])
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.agentSessionId = agentSessionId
    this.runId = randomUUID()
    this.seq = 0

    // No new user turn; minimal body so the CLI accepts the invocation.
    this.spawnAgent(['--message', '\u200b', '--session-id', agentSessionId])
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  private spawnAgent(extraArgs: string[]): void {
    const spec = resolveBuiltinCommand('openclaw')
    if (!spec) {
      this.emit('error', spawnEnoentError(this.workDir, 'Command "openclaw" not found. Is OpenClaw CLI installed?'))
      return
    }
    const args = ['agent', '--local', '--json', ...extraArgs]
    const proc = spawnResolvedCommand(spec, args, {
      cwd: this.workDir ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildAgentProcessEnv(this.extraEnv),
    })
    this.process = proc

    let stdoutBuf = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
    })

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    proc.on('close', (code) => {
      if (this.process !== proc) return
      this.process = null

      if (code !== 0 && code !== null) {
        const msg = stderrBuf.trim() || `openclaw exited with code ${code}`
        this.emitEvent({ state: 'error', message: msg })
        return
      }

      const raw = stdoutBuf.trim()
      if (!raw) {
        const msg = stderrBuf.trim() || 'openclaw returned empty stdout'
        this.emitEvent({ state: 'error', message: msg })
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        this.emitEvent({
          state: 'error',
          message: `openclaw stdout is not valid JSON: ${raw.slice(0, 200)}`,
        })
        return
      }

      const rec = parsed as Record<string, unknown>
      const failed = rec.ok === false || rec.success === false
      if (failed) {
        this.emitEvent({
          state: 'error',
          message: extractErrorMessage(parsed) ?? 'openclaw request failed',
        })
        return
      }

      const nextSid = extractSessionId(parsed)
      if (nextSid) this.agentSessionId = nextSid

      const text = extractResponseText(parsed)
      if (text) {
        this.emitEvent({ state: 'delta', text })
      }

      const usage = extractUsage(parsed)
      this.emitEvent({ state: 'final', agentSessionId: this.agentSessionId ?? undefined, usage })
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', new Error('Command "openclaw" not found. Is OpenClaw CLI installed?'))
      } else {
        this.emit('error', err)
      }
    })
  }

  private async runAgentCommand(
    extraArgs: string[],
  ): Promise<{ ok: boolean; parsed?: unknown; error?: string }> {
    return new Promise((resolve) => {
      const spec = resolveBuiltinCommand('openclaw')
      if (!spec) {
        resolve({ ok: false, error: 'Command "openclaw" not found. Is OpenClaw CLI installed?' })
        return
      }
      const args = ['agent', '--local', '--json', ...extraArgs]
      const proc = spawnResolvedCommand(spec, args, {
        cwd: this.workDir ?? undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildAgentProcessEnv(this.extraEnv),
      })

      let stdoutBuf = ''
      let stderrBuf = ''

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString()
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
      })

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          resolve({ ok: false, error: stderrBuf.trim() || `openclaw exited with code ${code}` })
          return
        }

        const raw = stdoutBuf.trim()
        if (!raw) {
          resolve({ ok: true })
          return
        }

        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          if (parsed.ok === false || parsed.success === false) {
            resolve({
              ok: false,
              error: extractErrorMessage(parsed) ?? 'openclaw request failed',
            })
            return
          }
          const nextSid = extractSessionId(parsed)
          if (nextSid) this.agentSessionId = nextSid
          resolve({ ok: true, parsed })
        } catch {
          resolve({ ok: false, error: `openclaw stdout is not valid JSON: ${raw.slice(0, 200)}` })
        }
      })

      proc.on('error', (err) => {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
    })
  }

  private emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    const event: AgentEvent = {
      ...partial,
      runId: this.runId,
      seq: this.seq++,
    }
    this.emit('agentEvent', event)
  }

  private async killProcess(): Promise<void> {
    const proc = this.process
    if (!proc) return
    this.process = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      proc.on('close', resolve)
      setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
    })
  }
}

// OpenClaw support is intentionally disabled.
// registerAgent('openclaw', () => new OpenClawAdapter())
