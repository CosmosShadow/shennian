// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/cursor-adapter.test.ts

import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { AgentAdapter, registerAgent, type AgentEvent, type AgentSendContext } from './adapter.js'
import { resolveBuiltinCommand, spawnResolvedCommand } from './command-spec.js'
import { spawnEnoentError } from './spawn-errors.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { buildInlineChannelPreamble } from './platform-instructions.js'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'
import {
  resolveManagedAgentAdapterEnforcement,
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import {
  compileCursorManagedPermissions,
  createCursorManagedConfigDirectory,
  CURSOR_MANAGED_RUNTIME_SECURITY,
  disposeCursorManagedConfigDirectory,
} from './cursor-managed-permissions.js'

registerManagedAgentRuntimeSecurity('cursor', CURSOR_MANAGED_RUNTIME_SECURITY)

type CursorContentBlock = {
  type: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
}

type CursorStreamEvent = {
  type?: string
  subtype?: string
  session_id?: string
  timestamp_ms?: number
  model_call_id?: string
  message?: {
    role?: string
    content?: CursorContentBlock[]
  }
  result?: string
  is_error?: boolean
  duration_ms?: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  error?: string
  // legacy flat fields
  event?: string
  chat_id?: string
  text?: string
  delta?: string
  thinking?: string
  tool_name?: string
  tool_args?: Record<string, unknown>
  tool_result?: string
  done?: boolean
}

export class CursorAdapter extends AgentAdapter {
  readonly type = 'cursor' as const
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private chatId: string | null = null
  private workDir: string | null = null
  private seq = 0
  private runId = ''
  private emittedText = ''
  private externalChannel: ExternalChannelSessionStatus | null = null
  private shennianSessionId: string | null = null
  private extraEnv: NodeJS.ProcessEnv = {}
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private managedConfigDir: string | null = null

  configure(options: {
    sessionId?: string
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
    managedAgentPolicy?: CompiledManagedAgentPolicy | null
  }): void {
    this.shennianSessionId = options.sessionId ?? null
    this.externalChannel = options.externalChannel ?? null
    this.extraEnv = options.env ?? {}
    if ('managedAgentPolicy' in options) {
      this.managedAgentPolicy = options.managedAgentPolicy ?? null
    }
    if (this.managedAgentPolicy) this.workDir = this.managedAgentPolicy.adapterPolicy.workDir
  }

  async start(_sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.seq = 0
    if (agentSessionId) this.chatId = agentSessionId
  }

  async send(
    text: string,
    modelId?: string,
    _reasoningEffort?: string,
    _attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    if (context?.source === 'room_activation' && !this.managedAgentPolicy) {
      throw new Error('managed_agent_policy_missing')
    }
    await this.killProcess()
    this.runId = randomUUID()
    this.resetRunState()

    const outgoing = `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
    await this.spawnAndParse(this.buildSendArgs(outgoing, modelId),
      context?.source === 'published_agent')
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.chatId = agentSessionId
    this.runId = randomUUID()
    this.resetRunState()

    await this.spawnAndParse([
      '--resume',
      agentSessionId,
      '--output-format',
      'stream-json',
      '--stream-partial-output',
    ])
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  private buildSendArgs(outgoing: string, modelId?: string): string[] {
    const args = ['-p', outgoing, '--output-format', 'stream-json', '--stream-partial-output']
    if (modelId) args.push('--model', modelId)
    // Recovery must name the journaled native chat explicitly. `--continue`
    // means "most recent chat" and can attach to unrelated Cursor work.
    if (this.chatId) args.push('--resume', this.chatId)
    return args
  }

  private async spawnAndParse(args: string[], publicTurn = false): Promise<void> {
    const spec = resolveBuiltinCommand('cursor')
    if (!spec) {
      this.emit(
        'error',
        new Error('Cursor Agent CLI not found. Expected "agent" or "cursor agent".'),
      )
      return
    }

    const managedLaunch = await this.prepareManagedLaunch(publicTurn)
    let proc: ChildProcess
    try {
      proc = spawnResolvedCommand(spec, [...args, ...managedLaunch.args], {
        cwd: this.workDir ?? undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: managedLaunch.env,
      })
    } catch (error) {
      await this.disposeManagedConfig(managedLaunch.configDir)
      throw error
    }
    this.process = proc
    this.managedConfigDir = managedLaunch.configDir

    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line) as CursorStreamEvent
        this.handleStreamEvent(obj)
      } catch {
        // 非 JSON 行当作纯文本 delta
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
      void this.disposeManagedConfig(managedLaunch.configDir)
      if (code !== 0 && code !== null) {
        const msg = stderrBuf.trim() || `cursor agent exited with code ${code}`
        this.emitEvent({ state: 'error', message: msg })
      }
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      void this.disposeManagedConfig(managedLaunch.configDir)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', spawnEnoentError(this.workDir, 'Command "cursor" not found. Is Cursor CLI installed?'))
      } else {
        this.emit('error', err)
      }
    })
  }

  private async prepareManagedLaunch(publicTurn = false): Promise<{
    args: string[]
    env: NodeJS.ProcessEnv
    configDir: string | null
  }> {
    const compiled = this.managedAgentPolicy
    if (!compiled) {
      return {
        args: ['--trust'],
        env: buildAgentProcessEnv(this.extraEnv),
        configDir: null,
      }
    }
    if (isManagedAgentNativeFull(compiled)) {
      return {
        args: ['--trust'],
        env: buildManagedNativeFullProcessEnv(this.extraEnv),
        configDir: null,
      }
    }

    const nativeConfig = compileCursorManagedPermissions(
      resolveManagedAgentAdapterEnforcement(compiled),
      compiled.adapterPolicy.workDir,
      { publicTurn },
    )
    const configDir = await createCursorManagedConfigDirectory(nativeConfig)
    const env = buildManagedAgentProcessEnv({
      agentType: 'cursor',
      providerEnv: this.extraEnv,
      sessionEnv: this.extraEnv,
      runtimeEnv: { NO_COLOR: '1' },
    })
    // CURSOR_CONFIG_DIR contains only Shennian-generated, non-secret policy.
    // It is assigned after allowlist filtering so Cursor cannot fall back to
    // the user's mutable global CLI configuration.
    env.CURSOR_CONFIG_DIR = configDir
    return { args: nativeConfig.args, env, configDir }
  }

  private async disposeManagedConfig(configDir: string | null): Promise<void> {
    if (!configDir) return
    if (this.managedConfigDir === configDir) this.managedConfigDir = null
    await disposeCursorManagedConfigDirectory(configDir).catch(() => {})
  }

  private handleStreamEvent(obj: CursorStreamEvent): void {
    if (obj.session_id && !this.chatId) {
      this.chatId = obj.session_id
      this.emit('nativeSession', 'cursor', obj.session_id)
    }
    if (obj.chat_id && !this.chatId) {
      this.chatId = obj.chat_id
      this.emit('nativeSession', 'cursor', obj.chat_id)
    }

    const eventType = obj.type ?? obj.event

    switch (eventType) {
      case 'system': {
        // init event — session_id already captured above
        break
      }

      case 'assistant': {
        // Cursor's --stream-partial-output currently emits duplicate buffered
        // flushes. Only timestamped assistant events without model_call_id are
        // safe to treat as live deltas; use result.result as the terminal
        // canonical text.
        if (obj.message?.content) {
          if (!this.isLiveAssistantDelta(obj)) break
          for (const block of obj.message.content) {
            if (block.type === 'text' && block.text) {
              this.emitTextDelta(block.text)
            } else if (block.type === 'thinking' && block.thinking) {
              this.emitEvent({ state: 'delta', text: block.thinking, thinking: true })
            } else if (block.type === 'tool_use') {
              this.emitEvent({ state: 'tool-call', name: block.name, args: block.input })
            }
          }
          break
        }
        // Legacy flat
        if (obj.delta ?? obj.text) {
          this.emitEvent({ state: 'delta', text: (obj.delta ?? obj.text)! })
        }
        break
      }

      case 'user':
        break // echo of user message

      case 'result': {
        if (obj.subtype === 'success' || !obj.is_error) {
          this.emitFinalResultDelta(obj.result)
          const u = obj.usage
          this.emitEvent({
            state: 'final',
            agentSessionId: this.chatId ?? undefined,
            usage: u
              ? {
                  inputTokens: u.inputTokens ?? u.input_tokens ?? 0,
                  outputTokens: u.outputTokens ?? u.output_tokens ?? 0,
                }
              : undefined,
          })
        } else {
          this.emitEvent({
            state: 'error',
            message: obj.result ?? obj.error ?? 'unknown error',
          })
        }
        break
      }

      case 'error': {
        this.emitEvent({
          state: 'error',
          message: obj.error ?? 'unknown error',
        })
        break
      }

      // Legacy event types
      case 'text':
      case 'delta':
      case 'content': {
        const text = obj.delta ?? obj.text
        if (text) this.emitEvent({ state: 'delta', text })
        break
      }
      case 'done': {
        this.emitEvent({ state: 'final', agentSessionId: this.chatId ?? undefined })
        break
      }

      default: {
        if (obj.done) {
          this.emitEvent({ state: 'final', agentSessionId: this.chatId ?? undefined })
        } else if (obj.delta ?? obj.text) {
          this.emitEvent({ state: 'delta', text: (obj.delta ?? obj.text)! })
        }
      }
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
    if (!proc) {
      await this.disposeManagedConfig(this.managedConfigDir)
      return
    }
    this.process = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      proc.on('close', resolve)
      setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
    })
    await this.disposeManagedConfig(this.managedConfigDir)
  }

  private resetRunState(): void {
    this.seq = 0
    this.emittedText = ''
  }

  private isLiveAssistantDelta(obj: CursorStreamEvent): boolean {
    return obj.timestamp_ms != null && !obj.model_call_id
  }

  private emitTextDelta(text: string): void {
    if (!text) return
    this.emittedText += text
    this.emitEvent({ state: 'delta', text })
  }

  private emitFinalResultDelta(result?: string): void {
    if (!result) return
    if (!this.emittedText) {
      this.emitTextDelta(result)
      return
    }
    if (!result.startsWith(this.emittedText)) return

    const tail = result.slice(this.emittedText.length)
    if (tail) {
      this.emitTextDelta(tail)
    }
  }
}

registerAgent('cursor', () => new CursorAdapter())
