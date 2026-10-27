// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-fs-client.test.ts

import {
  PROJECT_FS_LIMITS,
  hasProjectFsOpaqueCapability,
  parseProjectFsCloseParams,
  parseProjectFsCloseResult,
  parseProjectFsListParams,
  parseProjectFsListResult,
  parseProjectFsOpenParams,
  parseProjectFsOpenResult,
  parseProjectFsReadParams,
  parseProjectFsReadResult,
  parseProjectFsRejection,
  type Machine,
  type NianProject,
  type ProjectFsCloseResult,
  type ProjectFsListResult,
  type ProjectFsOpenResult,
  type ProjectFsReadEncoding,
  type ProjectFsReadResult,
  type ResFrame,
} from '@shennian/wire'
import {
  createProjectFsClientState,
  reduceProjectFsClientState,
  type ProjectFsClientErrorState,
  type ProjectFsClientState,
  type ProjectFsStateAction,
} from './desktopProjectFsState'

export type ProjectFsRequest = (
  machineId: string,
  method: 'project.fs.open' | 'project.fs.list' | 'project.fs.read' | 'project.fs.close',
  params: Record<string, unknown>,
) => Promise<ResFrame>

export type ProjectFsClientContext = {
  accountId: string | null
  /** Monotonic auth generation owned by the authenticated account lifecycle. */
  authGeneration: number
  machine: Machine | null
  project: NianProject | null
}

type ActiveContext = {
  key: string
  accountId: string
  authGeneration: number
  machineId: string
  projectId: string
  projectRef: string
  daemonInstallationId: string
  machineOnline: boolean
}

export class ProjectFsClientError extends Error {
  constructor(
    readonly kind:
      | 'unavailable'
      | 'offline'
      | 'permission_denied'
      | 'stale'
      | 'remote'
      | 'protocol',
    readonly detail?: ProjectFsClientErrorState,
  ) {
    super(`project_fs_${kind}`)
    this.name = 'ProjectFsClientError'
  }
}

/** Path-free, non-persistent adapter for project-scoped opaque file RPCs. */
export class ProjectFsClient {
  private state = createProjectFsClientState()
  private active: ActiveContext | null = null
  private configuredKey: string | null = null
  private readonly listeners = new Set<(state: ProjectFsClientState) => void>()
  private readonly pending = new Set<AbortController>()

  constructor(private readonly requestProjectFs: ProjectFsRequest) {}

  getState(): ProjectFsClientState {
    return this.state
  }

  subscribe(listener: (state: ProjectFsClientState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setContext(context: ProjectFsClientContext): void {
    const resolution = resolveContext(context)
    if (resolution.contextKey === this.configuredKey) return

    this.invalidate()
    this.active = resolution.active
    this.configuredKey = resolution.contextKey
    this.dispatch({
      type: 'replace_scope',
      accountId: context.accountId,
      machineId: context.machine?.id ?? null,
      projectId: context.project?.id ?? null,
      availability: resolution.availability,
      unavailableReason: resolution.unavailableReason,
    })
  }

  async open(
    limit: number = PROJECT_FS_LIMITS.defaultDirectoryPageItems,
  ): Promise<ProjectFsOpenResult> {
    const context = this.requireReady()
    const params = parseProjectFsOpenParams({ projectRef: context.projectRef, limit })
    if (!params) throw this.protocolFailure(this.state.generation)
    const result = await this.request('project.fs.open', params, parseProjectFsOpenResult)
    this.dispatch({
      type: 'open_succeeded',
      generation: result.generation,
      leaseId: result.value.leaseId,
      rootHandle: result.value.root.handle,
      rootName: result.value.root.name,
      page: result.value.page,
      expiresAt: result.value.expiresAt,
    })
    return result.value
  }

  async list(input: {
    directoryHandle: string
    cursor?: number
    limit?: number
  }): Promise<ProjectFsListResult> {
    const context = this.requireReady()
    const leaseId = this.requireLease()
    const params = parseProjectFsListParams({
      projectRef: context.projectRef,
      leaseId,
      directoryHandle: input.directoryHandle,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    })
    if (!params) throw this.protocolFailure(this.state.generation)
    const result = await this.request('project.fs.list', params, parseProjectFsListResult)
    if (
      result.value.leaseId !== leaseId ||
      result.value.directoryHandle !== input.directoryHandle ||
      result.value.cursor !== (input.cursor ?? 0)
    ) {
      throw this.protocolFailure(result.generation)
    }
    this.dispatch({
      type: 'list_succeeded',
      generation: result.generation,
      page: result.value,
      expiresAt: result.value.expiresAt,
    })
    return result.value
  }

  async read(input: {
    fileHandle: string
    offset: number
    limitBytes: number
    encoding?: ProjectFsReadEncoding
  }): Promise<ProjectFsReadResult> {
    const context = this.requireReady()
    const leaseId = this.requireLease()
    const params = parseProjectFsReadParams({ projectRef: context.projectRef, leaseId, ...input })
    if (!params) throw this.protocolFailure(this.state.generation)
    const result = await this.request('project.fs.read', params, parseProjectFsReadResult)
    if (
      result.value.leaseId !== leaseId ||
      result.value.fileHandle !== input.fileHandle ||
      result.value.offset !== input.offset
    ) {
      throw this.protocolFailure(result.generation)
    }
    this.dispatch({ type: 'read_succeeded', generation: result.generation, page: result.value })
    return result.value
  }

  async close(): Promise<ProjectFsCloseResult> {
    const context = this.requireReady()
    const leaseId = this.requireLease()
    const params = parseProjectFsCloseParams({ projectRef: context.projectRef, leaseId })
    if (!params) throw this.protocolFailure(this.state.generation)
    const result = await this.request('project.fs.close', params, parseProjectFsCloseResult)
    this.dispatch({ type: 'closed', generation: result.generation })
    return result.value
  }

  dispose(): void {
    this.invalidate()
    this.active = null
    this.configuredKey = null
    this.listeners.clear()
  }

  private requireReady(): ActiveContext {
    if (!this.active) throw new ProjectFsClientError('unavailable')
    if (!this.active.machineOnline) {
      this.replaceTransportState('offline')
      throw new ProjectFsClientError('offline')
    }
    if (
      this.state.availability !== 'ready' &&
      this.state.availability !== 'loading' &&
      this.state.availability !== 'error'
    ) {
      throw new ProjectFsClientError(
        this.state.availability === 'offline'
          ? 'offline'
          : this.state.availability === 'permission_denied'
            ? 'permission_denied'
            : 'unavailable',
      )
    }
    return this.active
  }

  private requireLease(): string {
    if (!this.state.leaseId) throw new ProjectFsClientError('unavailable')
    return this.state.leaseId
  }

  private async request<T>(
    method: 'project.fs.open' | 'project.fs.list' | 'project.fs.read' | 'project.fs.close',
    params: Record<string, unknown>,
    parse: (value: unknown) => T | null,
  ): Promise<{ generation: number; value: T }> {
    const context = this.requireReady()
    const generation = this.state.generation
    const controller = new AbortController()
    this.pending.add(controller)
    this.dispatch({ type: 'request_started', generation })
    try {
      const response = await abortable(
        this.requestProjectFs(context.machineId, method, params),
        controller.signal,
      )
      if (generation !== this.state.generation || context !== this.active) {
        throw new ProjectFsClientError('stale')
      }
      if (!response.ok) throw this.remoteFailure(response, generation)
      const value = parse(response.payload)
      if (!value) throw this.protocolFailure(generation)
      return { generation, value }
    } catch (error) {
      if (error instanceof ProjectFsClientError) throw error
      if (controller.signal.aborted || generation !== this.state.generation) {
        throw new ProjectFsClientError('stale')
      }
      const failure: ProjectFsClientErrorState = {
        code: 'machine_offline',
        retryable: true,
        requiredAction: 'retry',
      }
      this.applyFailure(generation, failure)
      throw new ProjectFsClientError('offline', failure)
    } finally {
      this.pending.delete(controller)
    }
  }

  private remoteFailure(response: ResFrame, generation: number): ProjectFsClientError {
    const payload = response.payload as { rejection?: unknown } | null | undefined
    const rejection = parseProjectFsRejection(payload?.rejection)
    if (!rejection) return this.protocolFailure(generation)
    this.applyFailure(generation, rejection)
    const kind =
      rejection.code === 'capability_required'
        ? 'unavailable'
        : rejection.code === 'machine_offline'
          ? 'offline'
          : rejection.code === 'permission_denied'
            ? 'permission_denied'
            : 'remote'
    return new ProjectFsClientError(kind, rejection)
  }

  private protocolFailure(generation: number): ProjectFsClientError {
    const failure: ProjectFsClientErrorState = {
      code: 'protocol_error',
      retryable: false,
      requiredAction: 'upgrade_daemon',
    }
    this.applyFailure(generation, failure)
    return new ProjectFsClientError('protocol', failure)
  }

  private applyFailure(generation: number, error: ProjectFsClientErrorState): void {
    const previousGeneration = this.state.generation
    this.dispatch({ type: 'request_failed', generation, error })
    if (this.state.generation !== previousGeneration) this.invalidate()
  }

  private replaceTransportState(availability: 'ready' | 'offline'): void {
    this.invalidate()
    this.dispatch({
      type: 'replace_scope',
      accountId: this.active?.accountId ?? null,
      machineId: this.active?.machineId ?? null,
      projectId: this.active?.projectId ?? null,
      availability,
      unavailableReason: null,
    })
  }

  private invalidate(): void {
    for (const controller of this.pending) controller.abort()
    this.pending.clear()
  }

  private dispatch(action: ProjectFsStateAction): void {
    const next = reduceProjectFsClientState(this.state, action)
    if (next === this.state) return
    this.state = next
    for (const listener of this.listeners) listener(next)
  }
}

function resolveContext(
  context: ProjectFsClientContext,
): {
  contextKey: string
  active: ActiveContext | null
  availability: 'unavailable' | 'offline' | 'ready' | 'permission_denied'
  unavailableReason: ProjectFsClientState['unavailableReason']
} {
  const { accountId, machine, project } = context
  const scopeKey = [
    accountId ?? '',
    context.authGeneration,
    machine?.id ?? '',
    project?.id ?? '',
    project?.fileBrowserRef ?? '',
    machine?.daemonInstallationId ?? '',
    machine?.online ? 1 : 0,
    machine?.role ?? 'owner',
    machine?.permission ?? '',
    hasProjectFsOpaqueCapability(machine?.sessionSyncCapabilities) ? 1 : 0,
  ].join('\u0001')
  if (!accountId || !machine || !project || project.machineId !== machine.id) {
    return {
      contextKey: `missing_scope\u0001${scopeKey}`,
      active: null,
      availability: 'unavailable',
      unavailableReason: 'missing_scope',
    }
  }
  if (
    !project.fileBrowserRef ||
    !parseProjectFsOpenParams({ projectRef: project.fileBrowserRef })
  ) {
    return {
      contextKey: `missing_project_ref\u0001${scopeKey}`,
      active: null,
      availability: 'unavailable',
      unavailableReason: 'missing_project_ref',
    }
  }
  if (!hasProjectFsOpaqueCapability(machine.sessionSyncCapabilities)) {
    return {
      contextKey: `capability_required\u0001${scopeKey}`,
      active: null,
      availability: 'unavailable',
      unavailableReason: 'capability_required',
    }
  }
  if (!machine.daemonInstallationId) {
    return {
      contextKey: `missing_daemon_identity\u0001${scopeKey}`,
      active: null,
      availability: 'unavailable',
      unavailableReason: 'missing_daemon_identity',
    }
  }
  if (machine.role === 'granted' && machine.permission === 'view') {
    return {
      contextKey: `permission_denied\u0001${scopeKey}`,
      active: null,
      availability: 'permission_denied',
      unavailableReason: null,
    }
  }
  const daemonInstallationId = machine.daemonInstallationId
  const active: ActiveContext = {
    key: [
      accountId,
      context.authGeneration,
      machine.id,
      project.id,
      project.fileBrowserRef,
      daemonInstallationId,
      machine.online ? 1 : 0,
      machine.role ?? 'owner',
      machine.permission ?? '',
    ].join('\u0001'),
    accountId,
    authGeneration: context.authGeneration,
    machineId: machine.id,
    projectId: project.id,
    projectRef: project.fileBrowserRef,
    daemonInstallationId,
    machineOnline: machine.online,
  }
  return {
    contextKey: active.key,
    active,
    availability: machine.online ? 'ready' : 'offline',
    unavailableReason: null,
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProjectFsClientError('stale'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProjectFsClientError('stale'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
