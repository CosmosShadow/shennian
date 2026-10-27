// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

import { deliverDirectWorkerEvents } from './direct-worker-notifications.js'
import http from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentEvent, AgentAdapter } from '../agents/adapter.js'
import {
  type AgentType,
  type AgentInfo,
  type ExternalChannelSessionStatus,
  type ReqFrame,
} from '@shennian/wire'
import { ManagerRegistry, type ManagedWorkerRoomOrigin, type ManagerInboxEvent, type ManagerRecord } from './registry.js'
import { loadConfig } from '../config/index.js'
import { isStewardSessionId } from '../steward/session.js'
import { appendMessage, listSessionRecords } from '../session/store.js'
import { requestSessionIndexPublish } from '../session/index-publisher.js'
import type { SessionManagerRuntime } from '../session/types.js'
import {
  RetiredChannelRuntime as ChannelRuntime,
  type ChannelRuntimeOptions,
  type WeChatAutomationLane,
} from './retired-external-channel-compat.js'
import { resolveShennianPath } from '../config/index.js'
import { buildExternalChannelInstructions } from '../agents/external-channel-instructions.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import {
  EphemeralWorkerError,
  handleEphemeralWorkerIpcRoute,
  handleWorkerIpcRoute,
} from './worker-ipc.js'
import {
  deriveWorkerTitle,
  formatWorkerMarkdown,
  type WorkerMarkdownKind,
} from './worker-markdown.js'
import type { JsonValue } from '../daemon-ipc/json.js'
import type { ManagedManagerAction } from '../room/managed-room-ipc.js'
import { markTrustedManagerEvent } from '../session/manager-event-authority.js'

export type LocalReqDispatchResult = {
  durableQueueHandoff?: boolean
}

export type LocalReqDispatcher = (req: ReqFrame) => Promise<void | LocalReqDispatchResult>

type ManagerRuntimeServiceOptions = {
  getRuntime: () => SessionManagerRuntime
  getAgentSnapshot?: () => AgentInfo[]
  dispatchReq: LocalReqDispatcher
  channelRuntime?: ChannelRuntime
  createWeChatRpaProductRunner?: ChannelRuntimeOptions['createWeChatRpaProductRunner']
  weChatAutomationLane?: WeChatAutomationLane
}

const MAX_MANAGER_IPC_BODY_BYTES = Number(process.env.SHENNIAN_MANAGER_IPC_BODY_MAX_BYTES || 2 * 1024 * 1024)
const MANAGER_IPC_LONG_OPERATION_TIMEOUT_MS = 12 * 60_000

let singleton: ManagerRuntimeService | null = null

export function setManagerRuntimeService(service: ManagerRuntimeService | null): void {
  singleton = service
}

export function getManagerRuntimeService(): ManagerRuntimeService | null {
  return singleton
}

function normalizeWorkDir(workDir: string): string {
  return path.resolve(workDir || os.homedir())
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function normalizeMarkdownForWorkerSummary(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function managerInboxKind(kind: ManagerInboxEvent['kind']): WorkerMarkdownKind {
  if (kind === 'worker.final') return 'completed'
  if (kind === 'worker.error') return 'failed'
  if (kind === 'worker.aborted') return 'stopped'
  return 'progress'
}

function managerInboxClientMessageId(
  managerSessionId: string,
  events: readonly ManagerInboxEvent[],
): string {
  const digest = createHash('sha256')
    .update(managerSessionId)
    .update('\0')
    .update(events.map((event) => event.id).join('\0'))
    .digest('hex')
    .slice(0, 32)
  return `manager-inbox:${digest}`
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_MANAGER_IPC_BODY_BYTES) throw new Error('Request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function appJson(runtime: SessionManagerRuntime, reqId: string, ok: boolean, payload: Record<string, unknown>): void {
  runtime.client.sendRes({
    type: 'res',
    id: reqId,
    ok,
    ...(ok ? { payload } : { error: String(payload.error || 'unknown error') }),
  })
}

function managerIpcRuntimePath(): string {
  if (isVitestRuntimeWithoutExplicitHome()) {
    return path.join(os.tmpdir(), 'shennian-vitest-runtime', String(process.pid), 'manager-ipc.json')
  }
  return resolveShennianPath('runtime', 'manager-ipc.json')
}

function isVitestRuntimeWithoutExplicitHome(): boolean {
  return (process.env.VITEST === 'true' || Boolean(process.env.VITEST_WORKER_ID)) && !process.env.SHENNIAN_HOME?.trim()
}

export class ManagerRuntimeService {
  private readonly managedPolicies = new Map<string, CompiledManagedAgentPolicy>()
  readonly registry = new ManagerRegistry()
  readonly channelRuntime: ChannelRuntime
  private server: http.Server | null = null
  private ipcUrl: string | null = null
  private ipcToken = randomBytes(24).toString('hex')
  private healthTimer: NodeJS.Timeout | null = null
  private startPromise: Promise<void> | null = null
  private workerTextAcc = new Map<string, string>()
  private pendingWorkerOrigins = new Map<string, ManagedWorkerRoomOrigin>()

  prepareWorkerTurnOrigin(sessionId: string, origin?: ManagedWorkerRoomOrigin): void {
    if (origin) this.pendingWorkerOrigins.set(sessionId, origin)
    else this.pendingWorkerOrigins.delete(sessionId)
  }

  constructor(private opts: ManagerRuntimeServiceOptions) {
    // External-channel transports are retired. Keep the injected compatibility
    // runtime only so old callers receive explicit feature_retired responses.
    this.channelRuntime = opts.channelRuntime ?? new ChannelRuntime()
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart()
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    if (this.server) return
    // Room authority is process-local. A Provider run surviving daemon restart
    // must complete privately rather than inheriting a pre-restart capability.
    this.registry.clearWorkerRunOrigins()
    this.server = http.createServer((req, res) => {
      void this.handleIpc(req, res)
    })
    this.server.requestTimeout = MANAGER_IPC_LONG_OPERATION_TIMEOUT_MS
    this.server.timeout = MANAGER_IPC_LONG_OPERATION_TIMEOUT_MS
    this.server.keepAliveTimeout = MANAGER_IPC_LONG_OPERATION_TIMEOUT_MS
    this.server.headersTimeout = MANAGER_IPC_LONG_OPERATION_TIMEOUT_MS + 5_000
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = this.server.address()
    if (typeof address === 'object' && address) {
      this.ipcUrl = `http://127.0.0.1:${address.port}`
      this.writeIpcRuntimeFile()
    }
    this.server.unref()
    await this.channelRuntime.start()
    this.healthTimer = setInterval(() => this.scanWorkerHealth(), 60_000)
    this.healthTimer.unref()
    this.recoverPersistedInboxDeliveries()
  }

  async ready(): Promise<void> {
    await this.start()
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
    await this.channelRuntime.stop()
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
    this.server = null
    this.ipcUrl = null
    this.removeIpcRuntimeFile()
  }

  private writeIpcRuntimeFile(): void {
    if (!this.ipcUrl) return
    try {
      const filePath = managerIpcRuntimePath()
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify({
        url: this.ipcUrl,
        token: this.ipcToken,
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      }, null, 2), { mode: 0o600 })
      fs.chmodSync(filePath, 0o600)
    } catch {
      // Best effort. Injected env remains the primary path for managed agents.
    }
  }

  private removeIpcRuntimeFile(): void {
    try {
      const filePath = managerIpcRuntimePath()
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      if (parsed.url === this.ipcUrl || parsed.token === this.ipcToken) {
        fs.unlinkSync(filePath)
      }
    } catch {
      // The file may not exist or may already have been replaced by a newer daemon.
    }
  }

  getInjectedEnv(managerSessionId: string, agentSessionId: string | null, workDir: string, modelId: string): NodeJS.ProcessEnv {
    if (!this.ipcUrl) return {}
    return {
      SHENNIAN_MANAGER_SESSION_ID: managerSessionId,
      SHENNIAN_MANAGER_AGENT_SESSION_ID: agentSessionId ?? '',
      SHENNIAN_MANAGER_WORKDIR: normalizeWorkDir(workDir),
      SHENNIAN_MANAGER_MODEL: modelId,
      SHENNIAN_MANAGER_IPC_URL: this.ipcUrl,
      SHENNIAN_MANAGER_IPC_TOKEN: this.ipcToken,
    }
  }

  registerManager(input: {
    sessionId: string
    agentSessionId?: string | null
    workDir: string
    modelId: AgentType
    agentType?: AgentType
    providerModelId?: string | null
    defaultWorkerAgentType?: AgentType | null
    defaultWorkerModelId?: string | null
    managedRoomBound?: boolean
    controllerKind?: 'managed_session' | 'ephemeral'
    status?: 'idle' | 'running' | 'interrupting'
  }): void {
    this.registry.upsertManager({
      ...input,
      workDir: normalizeWorkDir(input.workDir),
      machineId: process.env.SHENNIAN_MACHINE_ID ?? null,
      managedRoomBound:
        input.managedRoomBound ?? (this.managedPolicies.has(input.sessionId) || undefined),
    })
  }

  setManagedAgentPolicy(sessionId: string, policy: CompiledManagedAgentPolicy | null): void {
    if (policy) {
      this.managedPolicies.set(sessionId, policy)
      const manager = this.registry.getManager(sessionId)
      if (manager && !manager.managedRoomBound) {
        this.registry.upsertManager({ ...manager, managedRoomBound: true })
      }
    } else this.managedPolicies.delete(sessionId)
  }

  getManagedAgentPolicyForWorker(
    managerSessionId: string,
    workDir: string,
  ): CompiledManagedAgentPolicy | null {
    const manager = this.registry.getManager(managerSessionId)
    const policy = this.managedPolicies.get(managerSessionId)
    if (!manager || !policy || normalizeWorkDir(workDir) !== manager.workDir) return null
    return policy
  }

  isExternalWorkerController(managerSessionId: string, workDir: string): boolean {
    const manager = this.registry.getManager(managerSessionId)
    return Boolean(
      manager?.controllerKind === 'ephemeral' && normalizeWorkDir(workDir) === manager.workDir,
    )
  }

  isManagedWorkerSession(sessionId: string): boolean {
    return Boolean(this.findWorker(sessionId))
  }

  getWorkerControllerSessionId(sessionId: string, workDir: string): string | null {
    const worker = this.findWorker(sessionId)
    if (!worker || normalizeWorkDir(workDir) !== worker.workDir) return null
    const manager = this.registry.getManager(worker.managedBy)
    if (!manager || manager.workDir !== worker.workDir) return null
    return manager.sessionId
  }

  isManagedRoomBoundManager(sessionId: string): boolean {
    return this.registry.getManager(sessionId)?.managedRoomBound === true
  }

  async retireManagerAndWorkers(managerSessionId: string): Promise<string[]> {
    // Remove ownership first. Any terminal event emitted while Providers are
    // stopping then fails closed instead of being delivered to the retired
    // Manager or a replacement Manager in the same project.
    const workers = this.registry.retireManager(managerSessionId)
    this.managedPolicies.delete(managerSessionId)
    const runtime = this.opts.getRuntime()
    const failures: unknown[] = []
    const retireSession = async (
      sessionId: string,
      complete?: () => void,
    ): Promise<void> => {
      const sessionFailures: unknown[] = []
      try {
        runtime.runJournal?.markSessionAborted(sessionId)
      } catch (error) {
        sessionFailures.push(error)
      }
      try {
        runtime.recoveryBarrier?.end(sessionId)
      } catch (error) {
        sessionFailures.push(error)
      }
      try {
        runtime.chatQueue?.purgeSession(sessionId)
      } catch (error) {
        sessionFailures.push(error)
      }
      const session = runtime.sessions.get(sessionId)
      let stopped = !session
      if (session) {
        if (session.managedRoomContextToken) {
          try {
            runtime.revokeManagedRoomContextToken?.(session.managedRoomContextToken)
            session.managedRoomContextToken = null
          } catch (error) {
            sessionFailures.push(error)
          }
        }
        try {
          await session.adapter.stop()
          stopped = true
        } catch (error) {
          sessionFailures.push(error)
        }
      }
      if (session && stopped && sessionFailures.length === 0) {
        runtime.sessions.delete(sessionId)
        if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
        session.adapter.removeAllListeners()
      }
      if (stopped && sessionFailures.length === 0) {
        try {
          complete?.()
        } catch (error) {
          sessionFailures.push(error)
          failures.push(error)
        }
      } else {
        failures.push(...sessionFailures)
      }
    }

    // Stop the retired Manager itself before waiting on Worker cleanup, but do
    // not let one failed Provider prevent attempts to stop the others.
    await retireSession(managerSessionId)
    for (const worker of workers) {
      await retireSession(
        worker.sessionId,
        () => this.registry.completeRetiredWorker(managerSessionId, worker.sessionId),
      )
    }
    if (failures.length) {
      throw new AggregateError(failures, 'Failed to retire every Manager or Worker session')
    }
    return workers.map((worker) => worker.sessionId)
  }

  setManagerWorkerDefaults(sessionId: string, agentType?: AgentType | null, modelId?: string | null): void {
    const manager = this.registry.getManager(sessionId)
    if (!manager) return
    this.registry.upsertManager({
      ...manager,
      defaultWorkerAgentType: agentType ?? null,
      defaultWorkerModelId: modelId ?? null,
    })
  }

  getManagerWorkerDefaults(sessionId: string): { agentType: AgentType | null; modelId: string | null } {
    const manager = this.registry.getManager(sessionId)
    return {
      agentType: manager?.defaultWorkerAgentType ?? null,
      modelId: manager?.defaultWorkerModelId ?? null,
    }
  }

  noteManagerAgentSession(sessionId: string, agentSessionId: string | null, workDir: string, modelId: AgentType): void {
    const manager = this.registry.getManager(sessionId)
    this.registry.upsertManager({
      sessionId,
      agentSessionId,
      workDir: normalizeWorkDir(workDir),
      machineId: process.env.SHENNIAN_MACHINE_ID ?? null,
      modelId,
      agentType: manager?.agentType,
      providerModelId: manager?.providerModelId,
    })
  }

  noteAgentEvent(sessionId: string, event: AgentEvent): void {
    if (isStewardSessionId(sessionId) && (event.state === 'final' || event.state === 'error' || event.state === 'aborted')) {
      for (const manager of Object.values(this.registry.load().managers)) {
        if (manager.stewardSessionId !== sessionId) continue
        this.updateManagerStatus(manager.sessionId, 'idle')
        queueMicrotask(() => void this.drainManagerInbox(manager.sessionId))
      }
    }
    const worker = this.findWorker(sessionId)
    if (!worker) return
    const patch: Parameters<ManagerRegistry['updateWorker']>[1] = {
      lastActivityAt: new Date().toISOString(),
      runId: event.runId,
    }
    if (event.agentSessionId) patch.agentSessionId = event.agentSessionId
    if (event.state === 'start') {
      const origin = this.pendingWorkerOrigins.get(sessionId)
      this.pendingWorkerOrigins.delete(sessionId)
      if (origin) patch.runRoomOrigins = { ...(worker.runRoomOrigins ?? {}), [event.runId]: origin }
    }
    const textKey = `${sessionId}:${event.runId}`
    let terminalBody = event.message || worker.summary || '(无可见内容)'
    if (event.state === 'delta' && event.text && !event.thinking) {
      const nextText = (this.workerTextAcc.get(textKey) ?? '') + event.text
      this.workerTextAcc.set(textKey, nextText)
      const normalized = normalizeMarkdownForWorkerSummary(nextText)
      if (normalized) {
        patch.summary = normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized
      }
    }
    if (event.state === 'final' || event.state === 'error' || event.state === 'aborted') {
      patch.status = event.state
      const accumulated = normalizeMarkdownForWorkerSummary(this.workerTextAcc.get(textKey) ?? '')
      if (accumulated) {
        patch.summary = accumulated.length > 240 ? `${accumulated.slice(0, 240)}...` : accumulated
        terminalBody = event.state === 'final' ? accumulated : event.message || accumulated
      }
      this.workerTextAcc.delete(textKey)
      if (worker.runRoomOrigins?.[event.runId]) {
        const remaining = { ...worker.runRoomOrigins }
        delete remaining[event.runId]
        patch.runRoomOrigins = remaining
      }
    } else if (event.state === 'start') {
      patch.status = 'running'
    }
    const updated = this.registry.updateWorker(sessionId, patch)
    if (updated && (event.errorCode === 'auth_retrying' || (event.runPhase === 'waiting_approval' && this.registry.getManager(updated.managedBy)?.stewardSessionId))) {
      this.registry.enqueueInboxEvent({
        managerSessionId: updated.managedBy,
        workerSessionId: updated.sessionId,
        kind: event.runPhase === 'waiting_approval' ? 'worker.progress' : 'worker.health',
        priority: 'normal',
        runId: event.runId,
        roomOrigin: worker.runRoomOrigins?.[event.runId] ?? null,
        summary: event.message || (event.runPhase === 'waiting_approval' ? 'Worker 等待权限确认，请核对原授权并向用户说明。' : 'Worker authentication is retrying.'),
        ...(event.errorCode === 'auth_retrying' ? { code: 'auth_retrying' as const } : {}),
      })
      void this.drainManagerInbox(updated.managedBy)
    }
    if (updated && (event.state === 'final' || event.state === 'error' || event.state === 'aborted')) {
      this.enqueueWorkerEvent(
        updated.managedBy,
        updated,
        event.state,
        event.runId,
        terminalBody,
        worker.runRoomOrigins?.[event.runId] ?? null,
        event.errorCode === 'auth_required' || event.errorCode === 'acp_auth_required'
          ? 'auth_required'
          : undefined,
      )
    }
  }

  reportWorkerProgress(workerId: string, message: string): void {
    const worker = this.findWorker(workerId)
    const manager = worker && this.registry.getManager(worker.managedBy)
    const runId = this.opts.getRuntime().sessions.get(workerId)?.currentRunId
    if (!worker || !manager?.stewardSessionId || !runId || (manager.machineId !== loadConfig().machineId || manager.stewardAccountNamespaceId !== (loadConfig().accountNamespaceId ?? null)) || !isStewardSessionId(manager.stewardSessionId)) throw new Error('personal_worker_context_invalid')
    this.registry.enqueueInboxEvent({ managerSessionId: manager.sessionId, workerSessionId: workerId, kind: 'worker.progress', priority: 'normal', runId, summary: message })
    void this.drainManagerInbox(manager.sessionId)
  }

  private findWorker(sessionId: string) {
    const registry = this.registry.load()
    return registry.workers[sessionId]
  }

  async handleAppReq(req: ReqFrame): Promise<void> {
    appJson(this.opts.getRuntime(), req.id, false, { error: 'feature_retired' })
  }

  private async handleIpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${this.ipcToken}`) {
      json(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = await readJson(req)
      if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/external/') || url.pathname.startsWith('/wechat-rpa/')) {
        json(res, 410, { ok: false, error: 'feature_retired' })
        return
      }
      const workerHost = {
        registry: this.registry,
        getRuntime: this.opts.getRuntime,
        getAgentSnapshot: this.opts.getAgentSnapshot,
        dispatchReq: this.opts.dispatchReq,
        dispatchChatEnqueue: this.dispatchChatEnqueue.bind(this),
        appendManagerVisibleMarkdown: this.appendManagerVisibleMarkdown.bind(this),
        reportWorkerProgress: this.reportWorkerProgress.bind(this),
      }
      const workerResponse = await handleEphemeralWorkerIpcRoute(workerHost, url.pathname, body)
        ?? await handleWorkerIpcRoute(
          workerHost,
          url.pathname,
          body,
          String(req.headers['x-shennian-manager-session-id'] || ''),
        )
      if (workerResponse) {
        json(res, workerResponse.status, workerResponse.body)
        return
      }
      json(res, 404, { ok: false, error: `Unknown manager IPC path: ${url.pathname}` })
    } catch (err) {
      if (err instanceof EphemeralWorkerError) {
        json(res, err.status, {
          ok: false,
          error: err.code,
          message: err.message,
          nextAction: err.nextAction,
        })
        return
      }
      json(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  async executeScopedWorkerAction(
    managerSessionId: string,
    action: ManagedManagerAction,
    params: Record<string, JsonValue>,
    roomOrigin?: ManagedWorkerRoomOrigin,
  ): Promise<JsonValue> {
    const paths: Record<ManagedManagerAction, string> = {
      'manager.sessions.list': '/sessions/list',
      'manager.sessions.start': '/sessions/start',
      'manager.sessions.send': '/sessions/send',
      'manager.sessions.queue': '/sessions/queue',
      'manager.sessions.queue.edit': '/sessions/queue/edit',
      'manager.sessions.queue.delete': '/sessions/queue/delete',
      'manager.sessions.stop': '/sessions/stop',
      'manager.sessions.read': '/sessions/read',
      'manager.memory.path': '/memory/path',
    }
    const response = await handleWorkerIpcRoute({
      registry: this.registry,
      getRuntime: this.opts.getRuntime,
      getAgentSnapshot: this.opts.getAgentSnapshot,
      dispatchReq: this.opts.dispatchReq,
      dispatchChatEnqueue: this.dispatchChatEnqueue.bind(this),
      appendManagerVisibleMarkdown: this.appendManagerVisibleMarkdown.bind(this),
    }, paths[action], params, managerSessionId, { roomOrigin })
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error(String(response?.body.error || 'Managed Manager action failed'))
    }
    return JSON.parse(JSON.stringify(response.body)) as JsonValue
  }

  private async dispatchChatEnqueue(
    sessionId: string,
    agentType: AgentType,
    workDir: string,
    text: string,
    agentSessionId: string | null,
    modelId?: string,
    managedWorkerParentSessionId?: string,
    roomOrigin?: ManagedWorkerRoomOrigin,
  ): Promise<void> {
    const result = await this.opts.dispatchReq(markTrustedManagerEvent({
      type: 'req',
      id: `manager-enqueue-${randomUUID()}`,
      method: 'chat.enqueue',
      params: {
        ...getPersonalSyncIdentity(),
        sessionId, text, agentType, workDir, agentSessionId, modelId, managedWorkerParentSessionId,
        managerWorkerRoomOrigin: roomOrigin,
      },
    }))
    if (result?.durableQueueHandoff === false) {
      throw new Error('manager_worker_queue_handoff_unconfirmed')
    }
  }

  private appendManagerVisibleMarkdown(managerSessionId: string, markdown: string, id: string): void {
    if (this.registry.getManager(managerSessionId)?.controllerKind !== 'managed_session') return
    appendMessage(managerSessionId, {
      id,
      sessionId: managerSessionId,
      role: 'agent',
      ts: Date.now(),
      payload: markdown,
    }, 'committed')
    requestSessionIndexPublish(this.opts.getRuntime().client)
  }

  private enqueueWorkerEvent(
    managerSessionId: string,
    worker: { sessionId: string; summary?: string | null },
    state: 'final' | 'error' | 'aborted',
    runId?: string,
    message?: string,
    roomOrigin?: ManagedWorkerRoomOrigin | null,
    code?: 'auth_required',
  ): void {
    const event = this.registry.enqueueInboxEvent({
      managerSessionId,
      workerSessionId: worker.sessionId,
      kind: state === 'final' ? 'worker.final' : state === 'error' ? 'worker.error' : 'worker.aborted',
      priority: 'normal',
      runId: runId ?? null,
      roomOrigin: roomOrigin ?? null,
      summary: message || worker.summary || '(无可见摘要)',
      ...(code ? { code } : {}),
    })
    const manager = this.registry.getManager(managerSessionId)
    if (event && (manager?.controllerKind === 'managed_session' || manager?.stewardSessionId)) void this.drainManagerInbox(managerSessionId)
  }

  private scanWorkerHealth(): void {
    const now = Date.now()
    const registry = this.registry.load()
    const runtime = this.opts.getRuntime()
    for (const manager of Object.values(registry.managers)) {
      if (manager.stewardSessionId && this.registry.listInboxEvents(manager.sessionId).length) void this.drainManagerInbox(manager.sessionId)
    }
    for (const worker of Object.values(registry.workers)) {
      if (worker.status !== 'running') continue
      const ageMs = now - Date.parse(worker.createdAt)
      if (ageMs < 10 * 60_000) continue
      const inactiveMs = now - Date.parse(worker.lastActivityAt)
      const activeRunId = runtime.sessions.get(worker.sessionId)?.currentRunId
      const hasPendingQueue = Boolean(runtime.chatQueue?.getSnapshot(worker.sessionId).pending.length)
      if (!activeRunId) {
        // Old daemons could leave a registry-only `running` record after the
        // Provider run, queue, and recovery journal were already gone. Such a
        // record is not execution evidence and must not emit health forever.
        // Keep a ten-minute grace period for a newly queued or recovering turn.
        if (!hasPendingQueue && inactiveMs >= 10 * 60_000) {
          const summary = '未找到活动中的 Provider Run 或待处理消息；已将遗留的运行状态收敛为失败。原 Worker 会话仍保留，可继续发送新消息。'
          const updated = this.registry.updateWorker(worker.sessionId, {
            status: 'error',
            lastActivityAt: new Date(now).toISOString(),
            summary,
          })
          if (updated) this.enqueueWorkerEvent(updated.managedBy, updated, 'error', worker.runId ?? undefined, summary)
        }
        continue
      }
      // Personal delegation is event-driven, never wake the model every ten minutes.
      if (registry.managers[worker.managedBy]?.stewardSessionId) continue
      const lastHealthMs = worker.healthNotifiedAt ? Date.parse(worker.healthNotifiedAt) : 0
      if (lastHealthMs && now - lastHealthMs < 10 * 60_000) continue
      const manager = registry.managers[worker.managedBy]
      if (!manager) continue
      const inactiveMinutes = Math.max(0, Math.floor(inactiveMs / 60_000))
      const liveText = normalizeMarkdownForWorkerSummary(
        worker.runId ? this.workerTextAcc.get(`${worker.sessionId}:${worker.runId}`) ?? '' : '',
      )
      const prompt = `已运行 ${Math.floor(ageMs / 60_000)} 分钟，尚未结束。

当前可见进展：
- 最近文本：${liveText || worker.summary || '(无可见内容)'}
- 最近活动时间：${worker.lastActivityAt}
- 最近 ${inactiveMinutes} 分钟没有新活动。`
      this.registry.updateWorker(worker.sessionId, {
        healthNotifiedAt: new Date(now).toISOString(),
        lastHealthSummary: prompt,
      })
      const event = this.registry.enqueueInboxEvent({
        managerSessionId: manager.sessionId,
        workerSessionId: worker.sessionId,
        kind: 'worker.health',
        priority: 'normal',
        runId: worker.runId ?? null,
        roomOrigin: worker.runRoomOrigins?.[worker.runId ?? ''] ?? null,
        summary: prompt,
      })
      if (event && manager.controllerKind === 'managed_session') void this.drainManagerInbox(manager.sessionId)
    }
  }

  private async interruptAndResumeManager(
    manager: ManagerRecord,
    prompt: string,
    clientMessageId?: string,
    roomOrigin?: ManagedWorkerRoomOrigin | null,
  ): Promise<void> {
    const runtime = this.opts.getRuntime()
    const active = runtime.sessions.get(manager.sessionId)
    if (active?.currentRunId) {
      await this.opts.dispatchReq({
        type: 'req',
        id: `manager-interrupt-${randomUUID()}`,
        method: 'chat.abort',
        params: { ...getPersonalSyncIdentity(), sessionId: manager.sessionId },
      })
    }
    await this.dispatchManagerContinuation(manager, prompt, false, clientMessageId, roomOrigin)
  }

  bindManagerAdapterEvents(sessionId: string, adapter: AgentAdapter): void {
    adapter.on('agentEvent', (event) => {
      if (event.state === 'start' && event.agentSessionId) {
        const manager = this.registry.getManager(sessionId)
        if (manager) this.noteManagerAgentSession(sessionId, event.agentSessionId, manager.workDir, manager.modelId)
      }
      if (event.state === 'start') {
        this.acknowledgeManagerInboxDelivery(sessionId)
        this.updateManagerStatus(sessionId, 'running')
      }
      if (event.state === 'final' || event.state === 'error' || event.state === 'aborted') {
        this.updateManagerStatus(sessionId, 'idle')
        queueMicrotask(() => void this.drainManagerInbox(sessionId))
      }
    })
  }

  updateManagerStatus(sessionId: string, status: 'idle' | 'running' | 'interrupting'): void {
    const manager = this.registry.getManager(sessionId)
    if (!manager) return
    this.registry.upsertManager({ ...manager, status })
  }

  private async drainManagerInbox(managerSessionId: string): Promise<void> {
    const manager = this.registry.getManager(managerSessionId)
    if (!manager || (manager.controllerKind === 'ephemeral' && !manager.stewardSessionId)) return
    if (manager.stewardSessionId && (!isStewardSessionId(manager.stewardSessionId) || (manager.machineId !== loadConfig().machineId || manager.stewardAccountNamespaceId !== (loadConfig().accountNamespaceId ?? null)))) return
    // A high-priority abort emits a terminal event before its replacement turn
    // starts. Do not let that event's queued drain dispatch the same durable
    // batch a second time while the first delivery is still in flight.
    if (manager.deliveringInboxEventIds?.length) return
    const events = this.registry.listInboxEvents(managerSessionId)
    if (!events.length) return
    if (manager.notificationMode === 'direct' && manager.stewardSessionId) {
      try { deliverDirectWorkerEvents(this.opts.getRuntime(), this.registry, manager, events) }
      catch { /* Keep the durable inbox for the existing deterministic delivery retry. */ }
      return
    }
    const highPriority = manager.stewardSessionId ? undefined : events.find((event) => event.priority === 'high')
    const active = this.opts.getRuntime().sessions.get(manager.stewardSessionId ?? managerSessionId)
    if (manager.status !== 'idle' && !highPriority) return
    if (active?.currentRunId && !highPriority) return
    // A continuation may receive authority for exactly one originating Room.
    // Never batch events from different Rooms (or private Workers) into a turn.
    const first = highPriority ?? events[0]!
    const origin = first.roomOrigin ?? null
    const originKey = JSON.stringify(origin)
    const selected = manager.stewardSessionId
      ? [first]
      : highPriority
      ? [highPriority]
      : events.filter((event) => JSON.stringify(event.roomOrigin ?? null) === originKey).slice(0, 20)
    const prompt = selected.map((event) => {
      const worker = this.registry.getWorkerForManager(managerSessionId, event.workerSessionId)
      return formatWorkerMarkdown({
        kind: managerInboxKind(event.kind),
        sessionId: event.workerSessionId,
        title: worker?.title || deriveWorkerTitle(worker?.userGoal || worker?.summary || event.summary),
        body: event.summary,
      })
    }).join('\n\n---\n\n')
    const clientMessageId = managerInboxClientMessageId(managerSessionId, selected)
    try {
      if (highPriority && active?.currentRunId) {
        this.registry.upsertManager({
          ...manager,
          status: 'interrupting',
          deliveringInboxEventIds: selected.map((event) => event.id),
        })
        await this.interruptAndResumeManager(
          manager,
          prompt,
          clientMessageId,
          origin,
        )
      } else {
        this.registry.upsertManager({
          ...manager,
          status: 'running',
          deliveringInboxEventIds: selected.map((event) => event.id),
        })
        await this.dispatchManagerContinuation(manager, prompt, true, clientMessageId, origin)
      }
      // The unified queue owns delivery after chat.enqueue has durably
      // committed the stable manager-event message. Inbox is only the event
      // reducer; keeping a second copy until Provider start would create two
      // competing delivery state machines.
      this.registry.removeInboxEvents(managerSessionId, selected.map((event) => event.id))
      const latest = this.registry.getManager(managerSessionId)
      if (latest) {
        this.registry.upsertManager({
          ...latest,
          deliveringInboxEventIds: [],
          ...(latest.stewardSessionId ? { status: 'idle' as const } : {}),
        })
      }
    } catch (error) {
      const latest = this.registry.getManager(managerSessionId)
      if (latest) {
        this.registry.upsertManager({ ...latest, status: 'idle', deliveringInboxEventIds: [] })
      }
      console.error(`[manager-inbox] delivery failed sessionId=${managerSessionId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private acknowledgeManagerInboxDelivery(managerSessionId: string): void {
    const manager = this.registry.getManager(managerSessionId)
    const eventIds = manager?.deliveringInboxEventIds ?? []
    if (!manager || eventIds.length === 0) return
    this.registry.removeInboxEvents(managerSessionId, eventIds)
    this.registry.upsertManager({ ...manager, deliveringInboxEventIds: [] })
  }

  /** A process-local `running` flag is not evidence after daemon restart. Keep
   * unacknowledged inbox events and make them eligible for redelivery. */
  private recoverPersistedInboxDeliveries(): void {
    const registry = this.registry.load()
    const runtime = this.opts.getRuntime()
    for (const manager of Object.values(registry.managers)) {
      const active = runtime.sessions.get(manager.sessionId)
      if (active?.currentRunId) continue
      if (manager.status !== 'idle' || manager.deliveringInboxEventIds?.length) {
        this.registry.upsertManager({
          ...manager,
          status: 'idle',
          deliveringInboxEventIds: [],
        })
      }
      // Heal a crash between saving a terminal Worker and committing its inbox
      // event. Deterministic event IDs let the durable queue reject old receipts.
      if (manager.stewardSessionId) {
        for (const worker of this.registry.listWorkers(manager.sessionId)) {
          if (!worker.runId || !['final', 'error', 'aborted'].includes(worker.status)) continue
          const kind = `worker.${worker.status}` as 'worker.final' | 'worker.error' | 'worker.aborted'
          if (this.registry.listInboxEvents(manager.sessionId).some(event => event.workerSessionId === worker.sessionId && event.kind === kind && event.runId === worker.runId)) continue
          this.registry.enqueueInboxEvent({ managerSessionId: manager.sessionId, workerSessionId: worker.sessionId, kind, priority: 'normal', runId: worker.runId, summary: worker.summary || '后台任务已终结，请读取原 Worker 核查结果。' })
        }
      }
      // Health is transient evidence about an active Provider run. After a
      // daemon restart it must not be replayed when that run is not active;
      // recovery can generate a fresh health event later if the run resumes.
      const staleHealthEventIds = this.registry.listInboxEvents(manager.sessionId)
        .filter((event) => event.kind === 'worker.health'
          && !runtime.sessions.get(event.workerSessionId)?.currentRunId)
        .map((event) => event.id)
      this.registry.removeInboxEvents(manager.sessionId, staleHealthEventIds)
      if (this.registry.listInboxEvents(manager.sessionId).length > 0) {
        queueMicrotask(() => void this.drainManagerInbox(manager.sessionId))
      }
    }
  }

  private async dispatchManagerContinuation(
    manager: ManagerRecord,
    text: string,
    enqueue = false,
    clientMessageId?: string,
    roomOrigin?: ManagedWorkerRoomOrigin | null,
  ): Promise<void> {
    if (manager.stewardSessionId) {
      const target = listSessionRecords().find(record => record.sessionId === manager.stewardSessionId && record.sessionScope === 'steward')
      if (!target || (manager.machineId !== loadConfig().machineId || manager.stewardAccountNamespaceId !== (loadConfig().accountNamespaceId ?? null))) throw new Error('personal_worker_context_invalid')
      const result = await this.opts.dispatchReq(markTrustedManagerEvent({ type: 'req', id: `steward-worker-${randomUUID()}`, method: 'chat.enqueue', params: {
        ...getPersonalSyncIdentity(), sessionId: target.sessionId, sessionScope: 'steward', sessionMode: 'standard',
        agentType: target.agentType, agentSessionId: target.agentSessionId, workDir: target.workDir,
        text: `后台 Worker 事件（不是用户的新授权；先核对结果与原目标，再用 shennian steward say 向用户汇报；未验收不要称完成，不要盲目重试）：\n${text}`,
        clientMessageId, managerEventId: clientMessageId,
      } }))
      if (result?.durableQueueHandoff === false) throw new Error('personal_worker_queue_handoff_unconfirmed')
      return
    }
    const agentType = manager.agentType ?? 'manager'
    const modelId = agentType === 'manager' ? manager.modelId : manager.providerModelId ?? undefined
    const params = {
      ...getPersonalSyncIdentity(),
      sessionId: manager.sessionId,
      text,
      agentType,
      sessionMode: 'manager' as const,
      workDir: manager.workDir,
      agentSessionId: manager.agentSessionId,
      modelId,
      managerDefaultWorkerAgentType: manager.defaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId: manager.defaultWorkerModelId ?? null,
      // A managed Room inbox wake is a new managed-Agent turn, not a personal
      // message. Re-resolve the current local binding and issue a fresh
      // per-turn capability instead of reusing the revoked prior token.
      ...(manager.managedRoomBound ? { managedAgentDirect: true } : {}),
      clientMessageId,
      managerEventId: clientMessageId,
      ...(roomOrigin ? { managerEventRoomOrigin: roomOrigin } : {}),
    }
    const result = await this.opts.dispatchReq(markTrustedManagerEvent({
      type: 'req',
      id: `manager-${enqueue ? 'enqueue' : 'send'}-${randomUUID()}`,
      // All Manager continuations cross the same durable queue boundary. The
      // flag is retained for call-site compatibility during the migration.
      method: 'chat.enqueue',
      params,
    }))
    if (result?.durableQueueHandoff === false) {
      throw new Error('manager_event_queue_handoff_unconfirmed')
    }
  }

  getExternalChannelStatus(managerSessionId: string): ExternalChannelSessionStatus | null {
    return this.channelRuntime.getManagerChannelStatus(managerSessionId)
  }

  getManagerExternalChannelSystemPrompt(managerSessionId: string): string {
    return this.channelRuntime
      .listManagerExternalChannels(managerSessionId)
      .map((channel) => buildExternalChannelInstructions(channel, undefined, managerSessionId, 'manager'))
      .join('\n\n')
      .trim()
  }
}
