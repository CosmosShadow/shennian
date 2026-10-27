// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-adapter.test.ts

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import * as acp from '@agentclientprotocol/sdk'
import { RequestError } from '@agentclientprotocol/sdk'
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { AcpAgentType, ChatAttachmentMeta } from '@shennian/wire'
import {
  AgentAdapter,
  registerAgent,
  summarizeToolInput,
  type AgentEvent,
  type AgentSendContext,
  type ImportedAgentMessage,
} from '../adapter.js'
import { mapAcpSessionUpdate } from './events.js'
import { AcpProcessClient } from './process-client.js'
import { acpAgentType, type AcpAgentManifest } from './types.js'
import { runAcpTerminalAuthentication } from './auth.js'
import { setAcpRuntimeAuthState } from './auth-state.js'
import { recordAcpAuthFailure, recordAcpImportResult } from './metrics.js'
import {
  isManagedAgentNativeFull,
  type CompiledManagedAgentPolicy,
} from '../../security/managed-agent-policy.js'
import { buildManagedNativeFullProcessEnv } from '../../agent-env.js'
import { assertPublicAgentPolicy } from '../../security/public-agent-policy.js'

type PendingPermission = {
  optionIds: Set<string>
  resolve(response: RequestPermissionResponse): void
  timer: NodeJS.Timeout
}

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024

function readImageAttachment(attachment: ChatAttachmentMeta): { data: string } | null {
  if (attachment.kind !== 'image' || !attachment.mimeType.startsWith('image/')) return null
  let data = attachment.previewData?.trim() ?? ''
  const comma = data.indexOf(',')
  if (data.startsWith('data:') && comma >= 0) data = data.slice(comma + 1)
  if (!data && attachment.path && !/^https?:\/\//i.test(attachment.path)) {
    try {
      const stat = statSync(attachment.path)
      if (stat.isFile() && stat.size <= MAX_INLINE_IMAGE_BYTES) {
        data = readFileSync(attachment.path).toString('base64')
      }
    } catch {
      data = ''
    }
  }
  return data ? { data } : null
}

type SelectConfigOption = Extract<
  import('@agentclientprotocol/sdk').SessionConfigOption,
  { type: 'select' }
>

function findSelectOption(
  options: import('@agentclientprotocol/sdk').SessionConfigOption[],
  category: string,
): SelectConfigOption | undefined {
  return options.find(
    (item): item is SelectConfigOption => item.category === category && item.type === 'select',
  )
}

function flattenSelectOptions(option: SelectConfigOption | undefined) {
  return (option?.options ?? []).flatMap((item) => ('options' in item ? item.options : [item]))
}

type PendingAuthRetry = {
  text: string
  modelId?: string
  reasoningEffort?: string
  attachments?: ChatAttachmentMeta[]
  systemPrompt?: string | null
}

export class AcpAgentAdapter extends AgentAdapter {
  readonly type: AcpAgentType
  override get recoveryCapabilities() {
    const capabilities = this.client?.capabilities
    return {
      inspectTerminal: false,
      reattachRun: false,
      resumeRun: false,
      resumeSession: Boolean(capabilities?.sessionCapabilities?.resume || capabilities?.loadSession),
    }
  }
  private client: AcpProcessClient | null = null
  private workDir = ''
  private shennianSessionId = ''
  private requestedSessionId: string | null = null
  private agentSessionId: string | null = null
  private runId = ''
  private seq = 0
  private active = false
  private extraEnv: NodeJS.ProcessEnv = {}
  private pendingPermissions = new Map<string, PendingPermission>()
  private configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] = []
  private modes: import('@agentclientprotocol/sdk').SessionModeState | null = null
  private importCapture: Array<{ role: 'user' | 'agent'; payload: string; sourceHint?: string }> | null = null
  private emittedToolStates = new Map<string, string>()
  private pendingAuthRetry: PendingAuthRetry | null = null
  private retryingAfterAuth = false
  private managedAgentPolicy: CompiledManagedAgentPolicy | null = null
  private publicTurn = false
  private baseConfigurationSignature = ''
  private startedConfigurationSignature = ''

  constructor(
    private readonly manifest: AcpAgentManifest,
    private readonly options: { permissionTimeoutMs?: number; promptTimeoutMs?: number } = {},
  ) {
    super()
    this.type = acpAgentType(manifest.id)
  }

  configure(options: { env?: NodeJS.ProcessEnv; managedAgentPolicy?: CompiledManagedAgentPolicy | null }): void {
    this.extraEnv = options.env ?? {}
    this.managedAgentPolicy = options.managedAgentPolicy ?? null
    this.baseConfigurationSignature = createHash('sha256').update(JSON.stringify({
      env: Object.entries(this.extraEnv).sort(([left], [right]) => left.localeCompare(right)),
      managedAgentPolicy: this.managedAgentPolicy,
    })).digest('hex')
  }

  /** Recomputed whenever `publicTurn` may have changed, so a stale client capability set is never reused across it. */
  private get configurationSignature(): string {
    return `${this.baseConfigurationSignature}:${this.publicTurn ? 'public' : 'room'}`
  }

  async start(sessionId: string, workDir: string, agentSessionId?: string | null): Promise<void> {
    this.shennianSessionId = sessionId
    // Some platforms expose the same directory through aliases (notably
    // `/var` and `/private/var` on macOS). ACP session/list filtering is an
    // exact string comparison in several Agents, so use the executable's
    // canonical cwd for new, list, load and resume consistently.
    try {
      this.workDir = realpathSync.native(workDir)
    } catch {
      this.workDir = workDir
    }
    this.requestedSessionId = agentSessionId ?? null
    this.agentSessionId = null
    this.client = this.createProcessClient()
    await this.client.start(this.workDir)
    this.startedConfigurationSignature = this.configurationSignature
  }

  async send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    systemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void> {
    if (context?.source === 'published_agent') assertPublicAgentPolicy(this.managedAgentPolicy)
    this.publicTurn = context?.source === 'published_agent'
    await this.refreshProcessConfiguration()
    const client = this.requireClient()
    this.runId = randomUUID()
    this.seq = 0
    this.emittedToolStates.clear()
    try {
      await this.ensureSession()
      await this.applyDynamicConfig(modelId, reasoningEffort)
      this.active = true
      this.emitEvent({ state: 'start', runPhase: 'thinking', agentSessionId: this.agentSessionId ?? undefined })
      const prompt: import('@agentclientprotocol/sdk').ContentBlock[] = []
      const parts: string[] = []
      if (systemPrompt?.trim()) parts.push(systemPrompt.trim())
      parts.push(text)
      prompt.push({ type: 'text', text: parts.join('\n\n') })
      const acceptsImages = client.capabilities.promptCapabilities?.image === true
      for (const attachment of attachments ?? []) {
        const image = acceptsImages ? readImageAttachment(attachment) : null
        if (image) prompt.push({ type: 'image', data: image.data, mimeType: attachment.mimeType })
        prompt.push({
          type: 'resource_link',
          uri: pathToFileURL(attachment.path).href,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.byteSize,
        })
      }
      const result = await this.promptWithTimeout(client, prompt)
      this.active = false
      if (result.stopReason === 'cancelled') {
        this.emitEvent({ state: 'aborted', agentSessionId: this.agentSessionId ?? undefined })
      } else {
        this.emitEvent({ state: 'final', agentSessionId: this.agentSessionId ?? undefined })
      }
    } catch (error) {
      this.active = false
      this.cancelPendingPermissions()
      const message = error instanceof Error ? error.message : String(error)
      const authRequired = error instanceof RequestError && error.code === -32000
      if (authRequired) {
        setAcpRuntimeAuthState(this.type, 'required')
        if (!this.retryingAfterAuth) {
          this.pendingAuthRetry = {
            text,
            ...(modelId ? { modelId } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(attachments ? { attachments: [...attachments] } : {}),
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          }
        }
      }
      this.emitEvent({
        state: 'error',
        message,
        ...(authRequired ? { errorCode: 'acp_auth_required' } : {}),
        agentSessionId: this.agentSessionId ?? undefined,
      })
      throw error
    }
  }

  async resume(agentSessionId: string): Promise<void> {
    this.requestedSessionId = agentSessionId
    this.agentSessionId = null
    await this.ensureSession()
  }

  async stop(): Promise<void> {
    if (this.active && this.agentSessionId && this.client) {
      await this.client.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.agentSessionId })
    }
    this.cancelPendingPermissions()
    this.active = false
    await this.client?.close()
    this.client = null
    this.startedConfigurationSignature = ''
  }

  async getStatus() {
    return { active: this.active, runId: this.active ? this.runId : null, canStop: this.active }
  }

  async respondToPermission(permissionId: string, optionId: string): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId)
    if (!pending) throw new Error('ACP permission request is no longer pending')
    if (!pending.optionIds.has(optionId)) throw new Error('Invalid ACP permission option')
    this.pendingPermissions.delete(permissionId)
    clearTimeout(pending.timer)
    pending.resolve({ outcome: { outcome: 'selected', optionId } })
  }

  getAuthMethods(): import('@agentclientprotocol/sdk').AuthMethod[] {
    return [...(this.requireClient().initializeResponse?.authMethods ?? [])]
  }

  hasPendingAuthenticationRetry(): boolean {
    return this.pendingAuthRetry !== null
  }

  getSessionOptions(): import('../adapter.js').AgentSessionOptions {
    const modelOption = findSelectOption(this.configOptions, 'model')
    const thoughtOption = findSelectOption(this.configOptions, 'thought_level')
    const modes = this.modes?.availableModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    })) ?? []
    const reasoningOptions = (thoughtOption ? flattenSelectOptions(thoughtOption) : modes).map((option) => ({
      id: 'value' in option ? option.value : option.id,
      name: option.name,
      ...(option.description ? { description: option.description } : {}),
    }))
    return {
      models: flattenSelectOptions(modelOption).map((option) => ({
        id: option.value,
        name: option.name,
        ...(option.description ? { description: option.description } : {}),
        ...(option.value === modelOption?.currentValue ? { isDefault: true } : {}),
        ...(reasoningOptions.length ? { supportedReasoningEfforts: reasoningOptions } : {}),
      })),
      modes,
    }
  }

  async authenticate(methodId: string, options: { interactiveTerminal?: boolean } = {}): Promise<void> {
    const client = this.requireClient()
    const method = client.initializeResponse?.authMethods?.find((item) => item.id === methodId)
    if (!method) throw new Error('ACP authentication method is unavailable')
    try {
      if ('type' in method && method.type === 'terminal') {
        if (!options.interactiveTerminal) {
          throw new Error('ACP terminal authentication must be completed on the target machine with `shennian agent auth`')
        }
        await client.close()
        await runAcpTerminalAuthentication(
          {
            ...(this.manifest.authLaunch ?? this.manifest.launch),
            env: Object.fromEntries(Object.entries({
              ...this.extraEnv,
              ...(this.manifest.authLaunch?.env ?? this.manifest.launch.env),
            })
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
          },
          method,
          this.workDir,
        )
      } else {
        await client.authenticate(methodId)
      }
      await this.resumeAfterExternalAuthentication()
    } catch (error) {
      recordAcpAuthFailure()
      throw error
    }
  }

  async logout(): Promise<void> {
    await this.requireClient().logout()
    setAcpRuntimeAuthState(this.type, 'required')
  }

  async resumeAfterExternalAuthentication(): Promise<void> {
    await this.client?.close()
    this.client = this.createProcessClient()
    await this.client.start(this.workDir)
    this.startedConfigurationSignature = this.configurationSignature
    setAcpRuntimeAuthState(this.type, 'ready')
    const pending = this.pendingAuthRetry
    this.pendingAuthRetry = null
    if (pending) {
      // Authentication itself must acknowledge promptly. The original action
      // resumes on the adapter event stream and is consumed before dispatch,
      // so a second auth_required cannot create a retry loop.
      void this.retryAfterAuthentication(pending)
    }
  }

  async listExternalSessions(options: { cwd?: string } = {}) {
    const client = this.requireClient()
    if (!client.capabilities.sessionCapabilities?.list) return []
    const sessions: import('@shennian/wire').AcpExternalSessionInfo[] = []
    let cursor: string | null | undefined
    for (let page = 0; page < 10 && sessions.length < 500; page += 1) {
      let cwd = options.cwd
      if (cwd) {
        try { cwd = realpathSync.native(cwd) } catch { /* keep caller path for Agent diagnostics */ }
      }
      const response = await client.listSessions(cwd, cursor)
      sessions.push(...response.sessions.slice(0, 500 - sessions.length).map((session) => ({
        agentSessionId: session.sessionId,
        cwd: session.cwd,
        ...(session.title ? { title: session.title.slice(0, 200) } : {}),
        ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
      })))
      cursor = response.nextCursor
      if (!cursor) break
    }
    return sessions
  }

  async loadExternalSession(agentSessionId: string): Promise<ImportedAgentMessage[]> {
    const client = this.requireClient()
    if (!client.capabilities.loadSession) throw new Error('ACP session history import is unsupported')
    this.requestedSessionId = agentSessionId
    this.agentSessionId = agentSessionId
    const captured: Array<{ role: 'user' | 'agent'; payload: string; sourceHint?: string }> = []
    this.importCapture = captured
    try {
      const result = await client.agent.request(acp.methods.agent.session.load, {
        sessionId: agentSessionId,
        cwd: this.workDir,
        mcpServers: [],
      })
      this.configOptions = result.configOptions ?? []
      this.modes = result.modes ?? null
      recordAcpImportResult(true)
    } catch (error) {
      recordAcpImportResult(false)
      throw error
    } finally {
      this.importCapture = null
    }
    return captured.map((message, index) => ({
      sourceId: message.sourceHint ?? createHash('sha256')
        .update(`${agentSessionId}\0${index}\0${message.role}\0${message.payload}`)
        .digest('hex'),
      role: message.role,
      payload: message.payload,
    }))
  }

  async closeExternalSession(agentSessionId: string): Promise<void> {
    if (!this.requireClient().capabilities.sessionCapabilities?.close) throw new Error('ACP session close is unsupported')
    await this.requireClient().closeSession(agentSessionId)
  }

  async deleteExternalSession(agentSessionId: string): Promise<void> {
    if (!this.requireClient().capabilities.sessionCapabilities?.delete) throw new Error('ACP session delete is unsupported')
    await this.requireClient().deleteSession(agentSessionId)
  }

  private async ensureSession(): Promise<void> {
    if (this.agentSessionId) return
    const client = this.requireClient()
    if (this.requestedSessionId) {
      const capabilities = client.capabilities
      if (capabilities.sessionCapabilities?.resume) {
        const result = await client.agent.request(acp.methods.agent.session.resume, {
          sessionId: this.requestedSessionId,
          cwd: this.workDir,
          mcpServers: [],
        })
        this.configOptions = result.configOptions ?? []
        this.modes = result.modes ?? null
      } else if (capabilities.loadSession) {
        this.agentSessionId = this.requestedSessionId
        const result = await client.agent.request(acp.methods.agent.session.load, {
          sessionId: this.requestedSessionId,
          cwd: this.workDir,
          mcpServers: [],
        })
        this.configOptions = result.configOptions ?? []
        this.modes = result.modes ?? null
      } else {
        throw new Error(`${this.manifest.name} cannot resume ACP sessions`)
      }
      this.agentSessionId = this.requestedSessionId
      this.emit('sessionOptions')
      return
    }
    const result = await client.agent.request(acp.methods.agent.session.new, {
      cwd: this.workDir,
      mcpServers: [],
    })
    this.agentSessionId = result.sessionId
    this.configOptions = result.configOptions ?? []
    this.modes = result.modes ?? null
    this.emit('sessionOptions')
  }

  private async applyDynamicConfig(modelId?: string, reasoningEffort?: string): Promise<void> {
    if (!this.agentSessionId) return
    if (reasoningEffort && this.modes?.availableModes.some((mode) => mode.id === reasoningEffort)) {
      if (this.modes.currentModeId !== reasoningEffort) {
        await this.requireClient().agent.request(acp.methods.agent.session.setMode, {
          sessionId: this.agentSessionId,
          modeId: reasoningEffort,
        })
        this.modes.currentModeId = reasoningEffort
      }
      reasoningEffort = undefined
    }
    const choices = [
      { category: 'model', value: modelId },
      { category: 'thought_level', value: reasoningEffort },
    ]
    for (const choice of choices) {
      if (!choice.value) continue
      const option = findSelectOption(this.configOptions, choice.category)
      if (!option || option.currentValue === choice.value) continue
      // A model chosen from a cached list may no longer exist (config changed,
      // another project directory). Keep the provider's current choice instead
      // of failing the whole message.
      if (!flattenSelectOptions(option).some((item) => item.value === choice.value)) continue
      await this.requireClient().agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: this.agentSessionId,
        configId: option.id,
        value: choice.value,
      })
      option.currentValue = choice.value
    }
  }

  private handleSessionUpdate(params: SessionNotification): void {
    if (params.sessionId !== this.agentSessionId) return
    if (this.importCapture) {
      this.captureImportedUpdate(params.update)
      return
    }
    if (!this.active) return
    if (params.update.sessionUpdate === 'tool_call' || params.update.sessionUpdate === 'tool_call_update') {
      const signature = JSON.stringify(params.update)
      if (this.emittedToolStates.get(params.update.toolCallId) === signature) return
      this.emittedToolStates.set(params.update.toolCallId, signature)
    }
    for (const event of mapAcpSessionUpdate(params.update, (partial) => this.makeEvent(partial))) {
      this.emit('agentEvent', event)
    }
  }

  private captureImportedUpdate(update: import('@agentclientprotocol/sdk').SessionUpdate): void {
    if (!this.importCapture) return
    if (update.sessionUpdate === 'user_message_chunk' || update.sessionUpdate === 'agent_message_chunk') {
      const payload = update.content.type === 'text'
        ? update.content.text
        : update.content.type === 'resource_link'
          ? update.content.name || update.content.uri
          : `[${update.content.type}]`
      const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'agent'
      const sourceHint = update.messageId ? `message:${update.messageId}` : undefined
      const previous = sourceHint
        ? this.importCapture.find((message) => message.sourceHint === sourceHint)
        : this.importCapture.at(-1)
      if (previous?.role === role && previous.sourceHint === sourceHint) previous.payload += payload
      else this.importCapture.push({ role, payload, ...(sourceHint ? { sourceHint } : {}) })
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      const sourceHint = `tool:${update.toolCallId}`
      const existing = this.importCapture.find((message) => message.sourceHint === sourceHint)
      const imported = {
        role: 'agent',
        sourceHint,
        payload: JSON.stringify({
          v: 1,
          type: 'tool_use',
          name: update.title,
          toolCallId: update.toolCallId,
          status: update.status ?? 'running',
        }),
      } as const
      if (existing) existing.payload = imported.payload
      else this.importCapture.push(imported)
      return
    }
    if (update.sessionUpdate === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) {
      const existing = this.importCapture.find((message) => message.sourceHint === `tool:${update.toolCallId}`)
      const payload = JSON.stringify({
        v: 1,
        type: 'tool_result',
        name: update.title ?? 'tool',
        toolCallId: update.toolCallId,
        status: update.status,
      })
      if (existing) existing.payload = payload
      else this.importCapture.push({ role: 'agent', sourceHint: `tool:${update.toolCallId}`, payload })
    }
  }

  private handlePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (!this.active || params.sessionId !== this.agentSessionId) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    }
    const permissionId = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(permissionId)
        resolve({ outcome: { outcome: 'cancelled' } })
      }, this.options.permissionTimeoutMs ?? 5 * 60_000)
      timer.unref?.()
      this.pendingPermissions.set(permissionId, {
        optionIds: new Set(params.options.map((option) => option.optionId)),
        resolve,
        timer,
      })
      this.emitEvent({
        state: 'approval-pending',
        runPhase: 'waiting_approval',
        approval: {
          title: params.toolCall.title ?? undefined,
          content: summarizeToolInput(params.toolCall.rawInput),
          source: this.manifest.name,
        },
        permission: {
          id: permissionId,
          sessionId: this.shennianSessionId,
          agentSessionId: this.agentSessionId ?? undefined,
          runId: this.runId,
          toolCallId: params.toolCall.toolCallId,
          options: params.options.map((option) => ({
            id: option.optionId,
            name: option.name,
            kind: option.kind,
          })),
        },
      })
    })
  }

  private requireClient(): AcpProcessClient {
    if (!this.client) throw new Error('ACP adapter has not started')
    return this.client
  }

  private createProcessClient(): AcpProcessClient {
    return new AcpProcessClient(this.manifest.launch, {
      onSessionUpdate: (params) => this.handleSessionUpdate(params),
      onPermission: (params) => this.handlePermission(params),
    }, this.buildEnvironment(), { ...this.buildClientCapabilities(), terminalAuth: true })
  }

  private async refreshProcessConfiguration(): Promise<void> {
    if (!this.client || this.startedConfigurationSignature === this.configurationSignature) return
    const resumableSessionId = this.agentSessionId ?? this.requestedSessionId
    await this.client.close()
    this.requestedSessionId = resumableSessionId
    this.agentSessionId = null
    this.configOptions = []
    this.modes = null
    this.client = this.createProcessClient()
    await this.client.start(this.workDir)
    this.startedConfigurationSignature = this.configurationSignature
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    if (!this.managedAgentPolicy) return { ...process.env, ...this.extraEnv }
    return isManagedAgentNativeFull(this.managedAgentPolicy)
      ? buildManagedNativeFullProcessEnv(this.extraEnv)
      : { ...this.extraEnv }
  }

  private buildClientCapabilities() {
    const declared = this.manifest.clientCapabilities ?? {}
    const policy = this.managedAgentPolicy?.adapterPolicy
    if (!policy) return declared
    if (this.publicTurn) {
      // The `managed-room-only` terminal bridge below execs `shennian room
      // <status|read|send|...>` using the Owner's own paired-machine
      // identity — it has no concept of "which Room", so any Room ID the
      // model supplies would be accepted. A public visitor has no
      // legitimate Room at all; this must stay fully closed regardless of
      // fileAccess/native-full, not just narrowed like Room mode does.
      // Native-full keeps the Agent's ordinary ACP file capabilities. Only
      // the Owner-identity Room terminal bridge is unavailable to visitors.
      return isManagedAgentNativeFull(this.managedAgentPolicy)
        ? { readTextFile: Boolean(declared.readTextFile),
          writeTextFile: Boolean(declared.writeTextFile), terminal: false }
        : { readTextFile: false, writeTextFile: false, terminal: false }
    }
    if (isManagedAgentNativeFull(this.managedAgentPolicy)) {
      return {
        ...declared,
        terminal: true,
        terminalPolicy: 'managed-room-only' as const,
      }
    }
    return {
      readTextFile: Boolean(declared.readTextFile),
      writeTextFile: Boolean(declared.writeTextFile && policy.fileAccess !== 'workspace-read'),
      // Managed ACP sessions receive a host bridge that can execute only the
      // trusted Shennian Room CLI surface. It never becomes a general shell.
      terminal: true,
      terminalPolicy: 'managed-room-only' as const,
    }
  }

  private async retryAfterAuthentication(pending: PendingAuthRetry): Promise<void> {
    this.retryingAfterAuth = true
    try {
      await this.send(
        pending.text,
        pending.modelId,
        pending.reasoningEffort,
        pending.attachments,
        pending.systemPrompt,
      )
    } catch {
      // send() already emits the normalized terminal error. Never retry twice.
    } finally {
      this.retryingAfterAuth = false
    }
  }

  private async promptWithTimeout(
    client: AcpProcessClient,
    prompt: import('@agentclientprotocol/sdk').ContentBlock[],
  ) {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        client.agent.request(acp.methods.agent.session.prompt, {
          sessionId: this.agentSessionId!,
          prompt,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('ACP prompt timed out')),
            this.options.promptTimeoutMs ?? 12 * 60 * 60_000,
          )
          timer.unref?.()
        }),
      ])
    } catch (error) {
      if (error instanceof Error && error.message === 'ACP prompt timed out') {
        await client.close()
        if (this.client === client) this.client = null
      }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private cancelPendingPermissions(): void {
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timer)
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
    this.pendingPermissions.clear()
  }

  private makeEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): AgentEvent {
    return { ...partial, runId: this.runId, seq: this.seq++ }
  }

  private emitEvent(partial: Omit<AgentEvent, 'runId' | 'seq'>): void {
    this.emit('agentEvent', this.makeEvent(partial))
  }
}

export function registerAcpAgent(manifest: AcpAgentManifest): void {
  registerAgent(acpAgentType(manifest.id), () => new AcpAgentAdapter(manifest))
}
