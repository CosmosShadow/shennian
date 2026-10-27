// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/claude-managed-permissions.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  AgentAdapter,
  registerAgent,
  summarizeToolInput,
  type AgentEvent,
  type AgentSendContext,
  type AgentStartOptions,
} from './adapter.js'
import { ClaudePermissionBridge, type ClaudePermissionDecision } from './claude-permission-bridge.js'
import { CodexUserInputRequests } from './codex-user-input-requests.js'
import {
  CLAUDE_PERMISSION_MCP_SERVER_NAME,
  CLAUDE_PERMISSION_SOCKET_ENV,
  CLAUDE_PERMISSION_TOOL_NAME,
} from './claude-permission-protocol.js'
import {
  resolveBuiltinCommand,
  spawnAgentCommand,
  spawnResolvedCommandSync,
} from './command-spec.js'
import { spawnEnoentError } from './spawn-errors.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { buildPlatformInstructions } from './platform-instructions.js'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'
import {
  resolveManagedAgentAdapterEnforcement,
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import { resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
import {
  CLAUDE_MANAGED_RUNTIME_SECURITY,
  compileClaudeManagedPermissions,
  type ClaudeManagedPermissionConfig,
} from './claude-managed-permissions.js'

registerManagedAgentRuntimeSecurity('claude', CLAUDE_MANAGED_RUNTIME_SECURITY)

export function normalizeClaudeModelId(modelId?: string | null): string {
  const trimmed = modelId?.trim()
  return trimmed || 'default'
}

const CLAUDE_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const claudeEffortSupportCache = new Map<string, boolean>()

export function normalizeClaudeReasoningEffort(
  reasoningEffort?: string | null,
): string | undefined {
  const trimmed = reasoningEffort?.trim()
  if (!trimmed) return undefined
  if (CLAUDE_REASONING_EFFORTS.has(trimmed)) return trimmed
  throw new Error(
    `Unsupported Claude reasoning effort "${trimmed}". Supported values: low, medium, high, xhigh, max.`,
  )
}

export function resetClaudeCapabilityCacheForTests(): void {
  claudeEffortSupportCache.clear()
}

export function shouldForwardClaudeStderrLine(line: string): boolean {
  const normalized = line.trim()
  if (!normalized) return false
  return !normalized.includes('claude.ai connectors are disabled because')
}

export function supportsClaudeReasoningEffort(): boolean {
  const spec = resolveBuiltinCommand('claude')
  if (!spec) return false

  const cacheKey = `${spec.kind}:${spec.path}:${spec.command}:${spec.args.join('\0')}`
  if (claudeEffortSupportCache.has(cacheKey)) {
    return claudeEffortSupportCache.get(cacheKey) ?? false
  }

  try {
    const result = spawnResolvedCommandSync(spec, ['--help'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
      // Capability discovery already resolved the executable and only invokes
      // `--help`; it must not block on a login-shell environment refresh.
      env: process.env,
    })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    const supported = /(?:^|\s)--effort(?:\s|,|<)/.test(output)
    claudeEffortSupportCache.set(cacheKey, supported)
    return supported
  } catch {
    claudeEffortSupportCache.set(cacheKey, false)
    return false
  }
}

type ClaudeContentBlock = {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  // tool_result blocks arrive inside `user` frames
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

type ClaudeStreamEvent = {
  type: string
  subtype?: string
  session_id?: string
  error_status?: number
  // legacy flat fields (pre-2.1)
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  result?: string
  cost_usd?: number
  usage?: { input_tokens: number; output_tokens: number }
  is_error?: boolean
  message?: {
    content?: ClaudeContentBlock[]
    usage?: { input_tokens: number; output_tokens: number }
  }
  // error message field
  error?: string
}

const MAX_TOOL_RESULT_CHARS = 64 * 1024

function claudeToolResultText(content: unknown): string {
  const text = joinClaudeToolResult(content)
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`
    : text
}

function joinClaudeToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const item = part as { type?: unknown; text?: unknown }
      if (typeof item.text === 'string') return item.text
      return item.type === 'image' ? '[image]' : ''
    })
    .filter(Boolean)
    .join('\n')
}

export class ClaudeAdapter extends AgentAdapter {
  readonly type = 'claude' as const
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private agentSessionId: string | null = null
  private sessionId: string | null = null
  private workDir: string | null = null
  private seq = 0
  private runId = ''
  private hasEmittedText = false
  /** tool_use_id → tool name, so a tool_result frame can be folded into its call. */
  private toolNames = new Map<string, string>()
  private terminalState: 'open' | 'final' | 'error' = 'open'
  private authenticationRetrying = false
  private pendingSuccess: {
    agentSessionId?: string
    usage?: { inputTokens: number; outputTokens: number }
  } | null = null
  private persistNativeSession = true
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private permissionBridge: ClaudePermissionBridge | null = null
  private pendingInputReplies = new Map<string, (value: ClaudePermissionDecision) => void>()
  private readonly userInputs = new CodexUserInputRequests((id, result) => {
    const respond = this.pendingInputReplies.get(String(id)); this.pendingInputReplies.delete(String(id))
    const answered = Object.keys((result as { answers: Record<string, unknown> }).answers).length > 0
    respond?.(answered ? { behavior: 'allow', updatedInput: result } : { behavior: 'deny', message: 'user_input_ended' })
  }, event => this.emitEvent(event), 'claude')
  /** One entry per Claude tool call currently waiting on a phone tap. */
  private pendingClaudePermissions = new Map<string, {
    resolve: (decision: ClaudePermissionDecision) => void
    timer: NodeJS.Timeout
  }>()

  constructor(private readonly options: { systemPrompt?: string; hidden?: boolean } = {}) {
    super()
  }

  private externalChannel: ExternalChannelSessionStatus | null = null
  private shennianSessionId: string | null = null
  private extraEnv: NodeJS.ProcessEnv = {}

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

  async start(
    sessionId: string,
    workDir: string,
    agentSessionId?: string | null,
    options?: AgentStartOptions,
  ): Promise<void> {
    this.sessionId = sessionId
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.seq = 0
    this.persistNativeSession = options?.persistNativeSession !== false
    if (agentSessionId) this.agentSessionId = agentSessionId
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
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

    const args = [
      '-p',
      text,
      '--output-format',
      'stream-json',
      '--verbose',
      ...(this.buildManagedPermissionConfig(context?.source === 'published_agent')?.args ?? []),
    ]
    if (!this.persistNativeSession) args.push('--no-session-persistence')
    const systemPrompt =
      this.options.systemPrompt ??
      buildPlatformInstructions(
        this.workDir ?? process.cwd(),
        this.externalChannel,
        this.shennianSessionId ?? undefined,
        agentSystemPrompt,
      )
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt)
    }
    if (this.options.hidden) {
      args.push('--name', 'Shennian Manager Substrate')
    }
    args.push(...(await this.buildPermissionModeArgs()))
    args.push('--model', normalizeClaudeModelId(modelId))
    const effort = normalizeClaudeReasoningEffort(reasoningEffort)
    if (effort && supportsClaudeReasoningEffort()) {
      args.push('--effort', effort)
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
    this.resetRunState()

    const resumeArgs = [
      '--resume',
      agentSessionId,
      '--output-format',
      'stream-json',
      '--verbose',
      ...(this.buildManagedPermissionConfig()?.args ?? []),
    ]
    const systemPrompt =
      this.options.systemPrompt ??
      buildPlatformInstructions(
        this.workDir ?? process.cwd(),
        this.externalChannel,
        this.shennianSessionId ?? undefined,
      )
    if (systemPrompt) {
      resumeArgs.push('--append-system-prompt', systemPrompt)
    }
    if (this.options.hidden) {
      resumeArgs.push('--name', 'Shennian Manager Substrate')
    }
    resumeArgs.push(...(await this.buildPermissionModeArgs()))
    this.spawnAndParse(resumeArgs)
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  private spawnAndParse(args: string[]): void {
    const spec = resolveBuiltinCommand('claude')
    if (!spec) {
      this.emit('error', spawnEnoentError(this.workDir, 'Command "claude" not found. Is Claude Code CLI installed?'))
      return
    }
    const proc = spawnAgentCommand(spec, args, {
      cwd: this.workDir ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.buildProcessEnv(),
    })
    this.process = proc

    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line) as ClaudeStreamEvent
        this.handleStreamEvent(obj)
      } catch {
        // skip malformed lines
      }
    })

    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text
      if (this.terminalState !== 'open') return
      // Stream stderr lines in real-time so the app shows errors/retries immediately
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (shouldForwardClaudeStderrLine(trimmed)) {
          this.emitEvent({ state: 'delta', text: trimmed + '\n' })
        }
      }
    })

    proc.on('close', (code) => {
      if (this.process !== proc) return
      this.process = null
      this.handleProcessClose(code, stderrBuf)
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', new Error('Command "claude" not found. Is Claude Code CLI installed?'))
      } else {
        this.emit('error', err)
      }
    })
  }

  /**
   * A managed agent granted native-full execution runs with real machine
   * access, so unlike the owner's own unmanaged Claude session it must not
   * silently bypass permissions: every tool call routes through the phone's
   * approval UI via the MCP permission-relay instead.
   */
  private async buildPermissionModeArgs(): Promise<string[]> {
    // AskUserQuestion never gets a real answer in headless `-p` mode (it
    // resolves itself instantly as "did not answer"); disallowing it makes
    // Claude fall back to asking in plain text, which the user can actually see and answer.
    const args = ['--disallowedTools', 'AskUserQuestion']
    if (process.getuid?.() === 0) return args
    if (!this.managedAgentPolicy || isManagedAgentNativeFull(this.managedAgentPolicy)) {
      const socketPath = await this.startPermissionBridge()
      const mcpConfig = {
        mcpServers: {
          [CLAUDE_PERMISSION_MCP_SERVER_NAME]: {
            command: process.execPath,
            args: [fileURLToPath(new URL('./claude-permission-relay-server.js', import.meta.url))],
            env: { [CLAUDE_PERMISSION_SOCKET_ENV]: socketPath },
          },
        },
      }
      args.push('--mcp-config', JSON.stringify(mcpConfig))
      if (this.managedAgentPolicy) args.push('--permission-prompts', 'host', '--permission-prompt-tool', `mcp__${CLAUDE_PERMISSION_MCP_SERVER_NAME}__${CLAUDE_PERMISSION_TOOL_NAME}`)
      else args.push('--dangerously-skip-permissions')
      return args
    }
    if (!this.managedAgentPolicy) args.push('--dangerously-skip-permissions')
    return args
  }

  private async startPermissionBridge(): Promise<string> {
    const bridge = this.permissionBridge ?? new ClaudePermissionBridge(
      (toolName, input) => toolName === '__shennian_user_input__' ? this.requestClaudeUserInput(input) : this.requestClaudePermission(toolName, input),
    )
    this.permissionBridge = bridge
    return bridge.start()
  }

  private requestClaudePermission(toolName: unknown, input: unknown): Promise<ClaudePermissionDecision> {
    const permissionId = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingClaudePermissions.delete(permissionId)
        resolve({ behavior: 'deny', message: 'shennian_permission_timeout' })
      }, 5 * 60_000)
      timer.unref?.()
      this.pendingClaudePermissions.set(permissionId, { resolve, timer })
      this.emitEvent({
        state: 'approval-pending',
        runPhase: 'waiting_approval',
        approval: {
          title: typeof toolName === 'string' && toolName.trim() ? toolName : '需要用户确认',
          content: summarizeToolInput(input),
          source: 'claude',
        },
        permission: {
          id: permissionId,
          sessionId: this.shennianSessionId ?? undefined,
          agentSessionId: this.agentSessionId ?? undefined,
          runId: this.runId,
          toolCallId: permissionId,
          options: [
            { id: 'allow', name: '允许', kind: 'allow_once' },
            { id: 'deny', name: '拒绝', kind: 'reject_once' },
          ],
        },
      })
    })
  }
  private requestClaudeUserInput(input: unknown): Promise<ClaudePermissionDecision> {
    const id = randomUUID(), threadId = this.shennianSessionId ?? null
    return new Promise(resolve => {
      this.pendingInputReplies.set(id, resolve)
      this.userInputs.request(id, { ...(input as Record<string, unknown>), threadId, turnId: this.runId }, threadId, this.runId,
        Boolean(this.managedAgentPolicy && !isManagedAgentNativeFull(this.managedAgentPolicy)))
    })
  }

  async respondToPermission(permissionId: string, optionId: string): Promise<void> {
    if (permissionId.startsWith('input-')) { this.userInputs.respond(permissionId, optionId, this.runId); return }
    if (optionId !== 'allow' && optionId !== 'deny') throw new Error('claude_permission_invalid')
    const pending = this.pendingClaudePermissions.get(permissionId)
    if (!pending) throw new Error('Claude permission request is no longer pending')
    this.pendingClaudePermissions.delete(permissionId)
    clearTimeout(pending.timer)
    pending.resolve({ behavior: optionId === 'allow' ? 'allow' : 'deny' })
  }

  private buildManagedPermissionConfig(publicTurn = false): ClaudeManagedPermissionConfig | null {
    const compiled = this.managedAgentPolicy
    if (!compiled || isManagedAgentNativeFull(compiled)) return null
    // Public replies are collected by this host process. The visitor-facing
    // provider needs no access to the scoped Room CLI or daemon socket.
    const internalAccess = publicTurn
      ? { readPaths: [], unixSockets: [] }
      : resolveClaudeManagedInternalAccess()
    return compileClaudeManagedPermissions(
      resolveManagedAgentAdapterEnforcement(compiled),
      compiled.adapterPolicy.workDir,
      {
        internalReadPaths: internalAccess.readPaths,
        internalUnixSockets: internalAccess.unixSockets,
        shellSubprocessPolicy: compiled.environmentPolicy.shellSubprocess,
      },
    )
  }

  private buildProcessEnv(): NodeJS.ProcessEnv {
    if (!this.managedAgentPolicy) return buildAgentProcessEnv(this.extraEnv)
    if (isManagedAgentNativeFull(this.managedAgentPolicy)) {
      return buildManagedNativeFullProcessEnv({ NO_COLOR: '1', ...this.extraEnv })
    }
    return buildManagedAgentProcessEnv({
      agentType: 'claude',
      providerEnv: this.extraEnv,
      sessionEnv: this.extraEnv,
      runtimeEnv: { NO_COLOR: '1' },
    })
  }

  private handleStreamEvent(obj: ClaudeStreamEvent): void {
    if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
      this.agentSessionId = obj.session_id
      this.emitEvent({ state: 'start', agentSessionId: this.agentSessionId })
      return
    }

    if (
      obj.type === 'system' &&
      obj.subtype === 'api_retry' &&
      obj.error === 'authentication_failed'
    ) {
      // Claude emits api_retry while it is still recovering credentials and
      // can subsequently continue with tool calls and a successful result.
      // Only a structured result error or a non-zero process close is terminal.
      this.authenticationRetrying = true
      this.emitEvent({
        state: 'heartbeat',
        runPhase: 'thinking',
        errorCode: 'auth_retrying',
        message: 'Claude authentication is retrying.',
      })
      return
    }

    if (obj.type === 'assistant') {
      this.authenticationRetrying = false
      // New format (claude >= 2.1): content is in message.content[]
      if (obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && block.text) {
            const prefix = this.hasEmittedText ? '\n\n' : ''
            this.emitEvent({ state: 'delta', text: prefix + block.text })
            this.hasEmittedText = true
          } else if (block.type === 'thinking' && block.thinking) {
            this.emitEvent({ state: 'delta', text: block.thinking, thinking: true })
          } else if (block.type === 'tool_use') {
            if (block.id && block.name) this.toolNames.set(block.id, block.name)
            this.emitEvent({
              state: 'tool-call',
              name: block.name,
              args: block.input,
              ...(block.id ? { toolCallId: block.id } : {}),
            })
          }
        }
        return
      }
      // Legacy flat format (pre-2.1)
      if (obj.subtype === 'text' && obj.text) {
        const prefix = this.hasEmittedText ? '\n\n' : ''
        this.emitEvent({ state: 'delta', text: prefix + obj.text })
        this.hasEmittedText = true
      } else if (obj.subtype === 'thinking' && obj.thinking) {
        this.emitEvent({ state: 'delta', text: obj.thinking, thinking: true })
      } else if (obj.subtype === 'tool_use') {
        this.emitEvent({ state: 'tool-call', name: obj.name, args: obj.input })
      }
      return
    }

    // Claude >= 2.1 reports tool output as tool_result blocks in `user` frames.
    // Without this the tool card opened by tool-call never leaves `running`.
    if (obj.type === 'user') {
      for (const block of obj.message?.content ?? []) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue
        this.emitEvent({
          state: 'tool-result',
          name: this.toolNames.get(block.tool_use_id),
          toolCallId: block.tool_use_id,
          toolStatus: block.is_error === true ? 'failed' : 'completed',
          result: claudeToolResultText(block.content),
        })
      }
      return
    }

    if (obj.type === 'result') {
      if (obj.subtype === 'tool_result') {
        const content = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content)
        this.emitEvent({ state: 'tool-result', name: obj.name, result: content })
      } else if (obj.subtype === 'success') {
        if (obj.session_id) {
          this.agentSessionId = obj.session_id
        }
        const resultText = typeof obj.result === 'string' ? obj.result : ''
        // Claude stream-json normally emits an assistant frame and repeats the
        // final text on the success result. Under provider/CLI buffering the
        // assistant frame can be absent even though result is complete. Use
        // that structured terminal payload exactly once instead of publishing
        // a textless final to the canonical session.
        if (!this.hasEmittedText && resultText.trim()) {
          this.emitEvent({ state: 'delta', text: resultText })
          this.hasEmittedText = true
        }
        const usage = obj.usage ?? obj.message?.usage
        // A result line is structured completion metadata, but some Claude
        // builds can flush assistant content after it. Defer the public final
        // until the process stdio is closed so final can never overtake text.
        this.pendingSuccess = {
          agentSessionId: this.agentSessionId ?? undefined,
          usage: usage
            ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
            : undefined,
        }
      } else if (obj.subtype === 'error') {
        this.emitErrorIfOpen({
          state: 'error',
          message: (obj.error as string | undefined) ?? obj.result ?? 'unknown error',
          ...(this.authenticationRetrying ? { errorCode: 'auth_required' as const } : {}),
        })
      }
    }
  }

  private handleProcessClose(code: number | null, stderrBuf: string): void {
    if (code !== 0 && code !== null) {
      const msg = stderrBuf.trim() || `claude exited with code ${code}`
      this.emitErrorIfOpen({
        state: 'error',
        message: msg,
        ...(this.authenticationRetrying ? { errorCode: 'auth_required' as const } : {}),
      })
      return
    }
    if (!this.hasEmittedText) {
      this.emitErrorIfOpen({
        state: 'error',
        message: 'Claude completed without response text',
      })
      return
    }
    this.emitFinalIfOpen({
      state: 'final',
      agentSessionId: this.pendingSuccess?.agentSessionId ?? this.agentSessionId ?? undefined,
      usage: this.pendingSuccess?.usage,
    })
  }

  private emitFinalIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'final'
    this.emitEvent(partial)
  }

  private emitErrorIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'error'
    this.emitEvent(partial)
  }

  private resetRunState(): void {
    this.seq = 0
    this.hasEmittedText = false
    this.toolNames.clear()
    this.terminalState = 'open'
    this.authenticationRetrying = false
    this.pendingSuccess = null
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
    this.userInputs.clear()
    for (const [permissionId, pending] of this.pendingClaudePermissions) {
      clearTimeout(pending.timer)
      pending.resolve({ behavior: 'deny', message: 'shennian_permission_run_ended' })
      this.pendingClaudePermissions.delete(permissionId)
    }
    if (this.permissionBridge) {
      const bridge = this.permissionBridge
      this.permissionBridge = null
      await bridge.stop()
    }
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

export function resolveClaudeManagedInternalAccess(): {
  readPaths: string[]
  unixSockets: string[]
} {
  const daemonIpc = resolveManagedRoomIpcPaths()
  const readPaths = [daemonIpc.secretFile]
  const unixSockets = daemonIpc.transport === 'unix_socket' ? [daemonIpc.endpoint] : []
  if (daemonIpc.transport === 'unix_socket') readPaths.push(daemonIpc.endpoint)

  const shennian = resolveBuiltinCommand('pi')
  if (shennian?.path) {
    readPaths.push(...resolveClaudeShennianCliReadPaths(shennian.path))
  }

  return {
    readPaths: [...new Set(readPaths)].sort(),
    unixSockets: [...new Set(unixSockets)].sort(),
  }
}

/**
 * Resolve the smallest useful read boundary for the installed Shennian CLI.
 * npm's bin entry is a symlink into dist/bin, while runtime dependencies such
 * as commander live under the package-root node_modules directory. Allowing
 * only the entry point or dist therefore makes every Room CLI call fail inside
 * Claude's native sandbox.
 */
export function resolveClaudeShennianCliReadPaths(commandPath: string): string[] {
  const normalizedCommand = path.normalize(commandPath.trim())
  if (!normalizedCommand || !path.isAbsolute(normalizedCommand)) return []

  const readPaths = [normalizedCommand]
  try {
    const executable = fs.realpathSync(normalizedCommand)
    readPaths.push(executable, path.dirname(executable), path.dirname(path.dirname(executable)))

    let directory = path.dirname(executable)
    for (let depth = 0; depth < 8; depth += 1) {
      const manifestPath = path.join(directory, 'package.json')
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: unknown }
        if (manifest.name === 'shennian') {
          readPaths.push(directory)
          break
        }
      } catch {
        // Keep walking. A missing or malformed manifest must not broaden the
        // sandbox to an arbitrary ancestor such as the global node_modules.
      }
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {
    // The command resolver already confirmed this path. If it disappears
    // before launch, the managed Room command fails closed.
  }

  return [...new Set(readPaths)].sort()
}

registerAgent('claude', () => new ClaudeAdapter())
