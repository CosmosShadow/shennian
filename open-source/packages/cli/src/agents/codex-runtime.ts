// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-adapter.test.ts

import type { ChatAttachmentMeta, ExternalChannelSessionStatus } from '@shennian/wire'
import type { ChildProcess } from 'node:child_process'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import { AgentAdapter, isApprovalLikeName, type AgentEvent } from './adapter.js'
import { CodexApprovals } from './codex-approvals.js'
import { CodexUserInputRequests } from './codex-user-input-requests.js'
import { buildCodexUserQuestion } from './codex-user-question.js'
import type { CodexManagedPermissionConfig } from './codex-managed-permissions.js'
import {
  CodexManagedRoomToolBinding,
  type CodexDynamicToolCallParams,
} from './codex-managed-room-tools.js'
import type {
  CodexItem,
  CodexStreamEvent,
  CodexThreadStatus,
  JsonRpcMessage,
  ManagedTurnReplay,
  PendingRequest,
} from './codex-protocol.js'
import {
  extractAppServerErrorMessage,
  formatCodexErrorMessage,
  formatTransientCodexStatus,
  isCodexCollabAgentItem,
  isCodexCollabAgentToolName,
  isCodexLegacyCollabAgentItem,
  isMissingCodexRolloutError,
  isTransientCodexErrorMessage,
  looksLikeCodexInteractiveAuthPrompt,
  looksLikeFatalCodexStderr,
  normalizeCodexStderr,
  normalizeTerminalText,
  safeStringify,
  stripGitDirectiveArtifacts,
} from './codex-utils.js'

export abstract class CodexRuntime extends AgentAdapter {
  private readonly approvals = new CodexApprovals(
    (id, result) => { this.process?.stdin?.write(`${JSON.stringify({ id, result })}\n`) },
    (event) => this.emitEvent(event),
  )
  async respondToPermission(permissionId: string, optionId: string): Promise<void> {
    if (permissionId.startsWith('input-')) this.userInputs.respond(permissionId, optionId, this.activeTurnId)
    else this.approvals.respond(permissionId, optionId, this.activeTurnId)
  }
  private readonly userInputs = new CodexUserInputRequests(
    (id, result) => { this.process?.stdin?.write(`${JSON.stringify({ id, result })}\n`) },
    event => this.emitEvent(event),
  )

  protected process: ChildProcess | null = null
  protected workDir: string | null = null
  protected seq = 0
  protected runId = ''
  protected pendingUsage: AgentEvent['usage'] | undefined
  protected agentSessionId: string | null = null
  protected hasEmittedText = false
  protected textTail = ''
  protected terminalState: 'open' | 'final' | 'error' = 'open'
  protected forceCloseTimer: NodeJS.Timeout | null = null
  protected stderrBuf = ''
  protected rpcSeq = 1
  protected pendingRequests = new Map<number, PendingRequest>()
  protected appServerReady: Promise<void> | null = null
  protected appServerStartupError: Error | null = null
  protected activeTurnId: string | null = null
  protected deltaItemIds = new Set<string>()
  protected lastTransientStatus = ''
  protected agentSystemPrompt = ''
  protected managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  protected managedPermissionConfig: CodexManagedPermissionConfig | null = null
  protected configurationRestartRequired = false
  protected readonly managedRoomTools = new CodexManagedRoomToolBinding()
  protected configuredManagedRoomContextToken: string | null = null
  protected configuredManagedRoomExecutor: ManagedRoomExecutor | null = null
  protected managedRoomToolThreadId: string | null = null
  protected managedRoomToolSurfaceKey: string | null = null
  protected managedRoomCapabilityExpectedForTurn = false
  protected managedRoomTurnBindingFailed = false
  protected preparedExternalOwnerThreadId: string | null = null
  protected managedTurnReplay: ManagedTurnReplay | null = null
  protected managedAsyncRecovery: Promise<void> | null = null
  protected persistNativeSession = true
  protected nativeSessionVisibility: 'user' | 'internal' = 'user'

  constructor(protected readonly options: {
    modelInstructionsFile?: string
    hidden?: boolean
    isThreadTailInterrupted?: (threadId: string) => boolean
  } = {}) {
    super()
  }

  protected externalChannel: ExternalChannelSessionStatus | null = null
  protected shennianSessionId: string | null = null
  protected extraEnv: NodeJS.ProcessEnv = {}

  protected abstract ensureAppServer(modelId?: string): Promise<void>
  protected abstract logManagedThreadLifecycle(event: string, details: Record<string, unknown>): void
  protected abstract startFreshManagedTurnWithReadinessRetry(threadId: string, text: string,
    modelId?: string, reasoningEffort?: string, attachments?: ChatAttachmentMeta[]): Promise<{ turn?: { id?: string } }>

  protected sendRpc(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (this.appServerStartupError) return Promise.reject(this.appServerStartupError)
    const proc = this.process
    if (!proc?.stdin) return Promise.reject(new Error('codex app-server is not running'))
    const id = this.rpcSeq++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`codex app-server request timed out: ${method}`))
      }, timeoutMs)
      this.pendingRequests.set(id, { resolve, reject, timer })
      proc.stdin!.write(`${payload}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(error)
      })
    })
  }

  protected handleAppServerMessage(msg: JsonRpcMessage): void {
    if (msg.id != null && msg.method && this.approvals.request(msg.method, msg.id, msg.params ?? {},
      this.agentSessionId, this.activeTurnId, Boolean(this.managedAgentPolicy))) return
    if (msg.method === 'serverRequest/resolved') { this.approvals.resolved(msg.params?.requestId); this.userInputs.resolved(msg.params?.requestId) }

    if (msg.method === 'item/tool/requestUserInput' && msg.id != null) {
      this.userInputs.request(msg.id, msg.params ?? {}, this.agentSessionId, this.activeTurnId, Boolean(this.managedAgentPolicy))
      return
    }
    if (msg.method === 'item/tool/call' && msg.id != null) {
      void this.handleManagedRoomToolCall(msg.id, msg.params ?? {})
      return
    }
    if (msg.id != null) {
      const pending = typeof msg.id === 'number' ? this.pendingRequests.get(msg.id) : undefined
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.id as number)
        if (msg.error) {
          pending.reject(
            new Error(msg.error.message || `codex app-server error ${msg.error.code ?? ''}`.trim()),
          )
        } else {
          pending.resolve(msg.result)
        }
      }
    }

    if (!msg.method) return
    const params = msg.params ?? {}
    switch (msg.method) {
      case 'turn/started': {
        const turn =
          typeof params.turn === 'object' && params.turn !== null
            ? (params.turn as Record<string, unknown>)
            : null
        const turnId = typeof turn?.id === 'string' ? turn.id : null
        const threadId = typeof params.threadId === 'string' ? params.threadId : ''
        if (turnId) {
          this.activeTurnId = turnId
          if (
            this.managedRoomCapabilityExpectedForTurn &&
            this.managedRoomToolThreadId === threadId &&
            !this.managedRoomTools.bindTurn(threadId, turnId)
          ) {
            this.managedRoomTurnBindingFailed = true
            this.emitErrorIfOpen('codex_managed_room_turn_binding_failed')
          }
        }
        break
      }
      case 'thread/status/changed': {
        const threadId = typeof params.threadId === 'string' ? params.threadId : ''
        if (threadId && this.agentSessionId && threadId !== this.agentSessionId) break
        const status =
          typeof params.status === 'object' && params.status !== null
            ? (params.status as CodexThreadStatus)
            : null
        if (status?.type === 'active') {
          this.emitEvent({ state: 'heartbeat', runPhase: this.mapThreadStatusToRunPhase(status) })
        }
        break
      }
      case 'item/agentMessage/delta': {
        const itemId = typeof params.itemId === 'string' ? params.itemId : ''
        if (itemId) this.deltaItemIds.add(itemId)
        if (typeof params.delta === 'string') this.emitText(params.delta)
        break
      }
      case 'item/completed':
        this.handleAppServerCompletedItem(params)
        break
      case 'thread/tokenUsage/updated':
        this.handleAppServerUsage(params)
        break
      case 'turn/completed': {
        const turn =
          typeof params.turn === 'object' && params.turn !== null
            ? (params.turn as Record<string, unknown>)
            : null
        const turnId = typeof turn?.id === 'string' ? turn.id : null
        if (!this.activeTurnId || turnId === this.activeTurnId) {
          this.approvals.clear(); this.userInputs.clear()
          this.activeTurnId = null
          this.managedRoomTools.deactivateTurn()
          this.emitFinalIfOpen()
        }
        break
      }
      case 'turn/failed': {
        const message = extractAppServerErrorMessage(params)
        if (this.scheduleManagedAsyncRolloutRecovery(message)) return
        this.emitErrorIfOpen(message || 'turn failed')
        break
      }
      case 'error': {
        const message = extractAppServerErrorMessage(params)
        if (isTransientCodexErrorMessage(message)) {
          this.emitTransientStatus(message)
          return
        }
        if (this.scheduleManagedAsyncRolloutRecovery(message)) return
        this.emitErrorIfOpen(message)
        break
      }
    }
  }

  protected scheduleManagedAsyncRolloutRecovery(message: string): boolean {
    if (
      (!this.managedAgentPolicy && !this.managedPermissionConfig) ||
      !this.managedTurnReplay ||
      !isMissingCodexRolloutError(new Error(message))
    ) {
      return false
    }
    if (this.managedAsyncRecovery) return true
    if (this.managedTurnReplay.recoveryCount >= 2) return false

    this.managedTurnReplay.recoveryCount += 1
    const recoveryCount = this.managedTurnReplay.recoveryCount
    this.logManagedThreadLifecycle('rollout.failed-async', {
      threadId: this.agentSessionId,
      recoveryCount,
    })
    this.managedAsyncRecovery = this.recoverManagedTurnAfterAsyncRolloutFailure()
      .catch((error) => {
        const safeMessage = isMissingCodexRolloutError(error)
          ? 'no rollout found after managed thread recovery'
          : error instanceof Error
            ? error.message
            : 'managed thread recovery failed'
        this.emitErrorIfOpen(safeMessage)
      })
      .finally(() => {
        this.managedAsyncRecovery = null
      })
    return true
  }

  protected async recoverManagedTurnAfterAsyncRolloutFailure(): Promise<void> {
    const replay = this.managedTurnReplay
    const previousThreadId = this.agentSessionId
    if (!replay || !previousThreadId || this.terminalState !== 'open') return

    this.activeTurnId = null
    this.managedRoomTools.deactivateTurn()
    await this.killProcess(true)
    this.agentSessionId = null
    this.managedRoomToolThreadId = null
    this.managedRoomToolSurfaceKey = null
    await this.ensureAppServer(replay.modelId)
    const replacementThreadId = this.agentSessionId
    if (!replacementThreadId) throw new Error('codex app-server did not recreate the managed thread')

    this.logManagedThreadLifecycle('thread.recreated-async', {
      previousThreadId,
      threadId: replacementThreadId,
      recoveryCount: replay.recoveryCount,
    })
    this.emitEvent({ state: 'start', agentSessionId: replacementThreadId })
    const response = await this.startFreshManagedTurnWithReadinessRetry(
      replacementThreadId,
      replay.text,
      replay.modelId,
      replay.reasoningEffort,
      replay.attachments,
    )
    this.activeTurnId = response.turn?.id ?? null
    if (this.managedRoomTurnBindingFailed) {
      throw new Error('codex_managed_room_turn_binding_failed')
    }
    if (
      this.managedRoomCapabilityExpectedForTurn &&
      this.managedRoomToolThreadId === replacementThreadId &&
      this.activeTurnId &&
      !this.managedRoomTools.bindTurn(replacementThreadId, this.activeTurnId)
    ) {
      throw new Error('codex_managed_room_turn_binding_failed')
    }
  }

  protected async handleManagedRoomToolCall(
    id: number | string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.managedRoomTools.execute(params as CodexDynamicToolCallParams)
    this.writeAppServerResponse(id, result)
    if (result.success && params.tool === 'shennian_room_send') {
      const args =
        typeof params.arguments === 'object' && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : null
      const text = typeof args?.text === 'string' ? args.text.trim() : ''
      // The Room tool is the managed Agent's outward reply. Preserve that
      // reply in its own conversation too; otherwise the Agent page contains
      // only a collapsed tool card while the actual answer exists solely in
      // the group timeline.
      if (text) this.emitText(text, 'block')
    }
  }

  protected writeAppServerResponse(id: number | string, result: unknown): void {
    const proc = this.process
    if (!proc?.stdin) return
    proc.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  protected mapThreadStatusToRunPhase(
    status: CodexThreadStatus | null,
  ): 'thinking' | 'waiting_approval' | 'waiting_user_input' {
    const flags =
      status?.type === 'active' && Array.isArray(status.activeFlags) ? status.activeFlags : []
    if (flags.includes('waitingOnApproval')) return 'waiting_approval'
    if (flags.includes('waitingOnUserInput')) return 'waiting_user_input'
    return 'thinking'
  }

  protected handleAppServerNonJsonStdout(line: string): void {
    const normalized = normalizeTerminalText(line)
    if (!looksLikeCodexInteractiveAuthPrompt(normalized)) return
    this.failAppServerStartup(
      new Error(
        'Codex 未登录。请先在这台电脑的终端运行 `codex`，按提示完成 ChatGPT 登录或配置 API key，然后再回到神念发送消息。',
      ),
    )
  }

  protected failAppServerStartup(error: Error): void {
    if (this.appServerStartupError) return
    this.appServerStartupError = error
    this.rejectAllPending(error)
    this.process?.kill('SIGTERM')
  }

  protected handleAppServerCompletedItem(params: Record<string, unknown>): void {
    const item =
      typeof params.item === 'object' && params.item !== null
        ? (params.item as Record<string, unknown>)
        : null
    if (!item || typeof item.type !== 'string') return
    if (isCodexCollabAgentItem(item)) return

    switch (item.type) {
      case 'agentMessage': {
        const id = typeof item.id === 'string' ? item.id : ''
        if (id && this.deltaItemIds.has(id)) return
        if (typeof item.text === 'string') this.emitText(item.text, 'block')
        break
      }
      case 'commandExecution': {
        const command = typeof item.command === 'string' ? item.command : ''
        const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
        if (command) {
          this.emitEvent({ state: 'tool-call', name: 'command_execution', args: { command } })
        }
        this.emitEvent({
          state: 'tool-result',
          name: 'command_execution',
          result: [output, item.exitCode != null ? `\n(exit ${item.exitCode})` : '']
            .join('')
            .trim(),
        })
        break
      }
      case 'mcpToolCall':
      case 'dynamicToolCall': {
        const tool = typeof item.tool === 'string' ? item.tool : item.type
        if (isCodexCollabAgentToolName(tool)) return
        const args =
          typeof item.arguments === 'object' && item.arguments !== null
            ? (item.arguments as Record<string, unknown>)
            : {}
        this.emitEvent({ state: 'tool-call', name: tool, args })
        this.emitEvent({
          state: 'tool-result',
          name: tool,
          result: safeStringify(item.error ?? item.result ?? item.contentItems ?? ''),
        })
        break
      }
      case 'fileChange': {
        // File-change telemetry is useful to the local Codex host, but not to a
        // remote control surface. Drop it before it enters Shennian's event,
        // persistence, and relay pipeline.
        break
      }
      case 'approvalRequest':
      case 'approval_request':
      case 'permissionRequest':
      case 'permission_request':
      case 'userInputRequired':
      case 'user_input_required': {
        this.emitApprovalPending(item)
        break
      }
    }
  }

  protected handleAppServerUsage(params: Record<string, unknown>): void {
    const tokenUsage =
      typeof params.tokenUsage === 'object' && params.tokenUsage !== null
        ? (params.tokenUsage as Record<string, unknown>)
        : null
    const last =
      typeof tokenUsage?.last === 'object' && tokenUsage.last !== null
        ? (tokenUsage.last as Record<string, unknown>)
        : null
    const total =
      typeof tokenUsage?.total === 'object' && tokenUsage.total !== null
        ? (tokenUsage.total as Record<string, unknown>)
        : null
    const usage = last ?? total
    if (!usage) return
    const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined
    const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined
    if (input != null || output != null) {
      this.pendingUsage = {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
      }
    }
  }

  protected handleCodexItemLine(obj: CodexStreamEvent): void {
    const item = obj.item
    if (!item?.type) return
    if (isCodexLegacyCollabAgentItem(item)) return

    switch (item.type) {
      case 'agent_message':
      case 'reasoning': {
        if (obj.type === 'item.completed' && item.text) {
          this.emitText(item.text, 'block')
        }
        break
      }
      case 'command_execution': {
        if (obj.type === 'item.started' && item.command) {
          this.emitEvent({
            state: 'tool-call',
            name: 'command_execution',
            args: { command: item.command },
          })
        }
        if (obj.type === 'item.completed') {
          const parts = [
            item.aggregated_output ?? '',
            item.exit_code != null ? `\n(exit ${item.exit_code})` : '',
          ]
          this.emitEvent({
            state: 'tool-result',
            name: 'command_execution',
            result: parts.join('').trim() || String(item.status ?? ''),
          })
        }
        break
      }
      case 'mcp_tool_call': {
        if (item.tool && isCodexCollabAgentToolName(item.tool)) return
        if (obj.type === 'item.started') {
          this.emitEvent({
            state: 'tool-call',
            name: item.tool ?? 'mcp_tool',
            args: {
              server: item.server,
              ...(item.arguments && typeof item.arguments === 'object' ? item.arguments : {}),
            },
          })
        }
        if (obj.type === 'item.completed') {
          const errMsg =
            item.error && typeof item.error === 'object' ? item.error.message : undefined
          this.emitEvent({
            state: 'tool-result',
            name: item.tool ?? 'mcp_tool',
            result: errMsg ?? safeStringify(item.result),
          })
        }
        break
      }
      case 'file_change': {
        // Keep legacy exec compatibility aligned with the managed App Server:
        // file-change telemetry never leaves the local Codex client.
        break
      }
      case 'web_search': {
        if (obj.type === 'item.completed' && item.query) {
          this.emitText(`[web_search] ${item.query}`, 'block')
        }
        break
      }
      case 'todo_list': {
        if (obj.type === 'item.completed' && item.items?.length) {
          const lines = item.items.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.text}`).join('\n')
          this.emitText(lines, 'block')
        }
        break
      }
      case 'approval_request':
      case 'approvalRequest':
      case 'permission_request':
      case 'permissionRequest':
      case 'user_input_required':
      case 'userInputRequired': {
        if (obj.type === 'item.started' || obj.type === 'item.completed') {
          this.emitApprovalPending(item)
        }
        break
      }
      case 'error': {
        if (obj.type === 'item.completed' && item.message) {
          this.emitEvent({ state: 'error', message: item.message })
        }
        break
      }
      default:
        break
    }
  }

  protected handleStreamEvent(obj: CodexStreamEvent): void {
    const topType = obj.type ?? obj.event

    if (topType?.startsWith('item.')) {
      this.handleCodexItemLine(obj)
    }

    switch (topType) {
      case 'turn.completed': {
        const u = obj.usage
        if (u) {
          const input = u.input_tokens ?? u.prompt_tokens
          const output = u.output_tokens ?? u.completion_tokens
          if (input != null || output != null) {
            this.pendingUsage = {
              inputTokens: input ?? 0,
              outputTokens: output ?? 0,
            }
          }
        }
        this.emitFinalIfOpen()
        return
      }
      case 'turn.failed': {
        const msg =
          typeof obj.error === 'object' && obj.error?.message
            ? obj.error.message
            : typeof obj.error === 'string'
              ? obj.error
              : 'turn failed'
        this.emitErrorIfOpen(msg)
        return
      }
      case 'error': {
        const m = typeof obj.message === 'string' ? obj.message : ''
        if (m.includes('Reconnecting')) return
        this.emitErrorIfOpen(m || (typeof obj.error === 'string' ? obj.error : 'stream error'))
        return
      }
      case 'thread.started': {
        const sid =
          (obj as Record<string, unknown>).thread_id ??
          (obj as Record<string, unknown>).session_id ??
          (obj as Record<string, unknown>).id
        if (typeof sid === 'string' && sid) {
          this.agentSessionId = sid
          this.emitEvent({ state: 'start', agentSessionId: this.agentSessionId })
        }
        return
      }
      case 'turn.started':
        return
    }

    if (topType?.startsWith('item.')) return

    const eventType = obj.type ?? obj.event

    switch (eventType) {
      case 'message':
      case 'text':
      case 'content': {
        const text = obj.content ?? obj.text
        if (text) {
          this.emitText(text)
        }
        break
      }
      case 'function_call':
      case 'tool_call': {
        if (this.isApprovalLikeName(obj.name)) {
          this.emitApprovalPending(obj as Record<string, unknown>)
          break
        }
        if (obj.name && isCodexCollabAgentToolName(obj.name)) return
        this.emitEvent({
          state: 'tool-call',
          name: obj.name,
          args: obj.arguments ?? obj.input,
        })
        break
      }
      case 'function_call_output':
      case 'tool_result': {
        if (obj.name && isCodexCollabAgentToolName(obj.name)) return
        this.emitEvent({
          state: 'tool-result',
          name: obj.name,
          result: obj.output ?? obj.result,
        })
        break
      }
      case 'approval_request':
      case 'approvalRequest':
      case 'permission_request':
      case 'permissionRequest':
      case 'user_input_required':
      case 'userInputRequired': {
        this.emitApprovalPending(obj as Record<string, unknown>)
        break
      }
      case 'error': {
        break
      }
      case 'done':
      case 'completed': {
        if (obj.usage) {
          this.pendingUsage = {
            inputTokens: obj.usage.prompt_tokens ?? obj.usage.input_tokens ?? 0,
            outputTokens: obj.usage.completion_tokens ?? obj.usage.output_tokens ?? 0,
          }
        }
        this.emitFinalIfOpen()
        break
      }
    }
  }

  protected emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    // Codex can finish a turn while a long-running command is still shutting
    // down, then deliver that command's item/completed notification after
    // turn/completed.  Re-emitting it would make SessionManager mark the
    // already-finished run busy again, leaving every later message queued.
    if (
      this.terminalState !== 'open' &&
      partial.state !== 'final' &&
      partial.state !== 'error' &&
      partial.state !== 'aborted'
    )
      return

    const event: AgentEvent = {
      ...partial,
      runId: this.runId,
      seq: this.seq++,
    }
    this.emit('agentEvent', event)
  }

  protected isApprovalLikeName(name: unknown): boolean {
    return isApprovalLikeName(name)
  }

  protected emitApprovalPending(source: Record<string, unknown> | CodexItem): void {
    const input = source as Record<string, unknown>
    const question = buildCodexUserQuestion(input.name ?? input.tool, input.arguments ?? input.input)
    if (question) {
      this.emitEvent({ state: 'approval-pending', approval: question })
      return
    }
    const command = typeof source.command === 'string' ? source.command : ''
    const title =
      typeof source.title === 'string' && source.title.trim() ? source.title : '需要用户确认'
    const rawContent =
      typeof source.prompt === 'string'
        ? source.prompt
        : typeof source.reason === 'string'
          ? source.reason
          : typeof source.message === 'string'
            ? source.message
            : command
              ? `Codex 请求执行命令：${command}`
              : 'Codex 正在等待用户确认后继续。'
    this.emitEvent({
      state: 'approval-pending',
      approval: {
        title,
        content: rawContent,
        source: 'codex',
        actionHint: '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
      },
    })
  }

  protected async killProcess(preserveConfiguredManagedRoomContext = false): Promise<void> {
    this.approvals.clear(); this.userInputs.clear()
    const proc = this.process
    this.appServerReady = null
    this.activeTurnId = null
    this.managedRoomTools.reset()
    if (!preserveConfiguredManagedRoomContext) this.clearConfiguredManagedRoomContext()
    // Reject only this transport's requests before waiting for it to exit.
    // A next turn may create a new app-server while the old process closes.
    this.rejectAllPending(new Error('codex app-server stopped'))
    if (!proc) return
    this.process = null
    this.clearForceCloseTimer()
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve() }, 3000)
      timer.unref?.()
      proc.once('close', () => { clearTimeout(timer); resolve() })
    })
  }

  protected rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pendingRequests.delete(id)
    }
  }

  protected handleProcessClose(code: number | null, stderrBuf: string): void {
    const stderr = normalizeCodexStderr(stderrBuf)
    if (code !== 0 && code !== null) {
      const msg = stderr || `codex exited with code ${code}`
      this.emitErrorIfOpen(msg)
    } else if (looksLikeFatalCodexStderr(stderr)) {
      // Codex sometimes surfaces fatal API/auth errors on stderr without
      // emitting a protocol-level `turn.failed`, and may still exit 0.
      this.emitErrorIfOpen(stderr)
    } else {
      this.emitFinalIfOpen()
    }
    this.pendingUsage = undefined
  }

  protected emitFinalIfOpen(): void {
    this.approvals.clear(); this.userInputs.clear()
    if (this.terminalState !== 'open') return
    this.terminalState = 'final'
    this.managedTurnReplay = null
    this.managedRoomCapabilityExpectedForTurn = false
    this.managedRoomTools.deactivateTurn()
    this.clearConfiguredManagedRoomContext()
    this.emitEvent({
      state: 'final',
      usage: this.pendingUsage,
      agentSessionId: this.agentSessionId ?? undefined,
    })
    // A completed managed turn no longer needs to own Codex's per-thread writer
    // lock. Release the app-server immediately so Codex Desktop/TUI can resume
    // the same thread without requiring a daemon restart.
    void this.killProcess().catch(() => {})
  }

  protected emitErrorIfOpen(message: string): void {
    this.approvals.clear(); this.userInputs.clear()
    if (this.terminalState !== 'open') return
    this.terminalState = 'error'
    this.activeTurnId = null
    this.managedTurnReplay = null
    this.managedRoomCapabilityExpectedForTurn = false
    this.managedRoomTools.deactivateTurn()
    this.clearConfiguredManagedRoomContext()
    this.emitEvent({ state: 'error', message: formatCodexErrorMessage(message) })
    this.scheduleProcessClose()
  }

  protected resetRunState(): void {
    this.pendingUsage = undefined
    this.terminalState = 'open'
    this.managedRoomTurnBindingFailed = false
    this.deltaItemIds.clear()
    this.lastTransientStatus = ''
    this.clearForceCloseTimer()
    this.resetTextState()
  }

  protected clearConfiguredManagedRoomContext(): void {
    this.configuredManagedRoomContextToken = null
    this.configuredManagedRoomExecutor = null
  }

  protected emitTransientStatus(message: string): void {
    const formatted = formatTransientCodexStatus(message)
    if (!formatted || formatted === this.lastTransientStatus || this.terminalState !== 'open')
      return
    this.lastTransientStatus = formatted
    this.emitEvent({ state: 'delta', text: `${formatted}\n`, thinking: true })
  }

  protected resetTextState(): void {
    this.hasEmittedText = false
    this.textTail = ''
  }

  protected emitText(text: string, mode: 'delta' | 'block' = 'delta'): void {
    if (!text) return

    let next = stripGitDirectiveArtifacts(text)
    if (!next) return
    if (mode === 'block' && this.hasEmittedText && !next.startsWith('\n')) {
      if (this.textTail.endsWith('\n')) {
        next = `\n${next}`
      } else if (!this.textTail.endsWith('\n\n')) {
        next = `\n\n${next}`
      }
    }

    this.hasEmittedText = true
    this.textTail = (this.textTail + next).slice(-4)
    this.emitEvent({ state: 'delta', text: next })
  }

  protected scheduleProcessClose(): void {
    const proc = this.process
    if (!proc || this.forceCloseTimer) return
    this.forceCloseTimer = setTimeout(() => {
      this.forceCloseTimer = null
      if (this.process !== proc) return
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (this.process === proc) {
          proc.kill('SIGKILL')
        }
      }, 1000)
    }, 250)
  }

  protected clearForceCloseTimer(): void {
    if (!this.forceCloseTimer) return
    clearTimeout(this.forceCloseTimer)
    this.forceCloseTimer = null
  }
}
