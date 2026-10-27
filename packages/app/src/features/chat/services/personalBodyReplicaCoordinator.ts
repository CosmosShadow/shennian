// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/personal-body-replica-sync.test.ts

import {
  generateTraceId,
  incrementRuntimeMetric,
  isManagerWorkerSession,
  setRuntimeGauge,
  type RelayClientHandle,
  type RelayEventHandler,
  type RelayManager,
} from '@shennian/shared'
import {
  SESSION_HISTORY_LIMITS,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type Machine,
  type NianSession,
  type SessionBodyReplicaDeltaEvent,
  type SessionBodyReplicaSubscribeResponse,
  type SessionHistorySyncPage,
  type SessionHistorySyncParams,
} from '@shennian/wire'
import {
  PersonalBodyRevisionError,
  type PersonalSessionBodyStore,
} from '../../../storage/personal-session-body-store.native'
import { reportPersonalBodyReplicaFailure } from './visibleBodyRecovery'

const BODY_REPLICA_CAPABILITY = 'session_body_replica_v1'
const BODY_REPLICA_STREAM_CAPABILITY = 'session_body_replica_stream_v1'
const MAX_PARALLEL_SESSIONS = 2
const RETRY_BASE_DELAY_MS = 5_000
const RETRY_MAX_DELAY_MS = 5 * 60_000
let lastReplicaStreamGeneration = 0

export function nextPersonalBodyReplicaGeneration(previousGeneration: number): number {
  lastReplicaStreamGeneration = Math.max(
    lastReplicaStreamGeneration + 1,
    previousGeneration + 1,
    Date.now(),
  )
  return lastReplicaStreamGeneration
}

type ReplicaCandidate = {
  session: NianSession
  machine: Machine
  targetRevision: number
}

type RetryState = {
  targetRevision: number
  attempts: number
  nextAttemptAt: number
}

export type PersonalBodyReplicaCoordinatorOptions = {
  accountId: string
  appInstallationId: string
  store: PersonalSessionBodyStore
  getRelayManager: () => RelayManager | null
  getSessions: () => NianSession[] | Promise<NianSession[]>
  getSession?: (sessionId: string) => NianSession | undefined | Promise<NianSession | undefined>
  getMachines: () => Machine[]
  getCurrentSessionId: () => string | null
  readCloudPage?: (params: SessionHistorySyncParams) => Promise<SessionHistorySyncPage>
  onSessionCommitted?: (sessionId: string) => void | Promise<void>
}

type MachineReplicaStream = {
  machineId: string
  daemonInstallationId: string
  streamId: string
  generation: number
  subscribed: boolean
  subscribing: Promise<void> | null
  handle: RelayClientHandle
  eventHandler: (event: Parameters<RelayEventHandler>[1]) => void
  unsubscribeState: () => void
}

export function buildPersonalBodyReplicaSessionSignal(sessions: NianSession[]): string {
  return sessions.map((session) => [
    session.id,
    session.machineId,
    session.bodyStorageMode,
    session.localReady === true ? 1 : 0,
    session.bodyRevision ?? 0,
    session.dataEpoch ?? '',
    session.deletionRevision ?? 0,
    session.deletedAt ?? '',
  ].join('\u0001')).sort().join('\u0002')
}

export function buildPersonalBodyReplicaMachineSignal(machines: Machine[]): string {
  return machines.map((machine) => [
    machine.id,
    machine.online ? 1 : 0,
    machine.daemonInstallationId ?? '',
    machine.sessionSyncProtocolVersion ?? '',
    machine.sessionSyncDataEpoch ?? '',
    machine.sessionSyncCapabilities ? [...machine.sessionSyncCapabilities].sort().join('\u0003') : '',
  ].join('\u0001')).sort().join('\u0002')
}

export class PersonalBodyReplicaSyncCoordinator {
  private stopped = false
  private running: Promise<void> | null = null
  private rerunRequested = false
  private fullRefreshRequested = false
  private pendingSessionIds = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retries = new Map<string, RetryState>()
  private streams = new Map<string, MachineReplicaStream>()
  private streamHighWater = new Map<string, number>()
  private targetCommittedAt = new Map<string, string>()

  constructor(private readonly options: PersonalBodyReplicaCoordinatorOptions) {}

  /** Refresh only the conversation that just became visible. */
  async syncVisibleSession(sessionId: string): Promise<void> {
    if (this.stopped || !sessionId) return
    const [session, machines, initialState] = await Promise.all([
      this.options.getSession
        ? Promise.resolve(this.options.getSession(sessionId))
        : Promise.resolve(this.options.getSessions()).then(sessions => sessions.find(item => item.id === sessionId)),
      Promise.resolve(this.options.getMachines()),
      this.options.store.getState(this.options.accountId, sessionId),
    ])
    if (!session || session.deletedAt || session.bodyStorageMode !== 'machine_local') return
    let state = initialState
    if (state?.deleted && isManagerWorkerSession(session)) {
      await this.options.store.restoreSession(
        this.options.accountId,
        session.id,
        session.deletionRevision ?? 0,
      )
      state = await this.options.store.getState(this.options.accountId, sessionId)
    }
    if (state?.deleted) return
    const machine = machines.find((item) => item.id === session.machineId)
    if (!supportsBodyReplica(machine) && !(this.options.readCloudPage && supportsBodyIdentity(machine))) return
    await this.syncCandidate({
      session,
      machine: machine!,
      // Force one targeted request even when a Room-bound session's Server
      // index is behind. The response provides the machine's real high-water.
      targetRevision: (state?.cachedBodyRevision ?? 0) + 1,
    }, false)
    this.retries.delete(sessionId)
  }

  requestSync(sessionId?: string): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (sessionId && this.options.getSession) this.pendingSessionIds.add(sessionId)
    else this.fullRefreshRequested = true
    this.rerunRequested = true
    return this.ensureRunning()
  }

  private ensureRunning(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (!this.running) {
      const work = this.run().finally(() => {
        if (this.running === work) this.running = null
        // Do not lose a relevant index/presence signal that arrives after the
        // run loop observes an empty queue but before this promise settles.
        if (this.rerunRequested && !this.stopped) void this.ensureRunning()
      })
      this.running = work
    }
    return this.running
  }

  stop(): void {
    this.stopped = true
    this.rerunRequested = false
    this.fullRefreshRequested = false
    this.pendingSessionIds.clear()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retries.clear()
    for (const stream of this.streams.values()) this.releaseStream(stream, true)
    this.streams.clear()
    this.streamHighWater.clear()
    this.targetCommittedAt.clear()
  }

  private async run(): Promise<void> {
    while (this.rerunRequested && !this.stopped) {
      this.rerunRequested = false
      const sessionIds = this.fullRefreshRequested ? undefined : [...this.pendingSessionIds]
      this.fullRefreshRequested = false
      this.pendingSessionIds.clear()
      let candidates: ReplicaCandidate[]
      try {
        this.reconcileStreams(this.options.getMachines())
        candidates = await this.listCandidates(sessionIds)
      } catch (error) {
        incrementRuntimeMetric('personal_body_replica.sessions_failed')
        reportPersonalBodyReplicaFailure('reconcile', { error })
        this.scheduleRetryTimer(RETRY_BASE_DELAY_MS)
        break
      }
      setRuntimeGauge('personal_body_replica.pending_sessions', candidates.length)
      setRuntimeGauge('personal_body_replica.pending_indexes', candidates.length)
      if (candidates.length === 0) continue
      let cursor = 0
      const workers = Array.from(
        { length: Math.min(MAX_PARALLEL_SESSIONS, candidates.length) },
        async () => {
          while (!this.stopped) {
            const candidate = candidates[cursor++]
            if (!candidate) return
            try {
              await this.syncCandidate(candidate)
              this.retries.delete(candidate.session.id)
              incrementRuntimeMetric('personal_body_replica.sessions_completed')
            } catch (error) {
              if (!(error instanceof PersonalBodyRevisionError)) {
                incrementRuntimeMetric('personal_body_replica.sessions_failed')
              }
              reportPersonalBodyReplicaFailure('session_sync', {
                sessionId: candidate.session.id,
                machineId: candidate.machine.id,
                error,
              })
              this.deferCandidate(candidate)
            }
          }
        },
      )
      await Promise.all(workers)
    }
    setRuntimeGauge('personal_body_replica.pending_sessions', 0)
    setRuntimeGauge('personal_body_replica.pending_indexes', 0)
    this.scheduleNextRetry()
  }

  private async listCandidates(sessionIds?: string[]): Promise<ReplicaCandidate[]> {
    // Live index events already identify their target. Reading every session
    // and body state here stalls ALL pages as the local archive grows.
    const targeted = sessionIds && this.options.getSession
    incrementRuntimeMetric(targeted ? 'personal_body_replica.targeted_runs' : 'personal_body_replica.full_runs')
    const sessions = targeted
      ? (await Promise.all(sessionIds.map(id => this.options.getSession!(id))))
        .filter((session): session is NianSession => Boolean(session))
      : await this.options.getSessions()
    const states = targeted
      ? (await Promise.all(sessions.map(session => this.options.store.getState(this.options.accountId, session.id))))
        .filter((state): state is NonNullable<typeof state> => Boolean(state))
      : await this.options.store.getStates(this.options.accountId)
    const machines = this.options.getMachines()
    const retainedIds = new Set(sessions.map(session => session.id))
    for (const id of targeted ? sessionIds : this.retries.keys()) {
      if (!retainedIds.has(id)) this.retries.delete(id)
    }
    const statesBySession = new Map(states.map((state) => [state.sessionId, state]))
    const machinesById = new Map(machines.map((machine) => [machine.id, machine]))
    const candidates: ReplicaCandidate[] = []
    for (const session of sessions) {
      if (session.lastBodyCommittedAt) {
        this.targetCommittedAt.set(session.id, session.lastBodyCommittedAt)
      }
      if (
        session.deletedAt || session.bodyStorageMode !== 'machine_local' ||
        session.localReady !== true || !Number.isSafeInteger(session.bodyRevision)
      ) { this.retries.delete(session.id); continue }
      const machine = machinesById.get(session.machineId)
      if (!supportsBodyReplica(machine) && !(this.options.readCloudPage && supportsBodyIdentity(machine))) {
        this.retries.delete(session.id)
        continue
      }
      const state = statesBySession.get(session.id) ?? null
      if (state?.deleted) { this.retries.delete(session.id); continue }
      const cachedRevision = state?.cachedBodyRevision ?? 0
      const targetRevision = Math.max(
        session.bodyRevision ?? 0,
        this.streamHighWater.get(session.id) ?? 0,
      )
      // The body Relay and the lightweight index are independent transports.
      // A live delta or a one-shot sync response can therefore advance the
      // durable phone replica before the matching index event reaches the App.
      // Treat the index as a lower-bound target: cache-ahead is already safe
      // and must never trigger an authoritative snapshot repair.
      if (cachedRevision >= targetRevision) {
        // A stream can finish a previously failed one-shot sync. Leaving its
        // expired retry behind schedules a 0ms full scan forever on every page.
        this.retries.delete(session.id)
        continue
      }
      if (this.isDeferred(session.id, targetRevision)) continue
      candidates.push({ session, machine: machine!, targetRevision })
    }
    const currentSessionId = this.options.getCurrentSessionId()
    return candidates.sort((left, right) => compareCandidates(left, right, currentSessionId))
  }

  private async syncCandidate(candidate: ReplicaCandidate, requireTarget = true): Promise<void> {
    const manager = this.options.getRelayManager()
    const daemonInstallationId = candidate.machine.daemonInstallationId
    if (!daemonInstallationId) throw new Error('invalid_machine_identity')
    let state = await this.options.store.getState(this.options.accountId, candidate.session.id)
    let pageTarget = candidate.targetRevision
    if (state && state.cachedBodyRevision > pageTarget) return
    while (!this.stopped) {
      const afterRevision = state?.cachedBodyRevision ?? 0
      if (afterRevision >= pageTarget) break
      const syncId = `replica_${generateTraceId()}`
      incrementRuntimeMetric('personal_body_replica.gap_syncs')
      const params: SessionHistorySyncParams = {
        ...personalIdentity(daemonInstallationId), sessionId: candidate.session.id,
        syncId, afterRevision, limit: SESSION_HISTORY_LIMITS.maxDeltaMutations,
      }
      let page: SessionHistorySyncPage | undefined
      if (this.options.readCloudPage) {
        try {
          page = assertSyncPage(await this.options.readCloudPage(params), candidate.session.id, syncId, daemonInstallationId)
          if (page.fromRevision !== afterRevision) throw new Error('cloud_revision_mismatch')
        } catch {
          // Additive rollout: old/disabled Servers, a cloud lag, or a phone
          // already ahead via the live stream continue through the daemon.
          page = undefined
        }
      }
      if (!page) {
        if (!manager || !candidate.machine.online) throw new Error('cloud_or_machine_unavailable')
        const response = await manager.sendWhenReady(candidate.machine.id, {
          type: 'req', method: 'session.history.sync', params,
        }, 5_000, 30_000)
        if (!response.ok) throw new Error(response.error || 'history_sync_failed')
        page = assertSyncPage(response.payload, candidate.session.id, syncId, daemonInstallationId)
      }
      if (this.stopped) return
      pageTarget = page.targetRevision
      const latestState = await this.options.store.getState(
        this.options.accountId,
        candidate.session.id,
      )
      const latestRevision = latestState?.cachedBodyRevision ?? 0
      if (latestRevision >= page.toRevision) {
        state = latestState
        if (latestRevision >= pageTarget) break
        continue
      }
      if (latestRevision !== page.fromRevision) {
        state = latestState
        continue
      }
      if (page.mutations.length === 0) {
        if (page.toRevision !== afterRevision || page.hasMore) throw new Error('empty_history_sync_page')
        break
      }
      state = await this.options.store.applyDelta(this.options.accountId, {
        ...page,
        subscriptionId: syncId,
      })
      await this.options.onSessionCommitted?.(candidate.session.id)
      this.recordConvergence(candidate.session.id)
      incrementRuntimeMetric('personal_body_replica.pages')
      incrementRuntimeMetric('personal_body_replica.mutations', page.mutations.length)
      incrementRuntimeMetric(
        'personal_body_replica.bytes',
        JSON.stringify(page.mutations).length,
      )
      if (!page.hasMore) break
    }
    // The cloud replica may be between commits. Keep retrying toward the index
    // without clearing a partially downloaded local history or publishing it early.
    const committed = await this.options.store.getState(this.options.accountId, candidate.session.id)
    if (requireTarget && (committed?.cachedBodyRevision ?? 0) < candidate.targetRevision) throw new Error('cloud_history_pending')
  }

  private isDeferred(sessionId: string, targetRevision: number): boolean {
    const retry = this.retries.get(sessionId)
    if (!retry) return false
    if (targetRevision > retry.targetRevision) {
      this.retries.delete(sessionId)
      return false
    }
    return retry.nextAttemptAt > Date.now()
  }

  private deferCandidate(candidate: ReplicaCandidate): void {
    const sessionId = candidate.session.id
    const targetRevision = candidate.targetRevision
    const previous = this.retries.get(sessionId)
    const attempts = previous?.targetRevision === targetRevision ? previous.attempts + 1 : 1
    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.min(attempts - 1, 6), RETRY_MAX_DELAY_MS)
    this.retries.set(sessionId, {
      targetRevision,
      attempts,
      nextAttemptAt: Date.now() + delay,
    })
  }

  private scheduleNextRetry(): void {
    if (this.stopped || this.retryTimer || this.retries.size === 0) return
    const nextAttemptAt = Math.min(...[...this.retries.values()].map((retry) => retry.nextAttemptAt))
    this.scheduleRetryTimer(Math.max(0, nextAttemptAt - Date.now()))
  }

  private scheduleRetryTimer(delayMs: number): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.requestSync()
    }, delayMs)
  }

  private reconcileStreams(machines: Machine[]): void {
    const manager = this.options.getRelayManager()
    if (!manager) return
    const desired = new Set<string>()
    for (const machine of machines) {
      if (!supportsBodyReplicaStream(machine)) continue
      desired.add(machine.id)
      const existing = this.streams.get(machine.id)
      if (existing && existing.daemonInstallationId === machine.daemonInstallationId) {
        if (!existing.subscribed && !existing.subscribing
          && existing.handle.getState() === 'connected') void this.subscribeStream(existing)
        continue
      }
      if (existing) this.releaseStream(existing, true)
      const daemonInstallationId = machine.daemonInstallationId!
      const streamId = `body_${this.options.appInstallationId}_${machine.id}`
      const eventHandler = (event: Parameters<RelayEventHandler>[1]) => {
        if (event.event === 'session.body.replica.delta') {
          void this.applyReplicaEvent(machine.id, event.payload)
        } else if (event.event === 'session.body.replica.error') {
          stream.subscribed = false
          incrementRuntimeMetric('personal_body_replica.stream_failed')
          reportPersonalBodyReplicaFailure('stream_event', { machineId: machine.id })
          this.scheduleRetryTimer(RETRY_BASE_DELAY_MS)
        }
      }
      const handle = manager.acquire(machine.id, eventHandler)
      if (!handle) continue
      const stream: MachineReplicaStream = {
        machineId: machine.id,
        daemonInstallationId,
        streamId,
        generation: 0,
        subscribed: false,
        subscribing: null,
        handle,
        eventHandler,
        unsubscribeState: () => {},
      }
      stream.unsubscribeState = manager.onStateChange(machine.id, (state) => {
        if (state === 'connected') void this.subscribeStream(stream)
        else stream.subscribed = false
      })
      this.streams.set(machine.id, stream)
      if (handle.getState() === 'connected') void this.subscribeStream(stream)
    }
    for (const [machineId, stream] of this.streams.entries()) {
      if (desired.has(machineId)) continue
      this.releaseStream(stream, true)
      this.streams.delete(machineId)
    }
    setRuntimeGauge('personal_body_replica.active_streams', this.streams.size)
  }

  private subscribeStream(stream: MachineReplicaStream): Promise<void> {
    if (this.stopped || stream.subscribed) return Promise.resolve()
    if (stream.subscribing) return stream.subscribing
    // A coordinator can remount while its previous unsubscribe is still in
    // flight. Generation must remain strictly monotonic across coordinators;
    // otherwise a late generation-1 unsubscribe can delete the replacement
    // generation-1 stream while the replacement still believes it is live.
    const generation = nextPersonalBodyReplicaGeneration(stream.generation)
    const work = stream.handle.send({
      type: 'req',
      method: 'session.body.replica.subscribe',
      params: {
        ...personalIdentity(stream.daemonInstallationId),
        appInstallationId: this.options.appInstallationId,
        streamId: stream.streamId,
        generation,
      },
    }, 30_000).then((response) => {
      if (!response.ok) throw new Error(response.error || 'body_replica_subscribe_failed')
      const payload = assertReplicaSubscribeResponse(
        response.payload,
        this.options.appInstallationId,
        stream,
        generation,
      )
      stream.generation = generation
      stream.subscribed = true
      for (const item of payload.highWatermarks) {
        this.rememberHighWater(item.sessionId, item.bodyRevision)
      }
      incrementRuntimeMetric('personal_body_replica.stream_subscribed')
      return this.requestSync()
    }).catch((error) => {
      stream.subscribed = false
      incrementRuntimeMetric('personal_body_replica.stream_failed')
      reportPersonalBodyReplicaFailure('stream_subscribe', {
        machineId: stream.machineId,
        error,
      })
      this.scheduleRetryTimer(RETRY_BASE_DELAY_MS)
    }).finally(() => {
      if (stream.subscribing === work) stream.subscribing = null
    })
    stream.subscribing = work
    return work
  }

  private async applyReplicaEvent(machineId: string, payload: unknown): Promise<void> {
    const stream = this.streams.get(machineId)
    const delta = payload as SessionBodyReplicaDeltaEvent | undefined
    if (!stream || !delta || delta.streamId !== stream.streamId
      || delta.appInstallationId !== this.options.appInstallationId
      || delta.generation !== stream.generation
      || delta.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION
      || delta.dataEpoch !== SESSION_SYNC_DATA_EPOCH
      || delta.daemonInstallationId !== stream.daemonInstallationId
      || !Array.isArray(delta.batches)) return
    for (const batch of delta.batches) {
      this.rememberHighWater(batch.sessionId, batch.toRevision)
      const state = await this.options.store.getState(this.options.accountId, batch.sessionId)
      if ((state?.cachedBodyRevision ?? 0) >= batch.toRevision) continue
      try {
        await this.options.store.applyDelta(this.options.accountId, {
          protocolVersion: delta.protocolVersion,
          dataEpoch: delta.dataEpoch,
          daemonInstallationId: delta.daemonInstallationId,
          sessionId: batch.sessionId,
          subscriptionId: stream.streamId,
          fromRevision: batch.fromRevision,
          toRevision: batch.toRevision,
          mutations: batch.mutations,
        })
        await this.options.onSessionCommitted?.(batch.sessionId)
        this.recordConvergence(batch.sessionId)
        incrementRuntimeMetric('personal_body_replica.stream_batches')
        incrementRuntimeMetric('personal_body_replica.mutations', batch.mutations.length)
        incrementRuntimeMetric(
          'personal_body_replica.bytes',
          JSON.stringify(batch.mutations).length,
        )
      } catch (error) {
        if (!(error instanceof PersonalBodyRevisionError && error.code === 'revision_gap')) {
          incrementRuntimeMetric('personal_body_replica.sessions_failed')
        }
        reportPersonalBodyReplicaFailure('stream_event', {
          sessionId: batch.sessionId,
          machineId,
          error,
        })
        if (this.options.getSession) this.pendingSessionIds.add(batch.sessionId)
        else this.fullRefreshRequested = true
        this.rerunRequested = true
      }
    }
    if (this.rerunRequested) void this.ensureRunning()
  }

  private rememberHighWater(sessionId: string, bodyRevision: number): void {
    if (!sessionId || !Number.isSafeInteger(bodyRevision) || bodyRevision < 0) return
    this.streamHighWater.set(
      sessionId,
      Math.max(this.streamHighWater.get(sessionId) ?? 0, bodyRevision),
    )
  }

  private recordConvergence(sessionId: string): void {
    const committedAt = this.targetCommittedAt.get(sessionId)
    if (!committedAt) return
    const elapsed = Date.now() - Date.parse(committedAt)
    if (!Number.isFinite(elapsed) || elapsed < 0) return
    incrementRuntimeMetric('personal_body_replica.convergence_ms', elapsed)
    incrementRuntimeMetric('personal_body_replica.convergence_samples')
  }

  private releaseStream(stream: MachineReplicaStream, notifyDaemon: boolean): void {
    stream.unsubscribeState()
    const manager = this.options.getRelayManager()
    const release = () => manager?.release(stream.machineId, stream.eventHandler)
    if (notifyDaemon && stream.subscribed && stream.handle.getState() === 'connected') {
      void stream.handle.send({
        type: 'req', method: 'session.body.replica.unsubscribe',
        params: {
          ...personalIdentity(stream.daemonInstallationId),
          appInstallationId: this.options.appInstallationId,
          streamId: stream.streamId,
          generation: stream.generation,
        },
      }, 1_500).catch((error) => {
        reportPersonalBodyReplicaFailure('stream_unsubscribe', {
          machineId: stream.machineId,
          error,
        })
      }).finally(release)
    } else {
      release()
    }
    stream.subscribed = false
  }
}

function supportsBodyIdentity(machine: Machine | undefined): machine is Machine {
  return Boolean(machine?.daemonInstallationId
    && machine.sessionSyncProtocolVersion === SESSION_SYNC_PROTOCOL_VERSION
    && machine.sessionSyncDataEpoch === SESSION_SYNC_DATA_EPOCH
    && machine.sessionSyncCapabilities?.includes(BODY_REPLICA_CAPABILITY))
}

function supportsBodyReplica(machine: Machine | undefined): machine is Machine {
  return Boolean(
    machine?.online && machine.daemonInstallationId &&
    machine.sessionSyncProtocolVersion === SESSION_SYNC_PROTOCOL_VERSION &&
    machine.sessionSyncDataEpoch === SESSION_SYNC_DATA_EPOCH &&
    machine.sessionSyncCapabilities?.includes(BODY_REPLICA_CAPABILITY),
  )
}

function supportsBodyReplicaStream(machine: Machine | undefined): machine is Machine {
  return supportsBodyReplica(machine)
    && Boolean(machine.sessionSyncCapabilities?.includes(BODY_REPLICA_STREAM_CAPABILITY))
}

function compareCandidates(
  left: ReplicaCandidate,
  right: ReplicaCandidate,
  currentSessionId: string | null,
): number {
  if (left.session.id === currentSessionId && right.session.id !== currentSessionId) return -1
  if (right.session.id === currentSessionId && left.session.id !== currentSessionId) return 1
  const attention = (right.session.attentionCount ?? 0) - (left.session.attentionCount ?? 0)
  if (attention !== 0) return attention
  const leftActivity = new Date(
    left.session.lastVisibleEventAt ?? left.session.lastMessagePreviewAt ?? left.session.lastActivityAt,
  ).getTime()
  const rightActivity = new Date(
    right.session.lastVisibleEventAt ?? right.session.lastMessagePreviewAt ?? right.session.lastActivityAt,
  ).getTime()
  return (Number.isFinite(rightActivity) ? rightActivity : 0) -
    (Number.isFinite(leftActivity) ? leftActivity : 0)
}

function assertReplicaSubscribeResponse(
  value: unknown,
  appInstallationId: string,
  stream: Pick<MachineReplicaStream, 'streamId' | 'daemonInstallationId'>,
  generation: number,
): SessionBodyReplicaSubscribeResponse {
  const response = value as SessionBodyReplicaSubscribeResponse | undefined
  if (!response || response.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION
    || response.dataEpoch !== SESSION_SYNC_DATA_EPOCH
    || response.daemonInstallationId !== stream.daemonInstallationId
    || response.appInstallationId !== appInstallationId
    || response.streamId !== stream.streamId
    || response.generation !== generation
    || !Array.isArray(response.highWatermarks)
    || response.highWatermarks.some((item) => !item || typeof item.sessionId !== 'string'
      || !item.sessionId || !Number.isSafeInteger(item.bodyRevision) || item.bodyRevision < 0)) {
    throw new Error('invalid_body_replica_subscribe_response')
  }
  return response
}

function personalIdentity(daemonInstallationId: string) {
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
  }
}

function assertIdentity(
  value: { protocolVersion?: unknown; dataEpoch?: unknown; daemonInstallationId?: unknown },
  daemonInstallationId: string,
): void {
  if (
    value.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    value.dataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    value.daemonInstallationId !== daemonInstallationId
  ) throw new Error('invalid_history_sync_identity')
}

export function assertSyncPage(
  value: unknown,
  sessionId: string,
  syncId: string,
  daemonInstallationId: string,
): SessionHistorySyncPage {
  const page = value as SessionHistorySyncPage | undefined
  if (
    !page || page.sessionId !== sessionId || page.syncId !== syncId ||
    !Number.isSafeInteger(page.fromRevision) || !Number.isSafeInteger(page.toRevision) ||
    !Number.isSafeInteger(page.targetRevision) || page.toRevision < page.fromRevision ||
    page.targetRevision < page.toRevision || typeof page.hasMore !== 'boolean' ||
    page.hasMore !== (page.toRevision < page.targetRevision) || !Array.isArray(page.mutations)
  ) throw new Error('invalid_history_sync_page')
  assertIdentity(page, daemonInstallationId)
  if (page.mutations.some((mutation) => mutation.subscriptionId !== syncId)) {
    throw new Error('invalid_history_sync_mutation_identity')
  }
  return page
}
