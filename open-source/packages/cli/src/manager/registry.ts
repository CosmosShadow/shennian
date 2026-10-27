// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isAgentHiddenPayload, sessionPreviewFromPayload, type AgentType, type Envelope } from '@shennian/wire'
import { resolveShennianPath } from '../config/index.js'
import { readMessages } from '../session/store.js'

export type ManagerStatus = 'idle' | 'running' | 'interrupting'
export type WorkerStatus = 'running' | 'idle' | 'final' | 'error' | 'aborted'

export type ManagedWorkerRecord = {
  sessionId: string
  agentType: AgentType
  workDir: string
  managedBy: string
  status: WorkerStatus
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  title?: string | null
  userGoal?: string | null
  lastMessagePreview?: string | null
  summary?: string | null
  agentSessionId?: string | null
  runId?: string | null
  canResume?: boolean
  source?: 'manager_registry' | 'local_index' | 'app_projection'
  healthNotifiedAt?: string | null
  lastHealthSummary?: string | null
  role?: 'managed_worker' | 'project_session'
  /** Origins indexed by Provider run id; legacy records omit this and stay private. */
  runRoomOrigins?: Record<string, ManagedWorkerRoomOrigin>
}

export type ManagedWorkerRoomOrigin = {
  registryKey: string
  registrationEpoch: number
  bindingId: string
  roomId: string
}

export type ManagerRecord = {
  sessionId: string
  agentSessionId: string | null
  workDir: string
  machineId?: string | null
  modelId: AgentType
  /** Real provider for new Manager-mode sessions; legacy sessions use manager. */
  agentType?: AgentType
  /** Real provider model for new Manager-mode sessions. */
  providerModelId?: string | null
  defaultWorkerAgentType?: AgentType | null
  defaultWorkerModelId?: string | null
  /** This Manager Session originated from a managed Room and every synthetic
   * continuation must reacquire that Room's current trusted context. */
  managedRoomBound?: boolean
  /** Owner personal conversation receiving this external controller's events. */
  stewardSessionId?: string
  stewardAccountNamespaceId?: string | null
  notificationMode?: 'direct'
  scheduleId?: string
  requestFingerprint?: string
  controllerKind?: 'managed_session' | 'ephemeral'
  status: ManagerStatus
  /** Event ids currently being transferred. Queue durable ACK ends inbox
   * ownership; Provider start is intentionally not a second acknowledgement. */
  deliveringInboxEventIds?: string[]
  managedWorkerSessionIds: string[]
  attachedExternalChannels: string[]
  createdAt: string
  updatedAt: string
}

export type EphemeralWorkerAction = 'read' | 'send' | 'wait' | 'stop'

export type EphemeralWorkerGrant = {
  refDigest: string
  managerSessionId: string
  workerSessionId: string
  workDir: string
  machineId: string
  accountNamespaceId: string | null
  actions: EphemeralWorkerAction[]
  createdAt: string
  expiresAt: string
  revokedAt?: string | null
}

export type WorkerRefResolution =
  | { ok: true; grant: EphemeralWorkerGrant }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' }

export type ManagerInboxEvent = {
  id: string
  managerSessionId: string
  workerSessionId: string
  kind: 'worker.final' | 'worker.error' | 'worker.aborted' | 'worker.health' | 'worker.progress'
  priority: 'normal' | 'high'
  runId?: string | null
  roomOrigin?: ManagedWorkerRoomOrigin | null
  summary: string
  code?: 'auth_required' | 'auth_retrying'
  createdAt: string
  updatedAt: string
}

export type ManagerVisibleSessionRecord = Omit<ManagedWorkerRecord, 'managedBy'> & {
  managedBy: string | null
}

export type ReplyTargetRecord = {
  replyTarget: string
  managerSessionId: string
  channelId: string
  conversationId: string
  messageId?: string | null
  createdAt: string
}

type RegistryFile = {
  managers: Record<string, ManagerRecord>
  workers: Record<string, ManagedWorkerRecord>
  replyTargets: Record<string, ReplyTargetRecord>
  inbox: Record<string, ManagerInboxEvent[]>
  workerGrants: Record<string, EphemeralWorkerGrant>
}

const REGISTRY_PATH = resolveShennianPath('manager-registry.json')

function nowIso(): string {
  return new Date().toISOString()
}

function emptyRegistry(): RegistryFile {
  return { managers: {}, workers: {}, replyTargets: {}, inbox: {}, workerGrants: {} }
}

function workerRefDigest(workerRef: string): string {
  return createHash('sha256').update(workerRef).digest('hex')
}

function chmodIfPresent(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

export class ManagerRegistry {
  load(): RegistryFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as RegistryFile
      return {
        managers: parsed.managers ?? {},
        workers: parsed.workers ?? {},
        replyTargets: parsed.replyTargets ?? {},
        inbox: parsed.inbox ?? {},
        workerGrants: parsed.workerGrants ?? {},
      }
    } catch {
      return emptyRegistry()
    }
  }

  save(registry: RegistryFile): void {
    const directory = path.dirname(REGISTRY_PATH)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
        if (process.platform !== 'win32') chmodIfPresent(directory, 0o700)
        const temporary = `${REGISTRY_PATH}.${randomUUID()}.tmp`
        try {
          fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600, flag: 'wx' })
          fs.renameSync(temporary, REGISTRY_PATH)
        } finally { try { fs.unlinkSync(temporary) } catch { /* already renamed */ } }
        if (process.platform !== 'win32') chmodIfPresent(REGISTRY_PATH, 0o600)
        return
      } catch (error) {
        const retryable = error instanceof Error && 'code' in error && error.code === 'ENOENT'
        if (!retryable || attempt === 2) throw error
      }
    }
  }

  upsertManager(input: {
    sessionId: string
    agentSessionId?: string | null
    workDir: string
    machineId?: string | null
    modelId: AgentType
    agentType?: AgentType
    providerModelId?: string | null
    defaultWorkerAgentType?: AgentType | null
    defaultWorkerModelId?: string | null
    managedRoomBound?: boolean
    /** Owner personal conversation receiving this external controller's events. */
    stewardSessionId?: string
    stewardAccountNamespaceId?: string | null
    notificationMode?: 'direct'
    scheduleId?: string
    requestFingerprint?: string
    controllerKind?: 'managed_session' | 'ephemeral'
    status?: ManagerStatus
    deliveringInboxEventIds?: string[]
  }): ManagerRecord {
    const registry = this.load()
    const existing = registry.managers[input.sessionId]
    const timestamp = nowIso()
    const record: ManagerRecord = {
      sessionId: input.sessionId,
      agentSessionId: input.agentSessionId ?? existing?.agentSessionId ?? null,
      workDir: input.workDir,
      machineId: input.machineId ?? existing?.machineId ?? null,
      modelId: input.modelId,
      agentType: input.agentType ?? existing?.agentType ?? 'manager',
      providerModelId: input.providerModelId ?? existing?.providerModelId ?? null,
      defaultWorkerAgentType: input.defaultWorkerAgentType ?? existing?.defaultWorkerAgentType ?? null,
      defaultWorkerModelId: input.defaultWorkerModelId ?? existing?.defaultWorkerModelId ?? null,
      managedRoomBound: input.managedRoomBound ?? existing?.managedRoomBound ?? false,
      stewardSessionId: input.stewardSessionId ?? existing?.stewardSessionId,
      stewardAccountNamespaceId: input.stewardAccountNamespaceId ?? existing?.stewardAccountNamespaceId ?? null,
      notificationMode: input.notificationMode ?? existing?.notificationMode,
      scheduleId: input.scheduleId ?? existing?.scheduleId,
      requestFingerprint: input.requestFingerprint ?? existing?.requestFingerprint,
      controllerKind: input.controllerKind ?? existing?.controllerKind ?? 'managed_session',
      status: input.status ?? existing?.status ?? 'idle',
      deliveringInboxEventIds:
        input.deliveringInboxEventIds ?? existing?.deliveringInboxEventIds ?? [],
      managedWorkerSessionIds: existing?.managedWorkerSessionIds ?? [],
      attachedExternalChannels: existing?.attachedExternalChannels ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    registry.managers[input.sessionId] = record
    this.save(registry)
    return record
  }

  getManager(sessionId: string): ManagerRecord | undefined {
    return this.load().managers[sessionId]
  }

  issueWorkerRef(input: {
    managerSessionId: string
    workerSessionId: string
    workDir: string
    machineId: string
    accountNamespaceId?: string | null
    actions?: EphemeralWorkerAction[]
    ttlMs?: number
  }): { workerRef: string; grant: EphemeralWorkerGrant } {
    const registry = this.load()
    const manager = registry.managers[input.managerSessionId]
    const worker = registry.workers[input.workerSessionId]
    if (!manager || manager.controllerKind !== 'ephemeral') {
      throw new Error('ephemeral_controller_required')
    }
    if (!worker || worker.managedBy !== manager.sessionId || worker.workDir !== input.workDir) {
      throw new Error('worker_scope_mismatch')
    }
    const workerRef = `wr_${randomBytes(32).toString('base64url')}`
    const refDigest = workerRefDigest(workerRef)
    const createdAt = nowIso()
    const grant: EphemeralWorkerGrant = {
      refDigest,
      managerSessionId: manager.sessionId,
      workerSessionId: worker.sessionId,
      workDir: input.workDir,
      machineId: input.machineId,
      accountNamespaceId: input.accountNamespaceId ?? null,
      actions: input.actions ?? ['read', 'send', 'wait', 'stop'],
      createdAt,
      expiresAt: new Date(Date.now() + (input.ttlMs ?? 30 * 24 * 60 * 60_000)).toISOString(),
      revokedAt: null,
    }
    registry.workerGrants[refDigest] = grant
    this.save(registry)
    return { workerRef, grant }
  }

  resolveWorkerRef(input: {
    workerRef: string
    action: EphemeralWorkerAction
    machineId: string
    accountNamespaceId?: string | null
  }): EphemeralWorkerGrant | undefined {
    const resolution = this.resolveWorkerRefDetailed(input)
    return resolution.ok ? resolution.grant : undefined
  }

  resolveWorkerRefDetailed(input: {
    workerRef: string
    action: EphemeralWorkerAction
    machineId: string
    accountNamespaceId?: string | null
  }): WorkerRefResolution {
    if (!/^wr_[A-Za-z0-9_-]{40,}$/.test(input.workerRef)) return { ok: false, reason: 'invalid' }
    const registry = this.load()
    const grant = registry.workerGrants[workerRefDigest(input.workerRef)]
    if (!grant) return { ok: false, reason: 'invalid' }
    if (grant.revokedAt) return { ok: false, reason: 'revoked' }
    if (Date.parse(grant.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' }
    if (grant.machineId !== input.machineId) return { ok: false, reason: 'invalid' }
    if (grant.accountNamespaceId !== (input.accountNamespaceId ?? null)) return { ok: false, reason: 'invalid' }
    if (!grant.actions.includes(input.action)) return { ok: false, reason: 'invalid' }
    const manager = registry.managers[grant.managerSessionId]
    const worker = registry.workers[grant.workerSessionId]
    if (!manager || manager.controllerKind !== 'ephemeral') return { ok: false, reason: 'revoked' }
    if (!worker || worker.managedBy !== manager.sessionId || worker.workDir !== grant.workDir) {
      return { ok: false, reason: 'revoked' }
    }
    return { ok: true, grant }
  }

  revokeWorkerRefsForWorker(workerSessionId: string): void {
    const registry = this.load()
    const revokedAt = nowIso()
    let changed = false
    for (const grant of Object.values(registry.workerGrants)) {
      if (grant.workerSessionId !== workerSessionId || grant.revokedAt) continue
      grant.revokedAt = revokedAt
      changed = true
    }
    if (changed) this.save(registry)
  }

  enqueueInboxEvent(input: Omit<ManagerInboxEvent, 'id' | 'createdAt' | 'updatedAt'>): ManagerInboxEvent | null {
    const registry = this.load()
    const manager = registry.managers[input.managerSessionId]
    const worker = registry.workers[input.workerSessionId]
    if (!manager || !worker) return null
    if (worker.managedBy !== manager.sessionId || worker.workDir !== manager.workDir) return null

    const timestamp = nowIso()
    const events = registry.inbox[input.managerSessionId] ?? []
    const dedupeIndex = events.findIndex((event) =>
      !manager.deliveringInboxEventIds?.includes(event.id) && event.workerSessionId === input.workerSessionId && (
        input.kind === 'worker.health' || input.kind === 'worker.progress'
          ? event.kind === input.kind
          : event.kind === input.kind && event.runId === input.runId
      ),
    )
    const event: ManagerInboxEvent = dedupeIndex >= 0
      ? {
          ...events[dedupeIndex],
          ...input,
          updatedAt: timestamp,
        }
      : {
          ...input,
          id: input.kind !== 'worker.health' && input.kind !== 'worker.progress' && input.runId
            ? `mie_${createHash('sha256').update(JSON.stringify([input.managerSessionId, input.workerSessionId, input.kind, input.runId])).digest('hex')}`
            : `mie_${randomUUID()}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
    if (dedupeIndex >= 0) events[dedupeIndex] = event
    else events.push(event)
    registry.inbox[input.managerSessionId] = events
    this.save(registry)
    return event
  }

  listInboxEvents(managerSessionId: string): ManagerInboxEvent[] {
    return [...(this.load().inbox[managerSessionId] ?? [])]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  removeInboxEvents(managerSessionId: string, eventIds: readonly string[]): void {
    if (!eventIds.length) return
    const registry = this.load()
    const ids = new Set(eventIds)
    registry.inbox[managerSessionId] = (registry.inbox[managerSessionId] ?? [])
      .filter((event) => !ids.has(event.id))
    this.save(registry)
  }

  addWorker(input: {
    managerSessionId: string
    sessionId?: string
    agentType: AgentType
    workDir: string
    title?: string | null
    userGoal?: string | null
    summary?: string | null
  }): ManagedWorkerRecord {
    const registry = this.load()
    const manager = registry.managers[input.managerSessionId]
    if (!manager) throw new Error('Manager runtime is not registered')
    const sessionId = input.sessionId ?? `sess_worker_${randomUUID()}`
    const timestamp = nowIso()
    const record: ManagedWorkerRecord = {
      sessionId,
      agentType: input.agentType,
      workDir: input.workDir,
      managedBy: input.managerSessionId,
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      title: input.title ?? null,
      userGoal: input.userGoal ?? null,
      summary: input.summary ?? null,
      agentSessionId: null,
      runId: null,
    }
    registry.workers[sessionId] = record
    if (!manager.managedWorkerSessionIds.includes(sessionId)) {
      manager.managedWorkerSessionIds.push(sessionId)
    }
    manager.updatedAt = timestamp
    this.save(registry)
    return record
  }

  updateWorker(sessionId: string, patch: Partial<ManagedWorkerRecord>): ManagedWorkerRecord | undefined {
    const registry = this.load()
    const existing = registry.workers[sessionId]
    if (!existing) return undefined
    const record = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    }
    registry.workers[sessionId] = record
    this.save(registry)
    return record
  }

  clearWorkerRunOrigins(): void {
    const registry = this.load()
    let changed = false
    for (const worker of Object.values(registry.workers)) {
      if (!worker.runRoomOrigins) continue
      delete worker.runRoomOrigins
      changed = true
    }
    for (const events of Object.values(registry.inbox)) {
      for (const event of events) {
        if (!event.roomOrigin) continue
        delete event.roomOrigin
        changed = true
      }
    }
    if (changed) this.save(registry)
  }

  listWorkers(managerSessionId: string, opts: {
    includeManagers?: boolean
    runningSessionIds?: Set<string>
  } = {}): ManagerVisibleSessionRecord[] {
    const registry = this.load()
    const manager = registry.managers[managerSessionId]
    if (!manager) return []
    return Object.values(registry.workers)
      .filter((worker) => worker.managedBy === manager.sessionId)
      .filter((worker) => worker.workDir === manager.workDir)
      .filter((worker) => opts.includeManagers || worker.agentType !== 'manager')
      .map((worker) => this.decorateManagedWorker(worker, opts.runningSessionIds))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  }

  getWorkerForManager(managerSessionId: string, sessionId: string): ManagerVisibleSessionRecord | undefined {
    const registry = this.load()
    const manager = registry.managers[managerSessionId]
    const worker = registry.workers[sessionId]
    if (!manager) return undefined
    if (worker) {
      if (worker.managedBy !== manager.sessionId) return undefined
      if (worker.workDir !== manager.workDir) return undefined
      if (worker.agentType === 'manager') return undefined
      return this.decorateManagedWorker(worker)
    }
    return undefined
  }

  retireManager(managerSessionId: string): ManagedWorkerRecord[] {
    const registry = this.load()
    const workers = Object.values(registry.workers)
      .filter((worker) => worker.managedBy === managerSessionId)
    const revokedAt = nowIso()
    for (const grant of Object.values(registry.workerGrants)) {
      if (grant.managerSessionId === managerSessionId && !grant.revokedAt) grant.revokedAt = revokedAt
    }
    // Keep owned Worker records as durable retirement work until each Provider
    // has actually stopped. Removing the Manager first makes late events fail
    // closed, while a repeated restart can still find and stop failed Workers.
    delete registry.managers[managerSessionId]
    delete registry.inbox[managerSessionId]
    for (const [replyTarget, record] of Object.entries(registry.replyTargets)) {
      if (record.managerSessionId === managerSessionId) delete registry.replyTargets[replyTarget]
    }
    this.save(registry)
    return workers
  }

  completeRetiredWorker(managerSessionId: string, workerSessionId: string): void {
    const registry = this.load()
    const worker = registry.workers[workerSessionId]
    if (!worker || worker.managedBy !== managerSessionId) return
    const revokedAt = nowIso()
    for (const grant of Object.values(registry.workerGrants)) {
      if (grant.workerSessionId === workerSessionId && !grant.revokedAt) grant.revokedAt = revokedAt
    }
    delete registry.workers[workerSessionId]
    this.save(registry)
  }

  private decorateManagedWorker(worker: ManagedWorkerRecord, runningSessionIds?: Set<string>): ManagerVisibleSessionRecord {
    const status = runningSessionIds?.has(worker.sessionId) ? 'running' : worker.status
    const transcript = this.readTranscriptSummary(worker.sessionId, worker.summary ?? null)
    const lastMessagePreview = transcript.lastMessagePreview ?? worker.lastMessagePreview ?? worker.summary ?? null
    const userGoal = worker.userGoal ?? transcript.userGoal ?? null
    return {
      ...worker,
      managedBy: worker.managedBy ?? null,
      status,
      title: worker.title ?? userGoal ?? lastMessagePreview ?? worker.summary ?? worker.sessionId,
      userGoal,
      lastMessagePreview,
      summary: worker.summary ?? lastMessagePreview,
      canResume: worker.canResume ?? worker.status !== 'aborted',
      source: worker.source ?? 'manager_registry',
      role: 'managed_worker',
    }
  }

  private readTranscriptSummary(sessionId: string, fallbackPreview: string | null): {
    userGoal: string | null
    lastMessagePreview: string | null
  } {
    const messages = readMessages(sessionId, { limit: 200 })
    if (!messages.length) return { userGoal: null, lastMessagePreview: fallbackPreview }

    const chronological = [...messages].sort((a, b) => a.ts - b.ts)
    const firstUser = chronological.find((message) => message.role === 'user')
    const lastReadable = [...chronological].reverse().find((message) => readableText(message))
    return {
      userGoal: firstUser ? clip(readableText(firstUser), 160) : null,
      lastMessagePreview: clip(readableText(lastReadable), 180) ?? fallbackPreview,
    }
  }

  createReplyTarget(input: {
    managerSessionId: string
    channelId: string
    conversationId: string
    messageId?: string | null
  }): ReplyTargetRecord {
    const registry = this.load()
    const record: ReplyTargetRecord = {
      replyTarget: `rt_${randomUUID()}`,
      managerSessionId: input.managerSessionId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      messageId: input.messageId ?? null,
      createdAt: nowIso(),
    }
    registry.replyTargets[record.replyTarget] = record
    this.save(registry)
    return record
  }

  getReplyTarget(replyTarget: string): ReplyTargetRecord | undefined {
    return this.load().replyTargets[replyTarget]
  }

  getLatestReplyTargetForManager(managerSessionId: string): ReplyTargetRecord | undefined {
    return Object.values(this.load().replyTargets)
      .filter((target) => target.managerSessionId === managerSessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  }
}

function readableText(message: Envelope | undefined): string | null {
  if (!message || isAgentHiddenPayload(message.payload)) return null
  return sessionPreviewFromPayload(message.payload, 180)
}

function clip(text: string | null, max: number): string | null {
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}...` : text
}
