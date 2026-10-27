// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pi-coding-agent-adapter.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'
import {
  AgentAdapter, registerAgent, type AgentActiveInput, type AgentEvent, type AgentSendContext,
} from './adapter.js'
import { resolveBuiltinCommand, spawnAgentCommand } from './command-spec.js'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { resolveShennianPath } from '../config/index.js'
import { buildInlineChannelPreamble, buildPlatformInstructions } from './platform-instructions.js'
import {
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import { PiRpcClient, type PiRpcRecord } from './pi-rpc-client.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import { PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY } from './pi-coding-agent-managed-permissions.js'
import { writePiManagedExtension } from './pi-managed-extension.js'
import { recordPiSessionOwnership } from './pi-session-ownership.js'
import {
  classifyPiFailure,
  createPiDiagnosticMarker,
  formatPiDiagnostic,
  inspectPiTurnConfiguration,
  sanitizePiDiagnosticDimension,
  type PiTurnDiagnostic,
} from './pi-turn-diagnostics.js'

registerManagedAgentRuntimeSecurity(
  'pi-coding-agent',
  PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY,
)

const MAX_STDERR_BYTES = 32 * 1024
const MAX_EVENT_TEXT_BYTES = 256 * 1024
const STOP_TIMEOUT_MS = 3_000

type PiState = {
  isStreaming?: boolean
  isCompacting?: boolean
  sessionId?: string
  sessionFile?: string
  pendingMessageCount?: number
  messageCount?: number
  model?: { id?: string; provider?: string; api?: string; baseUrl?: string } | null
}

type PiUsage = {
  input?: number
  output?: number
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 180) || 'session'
}

function extractData(record: PiRpcRecord): Record<string, unknown> {
  return record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {}
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .join('')
}

function truncateText(value: string, limit = MAX_EVENT_TEXT_BYTES): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`
}

function piModelError(value: unknown): string {
  const failure = classifyPiFailure(value)
  const detail = failure.safeDetail ?? 'Upstream error details were omitted'
  // This proves only that Pi ended its model turn with an error. The nested
  // response can come from a provider, enterprise gateway or compatible
  // proxy; do not reclassify HTTP status text as an auth/key diagnosis.
  return `Pi model request failed${failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ''}: ${detail}`
}

function stringifySafe(value: unknown): string {
  try {
    return truncateText(JSON.stringify(value))
  } catch {
    return '[unserializable]'
  }
}

function usageFrom(value: unknown): AgentEvent['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as PiUsage
  if (typeof usage.input !== 'number' && typeof usage.output !== 'number') return undefined
  return {
    inputTokens: typeof usage.input === 'number' ? usage.input : 0,
    outputTokens: typeof usage.output === 'number' ? usage.output : 0,
  }
}

function splitModelSelection(selection?: string): { provider?: string; modelId?: string } {
  const value = selection?.trim()
  if (!value) return {}
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return { modelId: value }
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) }
}

function buildPromptText(
  text: string,
  attachments: ChatAttachmentMeta[] | undefined,
  workDir: string,
  externalChannel: ExternalChannelSessionStatus | null,
  shennianSessionId: string,
  agentSystemPrompt?: string | null,
): string {
  const prefix = buildInlineChannelPreamble(
    workDir,
    externalChannel,
    shennianSessionId,
    agentSystemPrompt,
  )
  const files = attachments?.filter((attachment) => attachment.kind !== 'image') ?? []
  if (!files.length) return `${prefix}${text}`
  const refs = files.map((attachment) => `[${attachment.name}](<${attachment.path}>)`)
  return `${prefix}${[text, '', ...refs].join('\n')}`
}

function imageInputs(attachments: ChatAttachmentMeta[] | undefined, allowFileRead: boolean): Array<{
  type: 'image'
  data: string
  mimeType: string
}> {
  const result: Array<{ type: 'image'; data: string; mimeType: string }> = []
  for (const attachment of attachments ?? []) {
    if (attachment.kind !== 'image' || !attachment.mimeType.startsWith('image/')) continue
    let data = attachment.previewData?.trim() ?? ''
    const comma = data.indexOf(',')
    if (data.startsWith('data:') && comma >= 0) data = data.slice(comma + 1)
    if (!data && allowFileRead && attachment.path && !/^https?:\/\//i.test(attachment.path)) {
      try {
        const stat = fs.statSync(attachment.path)
        if (stat.isFile() && stat.size <= 10 * 1024 * 1024) {
          data = fs.readFileSync(attachment.path).toString('base64')
        }
      } catch {
        data = ''
      }
    }
    if (data) result.push({ type: 'image', data, mimeType: attachment.mimeType })
  }
  return result
}

export class PiCodingAgentAdapter extends AgentAdapter {
  readonly type = 'pi-coding-agent' as const
  override get supportsActiveInput(): boolean { return true }

  async injectActiveInput(input: AgentActiveInput): Promise<void> {
    const state = await this.readState()
    if (!this.rpc || !this.runId || (!state.isStreaming && !state.isCompacting)) {
      throw new Error('pi_active_turn_unavailable')
    }
    const fields: Record<string, unknown> = {
      message: buildPromptText(
        input.text, input.attachments, this.workDir, this.externalChannel, this.shennianSessionId, null,
      ),
    }
    const images = imageInputs(input.attachments, !this.managedAgentPolicy)
    if (images.length) fields.images = images
    await this.rpc.request('steer', fields)
  }
  override get recoveryCapabilities() {
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  private process: ChildProcess | null = null
  private rpc: PiRpcClient | null = null
  private shennianSessionId = ''
  private workDir = ''
  private sessionDir = ''
  private agentSessionId: string | null = null
  private externalChannel: ExternalChannelSessionStatus | null = null
  private extraEnv: NodeJS.ProcessEnv = {}
  /** Room grant baked into the resident process at spawn; Pi cannot re-read its env. */
  private spawnedRoomContext: string | null = null
  private spawnedPublicTurn = false
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private runId = ''
  private seq = 0
  private active = false
  private terminal = true
  private stderr = ''
  private lastUsage: AgentEvent['usage'] | undefined
  private promptFile: string | null = null
  private persistNativeSession = true
  private validationRoot: string | null = null
  private runPhase: 'thinking' | 'tool_running' | 'streaming_text' | null = null
  private processEnv: NodeJS.ProcessEnv = {}
  private turnDiagnostic: PiTurnDiagnostic | null = null

  configure(options: {
    sessionId?: string
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
    managedAgentPolicy?: CompiledManagedAgentPolicy | null
  }): void {
    if (options.sessionId) this.shennianSessionId = options.sessionId
    this.externalChannel = options.externalChannel ?? null
    this.extraEnv = options.env ?? {}
    if ('managedAgentPolicy' in options) this.managedAgentPolicy = options.managedAgentPolicy ?? null
  }

  async start(
    sessionId: string,
    workDir: string,
    agentSessionId?: string | null,
    options?: import('./adapter.js').AgentStartOptions,
  ): Promise<void> {
    await this.stopProcess()
    this.shennianSessionId = sessionId
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.agentSessionId = agentSessionId ?? null
    const root = resolveShennianPath('runtime', 'pi-coding-agent', safePart(sessionId))
    this.persistNativeSession = options?.persistNativeSession !== false
    this.validationRoot = this.persistNativeSession ? null : path.join(root, `validation-${randomUUID()}`)
    this.sessionDir = this.validationRoot ? path.join(this.validationRoot, 'sessions') : path.join(root, 'sessions')
    fs.mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(this.sessionDir, 0o700)
    this.active = false
    this.terminal = true
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    const publicTurn = context?.source === 'published_agent'
    if (publicTurn) assertPublicAgentPolicy(this.managedAgentPolicy)
    const marker = createPiDiagnosticMarker()
    const requestedSelection = splitModelSelection(modelId)
    const attachmentCount = attachments?.length ?? 0
    const imageAttachmentCount = attachments?.filter((item) => item.kind === 'image').length ?? 0
    let stage: NonNullable<PiTurnDiagnostic['errorStage']> = 'process_start'
    let requestLogged = false
    try {
      await this.ensureProcess(agentSystemPrompt, publicTurn)
      const rpc = this.requireRpc()
      stage = 'state_read'
      let state = await this.readState()
      const queuedIntoActiveRun = Boolean(state.isStreaming || state.isCompacting)
      if (!queuedIntoActiveRun || !this.runId) {
        this.runId = randomUUID()
        this.seq = 0
        this.terminal = false
        this.lastUsage = undefined
        this.runPhase = 'thinking'
      }

      const selected = requestedSelection
      if (selected.modelId && !queuedIntoActiveRun) {
        if (
          state.model?.id !== selected.modelId ||
          (selected.provider && state.model?.provider !== selected.provider)
        ) {
          if (!selected.provider) {
            throw new Error('Pi model selection must include provider/modelId')
          }
          stage = 'model_selection'
          await rpc.request('set_model', {
            provider: selected.provider,
            modelId: selected.modelId,
          })
          stage = 'state_read'
          state = await this.readState()
        }
      }
      if (reasoningEffort && !queuedIntoActiveRun) {
        stage = 'thinking_selection'
        await rpc.request('set_thinking_level', { level: reasoningEffort })
      }

      const configured = inspectPiTurnConfiguration({ model: state.model, env: this.processEnv })
      this.turnDiagnostic = {
        marker,
        phase: 'request_config',
        ...(sanitizePiDiagnosticDimension(selected.provider)
          ? { requestedProvider: sanitizePiDiagnosticDimension(selected.provider) }
          : {}),
        ...(sanitizePiDiagnosticDimension(selected.modelId)
          ? { requestedModel: sanitizePiDiagnosticDimension(selected.modelId) }
          : {}),
        modelSelectionSource: context?.modelSelectionSource ?? (modelId ? 'request_model' : 'pi_default_model'),
        piObservedRequestConfig: true,
        finalHttpRequestObserved: false,
        ...configured,
        historyMessageCount: Number.isSafeInteger(state.messageCount) ? state.messageCount! : null,
        attachmentCount,
        imageAttachmentCount,
        toolCallCount: 0,
        queuedIntoActiveRun,
      }
      console.info(formatPiDiagnostic(this.turnDiagnostic))
      requestLogged = true

      const command = queuedIntoActiveRun
        ? context?.source === 'room_activation'
          ? 'follow_up'
          : 'steer'
        : 'prompt'
      const fields: Record<string, unknown> = {
        message: buildPromptText(
          text,
          attachments,
          this.workDir,
          this.externalChannel,
          this.shennianSessionId,
          // The private system-prompt file already carries this value. Only the
          // channel preamble belongs in the user message.
          null,
        ),
      }
      const images = imageInputs(attachments, !this.managedAgentPolicy)
      if (images.length) fields.images = images
      stage = 'prompt_dispatch'
      await rpc.request(command, fields)
    } catch (error) {
      const failure = classifyPiFailure(error)
      const base = this.turnDiagnostic ?? {
        marker,
        phase: 'request_config' as const,
        ...(sanitizePiDiagnosticDimension(requestedSelection.provider)
          ? { requestedProvider: sanitizePiDiagnosticDimension(requestedSelection.provider) }
          : {}),
        ...(sanitizePiDiagnosticDimension(requestedSelection.modelId)
          ? { requestedModel: sanitizePiDiagnosticDimension(requestedSelection.modelId) }
          : {}),
        modelSelectionSource: context?.modelSelectionSource ?? (modelId ? 'request_model' : 'pi_default_model'),
        piObservedRequestConfig: false,
        finalHttpRequestObserved: false as const,
        providerConfigSource: 'unknown' as const,
        credentialSource: 'unknown' as const,
        credentialPresent: 'unknown' as const,
        agentDirSource: this.processEnv.PI_CODING_AGENT_DIR ? 'pi_agent_dir_environment' as const : 'user_home_default' as const,
        historyMessageCount: null,
        attachmentCount,
        imageAttachmentCount,
        toolCallCount: 0,
        queuedIntoActiveRun: false,
      }
      if (!requestLogged) console.info(formatPiDiagnostic(base))
      console.warn(formatPiDiagnostic({
        ...base,
        phase: 'outcome',
        outcome: 'failed',
        errorStage: stage,
        errorCode: failure.errorCode,
        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
      }))
      this.turnDiagnostic = null
      throw new Error(
        `Pi ${stage} failed${failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : ''}: ${failure.safeDetail ?? failure.errorCode}`,
      )
    }
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.stopProcess()
    this.agentSessionId = agentSessionId
  }

  async stop(): Promise<void> {
    const rpc = this.rpc
    if (rpc) {
      await rpc.request('clear_queue').catch(() => {})
      await rpc.request('abort').catch(() => {})
    }
    if (!this.terminal && this.runId) {
      this.logDiagnosticOutcome('aborted')
      this.emitTerminal({ state: 'aborted' })
    }
    await this.stopProcess()
  }

  async getStatus(): Promise<{
    active: boolean
    runId?: string | null
    runPhase?: 'thinking' | 'tool_running' | 'streaming_text' | 'waiting_approval' | 'waiting_user_input' | null
    canStop?: boolean
  }> {
    if (!this.rpc || !this.process) return { active: false, runId: null, canStop: false }
    const state = await this.readState().catch(() => null)
    const active = Boolean(state?.isStreaming || state?.isCompacting || this.active)
    return {
      active,
      runId: active ? this.runId : null,
      runPhase: active ? this.runPhase ?? 'thinking' : null,
      canStop: active,
    }
  }

  async setTitle(_agentSessionId: string, title: string): Promise<void> {
    if (!this.rpc) return
    await this.rpc.request('set_session_name', { name: title.slice(0, 200) })
  }

  private async ensureProcess(agentSystemPrompt?: string | null, publicTurn = false): Promise<void> {
    if (this.process && this.rpc) {
      if (this.spawnedPublicTurn === publicTurn && !(await this.roomContextStale())) return
      await this.stopProcess()
    }
    const spec = resolveBuiltinCommand('pi-coding-agent')
    if (!spec) {
      throw new Error(
        'Command "pi" not found. Install @earendil-works/pi-coding-agent from the official package.',
      )
    }
    const args = ['--mode', 'rpc', '--session-dir', this.sessionDir, '--offline']
    if (this.agentSessionId) args.push('--session', this.agentSessionId)
    if (this.managedAgentPolicy && !isManagedAgentNativeFull(this.managedAgentPolicy)) {
      args.push('--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files')
      if (publicTurn) {
        // A visitor message is untrusted input. The host returns the model text;
        // no Room extension, local file tool, or project approval is needed.
        args.push('--no-tools', '--no-approve')
      } else {
        const tools = this.managedTools()
        const extensionPath = writePiManagedExtension({
          outputPath: path.join(
            resolveShennianPath('runtime', 'pi-coding-agent', safePart(this.shennianSessionId)),
            'managed-extension.ts',
          ),
          policy: this.managedAgentPolicy,
          allowRoomControl: Boolean(this.extraEnv.SHENNIAN_MANAGED_ROOM_CONTEXT),
          allowManagerControl: Boolean(this.extraEnv.SHENNIAN_MANAGER_SESSION_ID),
          allowHostShell: this.managedAgentPolicy.adapterPolicy.fileAccess === 'host-full',
        })
        args.push('--no-builtin-tools', '--extension', extensionPath)
        if (tools.length) args.push('--tools', tools.join(','))
        else args.push('--no-tools')
      }
    }
    const platformInstructions = buildPlatformInstructions(
      this.workDir,
      this.externalChannel,
      this.shennianSessionId,
      agentSystemPrompt,
    )
    const promptRoot = this.validationRoot ?? resolveShennianPath(
      'runtime',
      'pi-coding-agent',
      safePart(this.shennianSessionId),
    )
    fs.mkdirSync(promptRoot, { recursive: true, mode: 0o700 })
    this.promptFile = path.join(promptRoot, 'instructions.md')
    fs.writeFileSync(this.promptFile, platformInstructions, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') fs.chmodSync(this.promptFile, 0o600)
    args.push('--append-system-prompt', this.promptFile)

    const runtimeEnv = { NO_COLOR: '1' }
    const env = this.managedAgentPolicy && !isManagedAgentNativeFull(this.managedAgentPolicy)
      ? buildManagedAgentProcessEnv({
          agentType: this.type,
          providerEnv: this.extraEnv,
          sessionEnv: this.extraEnv,
          runtimeEnv,
        })
      : this.managedAgentPolicy
        ? buildManagedNativeFullProcessEnv({ ...runtimeEnv, ...this.extraEnv })
        : buildAgentProcessEnv({ ...runtimeEnv, ...this.extraEnv })
    this.processEnv = env
    const proc: ChildProcess = spawnAgentCommand(spec, args, {
      cwd: this.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    this.process = proc
    this.spawnedPublicTurn = publicTurn
    this.spawnedRoomContext = this.currentRoomContext()
    this.stderr = ''
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const next = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      this.stderr = truncateText(`${this.stderr}${next}`, MAX_STDERR_BYTES)
    })
    const rpc = new PiRpcClient(proc)
    this.rpc = rpc
    rpc.on('event', (event) => this.handleRpcEvent(event))
    rpc.on('protocolError', (error) => this.emitError(error.message))
    proc.once('close', (code) => {
      if (this.process !== proc) return
      this.process = null
      this.rpc = null
      if (!this.terminal) {
        this.emitError(
          code === 0
            ? 'Pi RPC process closed before agent_settled'
            : `Pi RPC process exited with code ${code ?? 'unknown'}${this.stderr ? `: ${this.stderr}` : ''}`,
        )
      }
    })
    proc.once('error', (error) => {
      if (this.process !== proc) return
      this.emitError(error.message)
    })

    try {
      const state = await this.readState()
      if (!state.sessionId) throw new Error('Pi RPC did not return a session ID')
      if (state.isStreaming || state.isCompacting) {
        throw new Error('Pi RPC session is not idle after startup')
      }
      if (this.agentSessionId && state.sessionId !== this.agentSessionId) {
        throw new Error('Pi RPC resumed a different session')
      }
      if (!state.sessionFile || !this.ownsSessionFile(state.sessionFile)) {
        throw new Error('Pi RPC returned a session file outside the Shennian-owned directory')
      }
      const isNewSession = this.agentSessionId !== state.sessionId
      this.agentSessionId = state.sessionId
      if (isNewSession) this.emit('nativeSession', 'pi-coding-agent', state.sessionId)
      if (this.persistNativeSession) recordPiSessionOwnership(state.sessionId, this.sessionDir)
    } catch (error) {
      await this.stopProcess()
      throw error
    }
  }

  private currentRoomContext(): string | null {
    return this.extraEnv.SHENNIAN_MANAGED_ROOM_CONTEXT ?? null
  }

  /**
   * Every Room turn replaces and revokes the previous grant, but the resident
   * process only holds the one it was spawned with. Respawn (the session file
   * resumes) once the run is idle; a live run keeps its process and queues.
   */
  private async roomContextStale(): Promise<boolean> {
    if (this.currentRoomContext() === this.spawnedRoomContext) return false
    const state = await this.readState().catch(() => null)
    return !state?.isStreaming && !state?.isCompacting
  }

  private managedTools(): string[] {
    const policy = this.managedAgentPolicy?.adapterPolicy
    if (!policy) return []
    const tools = ['read', 'grep', 'find', 'ls']
    if (policy.fileAccess === 'workspace-write' || policy.fileAccess === 'host-full') {
      tools.push('edit', 'write')
    }
    const manager = Boolean(this.extraEnv.SHENNIAN_MANAGER_SESSION_ID)
    const room = Boolean(this.extraEnv.SHENNIAN_MANAGED_ROOM_CONTEXT)
    if (manager || room || policy.fileAccess === 'host-full') tools.push('bash')
    return tools
  }

  private ownsSessionFile(sessionFile: string): boolean {
    const ownedRoot = path.resolve(this.sessionDir)
    const candidate = path.resolve(sessionFile)
    const relative = path.relative(ownedRoot, candidate)
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  }

  private async readState(): Promise<PiState> {
    const response = await this.requireRpc().request('get_state')
    return extractData(response) as PiState
  }

  private requireRpc(): PiRpcClient {
    if (!this.rpc) throw new Error('Pi RPC process is not running')
    return this.rpc
  }

  private handleRpcEvent(event: PiRpcRecord): void {
    if (event.type === 'agent_start') {
      this.active = true
      this.runPhase = 'thinking'
      this.emitEvent({ state: 'start', agentSessionId: this.agentSessionId ?? undefined })
      return
    }
    if (event.type === 'message_update') {
      this.lastUsage = usageFrom(event.usage) ?? this.lastUsage
      const delta = event.assistantMessageEvent
      if (!delta || typeof delta !== 'object') return
      const update = delta as Record<string, unknown>
      if (update.type === 'text_delta' && typeof update.delta === 'string') {
        this.runPhase = 'streaming_text'
        this.emitEvent({ state: 'delta', text: update.delta })
      } else if (update.type === 'thinking_delta' && typeof update.delta === 'string') {
        this.runPhase = 'thinking'
        this.emitEvent({ state: 'delta', text: update.delta, thinking: true })
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      if (this.turnDiagnostic) this.turnDiagnostic.toolCallCount += 1
      this.runPhase = 'tool_running'
      this.emitEvent({
        state: 'tool-call',
        name: typeof event.toolName === 'string' ? event.toolName : 'tool',
        args:
          event.args && typeof event.args === 'object' && !Array.isArray(event.args)
            ? (event.args as Record<string, unknown>)
            : {},
      })
      return
    }
    if (event.type === 'tool_execution_end') {
      this.runPhase = 'thinking'
      this.emitEvent({
        state: 'tool-result',
        name: typeof event.toolName === 'string' ? event.toolName : 'tool',
        result: extractText(event.result) || stringifySafe(event.result),
      })
      return
    }
    if (event.type === 'tool_execution_update') {
      this.emitEvent({
        state: 'notify',
        runPhase: 'tool_running',
        message: 'Pi tool is running',
      })
      return
    }
    if (event.type === 'message_end') {
      const message = event.message
      if (message && typeof message === 'object') {
        const record = message as Record<string, unknown>
        this.lastUsage = usageFrom(record.usage) ?? this.lastUsage
        if (record.stopReason === 'error') {
          const failure = classifyPiFailure(record.errorMessage)
          this.logDiagnosticOutcome('failed', {
            errorStage: 'pi_model_turn',
            errorCode: failure.errorCode,
            ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
          })
          this.emitError(piModelError(record.errorMessage))
        }
      }
      return
    }
    if (event.type === 'compaction_start') {
      this.runPhase = 'thinking'
      this.emitEvent({ state: 'notify', runPhase: 'thinking', message: 'Pi is compacting context' })
      return
    }
    if (event.type === 'auto_retry_start' || event.type === 'summarization_retry_scheduled') {
      this.runPhase = 'thinking'
      this.emitEvent({ state: 'notify', runPhase: 'thinking', message: 'Pi is retrying' })
      return
    }
    if (event.type === 'extension_ui_request') {
      if (typeof event.id === 'string') {
        this.rpc?.notify('extension_ui_response', { id: event.id, cancelled: true })
      }
      return
    }
    if (event.type === 'extension_error') {
      this.logDiagnosticOutcome('failed', { errorStage: 'pi_process', errorCode: 'extension_error' })
      this.emitError(typeof event.error === 'string' ? event.error : 'Pi extension failed')
      return
    }
    if (event.type === 'agent_settled') {
      this.active = false
      this.logDiagnosticOutcome('completed')
      this.emitTerminal({
        state: 'final',
        agentSessionId: this.agentSessionId ?? undefined,
        usage: this.lastUsage,
      })
    }
  }

  private emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (!this.runId) return
    this.emit('agentEvent', { ...partial, runId: this.runId, seq: this.seq++ })
  }

  private emitTerminal(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    if (this.terminal) return
    this.terminal = true
    this.active = false
    this.runPhase = null
    this.emitEvent(partial)
  }

  private logDiagnosticOutcome(
    outcome: 'completed' | 'failed' | 'aborted',
    error: Pick<PiTurnDiagnostic, 'errorStage' | 'errorCode' | 'httpStatus'> = {},
  ): void {
    if (!this.turnDiagnostic) return
    console.info(formatPiDiagnostic({
      ...this.turnDiagnostic,
      phase: 'outcome',
      outcome,
      ...error,
    }))
    this.turnDiagnostic = null
  }

  private emitError(message: string): void {
    if (this.turnDiagnostic) {
      const failure = classifyPiFailure(message)
      this.logDiagnosticOutcome('failed', {
        errorStage: 'pi_process',
        errorCode: failure.errorCode,
        ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
      })
    }
    this.emitTerminal({
      state: 'error',
      message: message.startsWith('Pi model request failed') ? message : piModelError(message),
    })
  }

  private async stopProcess(): Promise<void> {
    const proc = this.process
    this.process = null
    this.rpc?.close()
    this.rpc = null
    if (proc) {
      proc.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        proc.once('close', finish)
        setTimeout(() => {
          proc.kill('SIGKILL')
          finish()
        }, STOP_TIMEOUT_MS).unref()
      })
    }
    if (this.validationRoot) {
      fs.rmSync(this.validationRoot, { recursive: true, force: true })
      this.validationRoot = null
    }
  }
}

registerAgent('pi-coding-agent', () => new PiCodingAgentAdapter())
