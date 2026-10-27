// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/opencode-adapter.test.ts

import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { AgentAdapter, registerAgent, type AgentEvent, type AgentSendContext } from './adapter.js'
import { resolveBuiltinCommand, spawnAgentCommand } from './command-spec.js'
import { isMacosFileSandboxSupported, type MacosFileSandboxSpec } from '../security/macos-file-sandbox.js'
import { spawnEnoentError } from './spawn-errors.js'
import { DETACH_PROCESS_GROUP, stopProcessTree } from './process-tree.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { buildInlineChannelPreamble, buildPlatformInstructions } from './platform-instructions.js'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'
import {
  resolveManagedAgentAdapterEnforcement,
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import {
  compileOpenCodeManagedPermissions,
  createOpenCodeManagedConfigDirectory,
  disposeOpenCodeManagedConfigDirectory,
  OPENCODE_MANAGED_RUNTIME_SECURITY,
} from './opencode-managed-permissions.js'

registerManagedAgentRuntimeSecurity('opencode', OPENCODE_MANAGED_RUNTIME_SECURITY)

// A failing run can print unbounded diagnostics; keep only what an error message needs.
const STDERR_LIMIT_BYTES = 64 * 1024

type OpenCodeTokenUsage = {
  input?: number
  output?: number
  total?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

type OpenCodePart = {
  id?: string
  messageID?: string
  sessionID?: string
  type?: string
  text?: string
  tool?: string
  title?: string
  snapshot?: string
  reason?: string
  tokens?: OpenCodeTokenUsage
  time?: { start?: number; end?: number }
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: unknown
    error?: string
    metadata?: Record<string, unknown>
  }
}

type OpenCodeStreamEvent = {
  type?: string
  timestamp?: number
  sessionID?: string
  part?: OpenCodePart
  error?: unknown
}

function usageFromTokens(tokens?: OpenCodeTokenUsage): AgentEvent['usage'] {
  if (!tokens) return undefined
  const input = tokens.input
  const output = tokens.output
  if (typeof input !== 'number' && typeof output !== 'number') return undefined
  return {
    inputTokens: typeof input === 'number' ? input : 0,
    outputTokens: typeof output === 'number' ? output : 0,
  }
}

function stringifyResult(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractErrorMessage(value: unknown): string {
  if (!value) return 'opencode request failed'
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  if (typeof record.name === 'string') return record.name
  if ('data' in record) return extractErrorMessage(record.data)
  return stringifyResult(value) || 'opencode request failed'
}

export class OpenCodeAdapter extends AgentAdapter {
  readonly type = 'opencode' as const
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private agentSessionId: string | null = null
  private workDir: string | null = null
  private seq = 0
  private runId = ''
  private terminalState: 'open' | 'closed' = 'closed'
  private runUsage: AgentEvent['usage'] | undefined
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
    if (agentSessionId) this.agentSessionId = agentSessionId
    this.resetRunState()
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

    // Both OpenCode 1.x and 2.x can use the child process working directory.
    // 2.0.11 rejects `run --dir`, so keep the shared invocation independent of it.
    const args = ['run', '--format', 'json']
    if (this.agentSessionId) {
      args.push('--session', this.agentSessionId)
    }
    if (modelId) {
      args.push('--model', modelId)
    }
    const publicTurn = context?.source === 'published_agent'
    const outgoing = publicTurn ? text
      : `${buildInlineChannelPreamble(this.workDir ?? process.cwd(), this.externalChannel, this.shennianSessionId ?? undefined, agentSystemPrompt)}${text}`
    await this.spawnAndParse(args, outgoing, publicTurn
      ? buildPlatformInstructions(this.workDir ?? process.cwd(), null, undefined, agentSystemPrompt)
      : undefined, publicTurn)
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.agentSessionId = agentSessionId
    this.runId = randomUUID()
    this.resetRunState()
    this.emitEvent({ state: 'start', agentSessionId })
    this.emitFinalIfOpen({ state: 'final', agentSessionId })
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  private resetRunState(): void {
    this.seq = 0
    this.terminalState = 'open'
    this.runUsage = undefined
  }

  private async spawnAndParse(args: string[], input: string,
    systemPrompt?: string, publicTurn = false): Promise<void> {
    const spec = resolveBuiltinCommand('opencode')
    if (!spec) {
      this.emit(
        'error',
        new Error('Command "opencode" not found. Install it with "npm i -g opencode-ai@latest".'),
      )
      return
    }
    const managedLaunch = await this.prepareManagedLaunch(systemPrompt, publicTurn)
    // Some OpenCode builds also consult PWD. Keep it aligned with the actual
    // child cwd so a stale login-shell value cannot select another project.
    if (process.platform !== 'win32') managedLaunch.env.PWD = this.workDir ?? process.cwd()
    let proc: ChildProcess
    try {
      proc = spawnAgentCommand(spec, [args[0]!, ...managedLaunch.args, ...args.slice(1)], {
        cwd: this.workDir ?? undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: managedLaunch.env,
        // Own process group: LSP, MCP, shell tools and helper servers started by
        // `opencode run` must die with it instead of being orphaned.
        detached: DETACH_PROCESS_GROUP,
        ...(managedLaunch.macosFileSandbox ? { macosFileSandbox: managedLaunch.macosFileSandbox } : {}),
      })
    } catch (error) {
      await this.disposeManagedConfig(managedLaunch.configDir)
      throw error
    }
    this.process = proc
    this.managedConfigDir = managedLaunch.configDir

    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      this.handleProcessLine(proc, line)
    })

    let stderrBuf = Buffer.alloc(0)
    proc.stderr?.on('data', (chunk: Buffer) => {
      const remaining = STDERR_LIMIT_BYTES - stderrBuf.byteLength
      if (remaining > 0) stderrBuf = Buffer.concat([stderrBuf, chunk.subarray(0, remaining)])
    })

    proc.on('close', (code, signal) => {
      if (this.process !== proc) return
      // Keep the exited group leader until explicit stop/the next Turn. Its
      // descendants can outlive it, and the validation cleanup must still be
      // able to address the process group after the leader has closed.
      void this.disposeManagedConfig(managedLaunch.configDir)
      if (this.terminalState !== 'open') return
      this.completeRunAfterProcessExit(code, signal, stderrBuf.toString('utf8').trim())
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      void this.disposeManagedConfig(managedLaunch.configDir)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit(
          'error',
          spawnEnoentError(this.workDir, 'Command "opencode" not found. Install it with "npm i -g opencode-ai@latest".'),
        )
      } else {
        this.emit('error', err)
      }
    })
    // OpenCode's Windows launcher can retain argv's surrounding quotes in the
    // native user message. stdin preserves exact bytes and managed-echo identity.
    proc.stdin!.on('error', (error) => {
      if (this.process === proc) this.emitErrorIfOpen({ state: 'error', message: error.message })
    })
    proc.stdin!.end(input)

  }

  private async prepareManagedLaunch(systemPrompt?: string, publicTurn = false): Promise<{
    args: string[]
    env: NodeJS.ProcessEnv
    configDir: string | null
    macosFileSandbox: MacosFileSandboxSpec | null
  }> {
    const compiled = this.managedAgentPolicy
    if (!compiled) {
      return {
        args: ['--auto'],
        env: buildAgentProcessEnv({ NO_COLOR: '1', ...this.extraEnv }),
        configDir: null,
        macosFileSandbox: null,
      }
    }
    if (isManagedAgentNativeFull(compiled)) {
      return {
        args: ['--auto'],
        env: buildManagedNativeFullProcessEnv({ NO_COLOR: '1', ...this.extraEnv }),
        configDir: null,
        macosFileSandbox: null,
      }
    }

    const nativeConfig = compileOpenCodeManagedPermissions(
      resolveManagedAgentAdapterEnforcement(compiled),
      compiled.adapterPolicy.workDir,
      { systemPrompt, publicTurn },
    )
    const isolated = await createOpenCodeManagedConfigDirectory(nativeConfig)
    const env = buildManagedAgentProcessEnv({
      agentType: 'opencode',
      providerEnv: this.extraEnv,
      sessionEnv: this.extraEnv,
      runtimeEnv: { NO_COLOR: '1' },
    })
    env.OPENCODE_CONFIG = isolated.configPath
    env.OPENCODE_CONFIG_DIR = isolated.directory
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(nativeConfig.config)
    // Keeps the restricted run's model catalog cache and file locks out of
    // the real user's shared `~/.cache/opencode` and `~/.local/state/opencode`.
    // XDG_DATA_HOME (auth state) is intentionally left alone; see the
    // `config.globalAndAdministratorSourcesMayRemain` known gap.
    env.XDG_CACHE_HOME = isolated.cacheDir
    env.XDG_STATE_HOME = isolated.stateDir
    env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true'
    env.OPENCODE_DISABLE_CLAUDE_CODE = '1'
    env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = '1'
    env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
    // Host-level file confinement beneath the tool-layer restriction above:
    // real cross-visitor reads/writes under $HOME are denied at the OS level,
    // not just by the (bypassable) tool allowlist. macOS-only for now; other
    // platforms keep relying on the tool layer alone, matching their existing
    // `partial` declaration.
    const macosFileSandbox = publicTurn && isMacosFileSandboxSupported()
      ? this.buildMacosFileSandboxSpec(compiled.adapterPolicy.workDir, isolated.directory)
      : null
    return { args: nativeConfig.args, env, configDir: isolated.directory, macosFileSandbox }
  }

  /**
   * Confines the whole home directory and reopens only what this turn
   * legitimately needs: the isolated per-conversation workDir, the throwaway
   * managed-config directory, and OpenCode/Bun's real global config/data
   * dirs, which it creates unconditionally on startup regardless of the
   * `OPENCODE_CONFIG*`/`XDG_CACHE_HOME`/`XDG_STATE_HOME` overrides above
   * (verified directly: without reopening them the process fails before
   * producing any reply). Reopening them matches the already-declared
   * `config.globalAndAdministratorSourcesMayRemain` gap rather than
   * widening it; every sibling visitor directory and credential path under
   * the home directory that is not one of these stays genuinely unreadable.
   */
  private buildMacosFileSandboxSpec(workDir: string, isolatedConfigDir: string): MacosFileSandboxSpec {
    const home = os.homedir()
    return {
      confinedRoots: [home],
      scopes: [
        { path: workDir, write: true },
        { path: isolatedConfigDir, write: true },
        { path: path.join(home, '.local', 'share', 'opencode'), write: true },
        { path: path.join(home, '.config', 'opencode'), write: true },
      ],
    }
  }

  private async disposeManagedConfig(configDir: string | null): Promise<void> {
    if (!configDir) return
    if (this.managedConfigDir === configDir) this.managedConfigDir = null
    await disposeOpenCodeManagedConfigDirectory(configDir).catch(() => {})
  }

  private handleStreamEvent(obj: OpenCodeStreamEvent): void {
    if (obj.sessionID && obj.sessionID !== this.agentSessionId) {
      this.agentSessionId = obj.sessionID
      this.emitEvent({ state: 'start', agentSessionId: obj.sessionID })
      this.emit('nativeSession', 'opencode', obj.sessionID)
    }

    const part = obj.part
    if (obj.type === 'text' && part?.text) {
      this.emitEvent({ state: 'delta', text: part.text })
      return
    }

    if (obj.type === 'reasoning' && part?.text) {
      this.emitEvent({ state: 'delta', text: part.text, thinking: true })
      return
    }

    if (obj.type === 'tool_use' && part?.type === 'tool') {
      if (part.state?.status === 'completed' || part.state?.status === 'error') {
        this.emitEvent({
          state: 'tool-result',
          name: part.tool ?? 'tool',
          result:
            part.state.status === 'error'
              ? (part.state.error ?? 'tool failed')
              : stringifyResult(part.state?.output),
        })
      } else {
        this.emitEvent({
          state: 'tool-call',
          name: part.tool ?? 'tool',
          args: part.state?.input ?? {},
        })
      }
      return
    }

    if (obj.type === 'error') {
      this.emitErrorIfOpen({ state: 'error', message: extractErrorMessage(obj.error) })
      return
    }

    if (obj.type === 'step_finish') {
      // OpenCode emits step_finish for every model step, including the step
      // that requests a tool. The same process then continues with the tool
      // result and another model step. Treating this as the Run terminal
      // boundary revokes per-Turn capabilities while later tools are still
      // executing. The `opencode run` process close is the actual boundary.
      this.recordStepUsage(usageFromTokens(part?.tokens))
    }
  }

  private handleProcessLine(proc: ChildProcess, line: string): void {
    // A stopped process may flush buffered JSON after the next Turn has
    // already started. Never let a previous process emit events under the new
    // runId or close the new Turn.
    if (this.process !== proc || !line.trim()) return
    try {
      this.handleStreamEvent(JSON.parse(line) as OpenCodeStreamEvent)
    } catch {
      this.emitEvent({ state: 'delta', text: line })
    }
  }

  private recordStepUsage(usage: AgentEvent['usage'] | undefined): void {
    if (!usage) return
    this.runUsage = {
      inputTokens: (this.runUsage?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (this.runUsage?.outputTokens ?? 0) + usage.outputTokens,
    }
  }

  private completeRunAfterProcessExit(
    code: number | null = 0,
    signal: NodeJS.Signals | null = null,
    stderr = '',
  ): void {
    if (code !== 0 || signal !== null) {
      this.emitErrorIfOpen({
        state: 'error',
        message:
          stderr ||
          (signal ? `opencode exited with signal ${signal}` : `opencode exited with code ${String(code)}`),
      })
      return
    }
    this.emitFinalIfOpen({
      state: 'final',
      agentSessionId: this.agentSessionId ?? undefined,
      usage: this.runUsage,
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

  private emitFinalIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'closed'
    this.emitEvent(partial)
  }

  private emitErrorIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'closed'
    this.emitEvent(partial)
  }

  private async killProcess(): Promise<void> {
    const proc = this.process
    if (!proc) {
      await this.disposeManagedConfig(this.managedConfigDir)
      return
    }
    this.process = null
    await stopProcessTree(proc)
    await this.disposeManagedConfig(this.managedConfigDir)
  }
}

registerAgent('opencode', () => new OpenCodeAdapter())
