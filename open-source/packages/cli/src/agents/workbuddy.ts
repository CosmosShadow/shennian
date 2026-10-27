// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/workbuddy-adapter.test.ts

import { spawnSync, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  ChatAttachmentMeta,
  ExternalChannelSessionStatus,
  SessionRunPhase,
} from '@shennian/wire'
import {
  AgentAdapter,
  registerAgent,
  type AgentEvent,
  type AgentSendContext,
  type AgentStartOptions,
} from './adapter.js'
import { resolveBuiltinCommand, spawnAgentCommand } from './command-spec.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import {
  buildPlatformInstructions,
  ensurePlatformInstructionsFile,
} from './platform-instructions.js'
import { resolveWindowsSystemRoot } from '../windows-shell.js'
import {
  resolveManagedAgentAdapterEnforcement,
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import { resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
import {
  compileWorkBuddyManagedPermissions,
  createWorkBuddyManagedConfigFiles,
  disposeWorkBuddyManagedConfigFiles,
  WORKBUDDY_MANAGED_RUNTIME_SECURITY,
} from './workbuddy-managed-permissions.js'

registerManagedAgentRuntimeSecurity('workbuddy', WORKBUDDY_MANAGED_RUNTIME_SECURITY)

const WORKBUDDY_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function normalizeWorkBuddyModelId(modelId?: string | null): string | undefined {
  const trimmed = modelId?.trim()
  return trimmed && trimmed !== 'auto' ? trimmed : undefined
}

export function normalizeWorkBuddyReasoningEffort(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (WORKBUDDY_EFFORTS.has(trimmed)) return trimmed
  throw new Error(
    `Unsupported WorkBuddy reasoning effort "${trimmed}". Supported values: minimal, low, medium, high, xhigh, max.`,
  )
}

export function workBuddySystemPromptArgs(
  systemPrompt: string | null,
  platform: NodeJS.Platform,
  promptFile?: string,
): string[] {
  if (!systemPrompt) return []
  if (platform === 'win32') {
    if (!promptFile) throw new Error('WorkBuddy system prompt file is required on Windows.')
    return ['--system-prompt-file', promptFile]
  }
  return ['--append-system-prompt', systemPrompt]
}

export function workBuddyRoomActivationText(text: string): string {
  const blocks = text.split(/\n\n(?=<[^>\n]+>\n)/)
  const current = blocks[blocks.length - 1] ?? text
  return current
    .replace(/^\[群消息\][ \t]+<[^>\n]+>\n/, '')
    .replace(/^\[群消息\]\n?/, '')
    .replace(/^<[^>\n]+>\n/, '')
    .trim()
}

export function terminateWorkBuddyProcess(
  proc: Pick<ChildProcess, 'pid' | 'kill'>,
  platform: NodeJS.Platform = process.platform,
  terminateWindowsTree: (pid: number) => boolean = terminateWindowsProcessTree,
): void {
  if (platform === 'win32' && proc.pid && terminateWindowsTree(proc.pid)) return
  proc.kill('SIGTERM')
}

function terminateWindowsProcessTree(pid: number): boolean {
  const taskkill = path.win32.join(resolveWindowsSystemRoot(), 'System32', 'taskkill.exe')
  const result = spawnSync(taskkill, ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5_000,
  })
  return result.status === 0
}

type WorkBuddyContentBlock = {
  type?: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  content?: unknown
}

type WorkBuddyStreamEvent = {
  type?: string
  subtype?: string
  session_id?: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  content?: unknown
  result?: string
  error?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: {
    content?: WorkBuddyContentBlock[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  request?: {
    subtype?: string
    tool_name?: string
    input?: Record<string, unknown>
  }
}

function summarizeWorkBuddyToolInput(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input.trim().slice(0, 600) || undefined
  const record = typeof input === 'object' ? (input as Record<string, unknown>) : null
  const primary = record && [record.command, record.file_path, record.path, record.url, record.pattern]
    .find((value) => typeof value === 'string' && value.trim())
  if (typeof primary === 'string') return primary.trim().slice(0, 600)
  try {
    return JSON.stringify(input).slice(0, 600)
  } catch {
    return undefined
  }
}

export class WorkBuddyAdapter extends AgentAdapter {
  readonly type = 'workbuddy' as const
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private agentSessionId: string | null = null
  private workDir: string | null = null
  private seq = 0
  private runId = ''
  private terminalState: 'open' | 'final' | 'error' = 'open'
  private hasEmittedText = false
  private runPhase: SessionRunPhase | null = null
  private persistNativeSession = true
  private externalChannel: ExternalChannelSessionStatus | null = null
  private shennianSessionId: string | null = null
  private extraEnv: NodeJS.ProcessEnv = {}
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private managedConfigDir: string | null = null
  private managedProcessEnv: NodeJS.ProcessEnv | null = null

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
    _sessionId: string,
    workDir: string,
    agentSessionId?: string | null,
    options?: AgentStartOptions,
  ): Promise<void> {
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.seq = 0
    this.persistNativeSession = options?.persistNativeSession !== false
    if (agentSessionId) this.agentSessionId = agentSessionId
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    const managedInvocation =
      context?.source === 'room_activation' ||
      this.shennianSessionId?.startsWith('room-managed-') === true
    if (managedInvocation && !this.managedAgentPolicy) {
      throw new Error('managed_agent_policy_missing')
    }
    await this.killProcess()
    this.runId = randomUUID()
    this.resetRunState()
    const managedRoomActivation = context?.source === 'room_activation'
    // CodeBuddy's resumed native Session treats the Room's `<speaker>` block
    // envelope as already-consumed input and exits without calling the tool.
    // Give it the current addressed message only. Additional history remains
    // available through the scoped Shennian CLI read command.
    const baseText = managedRoomActivation ? workBuddyRoomActivationText(text) : text
    // CodeBuddy's -p mode takes text only; expose uploaded files (including
    // images) by path so the Agent can open them with its own file tools.
    const attachmentRefs = (attachments ?? [])
      .filter((attachment) => attachment.path && !/^https?:\/\//i.test(attachment.path))
      .map((attachment) => `[${attachment.name}](<${attachment.path}>)`)
    const promptText = attachmentRefs.length ? [baseText, '', ...attachmentRefs].join('\n') : baseText

    const args = ['-p', promptText, '--output-format', 'stream-json', '--verbose']
    if (!this.persistNativeSession) args.push('--no-session-persistence')
    const resolvedModelId = normalizeWorkBuddyModelId(modelId)
    if (resolvedModelId) args.push('--model', resolvedModelId)
    if (managedRoomActivation) args.push('--max-turns', '8')
    // Windows launches the npm WorkBuddy shim through cmd.exe, whose command
    // line is capped at 8191 characters. The managed bootstrap only needs a
    // native Session id, so avoid attaching the large platform prompt until
    // that Session exists. Room activations still receive the full prompt.
    const isManagedBootstrap =
      this.shennianSessionId?.startsWith('room-managed-') &&
      !this.agentSessionId &&
      !managedRoomActivation
    const systemPrompt = isManagedBootstrap
      ? null
      : buildPlatformInstructions(
          this.workDir ?? process.cwd(),
          this.externalChannel,
          this.shennianSessionId ?? undefined,
          agentSystemPrompt,
        )
    if (systemPrompt) {
      // The npm shim is launched through cmd.exe on Windows. Room context can
      // exceed its 8191-character command-line limit, so pass the same private
      // generated instructions by file instead of truncating the activation.
      const promptFile =
        process.platform === 'win32'
          ? ensurePlatformInstructionsFile(
              this.workDir ?? process.cwd(),
              this.externalChannel,
              this.shennianSessionId ?? undefined,
              agentSystemPrompt,
            )
          : undefined
      args.push(...workBuddySystemPromptArgs(systemPrompt, process.platform, promptFile))
    }
    const effort = normalizeWorkBuddyReasoningEffort(reasoningEffort)
    if (effort) args.push('--effort', effort)
    if (this.agentSessionId) args.push('--resume', this.agentSessionId)

    args.push(...(await this.prepareManagedLaunch(context?.source === 'published_agent')))

    this.spawnAndParse(args)
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.agentSessionId = agentSessionId
    this.resetRunState()
  }

  async stop(): Promise<void> {
    await this.killProcess()
  }

  async getStatus(): Promise<{
    active: boolean
    runId?: string | null
    runPhase?: SessionRunPhase | null
    canStop?: boolean
  }> {
    return {
      active: this.process != null && this.terminalState === 'open',
      runId: this.runId || null,
      runPhase: this.runPhase,
      canStop: this.process != null && this.terminalState === 'open',
    }
  }

  private spawnAndParse(args: string[]): void {
    const spec = resolveBuiltinCommand('workbuddy')
    if (!spec) {
      void this.disposeManagedConfig()
      this.emit(
        'error',
        new Error(
          'WorkBuddy was not found. Install WorkBuddy Desktop or the CodeBuddy CLI, then retry.',
        ),
      )
      return
    }
    let proc: ChildProcess
    try {
      proc = spawnAgentCommand(spec, args, {
        cwd: this.workDir ?? undefined,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.buildProcessEnv(),
      })
    } catch (error) {
      void this.disposeManagedConfig()
      throw error
    }
    this.process = proc

    const lines = createInterface({ input: proc.stdout! })
    lines.on('line', (line) => {
      if (!line.trim()) return
      try {
        this.handleStreamEvent(JSON.parse(line) as WorkBuddyStreamEvent)
      } catch {
        // WorkBuddy may write non-protocol notices to stdout. Never surface
        // unstructured output because it may contain local connector details.
      }
    })

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_000)
    })

    proc.on('close', (code) => {
      if (this.process !== proc) return
      this.process = null
      this.runPhase = null
      void this.disposeManagedConfig()
      this.handleProcessClose(code, stderr)
    })
    proc.on('error', (error) => {
      if (this.process !== proc) return
      this.process = null
      this.runPhase = null
      void this.disposeManagedConfig()
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      this.emitErrorIfOpen({
        state: 'error',
        message: missing
          ? 'WorkBuddy was not found. Install WorkBuddy Desktop or the CodeBuddy CLI, then retry.'
          : sanitizeWorkBuddyError(error.message),
      })
    })
  }

  private handleStreamEvent(event: WorkBuddyStreamEvent): void {
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      this.agentSessionId = event.session_id
      this.runPhase = 'thinking'
      this.emitEvent({ state: 'start', agentSessionId: event.session_id })
      this.emit('nativeSession', 'workbuddy', event.session_id)
      return
    }

    if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
      this.runPhase = 'waiting_approval'
      this.emitEvent({
        state: 'approval-pending',
        name: event.request.tool_name,
        args: event.request.input,
        approval: {
          title: `WorkBuddy 请求使用 ${event.request.tool_name || '工具'}`,
          content: summarizeWorkBuddyToolInput(event.request.input),
          source: 'workbuddy',
          actionHint: '请在 WorkBuddy 或神念中确认后继续。',
        },
      })
      return
    }

    if (event.type === 'assistant') {
      const blocks = event.message?.content
      if (blocks?.length) {
        for (const block of blocks) this.handleContentBlock(block)
      } else if (event.text) {
        this.emitText(event.text, Boolean(event.thinking))
      }
      return
    }

    if (event.type !== 'result') return
    if (event.subtype === 'tool_result') {
      this.runPhase = 'tool_running'
      this.emitEvent({
        state: 'tool-result',
        name: event.name,
        result: stringifyToolResult(event.content),
      })
      return
    }
    if (event.subtype === 'error' || event.error) {
      this.emitErrorIfOpen({
        state: 'error',
        message: sanitizeWorkBuddyError(event.error || event.result || 'WorkBuddy failed.'),
      })
      return
    }
    if (!this.hasEmittedText && event.result) this.emitText(event.result, false)
    if (event.session_id && event.session_id !== this.agentSessionId) {
      this.agentSessionId = event.session_id
      this.emit('nativeSession', 'workbuddy', event.session_id)
    }
    const usage = event.usage ?? event.message?.usage
    this.emitFinalIfOpen({
      state: 'final',
      agentSessionId: this.agentSessionId ?? undefined,
      usage: usage
        ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 }
        : undefined,
    })
  }

  private handleContentBlock(block: WorkBuddyContentBlock): void {
    if (block.type === 'text' && block.text) {
      this.emitText(block.text, false)
    } else if (block.type === 'thinking' && block.thinking) {
      this.emitText(block.thinking, true)
    } else if (block.type === 'tool_use') {
      this.runPhase = 'tool_running'
      this.emitEvent({ state: 'tool-call', name: block.name, args: block.input })
    } else if (block.type === 'tool_result') {
      this.emitEvent({
        state: 'tool-result',
        name: block.name,
        result: stringifyToolResult(block.content),
      })
    }
  }

  private emitText(text: string, thinking: boolean): void {
    this.runPhase = thinking ? 'thinking' : 'streaming_text'
    const prefix = !thinking && this.hasEmittedText ? '\n\n' : ''
    this.emitEvent({ state: 'delta', text: prefix + text, thinking: thinking || undefined })
    if (!thinking) this.hasEmittedText = true
  }

  private handleProcessClose(code: number | null, stderr: string): void {
    if (code !== 0 && code !== null) {
      this.emitErrorIfOpen({
        state: 'error',
        message: sanitizeWorkBuddyError(stderr) || `WorkBuddy exited with code ${code}.`,
      })
      return
    }
    this.emitFinalIfOpen({ state: 'final', agentSessionId: this.agentSessionId ?? undefined })
  }

  private emitFinalIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'final'
    this.runPhase = null
    this.emitEvent(partial)
  }

  private emitErrorIfOpen(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminalState !== 'open') return
    this.terminalState = 'error'
    this.runPhase = null
    this.emitEvent(partial)
  }

  private emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    this.emit('agentEvent', { ...partial, runId: this.runId, seq: this.seq++ })
  }

  private resetRunState(): void {
    this.seq = 0
    this.terminalState = 'open'
    this.hasEmittedText = false
    this.runPhase = null
  }

  private async killProcess(): Promise<void> {
    const proc = this.process
    if (!proc) {
      await this.disposeManagedConfig()
      return
    }
    this.process = null
    this.runPhase = null
    terminateWorkBuddyProcess(proc)
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      proc.once('close', finish)
      setTimeout(() => {
        terminateWorkBuddyProcess(proc)
        finish()
      }, 3_000).unref?.()
    })
    await this.disposeManagedConfig()
  }

  private async prepareManagedLaunch(publicTurn = false): Promise<string[]> {
    const compiled = this.managedAgentPolicy
    if (!compiled || isManagedAgentNativeFull(compiled)) {
      this.managedProcessEnv = null
      if (compiled) this.managedProcessEnv = buildManagedNativeFullProcessEnv(this.extraEnv)
      return [
        '--permission-mode',
        'bypassPermissions',
        '--setting-sources',
        'user,project,local',
        '--tools',
        'default',
      ]
    }

    const daemonIpc = publicTurn ? null : resolveManagedRoomIpcPaths()
    const nativeConfig = compileWorkBuddyManagedPermissions(
      resolveManagedAgentAdapterEnforcement(compiled),
      compiled.adapterPolicy.workDir,
      {
        internalUnixSockets: daemonIpc?.transport === 'unix_socket' ? [daemonIpc.endpoint] : [],
        publicTurn,
      },
    )
    const files = await createWorkBuddyManagedConfigFiles(nativeConfig)
    this.managedConfigDir = files.directory
    const env = buildManagedAgentProcessEnv({
      agentType: 'workbuddy',
      providerEnv: this.extraEnv,
      sessionEnv: this.extraEnv,
      runtimeEnv: { NO_COLOR: '1' },
    })
    // These values are generated from the verified policy rather than inherited
    // from the daemon. They contain no credentials and cannot enable bypass mode.
    Object.assign(env, nativeConfig.runtimeEnv)
    delete env.CODEBUDDY_IS_SANDBOX
    this.managedProcessEnv = env

    return [
      '--permission-mode',
      'dontAsk',
      '--subagent-permission-mode',
      'dontAsk',
      '--settings',
      files.settingsPath,
      '--setting-sources',
      'none',
      '--strict-mcp-config',
      '--mcp-config',
      '{}',
      '--tools',
      nativeConfig.toolNames.join(','),
    ]
  }

  private buildProcessEnv(): NodeJS.ProcessEnv {
    return this.managedProcessEnv ?? buildAgentProcessEnv(this.extraEnv)
  }

  private async disposeManagedConfig(): Promise<void> {
    const directory = this.managedConfigDir
    this.managedConfigDir = null
    this.managedProcessEnv = null
    if (!directory) return
    await disposeWorkBuddyManagedConfigFiles(directory).catch(() => {})
  }
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable WorkBuddy tool result]'
  }
}

export function sanitizeWorkBuddyError(value: string): string {
  return value
    .replace(/(Authorization\s*:\s*)Bearer\s+[A-Za-z0-9._~+/-]+/gi, '$1Bearer [redacted]')
    .replace(
      /(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|connector[-_ ]?token)(\s*[:=]\s*)[^\s,;]+/gi,
      '$1$2[redacted]',
    )
    .trim()
    .slice(0, 2_000)
}

registerAgent('workbuddy', () => new WorkBuddyAdapter())
