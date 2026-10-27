// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-adapter.test.ts

import type { CodexConversationSettings, SessionRunPhase } from '@shennian/wire'
import {
  CODEX_DESKTOP_SEND_UNAVAILABLE,
  type ChatAttachmentMeta,
  type ExternalChannelSessionStatus,
} from '@shennian/wire'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  buildAgentProcessEnv,
  buildManagedAgentProcessEnv,
  buildManagedNativeFullProcessEnv,
} from '../agent-env.js'
import { isCodexThreadTailInterrupted } from '../native-fusion/codex-files.js'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import {
  isManagedAgentNativeFull,
  resolveManagedAgentAdapterEnforcement,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { registerManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'
import {
  registerAgent,
  type AgentActiveInput,
  type AgentSendContext,
  type AgentSendResult,
  type AgentStartOptions,
} from './adapter.js'
import {
  CODEX_MANAGED_RUNTIME_SECURITY,
  assertCodexManagedPermissionProfile,
  compileCodexManagedPermissions,
  extractCodexMcpServerNames,
  type CodexManagedPermissionConfig,
} from './codex-managed-permissions.js'
import {
  CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS,
  CODEX_MANAGED_ROOM_DYNAMIC_TOOLS,
} from './codex-managed-room-tools.js'
import {
  CODEX_APP_SERVER_CLIENT_INFO,
  isCodexUnsupportedEffortError,
  isMissingCodexRolloutError,
  normalizeCodexModelId,
  normalizeCodexReasoningEffort,
  normalizeCodexStderr,
} from './codex-utils.js'
import { resolveBuiltinCommand, spawnAgentCommand, type ResolvedCommandSpec } from './command-spec.js'
import { spawnEnoentError } from './spawn-errors.js'

const CODEX_COMMAND_UNAVAILABLE = 'codex_command_unavailable: 请确认 Codex CLI 路径并刷新 AI 列表。'
import { ensurePlatformInstructionsFile } from './platform-instructions.js'
export {
  buildCodexQueueArgs,
  buildCodexQueuedText,
  isCodexActiveWriterError,
  isCodexExcludeTurnsUnsupportedError,
  isCodexPaginatedHistoryUnsupportedError,
  isCodexProjectApiUnsupportedError,
  selectCodexProjectIdForWorkDir,
} from './codex-protocol.js'
export {
  isCodexUnsupportedEffortError,
  isMissingCodexRolloutError,
  normalizeCodexModelId,
  normalizeCodexReasoningEffort,
} from './codex-utils.js'

import {
  buildCodexQueueArgs,
  buildCodexTextInput,
  isCodexActiveWriterError,
  isCodexExcludeTurnsUnsupportedError,
  isCodexPaginatedHistoryUnsupportedError,
  isCodexProjectApiUnsupportedError,
  selectCodexProjectIdForWorkDir,
  type CodexProject,
  type CodexProjectListResponse,
  type CodexStreamEvent,
  type CodexThreadStatus,
  type JsonRpcMessage,
} from './codex-protocol.js'
import { codexThreadPermissionParams, codexTurnPermissionParams, hasNonDefaultCodexSettings, normalizeCodexConversationSettings } from './codex-conversation-settings.js'
import { CodexRuntime } from './codex-runtime.js'

registerManagedAgentRuntimeSecurity('codex', CODEX_MANAGED_RUNTIME_SECURITY)

export class CodexAdapter extends CodexRuntime {
  override get supportsActiveInput(): boolean { return true }

  async injectActiveInput(input: AgentActiveInput): Promise<void> {
    const threadId = this.agentSessionId
    const turnId = this.activeTurnId
    if (!threadId || !turnId || !this.process) throw new Error('codex_active_turn_unavailable')
    const response = await this.sendRpc('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [buildCodexTextInput(input.text, input.attachments)],
      ...(input.clientMessageId ? { clientUserMessageId: input.clientMessageId } : {}),
    }) as { turnId?: string }
    if (response.turnId && response.turnId !== turnId) throw new Error('codex_active_turn_changed')
  }
  private conversationSettings?: CodexConversationSettings
  private launchCommand: ResolvedCommandSpec | null = null
  private resolveLaunchCommand(): ResolvedCommandSpec {
    if (this.process && this.launchCommand) return this.launchCommand
    const spec = resolveBuiltinCommand('codex')
    if (!spec || (process.platform === 'win32' && spec.kind === 'wsl-bridge')) {
      throw new Error(process.platform === 'win32'
        ? 'codex_windows_runtime_unavailable: 请确认 Windows Codex CLI 路径并刷新 AI 列表；不会自动切换到 WSL，待发送消息保留。'
        : CODEX_COMMAND_UNAVAILABLE)
    }
    this.launchCommand = spec
    return spec
  }
  readonly type = 'codex' as const
  override get recoveryCapabilities() {
    // A replacement daemon cannot attach to the old app-server transport.
    // Exact thread resume is real; terminal inspection/turn reattach are not.
    return { inspectTerminal: false, reattachRun: false, resumeRun: false, resumeSession: true }
  }
  configure(options: {
    sessionId?: string
    codexSettings?: CodexConversationSettings
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
    managedAgentPolicy?: CompiledManagedAgentPolicy | null
    managedRoomContextToken?: string | null
    managedRoomExecutor?: ManagedRoomExecutor | null
  }): void {
    const previousFingerprint = this.configurationFingerprint()
    this.shennianSessionId = options.sessionId ?? null
    this.externalChannel = options.externalChannel ?? null
    this.extraEnv = options.env ?? {}
    if ('managedAgentPolicy' in options) {
      this.managedAgentPolicy = options.managedAgentPolicy ?? null
    }
    if ('managedRoomContextToken' in options || 'managedRoomExecutor' in options) {
      // Reconfiguration invalidates the previous turn immediately. The new
      // token is activated only after any required pre-turn process restart.
      this.managedRoomTools.deactivateTurn()
      this.configuredManagedRoomContextToken = options.managedRoomContextToken?.trim() || null
      this.configuredManagedRoomExecutor = options.managedRoomExecutor ?? null
    }
    this.conversationSettings = !this.managedAgentPolicy && options.codexSettings
      ? normalizeCodexConversationSettings(options.codexSettings) : undefined
    if (this.managedAgentPolicy) this.workDir = this.managedAgentPolicy.adapterPolicy.workDir
    const nextFingerprint = this.configurationFingerprint()
    if (previousFingerprint !== nextFingerprint && this.process) {
      this.configurationRestartRequired = true
    }
  }

  private configurationFingerprint(): string {
    const sortedEnv = Object.keys(this.extraEnv)
      .sort()
      .map((key) => [key, this.extraEnv[key] ?? null])
    return createHash('sha256')
      .update(
        JSON.stringify({
          sessionId: this.shennianSessionId,
          externalChannel: this.externalChannel,
          env: sortedEnv,
          managedAgentPolicy: this.managedAgentPolicy,
          conversationSettings: this.conversationSettings,
        }),
      )
      .digest('hex')
  }

  private buildProcessEnv(runtimeEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    if (!this.managedAgentPolicy) {
      return buildAgentProcessEnv({ ...runtimeEnv, ...this.extraEnv,
        ...(this.conversationSettings?.codexHome ? { CODEX_HOME: this.conversationSettings.codexHome } : {}),
      })
    }
    if (isManagedAgentNativeFull(this.managedAgentPolicy)) {
      return buildManagedNativeFullProcessEnv({ ...runtimeEnv, ...this.extraEnv })
    }
    const providerEnv = Object.fromEntries(
      Object.entries(this.extraEnv).filter(
        ([key]) =>
          key !== 'SHENNIAN_MANAGED_ROOM_CONTEXT' &&
          key !== 'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
      ),
    )
    return buildManagedAgentProcessEnv({
      agentType: 'codex',
      providerEnv,
      sessionEnv: providerEnv,
      runtimeEnv,
    })
  }

  async start(
    sessionId: string,
    workDir: string,
    agentSessionId?: string | null,
    options?: AgentStartOptions,
  ): Promise<void> {
    this.shennianSessionId = sessionId
    this.workDir = this.managedAgentPolicy?.adapterPolicy.workDir ?? workDir
    this.seq = 0
    this.persistNativeSession = options?.persistNativeSession !== false
    this.nativeSessionVisibility = options?.nativeSessionVisibility ?? 'user'
    if (agentSessionId) this.agentSessionId = agentSessionId
    this.notifyNativeSession()
  }

  async prepareSend(
    _text: string,
    modelId?: string,
    _reasoningEffort?: string,
    _attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    // Room dispatch prepares Codex before the durable queue is acknowledged.
    // Apply the prompt before spawning app-server; otherwise send() observes a
    // prompt change, restarts the just-created empty thread, and thread/resume
    // fails because that thread does not have its first rollout yet.
    const nextSystemPrompt = agentSystemPrompt?.trim() ?? ''
    if (nextSystemPrompt !== this.agentSystemPrompt) {
      this.agentSystemPrompt = nextSystemPrompt
      if (this.process) await this.killProcess(true)
    }
    if (this.activeTurnId) return
    this.preparedExternalOwnerThreadId = null
    try {
      await this.ensureAppServer(normalizeCodexModelId(modelId))
    } catch (error) {
      if (!isCodexActiveWriterError(error) || !this.agentSessionId) throw error
      if (context?.source === 'room_activation' || context?.source === 'managed_private'
        || context?.source === 'published_agent') {
        throw new Error('codex_managed_thread_owned_externally', { cause: error })
      }
      if (hasNonDefaultCodexSettings(this.conversationSettings)) throw new Error('codex_settings_external_owner_unsupported')
      if (this.isThreadTailInterrupted(this.agentSessionId)) {
        throw new Error(CODEX_DESKTOP_SEND_UNAVAILABLE, { cause: error })
      }
      this.preparedExternalOwnerThreadId = this.agentSessionId
    }
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    agentSystemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void | AgentSendResult> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    if ((context?.source === 'room_activation' || context?.source === 'managed_private') && !this.managedAgentPolicy) {
      throw new Error('managed_agent_policy_missing')
    }
    if (
      (context?.source === 'room_activation' || context?.source === 'managed_private') &&
      (!this.configuredManagedRoomContextToken || !this.configuredManagedRoomExecutor)
    ) {
      throw new Error('codex_managed_room_tool_context_unavailable')
    }
    const expectsManagedRoomCapability =
      context?.source === 'room_activation' || context?.source === 'managed_private'
    // Revoke the previous turn before awaiting its interrupt. A late event
    // from that turn must not bind against authority prepared for this send.
    this.managedRoomCapabilityExpectedForTurn = false
    if (this.activeTurnId) {
      await this.interruptActiveTurn().catch(() => {})
      await this.killProcess(true)
    }
    if (this.configurationRestartRequired && this.process) await this.killProcess(true)
    this.configurationRestartRequired = false
    const codexModelId = normalizeCodexModelId(modelId)
    const codexReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort)
    const nextSystemPrompt = agentSystemPrompt?.trim() ?? ''
    if (nextSystemPrompt !== this.agentSystemPrompt) {
      this.agentSystemPrompt = nextSystemPrompt
      if (this.process) await this.killProcess(true)
    }
    if (context?.source === 'room_activation' || context?.source === 'managed_private') {
      this.managedRoomTools.configure(
        this.configuredManagedRoomContextToken,
        this.configuredManagedRoomExecutor,
      )
    }
    this.runId = randomUUID()
    this.seq = 0
    this.resetRunState()

    if (this.agentSessionId && this.preparedExternalOwnerThreadId === this.agentSessionId) {
      this.preparedExternalOwnerThreadId = null
      const queuedSubmissionId = await this.enqueueForExternalOwner(
        this.agentSessionId,
        text,
        attachments,
      )
      return { deliveryMode: 'external_owner_queue', queuedSubmissionId }
    }

    // App-server can emit turn/started before turn/start resolves. Record the
    // trusted dispatch source before starting/resuming the native thread so
    // event-time binding never infers Room authority from the thread's
    // persisted dynamic-tool surface alone.
    this.managedRoomCapabilityExpectedForTurn = expectsManagedRoomCapability

    try {
      await this.ensureAppServer(codexModelId)
    } catch (error) {
      if (!this.agentSessionId || !isCodexActiveWriterError(error)) throw error
      if (context?.source === 'room_activation' || context?.source === 'managed_private'
        || context?.source === 'published_agent') {
        throw new Error('codex_managed_thread_owned_externally', { cause: error })
      }
      if (hasNonDefaultCodexSettings(this.conversationSettings)) throw new Error('codex_settings_external_owner_unsupported')
      if (this.isThreadTailInterrupted(this.agentSessionId)) {
        throw new Error(CODEX_DESKTOP_SEND_UNAVAILABLE, { cause: error })
      }
      const queuedSubmissionId = await this.enqueueForExternalOwner(
        this.agentSessionId,
        text,
        attachments,
      )
      return { deliveryMode: 'external_owner_queue', queuedSubmissionId }
    }
    const threadId = this.agentSessionId
    if (!threadId) throw new Error('codex app-server did not create a thread')

    this.emitEvent({ state: 'start', agentSessionId: threadId })

    this.managedTurnReplay = this.managedPermissionConfig
      ? {
          text,
          modelId: codexModelId,
          reasoningEffort: codexReasoningEffort,
          attachments,
          recoveryCount: 0,
        }
      : null

    const response = await this.startTurnWithRecovery(
      threadId,
      text,
      codexModelId,
      codexReasoningEffort,
      attachments,
    )

    const activeThreadId = this.agentSessionId ?? threadId
    this.activeTurnId = response.turn?.id ?? null
    if (this.managedRoomTurnBindingFailed) {
      await this.killProcess()
      throw new Error('codex_managed_room_turn_binding_failed')
    }
    if (
      this.managedRoomCapabilityExpectedForTurn &&
      this.managedRoomToolThreadId === activeThreadId &&
      this.activeTurnId &&
      !this.managedRoomTools.bindTurn(activeThreadId, this.activeTurnId)
    ) {
      await this.killProcess()
      throw new Error('codex_managed_room_turn_binding_failed')
    }
    return { deliveryMode: 'direct' }
  }

  private isThreadTailInterrupted(threadId: string): boolean {
    return this.options.isThreadTailInterrupted?.(threadId) ?? isCodexThreadTailInterrupted(threadId)
  }

  private async enqueueForExternalOwner(
    threadId: string,
    text: string,
    attachments?: ChatAttachmentMeta[],
  ): Promise<string | undefined> {
    if (hasNonDefaultCodexSettings(this.conversationSettings)) {
      throw new Error('codex_settings_external_owner_unsupported')
    }
    if (this.options.hidden || this.nativeSessionVisibility === 'internal') {
      // Internal sources are excluded from native import; external queue execution
      // would have no authoritative response/terminal path back to this workflow.
      throw new Error('codex_managed_thread_owned_externally')
    }
    const spec = this.resolveLaunchCommand()

    const args = buildCodexQueueArgs(threadId, text, attachments)

    const proc = spawnAgentCommand(spec, args, {
      cwd: this.workDir ?? undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.buildProcessEnv({ NO_COLOR: '1' }),
    })
    return await new Promise<string | undefined>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (error?: Error, queuedSubmissionId?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(queuedSubmissionId)
      }
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        finish(new Error('Codex Desktop message queue timed out'))
      }, 60_000)
      timer.unref?.()
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.once('error', (error) => finish(error))
      proc.once('close', (code) => {
        const output = `${stdout}\n${stderr}`.trim()
        if (code !== 0) {
          finish(new Error(output || `codex queue exited with code ${code ?? 'unknown'}`))
          return
        }
        const submissionId = output.match(/Queued message\s+([^\s]+)\s+for thread/i)?.[1]
        finish(undefined, submissionId)
      })
    })
  }

  async resume(agentSessionId: string): Promise<void> {
    await this.killProcess()
    this.agentSessionId = agentSessionId
    this.resetTextState()
  }

  async setTitle(agentSessionId: string, title: string, workDir?: string): Promise<void> {
    const threadId = agentSessionId.trim()
    const name = title.replace(/\s+/g, ' ').trim()
    if (!threadId || !name) return

    this.agentSessionId = threadId
    this.notifyNativeSession()
    if (workDir?.trim()) this.workDir = workDir
    await this.ensureAppServer()
    await this.sendRpc('thread/name/set', { threadId, name })
  }

  async stop(): Promise<void> {
    this.managedRoomTools.deactivateTurn()
    await this.interruptActiveTurn().catch(() => {})
    await this.killProcess()
  }

  async getStatus(): Promise<{
    active: boolean
    runId?: string | null
    runPhase?: SessionRunPhase | null
    canStop?: boolean
  }> {
    const threadId = this.agentSessionId
    const activeTurnId = this.activeTurnId
    if (this.terminalState !== 'open' || !threadId || !this.process) {
      return { active: false, runId: activeTurnId, runPhase: null, canStop: false }
    }

    let status: CodexThreadStatus | null = null
    try {
      const response = (await this.sendRpc(
        'thread/read',
        { threadId, includeTurns: false },
        5_000,
      )) as {
        thread?: { status?: CodexThreadStatus }
      }
      status = response.thread?.status ?? null
    } catch {
      // If the local control channel is still alive but the status read fails,
      // fall back to activeTurnId. This keeps the stop button available for
      // the running turn while avoiding false positives for idle sessions.
    }

    // Terminal can arrive while thread/read is in flight. Its stale active
    // result must not resurrect a finished run when the queue wakes up.
    const active = this.terminalState === 'open' && (status?.type === 'active' || Boolean(activeTurnId))
    return {
      active,
      runId: activeTurnId,
      runPhase: active ? this.mapThreadStatusToRunPhase(status) : null,
      canStop: Boolean(active && activeTurnId && this.process),
    }
  }

  private spawnCodex(args: string[]): void {
    const spec = this.resolveLaunchCommand()
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
        const obj = JSON.parse(line) as CodexStreamEvent
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
      this.clearForceCloseTimer()
      this.handleProcessClose(code, stderrBuf)
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', spawnEnoentError(this.workDir, CODEX_COMMAND_UNAVAILABLE))
      } else {
        this.emit('error', err)
      }
    })
  }

  private spawnAppServer(): void {
    const spec = this.resolveLaunchCommand()
    const args = ['app-server', '--listen', 'stdio://']
    const modelInstructionsFile =
      this.options.modelInstructionsFile ??
      ensurePlatformInstructionsFile(
        this.workDir ?? process.cwd(),
        this.externalChannel,
        this.shennianSessionId ?? undefined,
        this.agentSystemPrompt,
      )
    if (modelInstructionsFile) {
      args.push('-c', `model_instructions_file=${JSON.stringify(modelInstructionsFile)}`)
    }
    const proc = spawnAgentCommand(spec, args, {
      cwd: this.workDir ?? undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildProcessEnv({ NO_COLOR: '1' }),
    })
    this.process = proc
    this.stderrBuf = ''
    this.appServerStartupError = null

    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line) as JsonRpcMessage
      } catch {
        this.handleAppServerNonJsonStdout(line)
        return
      }
      this.handleAppServerMessage(msg)
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuf += chunk.toString()
    })

    proc.on('close', (code) => {
      if (this.process !== proc) return
      const hadActiveTurn = this.activeTurnId != null
      this.process = null
      this.appServerReady = null
      this.activeTurnId = null
      this.managedRoomTools.reset()
      this.clearConfiguredManagedRoomContext()
      this.rejectAllPending(
        new Error(
          normalizeCodexStderr(this.stderrBuf) || `codex app-server exited with code ${code}`,
        ),
      )
      if (this.terminalState === 'open' && hadActiveTurn) {
        this.handleProcessClose(code, this.stderrBuf)
      }
    })

    proc.on('error', (err) => {
      if (this.process !== proc) return
      this.process = null
      this.managedRoomTools.reset()
      this.clearConfiguredManagedRoomContext()
      this.rejectAllPending(err)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.emit('error', spawnEnoentError(this.workDir, CODEX_COMMAND_UNAVAILABLE))
      } else {
        this.emit('error', err)
      }
    })
  }

  protected async ensureAppServer(modelId?: string): Promise<void> {
    if (this.appServerReady) return this.appServerReady
    this.spawnAppServer()
    this.appServerReady = this.initializeAppServer(modelId).catch(async (error) => {
      this.appServerReady = null
      await this.killProcess()
      throw error
    })
    return this.appServerReady
  }

  private async initializeAppServer(modelId?: string): Promise<void> {
    const codexModelId = normalizeCodexModelId(modelId)
    await this.sendRpc('initialize', {
      clientInfo: CODEX_APP_SERVER_CLIENT_INFO,
      capabilities: { experimentalApi: true },
    })

    this.managedPermissionConfig =
      this.managedAgentPolicy && !isManagedAgentNativeFull(this.managedAgentPolicy)
      ? await this.buildManagedPermissionConfig()
      : null

    // A Manager Worker inherits the managed Agent's immutable permission
    // snapshot, but it is a private child session rather than a Room member.
    // Only adapters configured with a Room turn capability get the dynamic
    // Room tool surface; managed permissions alone must not imply Room access.
    const managedRoomToolSurface = Boolean(
      this.configuredManagedRoomContextToken || this.configuredManagedRoomExecutor,
    )
    const managedDynamicTools = this.extraEnv.SHENNIAN_MANAGER_SESSION_ID
      ? CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS
      : CODEX_MANAGED_ROOM_DYNAMIC_TOOLS
    const managedRoomToolSurfaceKey = managedRoomToolSurface
      ? managedDynamicTools.flatMap(namespace => namespace.tools.map(tool => `${namespace.name}.${tool.name}`)).join('\n')
      : null

    if (this.managedAgentPolicy && managedRoomToolSurface) {
      if (!this.managedRoomTools.isConfigured()) {
        this.managedRoomTools.configure(
          this.configuredManagedRoomContextToken,
          this.configuredManagedRoomExecutor,
        )
      }
      if (!this.managedRoomTools.isConfigured()) {
        throw new Error('codex_managed_room_tool_context_unavailable')
      }
      await this.managedRoomTools.assertReady(
        this.extraEnv.SHENNIAN_MANAGER_SESSION_ID ? 'manager.sessions.list' : 'status',
      )
    }

    // Dynamic tools are persisted only when a thread is created. A legacy
    // managed Codex thread therefore cannot be resumed safely: start a fresh
    // native thread with the host tool surface instead of silently losing Room
    // access or falling back to the CLI/socket transport.
    if (
      this.agentSessionId &&
      this.managedAgentPolicy &&
      managedRoomToolSurface &&
      (
        this.agentSessionId !== this.managedRoomToolThreadId ||
        this.managedRoomToolSurfaceKey !== managedRoomToolSurfaceKey
      )
    ) {
      if (!this.managedRoomTools.isConfigured()) {
        throw new Error('codex_managed_room_tool_context_unavailable')
      }
      this.agentSessionId = null
      this.managedRoomToolThreadId = null
      this.managedRoomToolSurfaceKey = null
    }

    if (this.agentSessionId) {
      const resumeParams = {
        threadId: this.agentSessionId,
        cwd: this.workDir,
        ...(this.managedPermissionConfig
          ? { approvalPolicy: 'never', config: this.managedPermissionConfig.threadConfig }
          : codexThreadPermissionParams(this.conversationSettings)),
        persistExtendedHistory: true,
        ...(codexModelId ? { model: codexModelId } : {}),
      }
      let response: { thread?: { id?: string; name?: string | null } }
      try {
        response = (await this.sendRpc('thread/resume', {
          ...resumeParams,
          excludeTurns: true,
        })) as typeof response
      } catch (error) {
        if (!isCodexExcludeTurnsUnsupportedError(error)) throw error
        response = (await this.sendRpc('thread/resume', resumeParams)) as typeof response
      }
      this.agentSessionId = response.thread?.id ?? this.agentSessionId
      this.notifyNativeSession()
      if (this.managedPermissionConfig) {
        assertCodexManagedPermissionProfile(response, this.managedPermissionConfig.profileId)
      }
      if (this.managedAgentPolicy && managedRoomToolSurface) {
        this.managedRoomTools.bindThread(this.agentSessionId)
        this.managedRoomToolThreadId = this.agentSessionId
        this.managedRoomToolSurfaceKey = managedRoomToolSurfaceKey
      }
      return
    }

    const hidden =
      this.options.hidden ||
      this.nativeSessionVisibility === 'internal' ||
      !this.persistNativeSession
    const projectId = hidden ? undefined : await this.resolveCodexProjectId()

    const startParams = {
      cwd: this.workDir,
      ...(this.managedPermissionConfig
        ? { approvalPolicy: 'never', config: this.managedPermissionConfig.threadConfig }
        : codexThreadPermissionParams(this.conversationSettings)),
      serviceName: 'Shennian',
      threadSource: hidden ? 'shennian_internal' : 'user',
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      ...(this.managedAgentPolicy && managedRoomToolSurface
        ? { dynamicTools: managedDynamicTools }
        : {}),
      ...(projectId ? { projectId } : {}),
      ...(codexModelId ? { model: codexModelId } : {}),
    }
    let response: { thread?: { id?: string; name?: string | null } }
    if (hidden && !this.managedPermissionConfig) {
      response = (await this.sendRpc('thread/start', startParams)) as typeof response
    } else {
      try {
        response = (await this.sendRpc('thread/start', {
          ...startParams,
          historyMode: 'paginated',
        })) as typeof response
      } catch (error) {
        if (!isCodexPaginatedHistoryUnsupportedError(error)) throw error
        throw new Error(
          'codex_session_capability_unavailable: 当前 Codex CLI 不支持创建可在 Codex Desktop 中继续的新会话，请手动升级 Codex CLI 后重试。神念不会自动升级，也不会降级创建不可见的 legacy 会话。',
          { cause: error },
        )
      }
    }
    const threadId = response.thread?.id
    if (!threadId) throw new Error('codex app-server thread/start returned no thread id')
    if (this.managedPermissionConfig) {
      assertCodexManagedPermissionProfile(response, this.managedPermissionConfig.profileId)
    }
    if (this.managedAgentPolicy && managedRoomToolSurface) {
      this.managedRoomTools.bindThread(threadId)
      this.managedRoomToolThreadId = threadId
      this.managedRoomToolSurfaceKey = managedRoomToolSurfaceKey
    }
    this.agentSessionId = threadId
    this.notifyNativeSession()
  }

  private notifyNativeSession(): void {
    if (this.agentSessionId) this.emit('nativeSession', 'codex', this.agentSessionId)
  }

  private async buildManagedPermissionConfig(): Promise<CodexManagedPermissionConfig> {
    const compiled = this.managedAgentPolicy
    if (!compiled) throw new Error('managed_agent_policy_missing')
    const hasRoomTools = Boolean(this.configuredManagedRoomContextToken || this.configuredManagedRoomExecutor)
    if (hasRoomTools && !this.shennianSessionId) throw new Error('codex_managed_room_session_missing')
    const mcpServers = compiled.adapterPolicy.externalCapabilities.mcp
      ? []
      : extractCodexMcpServerNames(
          await this.sendRpc('config/read', { cwd: compiled.adapterPolicy.workDir }),
        )
    return compileCodexManagedPermissions(
      resolveManagedAgentAdapterEnforcement(compiled),
      compiled.adapterPolicy.workDir,
      {
        configuredMcpServerNames: mcpServers,
        shellSubprocessPolicy: compiled.environmentPolicy.shellSubprocess,
        // The same native thread may receive a Room turn after a private turn.
        // Pre-grant only its own empty Session directory so later attachments
        // remain readable without broadening access to other Sessions.
        ...(this.shennianSessionId ? { roomAttachmentSessionId: this.shennianSessionId } : {}),
      },
    )
  }

  private async resolveCodexProjectId(): Promise<string | undefined> {
    const workDir = this.workDir?.trim()
    if (!workDir) return undefined

    try {
      const projects: CodexProject[] = []
      let cursor: string | null | undefined
      do {
        const response = (await this.sendRpc('project/list', {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })) as CodexProjectListResponse
        projects.push(...(response.data ?? []))
        cursor = response.nextCursor
      } while (cursor)

      const existingProjectId = selectCodexProjectIdForWorkDir(projects, workDir)
      if (existingProjectId) return existingProjectId

      const normalizedWorkDir = path.resolve(workDir)
      const idempotencyKey = `shennian-project-${createHash('sha256')
        .update(normalizedWorkDir)
        .digest('hex')}`
      const response = (await this.sendRpc('project/create', {
        idempotencyKey,
        name: path.basename(normalizedWorkDir) || normalizedWorkDir,
        roots: [{ path: normalizedWorkDir }],
        metadata: { createdBy: 'Shennian' },
      })) as { project?: CodexProject }
      const projectId = response.project?.id
      if (!projectId) throw new Error('codex app-server project/create returned no project id')
      return projectId
    } catch (error) {
      if (!isCodexProjectApiUnsupportedError(error)) throw error
      throw new Error(
        'codex_session_capability_unavailable: 当前 Codex CLI 不支持创建可归属到 Codex Desktop 项目的新会话，请手动升级 Codex CLI 后重试。神念不会自动升级，也不会直接修改 Codex Desktop 的私有侧栏索引。',
        { cause: error },
      )
    }
  }

  private async startTurnWithRecovery(
    threadId: string,
    text: string,
    codexModelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
  ): Promise<{ turn?: { id?: string } }> {
    try {
      return await this.startTurn(threadId, text, codexModelId, reasoningEffort, attachments)
    } catch (error) {
      if (!isMissingCodexRolloutError(error)) throw error
      if (this.managedAgentPolicy || this.managedPermissionConfig) {
        this.logManagedThreadLifecycle('rollout.missing', {
          threadId,
          recovery: 'recreate',
        })
        // A binding may outlive its Codex history (for example after a local
        // cleanup or migration). Recreate the managed thread and replay the
        // same real message once; never manufacture a placeholder turn merely
        // to materialize a rollout.
        await this.killProcess(true)
        this.agentSessionId = null
        this.managedRoomToolThreadId = null
        this.managedRoomToolSurfaceKey = null
        await this.ensureAppServer(codexModelId)
        const replacementThreadId = this.agentSessionId
        if (!replacementThreadId) {
          throw new Error('codex app-server did not recreate the managed thread', {
            cause: error,
          })
        }
        this.logManagedThreadLifecycle('thread.recreated', {
          previousThreadId: threadId,
          threadId: replacementThreadId,
        })
        this.emitEvent({ state: 'start', agentSessionId: replacementThreadId })
        return await this.startFreshManagedTurnWithReadinessRetry(
          replacementThreadId,
          text,
          codexModelId,
          reasoningEffort,
          attachments,
        )
      }

      await this.killProcess()
      await this.ensureAppServer(codexModelId)
      return await this.startTurn(threadId, text, codexModelId, reasoningEffort, attachments)
    }
  }

  protected async startFreshManagedTurnWithReadinessRetry(
    threadId: string,
    text: string,
    codexModelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
  ): Promise<{ turn?: { id?: string } }> {
    const retryDelaysMs = [0, 100, 300, 1_000]
    let lastError: unknown
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      const delayMs = retryDelaysMs[attempt]!
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      try {
        const response = await this.startTurn(
          threadId,
          text,
          codexModelId,
          reasoningEffort,
          attachments,
        )
        if (attempt > 0) {
          this.logManagedThreadLifecycle('rollout.ready', { threadId, attempt: attempt + 1 })
        }
        return response
      } catch (error) {
        lastError = error
        if (!isMissingCodexRolloutError(error) || attempt === retryDelaysMs.length - 1) throw error
        this.logManagedThreadLifecycle('rollout.retry', {
          threadId,
          attempt: attempt + 2,
          delayMs: retryDelaysMs[attempt + 1],
        })
      }
    }
    throw lastError
  }

  protected logManagedThreadLifecycle(event: string, details: Record<string, unknown>): void {
    console.error(`[codex.managed] ${JSON.stringify({ event, ...details })}`)
  }

  private async startTurn(
    threadId: string,
    text: string,
    codexModelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
  ): Promise<{ turn?: { id?: string } }> {
    try {
      return (await this.sendRpc('turn/start', {
        threadId,
        input: [buildCodexTextInput(text, attachments)],
        ...(this.managedPermissionConfig ? { approvalPolicy: 'never' }
          : codexTurnPermissionParams(this.conversationSettings, this.workDir ?? process.cwd())),
        ...(codexModelId ? { model: codexModelId } : {}),
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      })) as { turn?: { id?: string } }
    } catch (error) {
      if (reasoningEffort && isCodexUnsupportedEffortError(error)) {
        throw new Error(
          `Codex app-server does not accept reasoning effort "${reasoningEffort}" for this turn. Refresh models or upgrade Codex CLI, then retry.`,
          { cause: error },
        )
      }
      throw error
    }
  }

  private async interruptActiveTurn(): Promise<void> {
    const threadId = this.agentSessionId
    const turnId = this.activeTurnId
    this.activeTurnId = null
    this.managedRoomTools.deactivateTurn()
    if (!threadId || !turnId || !this.process) return
    await this.sendRpc('turn/interrupt', { threadId, turnId }, 5_000)
  }

}

registerAgent('codex', () => new CodexAdapter())
