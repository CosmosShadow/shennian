import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { AgentAdapter, registerAgent, type AgentEvent } from './adapter.js'
import { resolveBuiltinCommand, spawnResolvedCommand } from './command-spec.js'
import { spawnEnoentError } from './spawn-errors.js'
import { buildAgentProcessEnv } from '../agent-env.js'
import { buildInlineChannelPreamble } from './platform-instructions.js'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'

/** NDJSON lines from `gemini --output-format stream-json` */
type GeminiStreamEvent = {
  type?: string
  timestamp?: string
  session_id?: string
  model?: string
  role?: string
  content?: string
  delta?: boolean
  status?: string
  stats?: Record<string, unknown>
  error?: string
  message?: string
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function usageFromStats(stats: Record<string, unknown> | undefined): AgentEvent['usage'] {
  if (!stats) return undefined
  const input =
    num(stats.input_tokens) ??
    num(stats.prompt_tokens) ??
    num(stats.inputTokens) ??
    num(stats.promptTokenCount)
  const output =
    num(stats.output_tokens) ??
    num(stats.completion_tokens) ??
    num(stats.outputTokens) ??
    num(stats.candidatesTokenCount) ??
    num(stats.responseTokenCount)
  if (input === undefined && output === undefined) return undefined
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
  }
}

export class GeminiAdapter extends AgentAdapter {
  readonly type = 'gemini' as const
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private agentSessionId: string | null = null
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

  async start(_sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
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

    const outgoing = `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
    const args = ['-p', outgoing, '--output-format', 'stream-json']
    if (modelId) {
      args.push('-m', modelId)
    }
    if (this.agentSessionId) {
      args.push('--resume', this.agentSessionId)
    }

    this.spawnAndParse(args)
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.agentSessionId = agentSessionId
    this.runId = randomUUID()
    this.seq = 0

    this.spawnAndParse(['--resume', agentSessionId, '--output-format', 'stream-json'])
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  private spawnAndParse(args: string[]): void {
    const spec = resolveBuiltinCommand('gemini')
    if (!spec) {
      this.emit('error', spawnEnoentError(this.workDir, 'Command "gemini" not found. Is Gemini CLI installed?'))
      return
    }
    const proc = spawnResolvedCommand(spec, args, {
      cwd: this.workDir ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildAgentProcessEnv(this.extraEnv),
    })
    this.process = proc

    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line) as GeminiStreamEvent
        this.handleStreamEvent(obj)
      } catch {
        this.emitEvent({ state: 'delta', text: line })
      }
    })

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    proc.on('close', (code) => {
      if (this.process !== proc) return
      this.process = null
      if (code !== 0 && code !== null) {
        const msg = stderrBuf.trim() || `gemini exited with code ${code}`
        this.emitEvent({ state: 'error', message: msg })
      }
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', new Error('Command "gemini" not found. Is Gemini CLI installed?'))
      } else {
        this.emit('error', err)
      }
    })
  }

  private handleStreamEvent(obj: GeminiStreamEvent): void {
    switch (obj.type) {
      case 'init': {
        if (obj.session_id) {
          this.agentSessionId = obj.session_id
        }
        break
      }
      case 'message': {
        if (obj.role === 'assistant' && obj.content) {
          this.emitEvent({ state: 'delta', text: obj.content })
        }
        break
      }
      case 'result': {
        if (obj.status === 'success') {
          this.emitEvent({
            state: 'final',
            agentSessionId: this.agentSessionId ?? undefined,
            usage: usageFromStats(obj.stats),
          })
        } else if (obj.status === 'error') {
          const msg =
            (typeof obj.error === 'string' && obj.error) ||
            (typeof obj.message === 'string' && obj.message) ||
            'gemini result error'
          this.emitEvent({ state: 'error', message: msg })
        }
        break
      }
      default:
        break
    }
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

registerAgent('gemini', () => new GeminiAdapter())
