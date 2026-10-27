// @arch docs/features/desktop-local-first-client.md#54-同步与服务器压力
// @test ../../__tests__/desktop-account-runtime.test.ts

import type {
  EventFrame,
  Machine,
  NianProject,
  NianSession,
  RelayConnectivitySnapshot,
} from '@shennian/wire'
import { readDesktopCanonicalProject, readDesktopProjectAliases, type DesktopCanonicalProjectInput } from './desktopProjectContracts'
import { readDesktopCreatedSession, type DesktopSessionLaunchInput } from '../desktop-launch/desktopSessionLaunch'

export type DesktopAccountSyncPhase =
  | 'signed-out'
  | 'offline'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'blocked'

export type DesktopAccountSyncStatus = {
  phase: DesktopAccountSyncPhase
  connectivity: RelayConnectivitySnapshot | null
  remoteResolved: boolean
}

export type DesktopAccountSyncSnapshot = {
  revision: number
  accountId: string | null
  status: DesktopAccountSyncStatus
  sessions: NianSession[]
  machines: Machine[]
  projects: NianProject[]
}

export type DesktopAccountSyncEvent = {
  revision: number
  accountId: string | null
  type:
    | 'status'
    | 'sessions'
    | 'session-upsert'
    | 'session-batch'
    | 'session-delete'
    | 'machines'
    | 'machine-status'
    | 'machine-agents'
    | 'projects'
    | 'session-queue'
    | 'room-revision'
    | 'agent-revision'
    | 'relay-event'
  value: unknown
}

export type DesktopAccountSyncOperation =
  | 'agent.projection.list'
  | 'agent.projection.get'
  | 'room.agent.get'
  | 'room.agent.setMode'
  | 'room.agent.restart'
  | 'room.agent.add'
  | 'room.agent.remove'
  | 'agent.editor.save'
  | 'account.clearLocalData'
  | 'account.reconcile'
  | 'account.reconnect'
  | 'session.loadProjectPage'
  | 'session.persist'
  | 'session.create'
  | 'session.body.syncVisible'
  | 'session.delete'
  | 'session.updateUserState'
  | 'session.markRead'
  | 'project.delete'
  | 'project.canonicalize'
  | 'project.resolveAliases'
  | 'machine.observe'
  | 'machine.unobserve'
  | 'machine.fs.list'
  | 'machine.fs.read'
  | 'machine.fs.rename'
  | 'machine.fs.write'
  | 'machine.fs.archive'
  | 'machine.fs.exportPdf'
  | 'machine.fs.exportPdfSetup'
  | 'machine.transfer.start'
  | 'machine.transfer.chunk'
  | 'machine.transfer.finish'
  | 'machine.transfer.abort'
  | 'project.fs.open'
  | 'project.fs.list'
  | 'project.fs.read'
  | 'project.fs.close'
  | 'machine.upgrade.start'
  | 'machine.upgrade.setPolicy'
  | 'machine.agents.refresh'
  | 'machine.agentAuth.start'
  | 'machine.externalSessions.list'
  | 'machine.externalSessions.import'
  | 'machine.permission.respond'
  | 'machine.sessionOptions.get'
  | 'machine.agentWorkspace.validate'
  | 'machine.remoteAccess.pause'
  | 'machine.models.refresh'
  | 'machine.session.refresh'
  | 'machine.managedSession.restart'
  | 'machine.sessionTool.detail'
  | 'machine.chat.enqueue'
  | 'machine.chat.queueGet'
  | 'machine.chat.queueEdit'
  | 'machine.chat.queueDelete'
  | 'machine.chat.queuePromote'
  | 'machine.chat.abort'
  | 'machine.sessionMessage.status'
  | 'machine.agentCapabilities.list'
  | 'machine.publish'
  | 'network.setOnline'

export type DesktopAccountSyncCommand = {
  requestId: string
  operation: DesktopAccountSyncOperation
  args: unknown[]
}

export type DesktopAccountSyncFailure = {
  code: string
  message: string
  retryable: boolean
  action?: 'retry' | 'sign_in'
}

export type DesktopAccountSyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopAccountSyncFailure }

export type DesktopAccountSyncBridge = {
  getState(): Promise<DesktopAccountSyncResult<DesktopAccountSyncSnapshot>>
  command(command: DesktopAccountSyncCommand): Promise<DesktopAccountSyncResult<unknown>>
  subscribe(listener: (event: DesktopAccountSyncEvent) => void): () => void
}

type DesktopSyncWindow = typeof globalThis & {
  shennianDesktop?: { sync?: DesktopAccountSyncBridge }
}

export function requireDesktopAccountSyncBridge(): DesktopAccountSyncBridge {
  const bridge = (globalThis as DesktopSyncWindow).shennianDesktop?.sync
  if (
    !bridge ||
    typeof bridge.getState !== 'function' ||
    typeof bridge.command !== 'function' ||
    typeof bridge.subscribe !== 'function'
  ) {
    throw new DesktopAccountRuntimeError(
      'BRIDGE_UNAVAILABLE',
      'Desktop account bridge is unavailable; renderer account sync cannot run on Web.',
      false,
    )
  }
  return bridge
}

export type DesktopAccountProjection = {
  applySnapshot(snapshot: DesktopAccountSyncSnapshot): void
  applyEvent(event: DesktopAccountSyncEvent): void
}

export type DesktopAccountRuntimeState = {
  revision: number
  accountId: string | null
  status: DesktopAccountSyncStatus | null
  bootstrapped: boolean
  error: DesktopAccountRuntimeError | null
}

type StateListener = () => void

export class DesktopAccountRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: DesktopAccountSyncFailure['action'],
  ) {
    super(message)
    this.name = 'DesktopAccountRuntimeError'
  }
}

/**
 * Renderer-side projection controller. The main process owns credentials,
 * network transports, reconciliation and durable SQLite writes; this class
 * only bootstraps and applies the resulting typed UI projection.
 */
export class DesktopAccountRuntime {
  private readonly listeners = new Set<StateListener>()
  private state: DesktopAccountRuntimeState = {
    revision: 0,
    accountId: null,
    status: null,
    bootstrapped: false,
    error: null,
  }
  private bufferedEvents: DesktopAccountSyncEvent[] = []
  private bridgeUnsubscribe: (() => void) | null = null
  private startPromise: Promise<void> | null = null
  private bootstrapping = false
  private consumers = 0
  private bootstrapGeneration = 0
  private releaseAfterBootstrap = false
  private requestSequence = 0
  private accountScopeVersion = 0

  constructor(
    private readonly bridge: DesktopAccountSyncBridge,
    private readonly projection: DesktopAccountProjection,
  ) {}

  getState = (): DesktopAccountRuntimeState => this.state

  subscribeState = (listener: StateListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  retain(): () => void {
    this.consumers += 1
    this.releaseAfterBootstrap = false
    void this.start().catch(() => undefined)
    let released = false
    return () => {
      if (released) return
      released = true
      this.consumers = Math.max(0, this.consumers - 1)
      if (this.consumers !== 0) return
      if (this.startPromise) this.releaseAfterBootstrap = true
      else this.stop()
    }
  }

  start(): Promise<void> {
    if (this.state.bootstrapped && this.bridgeUnsubscribe) return Promise.resolve()
    if (this.startPromise) return this.startPromise

    this.bootstrapping = true
    const generation = ++this.bootstrapGeneration
    this.bufferedEvents = []
    this.bridgeUnsubscribe ??= this.bridge.subscribe((event) => this.receiveEvent(event))
    this.setState({ ...this.state, error: null })

    const work = this.bridge
      .getState()
      .then((result) => {
        if (generation !== this.bootstrapGeneration) return
        const snapshot = unwrapDesktopResult(result)
        assertSnapshot(snapshot)
        this.projection.applySnapshot(snapshot)
        this.state = {
          revision: snapshot.revision,
          accountId: snapshot.accountId,
          status: snapshot.status,
          bootstrapped: true,
          error: null,
        }
        this.bootstrapping = false
        const buffered = this.bufferedEvents.sort((left, right) => left.revision - right.revision)
        this.bufferedEvents = []
        for (const event of buffered) this.applyEvent(event)
        this.notify()
      })
      .catch((error) => {
        if (generation !== this.bootstrapGeneration) return
        this.bootstrapping = false
        this.bufferedEvents = []
        this.bridgeUnsubscribe?.()
        this.bridgeUnsubscribe = null
        const runtimeError = asRuntimeError(error)
        this.setState({ ...this.state, bootstrapped: false, error: runtimeError })
        throw runtimeError
      })
      .finally(() => {
        if (this.startPromise === work) this.startPromise = null
        if (this.releaseAfterBootstrap && this.consumers === 0) {
          this.releaseAfterBootstrap = false
          this.stop()
        }
      })

    this.startPromise = work
    return work
  }

  stop(): void {
    this.bootstrapGeneration += 1
    this.startPromise = null
    this.bridgeUnsubscribe?.()
    this.bridgeUnsubscribe = null
    this.bootstrapping = false
    this.bufferedEvents = []
  }

  reconcile(context?: unknown): Promise<unknown> {
    return this.command('account.reconcile', context === undefined ? [] : [context])
  }

  async syncVisibleSessionBody(sessionId: string): Promise<void> {
    await this.command('session.body.syncVisible', [sessionId])
  }

  clearLocalData(): Promise<unknown> {
    return this.command('account.clearLocalData', [])
  }

  reconnect(source?: string): Promise<unknown> {
    return this.command('account.reconnect', source === undefined ? [] : [source])
  }

  loadProjectSessions(projectId: string, page?: unknown): Promise<unknown> {
    return this.command('session.loadProjectPage', page === undefined ? [projectId] : [projectId, page])
  }

  persistSession(session: NianSession): Promise<unknown> {
    return this.command('session.persist', [session])
  }

  async createSession(input: DesktopSessionLaunchInput): Promise<NianSession> {
    return readDesktopCreatedSession(await this.scopedCommand('session.create', [input]))
  }

  deleteSession(sessionId: string, cleanupPolicy?: 'none' | 'auto'): Promise<unknown> {
    return this.command(
      'session.delete',
      cleanupPolicy === undefined ? [sessionId] : [sessionId, cleanupPolicy],
    )
  }

  updateSessionUserState(sessionId: string, userState: unknown): Promise<unknown> {
    return this.command('session.updateUserState', [sessionId, userState])
  }

  markSessionRead(sessionId: string, lastReadAt?: string, readWatermark?: unknown): Promise<unknown> {
    const args: unknown[] = [sessionId]
    if (lastReadAt !== undefined || readWatermark !== undefined) args.push(lastReadAt)
    if (readWatermark !== undefined) args.push(readWatermark)
    return this.command('session.markRead', args)
  }

  deleteProject(projectId: string): Promise<unknown> {
    return this.command('project.delete', [projectId])
  }

  async canonicalizeProject(input: DesktopCanonicalProjectInput) {
    return readDesktopCanonicalProject(await this.scopedCommand('project.canonicalize', [{ machineId: input.machineId, workDir: input.workDir }]))
  }

  async resolveProjectAliases() {
    return readDesktopProjectAliases(await this.scopedCommand('project.resolveAliases', []))
  }

  private async scopedCommand(operation: 'project.canonicalize' | 'project.resolveAliases' | 'session.create', args: unknown[]) {
    const accountId = this.state.accountId
    const generation = this.bootstrapGeneration
    const scopeVersion = this.accountScopeVersion
    if (!accountId || !this.state.bootstrapped || !this.bridgeUnsubscribe) {
      throw new DesktopAccountRuntimeError('ACCOUNT_UNAVAILABLE', 'Desktop account is unavailable.', false)
    }
    const result = await this.command(operation, args)
    if (this.state.accountId !== accountId || this.bootstrapGeneration !== generation ||
        this.accountScopeVersion !== scopeVersion || !this.bridgeUnsubscribe) {
      throw new DesktopAccountRuntimeError('ACCOUNT_CHANGED', 'Desktop account changed.', false)
    }
    return result
  }

  observeMachine(machineId: string): Promise<boolean> {
    return this.command('machine.observe', [machineId]).then(Boolean)
  }

  unobserveMachine(machineId: string): Promise<unknown> {
    return this.command('machine.unobserve', [machineId])
  }

  requestMachineOperation<T>(
    operation: Extract<DesktopAccountSyncOperation, `machine.${string}` | `project.fs.${string}`>,
    machineId: string,
    params: Record<string, unknown>,
    connectTimeoutMs?: number,
    responseTimeoutMs?: number,
  ): Promise<T> {
    const args: unknown[] = [machineId, params]
    if (connectTimeoutMs !== undefined || responseTimeoutMs !== undefined) {
      args.push(connectTimeoutMs ?? 10_000)
    }
    if (responseTimeoutMs !== undefined) args.push(responseTimeoutMs)
    return this.command(operation, args) as Promise<T>
  }

  publishMachineEvent(machineId: string, event: EventFrame): Promise<unknown> {
    return this.command('machine.publish', [machineId, event])
  }

  setNetworkOnline(online: boolean): Promise<unknown> {
    return this.command('network.setOnline', [online])
  }

  private receiveEvent(event: DesktopAccountSyncEvent): void {
    if (!isDesktopAccountSyncEvent(event)) return
    if (this.bootstrapping) {
      this.bufferedEvents.push(event)
      return
    }
    this.applyEvent(event)
  }

  private applyEvent(event: DesktopAccountSyncEvent): void {
    if (event.revision <= this.state.revision) return
    if (event.accountId !== this.state.accountId) this.accountScopeVersion++
    this.projection.applyEvent(event)
    this.state = {
      revision: event.revision,
      accountId: event.accountId,
      status: event.type === 'status' ? (event.value as DesktopAccountSyncStatus) : this.state.status,
      bootstrapped: true,
      error: null,
    }
    this.notify()
  }

  private async command(operation: DesktopAccountSyncOperation, args: unknown[]): Promise<unknown> {
    const requestId = `desktop-renderer-${Date.now()}-${++this.requestSequence}`
    return unwrapDesktopResult(await this.bridge.command({ requestId, operation, args }))
  }

  private setState(state: DesktopAccountRuntimeState): void {
    this.state = state
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function unwrapDesktopResult<T>(result: DesktopAccountSyncResult<T>): T {
  if (result.ok) return result.value
  throw new DesktopAccountRuntimeError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function asRuntimeError(error: unknown): DesktopAccountRuntimeError {
  return error instanceof DesktopAccountRuntimeError
    ? error
    : new DesktopAccountRuntimeError(
        'INVALID_OUTPUT',
        error instanceof Error ? error.message : 'Desktop account bootstrap failed.',
        true,
      )
}

function assertSnapshot(snapshot: DesktopAccountSyncSnapshot): void {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    !isStatus(snapshot.status) ||
    !Array.isArray(snapshot.sessions) ||
    !Array.isArray(snapshot.machines) ||
    !Array.isArray(snapshot.projects)
  ) {
    throw new DesktopAccountRuntimeError(
      'INVALID_OUTPUT',
      'Desktop account bootstrap returned an invalid projection.',
      true,
    )
  }
}

function isDesktopAccountSyncEvent(event: DesktopAccountSyncEvent): boolean {
  if (!event || !Number.isSafeInteger(event.revision) || event.revision < 1) return false
  if (event.accountId !== null && typeof event.accountId !== 'string') return false
  if (event.type === 'status') return isStatus(event.value)
  if (event.type === 'room-revision') return isRoomRevision(event.value)
  if (event.type === 'agent-revision') {
    const value = event.value
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && (value as { agentId?: unknown }).agentId === null)
  }
  return EVENT_TYPES.has(event.type)
}

function isRoomRevision(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const revision = value as Record<string, unknown>
  return (
    (revision.roomId === null || typeof revision.roomId === 'string') &&
    Array.isArray(revision.scopes) &&
    revision.scopes.length > 0 &&
    revision.scopes.every((scope) =>
      scope === 'inventory' || scope === 'members' || scope === 'messages' || scope === 'attachments')
  )
}

function isStatus(value: unknown): value is DesktopAccountSyncStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const status = value as Partial<DesktopAccountSyncStatus>
  const valid = (
    STATUS_PHASES.has(status.phase as DesktopAccountSyncPhase) &&
    typeof status.remoteResolved === 'boolean' &&
    (status.connectivity === null || isConnectivitySnapshot(status.connectivity))
  )
  if (!valid) return false
  if (status.phase === 'ready') return status.connectivity?.phase === 'connected'
  if (status.phase === 'blocked') return status.connectivity?.phase === 'blocked'
  return status.phase !== 'signed-out' || status.connectivity === null
}

function isConnectivitySnapshot(value: unknown): value is RelayConnectivitySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  if (!hasExactKeys(snapshot, CONNECTIVITY_KEYS)) return false
  return (
    CONNECTIVITY_PHASES.has(snapshot.phase as RelayConnectivitySnapshot['phase']) &&
    CONNECTIVITY_REASONS.has(snapshot.reason as RelayConnectivitySnapshot['reason']) &&
    optionalNonNegativeInteger(snapshot.closeCode) &&
    (snapshot.closeReason === null ||
      (typeof snapshot.closeReason === 'string' && snapshot.closeReason.length <= 256)) &&
    typeof snapshot.retryable === 'boolean' &&
    nonNegativeInteger(snapshot.retryAttempt) &&
    optionalNonNegativeFiniteNumber(snapshot.nextRetryAt) &&
    optionalNonNegativeFiniteNumber(snapshot.disconnectedAt) &&
    optionalNonNegativeFiniteNumber(snapshot.lastConnectedAt) &&
    (snapshot.connectionId === null ||
      (typeof snapshot.connectionId === 'string' && snapshot.connectionId.length <= 256))
  )
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === null || nonNegativeInteger(value)
}

function optionalNonNegativeFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

const STATUS_PHASES = new Set<DesktopAccountSyncPhase>([
  'signed-out',
  'offline',
  'connecting',
  'syncing',
  'ready',
  'blocked',
])

const CONNECTIVITY_KEYS = [
  'phase',
  'reason',
  'closeCode',
  'closeReason',
  'retryable',
  'retryAttempt',
  'nextRetryAt',
  'disconnectedAt',
  'lastConnectedAt',
  'connectionId',
] as const

const CONNECTIVITY_PHASES = new Set<RelayConnectivitySnapshot['phase']>([
  'connecting',
  'connected',
  'recovering',
  'blocked',
  'offline',
])

const CONNECTIVITY_REASONS = new Set<RelayConnectivitySnapshot['reason']>([
  'initial_connect',
  'network_offline',
  'transient_transport',
  'server_unavailable',
  'auth_required',
  'version_unsupported',
  'permission_revoked',
  'plan_required',
  'machine_unavailable',
  'unknown',
])

const EVENT_TYPES = new Set<DesktopAccountSyncEvent['type']>([
  'sessions',
  'session-upsert',
  'session-batch',
  'session-delete',
  'machines',
  'machine-status',
  'machine-agents',
  'projects',
  'session-queue',
  'room-revision',
  'agent-revision',
  'relay-event',
])
