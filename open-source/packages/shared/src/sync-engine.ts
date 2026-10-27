// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine.test.ts

import type {
  AgentInfo,
  ChatQueueSnapshot,
  EventFrame,
  Machine,
  NianProject,
  NianSession,
  SessionActivitySnapshot,
  SessionUserState,
  UpgradeEventPayload,
} from '@shennian/wire'
import { buildProjectKey } from './lib/project-list'
import { isProjectVisibleSession } from './lib/session-list'
import { mergeSessionPatch, normalizeSession } from './lib/sync-session-state'
import { incrementRuntimeMetric } from './runtime-metrics'

import { DEFAULT_SESSIONS_PAGE_SIZE, apiErrorStatus, toMs } from './sync-engine-types'
import { SyncSessionRuntime } from './sync-session-runtime'
export { DEFAULT_SESSIONS_PAGE_SIZE } from './sync-engine-types'
export type { ApiClient, ChangeNotifier, SyncEngineOptions } from './sync-engine-types'

export class SyncEngine extends SyncSessionRuntime {
  // ─── Phase 1: Boot (local-first, incremental sync) ───

  async boot(options: { localOnly?: boolean } = {}): Promise<void> {
    if (this.booted) return
    this.booted = true

    this.onChange.onSyncStart?.()
    try {
      await this.ensureCacheVersion()

      // ① Read local cache → push to Zustand → UI renders immediately
      console.log('[SyncEngine] boot start, reading local cache')
      const [localSessions, localMachines, localProjects] = await Promise.all([
        this.store.getSessions().catch(() => [] as NianSession[]),
        this.store.getMachines().catch(() => [] as Machine[]),
        this.store.getProjects().catch(() => [] as NianProject[]),
      ])

      this.onChange.onSessionsChange(localSessions.filter(isProjectVisibleSession))
      for (const session of localSessions) {
        this.activityCache.set(session.id, { session, lastCheckpointAt: Date.now() })
      }
      this.onChange.onMachinesChange(localMachines)
      this.knownMachineIds = new Set(localMachines.map((machine) => machine.id))
      this.onChange.onProjectsChange(localProjects)

      const hasLocalSessions = localSessions.length > 0
      console.log(
        `[SyncEngine] local cache: ${localSessions.length} sessions, ${localMachines.length} machines`,
      )

      // Desktop can restore an authenticated account while the refresh request is
      // offline. Publish the durable projection without attempting any API or
      // Relay work; the auth token effect will create a fresh online engine later.
      if (options.localOnly) {
        await this.rollbackPendingSessionDeletions().catch(() => {})
        console.log('[SyncEngine] local-only boot done')
        return
      }

      // ② Incremental session sync + full machine sync
      await this.syncRemote({ hasLocalSessions }).catch((e) => {
        console.warn('[SyncEngine] syncRemote failed:', e)
      })
      await this.rollbackPendingSessionDeletions().catch(() => {})
      await this.retryPendingReadStates().catch(() => {})

      console.log('[SyncEngine] boot done')
    } catch (e) {
      console.error('[SyncEngine] boot crashed:', e)
      this.onChange.onSessionsChange([])
      this.onChange.onMachinesChange([])
    } finally {
      // Sessions are ready — end the sync indicator before background message backfill.
      this.onChange.onSyncEnd?.()
    }

    // Complete the lightweight index in the background. The native App-level
    // body replica coordinator observes each published batch and independently
    // catches every personal transcript up by revision.
    void this.backfillAllSessionMetadata()
  }

  protected async backfillAllSessionMetadata(): Promise<void> {
    const complete = await this.store.getSessionBackfillComplete().catch(() => false)
    if (complete) return

    let before = await this.store.getSessionBackfillCursor().catch(() => 0)
    while (this.hasMoreRemoteSessions) {
      const page = await this.loadMoreSessions({ limit: 100, before })
      if (page.nextBefore) {
        before = page.nextBefore
        await this.store.setSessionBackfillCursor(before).catch(() => {})
      }
      if (!page.hasMore) break
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (!this.hasMoreRemoteSessions) {
      await this.store.setSessionBackfillComplete(true).catch(() => {})
    }
  }

  async loadProjectSessions(
    projectId: string,
    opts?: { limit?: number; before?: number },
  ): Promise<{ loaded: number; hasMore: boolean; nextBefore: number | null }> {
    const generation = (this.projectSessionLoadGenerations.get(projectId) ?? 0) + 1
    this.projectSessionLoadGenerations.set(projectId, generation)
    const limit = opts?.limit ?? 100
    const query = new URLSearchParams({ limit: String(limit) })
    if (opts?.before) query.set('before', String(opts.before))
    const path = `/projects/${encodeURIComponent(projectId)}/sessions?${query.toString()}`
    try {
      const res = await this.api<{ sessions: NianSession[]; hasMore?: boolean }>(path)
      if (this.projectSessionLoadGenerations.get(projectId) !== generation) {
        return { loaded: 0, hasMore: true, nextBefore: null }
      }
      const sessions = res.sessions ?? []
      const changed = await this.applySessionBatch(sessions)
      if (changed) await this.publishSessionsFromStore()
      const nextBefore = sessions.length
        ? Math.min(...sessions.map((session) => toMs(session.lastActivityAt)))
        : null
      return {
        loaded: sessions.length,
        hasMore: res.hasMore ?? sessions.length >= limit,
        nextBefore,
      }
    } catch (error) {
      const authorityFailure = [401, 403, 404].includes(apiErrorStatus(error) ?? 0)
      if (
        authorityFailure &&
        this.projectSessionLoadGenerations.get(projectId) === generation
      ) {
        await this.discardProjectProjection(projectId).catch(() => {})
      }
      throw error
    } finally {
      if (this.projectSessionLoadGenerations.get(projectId) === generation) {
        this.projectSessionLoadGenerations.delete(projectId)
      }
    }
  }

  protected async discardProjectProjection(projectId: string): Promise<void> {
    const [projects, sessions] = await Promise.all([
      this.store.getProjects(),
      this.getSessionSyncTargets(),
    ])
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    const projectKey = buildProjectKey(project.machineId, project.workDir)
    const removedSessionIds = sessions
      .filter(
        (session) => buildProjectKey(session.machineId, session.workDir) === projectKey,
      )
      .map((session) => session.id)
    for (const sessionId of removedSessionIds) {
      await this.store.deleteSession(sessionId)
      this.activityCache.delete(sessionId)
      this.onChange.onSessionDelete(sessionId)
    }
    const remainingProjects = projects.filter((item) => item.id !== projectId)
    await this.store.putProjects(remainingProjects)
    this.onChange.onProjectsChange(remainingProjects)
  }

  protected async ensureCacheVersion(): Promise<void> {
    if (!this.cacheVersion) return

    const storedVersion = await this.store.getSyncCacheVersion().catch(() => null)
    if (storedVersion === this.cacheVersion) return

    console.log(
      `[SyncEngine] sync cache version changed: ${storedVersion} -> ${this.cacheVersion}; rebuilding local sync cache`,
    )
    await this.resetPersonalDataForEpoch()
    await this.store.setSyncCacheVersion(this.cacheVersion)
    this.hasMoreRemoteSessions = true
    this.loadingMoreSessions = false
  }

  protected async resetPersonalDataForEpoch(): Promise<void> {
    if (this.store.resetPersonalData) await this.store.resetPersonalData()
    else await this.store.clearAll()
    await this.onPersonalDataReset?.()
    this.sessionDeletionBarriers.clear()
    this.activityCache.clear()
  }

  protected async syncRemote(opts: { hasLocalSessions: boolean }): Promise<void> {
    if (this.remoteSyncInFlight) return this.remoteSyncInFlight
    const run = this.runRemoteSync(opts)
    this.remoteSyncInFlight = run
    try {
      await run
    } finally {
      if (this.remoteSyncInFlight === run) this.remoteSyncInFlight = null
    }
  }

  protected async runRemoteSync(opts: { hasLocalSessions: boolean }): Promise<void> {
    console.log('[SyncEngine] syncRemote start, hasLocalSessions =', opts.hasLocalSessions)
    let sessionSyncSucceeded = true
    const sessionSync = opts.hasLocalSessions
      ? this.syncSessionDeltas().then(() =>
          this.backfillRecentSessions({ limit: DEFAULT_SESSIONS_PAGE_SIZE }),
        )
      : this.loadMoreSessions({ limit: DEFAULT_SESSIONS_PAGE_SIZE })
    const guardedSessionSync = sessionSync.catch((e) => {
      sessionSyncSucceeded = false
      console.warn('[SyncEngine] session sync failed:', e)
    })
    const machinesReq = this.api<{ machines: Machine[] }>('/machines').catch((e) => {
      console.warn('[SyncEngine] GET /machines failed:', e)
      return null
    })
    const projectsReq = this.api<{ projects: NianProject[] }>('/projects').catch((e) => {
      console.warn('[SyncEngine] GET /projects failed:', e)
      return null
    })
    const [, machinesRes, projectsRes] = await Promise.all([
      guardedSessionSync,
      machinesReq,
      projectsReq,
    ])

    if (sessionSyncSucceeded) {
      await this.refreshSessionActivities().catch(() => {})
    }

    if (machinesRes?.machines) {
      this.applyMachineInventoryBarriers(machinesRes.machines)
      await this.store.putMachines(machinesRes.machines)
      const pruned = await this.pruneSessionsForMachines(machinesRes.machines)
      if (pruned) await this.publishSessionsFromStore()
      await this.pruneProjectsForMachines(machinesRes.machines)
      this.onChange.onMachinesChange(machinesRes.machines)
      this.onChange.onMachinesRemoteResolved?.()
    }
    if (projectsRes?.projects) {
      const accessibleMachineIds = machinesRes?.machines
        ? new Set(machinesRes.machines.map((machine) => machine.id))
        : null
      const projects = accessibleMachineIds
        ? projectsRes.projects.filter((project) => accessibleMachineIds.has(project.machineId))
        : projectsRes.projects
      await this.store.putProjects(projects)
      this.onChange.onProjectsChange(projects)
    }
  }

  protected async publishSessionsFromStore(): Promise<NianSession[]> {
    const sessions = await this.store.getSessions().catch(() => [])
    this.onChange.onSessionsChange(sessions.filter(isProjectVisibleSession))
    return sessions
  }

  protected getSessionSyncTargets(): Promise<NianSession[]> {
    return this.store.getSessionSyncTargets?.() ?? this.store.getSessions()
  }

  protected getSessionSyncTarget(sessionId: string): Promise<NianSession | undefined> {
    return this.store.getSessionSyncTarget?.(sessionId) ?? this.store.getSession(sessionId)
  }

  protected async publishSessionFromStore(sessionId: string): Promise<NianSession | undefined> {
    const published = await this.store.getSession(sessionId).catch(() => undefined)
    if (published && isProjectVisibleSession(published)) this.onChange.onSessionUpdate(published)
    return published
  }

  protected async applySessionBatch(sessions: NianSession[]): Promise<boolean> {
    if (sessions.length === 0) return false
    const incomingIds = [...new Set(sessions.map((session) => session.id))]
    const hasBatchReads = Boolean(this.store.getSessionDeletionBatch)
    const [existingSessions, deletionIds] = hasBatchReads
      ? await Promise.all([
          this.getSessionSyncTargets(),
          this.store.getSessionDeletionBatch!(incomingIds),
        ])
      : [[], []]
    const existingById = new Map(existingSessions.map((session) => [session.id, session]))
    const deletionBarriers = hasBatchReads ? new Set(deletionIds) : null
    const upserts: NianSession[] = []
    let changed = false
    for (const incoming of sessions) {
      let session = normalizeSession(incoming)
      if (session.deletedAt) {
        await this.confirmLocalSessionDeletion(session.id, session.deletedAt)
        changed = true
        continue
      }
      const deletion = deletionBarriers
        ? deletionBarriers.has(session.id)
        : Boolean(await this.store.getSessionDeletion(session.id))
      if (deletion || this.sessionDeletionBarriers.has(session.id)) continue
      const existing = hasBatchReads
        ? existingById.get(session.id)
        : await this.getSessionSyncTarget(session.id)
      if (existing) {
        session = mergeSessionPatch(existing, session)
      }
      existingById.set(session.id, session)
      upserts.push(session)
      changed = true
    }
    if (upserts.length > 0) await this.store.putSessions(upserts)
    if (changed) this.onChange.onSessionIndexTargetChange?.()
    return changed
  }

  protected async getLatestSessionUpdatedAt(): Promise<number> {
    const sessions = await this.getSessionSyncTargets().catch(() => [])
    return sessions.reduce((max, session) => Math.max(max, toMs(session.updatedAt)), 0)
  }

  protected async getSessionSyncCursor(): Promise<number> {
    const persisted = await this.store.getSessionSyncCursor().catch(() => 0)
    if (persisted > 0) return persisted

    const fallback = await this.getLatestSessionUpdatedAt()
    if (fallback > 0) {
      await this.store.setSessionSyncCursor(fallback)
    }
    return fallback
  }

  protected async getOldestSessionActivityAt(): Promise<number> {
    const sessions = await this.getSessionSyncTargets().catch(() => [])
    if (sessions.length === 0) return 0
    return sessions.reduce((min, session) => {
      const activityAt = toMs(session.lastActivityAt || session.updatedAt)
      return min === 0 ? activityAt : Math.min(min, activityAt)
    }, 0)
  }

  protected async syncSessionDeltas(): Promise<void> {
    let cursor = await this.getSessionSyncCursor()
    let changed = false
    let maxSeenCursor = cursor

    while (cursor > 0) {
      const res = await this.api<{ sessions: NianSession[] }>(
        `/sessions?updatedAfter=${cursor}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`,
      ).catch(() => null)
      const batch = res?.sessions ?? []
      if (batch.length === 0) break
      const applied = await this.applySessionBatch(batch)
      changed = changed || applied
      cursor = Math.max(cursor, ...batch.map((session) => toMs(session.updatedAt)))
      maxSeenCursor = Math.max(maxSeenCursor, cursor)
      if (batch.length < DEFAULT_SESSIONS_PAGE_SIZE) break
    }

    if (maxSeenCursor > 0) {
      await this.store.setSessionSyncCursor(maxSeenCursor)
    }

    if (changed) {
      await this.publishSessionsFromStore()
    }
  }

  protected async backfillRecentSessions(opts?: { limit?: number }): Promise<void> {
    const limit = opts?.limit ?? DEFAULT_SESSIONS_PAGE_SIZE
    const path = `/sessions?limit=${limit}`
    const res = await this.api<{ sessions: NianSession[] }>(path).catch((e) => {
      console.warn('[SyncEngine] GET', path, 'failed:', e)
      return null
    })
    const sessions = res?.sessions ?? []
    if (sessions.length === 0) return
    console.log(`[SyncEngine] backfillRecentSessions: ${sessions.length} sessions from server`)
    const changed = await this.applySessionBatch(sessions)
    if (changed) {
      await this.publishSessionsFromStore()
    }
  }

  /**
   * Debounced backfill: coalesces rapid calls (e.g. from multiple live events
   * arriving for a not-yet-local session) into a single server request.
   */
  protected backfillMissingSessions(): Promise<void> {
    const now = Date.now()
    if (this.pendingBackfill && now - this.lastBackfillAt < 3000) {
      return this.pendingBackfill
    }
    this.lastBackfillAt = now
    this.pendingBackfill = this.backfillRecentSessions({ limit: 10 }).finally(() => {
      this.pendingBackfill = null
    })
    return this.pendingBackfill
  }

  async loadMoreSessions(opts?: { limit?: number; before?: number }): Promise<{
    loaded: number
    hasMore: boolean
    nextBefore: number | null
  }> {
    if (this.loadingMoreSessions) {
      return { loaded: 0, hasMore: this.hasMoreRemoteSessions, nextBefore: null }
    }
    this.loadingMoreSessions = true
    try {
      const limit = opts?.limit ?? DEFAULT_SESSIONS_PAGE_SIZE
      const before = opts?.before ?? (await this.getOldestSessionActivityAt())
      const path =
        before > 0 ? `/sessions?limit=${limit}&before=${before}` : `/sessions?limit=${limit}`
      const res = await this.api<{ sessions: NianSession[] }>(path).catch((e) => {
        console.warn('[SyncEngine] GET', path, 'failed:', e)
        return null
      })
      const sessions = res?.sessions ?? []
      console.log(`[SyncEngine] loadMoreSessions: ${sessions.length} sessions from server`)
      if (sessions.length === 0) {
        this.hasMoreRemoteSessions = false
        await this.publishSessionsFromStore()
        return { loaded: 0, hasMore: false, nextBefore: null }
      }

      const changed = await this.applySessionBatch(sessions)
      this.hasMoreRemoteSessions = sessions.length >= limit
      if (changed) {
        await this.publishSessionsFromStore()
      }
      return {
        loaded: sessions.length,
        hasMore: this.hasMoreRemoteSessions,
        nextBefore: Math.min(...sessions.map((session) => toMs(session.lastActivityAt))),
      }
    } finally {
      this.loadingMoreSessions = false
    }
  }

  async refreshSessionActivities(): Promise<void> {
    const [localSessions, res] = await Promise.all([
      this.getSessionSyncTargets().catch(() => []),
      this.api<{ activities: SessionActivitySnapshot[] }>('/sessions/activities').catch(() => null),
    ])

    if (!res?.activities) return

    const activityMap = new Map(res.activities.map((activity) => [activity.sessionId, activity]))
    const now = Date.now()
    const changedSessions: NianSession[] = []
    for (const session of localSessions) {
      const nextActivity = activityMap.get(session.id) ?? null
      const nextSession = { ...session, activity: nextActivity }
      // The server snapshot is authoritative after reconnect. Refresh the
      // in-memory baseline even when only updatedAt differs, otherwise the
      // next heartbeat could resurrect a stale pre-reconnect projection.
      this.activityCache.set(session.id, { session: nextSession, lastCheckpointAt: now })
      const sameActivity = JSON.stringify(session.activity ?? null) === JSON.stringify(nextActivity)
      if (sameActivity) continue
      changedSessions.push(nextSession)
    }

    if (changedSessions.length > 0) {
      await this.store.putSessions(changedSessions)
      incrementRuntimeMetric('storage.activity_recovery_transactions')
      incrementRuntimeMetric('storage.activity_recovery_sessions', changedSessions.length)
      await this.publishSessionsFromStore()
    }
  }

  // ─── Phase 2: Live Sync (relay event handling) ────────

  handleRelayEvent(event: EventFrame): void {
    if (event.event === 'session.update') {
      const payload = event.payload as
        | { session: Partial<NianSession> & Pick<NianSession, 'id'> }
        | undefined
      if (payload?.session) {
        void this.handleSessionPatch(payload.session)
      }
    } else if (event.event === 'session.delete') {
      const payload = event.payload as {
        sessionId: string
        deletedAt?: string
        deletionRevision?: number
      } | undefined
      if (payload?.sessionId) {
        if (this.sessionDeletionBarriers.has(payload.sessionId)) return
        const repairTimer = this.sessionRepairTimers.get(payload.sessionId)
        if (repairTimer) clearTimeout(repairTimer)
        this.sessionRepairTimers.delete(payload.sessionId)
        this.sessionRepairAttempts.delete(payload.sessionId)
        this.activityCache.delete(payload.sessionId)
        this.sessionDeletionBarriers.add(payload.sessionId)
        void this.confirmLocalSessionDeletion(payload.sessionId, payload.deletedAt).catch((error) => {
          console.warn('[SyncEngine] session deletion projection failed:', error)
        })
        this.onChange.onSessionDelete(payload.sessionId, payload.deletionRevision)
      }
    } else if (event.event === 'session.user-state') {
      const payload = event.payload as
        | { sessionId: string; userState: SessionUserState | null }
        | undefined
      if (payload?.sessionId) {
        void this.handleSessionUserState(payload.sessionId, payload.userState ?? null)
      }
    } else if (event.event === 'session.activity') {
      const payload = event.payload as
        | { sessionId: string; activity: SessionActivitySnapshot | null }
        | undefined
      if (payload?.sessionId) {
        this.handleSessionActivity(payload.sessionId, payload.activity)
      }
    } else if (event.event === 'machine.removed') {
      // The server inventory is authoritative. Re-fetching removes the revoked
      // machine and prunes only personal sessions that are no longer accessible.
      const payload = event.payload as { machineId?: string } | undefined
      if (payload?.machineId) {
        this.removedMachineIds.add(payload.machineId)
        this.knownMachineIds.delete(payload.machineId)
        this.store.updateMachineStatus(payload.machineId, false).catch(() => {})
        this.onChange.onMachineStatus(payload.machineId, false)
        this.onChange.onMachineRemoved?.(payload.machineId)
      }
      void this.refreshMachines()
    } else if (event.event === 'machine.status') {
      const payload = event.payload as
        | {
            machineId: string
            online: boolean
            region?: string
            cliVersion?: string
            autoUpgrade?: 'none' | 'patch'
            sessionSyncProtocolVersion?: Machine['sessionSyncProtocolVersion']
            sessionSyncDataEpoch?: Machine['sessionSyncDataEpoch']
            sessionSyncCapabilities?: Machine['sessionSyncCapabilities']
            daemonInstallationId?: string
            updaterProtocolVersion?: number
            remoteAccessDisabledAt?: string | null
            lastSeen?: number
          }
        | undefined
      if (payload && !this.removedMachineIds.has(payload.machineId)) {
        const incomingRevision = Number(payload.lastSeen ?? 0)
        const currentRevision = this.machineStatusRevisions.get(payload.machineId) ?? 0
        if (incomingRevision > 0 && incomingRevision < currentRevision) return
        if (incomingRevision > 0) {
          this.machineStatusRevisions.set(payload.machineId, incomingRevision)
        }
        this.store
          .updateMachineStatus(payload.machineId, payload.online, {
            cliVersion: payload.cliVersion,
            region: payload.region,
            autoUpgrade: payload.autoUpgrade,
            sessionSyncProtocolVersion: payload.sessionSyncProtocolVersion,
            sessionSyncDataEpoch: payload.sessionSyncDataEpoch,
            sessionSyncCapabilities: payload.sessionSyncCapabilities,
            daemonInstallationId: payload.daemonInstallationId,
            ...(Object.prototype.hasOwnProperty.call(payload, 'remoteAccessDisabledAt')
              ? { remoteAccessDisabledAt: payload.remoteAccessDisabledAt ?? null }
              : {}),
          })
          .catch(() => {})
        this.onChange.onMachineStatus(
          payload.machineId,
          payload.online,
          payload.region,
          payload.cliVersion,
          payload.autoUpgrade,
          {
            sessionSyncProtocolVersion: payload.sessionSyncProtocolVersion,
            sessionSyncDataEpoch: payload.sessionSyncDataEpoch,
            sessionSyncCapabilities: payload.sessionSyncCapabilities,
            daemonInstallationId: payload.daemonInstallationId,
            updaterProtocolVersion: payload.updaterProtocolVersion,
            ...(Object.prototype.hasOwnProperty.call(payload, 'remoteAccessDisabledAt')
              ? { remoteAccessDisabledAt: payload.remoteAccessDisabledAt ?? null }
              : {}),
          },
        )
      }
    } else if (event.event === 'machine.agents') {
      const payload = event.payload as
        | { machineId: string; agentList?: string[]; agents?: AgentInfo[] }
        | undefined
      if (payload?.machineId && Array.isArray(payload.agents)) {
        const agentList = Array.isArray(payload.agentList)
          ? payload.agentList
          : payload.agents
              .map((agent) => agent?.type)
              .filter((type): type is AgentInfo['type'] => typeof type === 'string')
        this.store.updateMachineAgents(payload.machineId, agentList, payload.agents).catch(() => {})
        this.onChange.onMachineAgents(payload.machineId, agentList, payload.agents)
      } else if (payload?.machineId && Array.isArray(payload.agentList)) {
        this.onChange.onMachineAgentList(payload.machineId, payload.agentList)
      }
    } else if (event.event === 'upgrade') {
      const payload = event.payload as (UpgradeEventPayload & { machineId: string }) | undefined
      if (payload?.machineId) {
        this.onChange.onUpgradeEvent(payload)
      }
    } else if (event.event === 'session.queue.update') {
      const payload = event.payload as { queue?: ChatQueueSnapshot } | undefined
      if (payload?.queue?.sessionId) {
        this.onChange.onSessionQueueUpdate?.(payload.queue.sessionId, payload.queue)
      }
    }
  }

  /**
   * Per-session queue for all read-modify-write operations.
   * Prevents concurrent local writes and server event handlers from
   * interleaving and overwriting each other.
   */
  /** Re-fetch machines from the API and update store + UI */
  async refreshMachines(): Promise<void> {
    const res = await this.api<{ machines: Machine[] }>('/machines').catch(() => null)
    if (res?.machines) {
      this.applyMachineInventoryBarriers(res.machines)
      for (const machine of res.machines) {
        this.removedMachineIds.delete(machine.id)
        const remoteRevision = toMs(machine.lastSeen)
        if (remoteRevision > 0) this.machineStatusRevisions.set(machine.id, remoteRevision)
      }
      await this.store.putMachines(res.machines)
      const pruned = await this.pruneSessionsForMachines(res.machines)
      if (pruned) await this.publishSessionsFromStore()
      await this.pruneProjectsForMachines(res.machines)
      this.onChange.onMachinesChange(res.machines)
      this.onChange.onMachinesRemoteResolved?.()
    }
  }

  protected applyMachineInventoryBarriers(machines: Machine[]): void {
    const nextMachineIds = new Set(machines.map((machine) => machine.id))
    for (const machineId of this.knownMachineIds) {
      if (nextMachineIds.has(machineId)) continue
      this.removedMachineIds.add(machineId)
      this.onChange.onMachineRemoved?.(machineId)
    }
    this.knownMachineIds = nextMachineIds
  }

  protected async pruneSessionsForMachines(machines: Machine[]): Promise<boolean> {
    const accessibleMachineIds = new Set(machines.map((machine) => machine.id))
    const sessions = await this.getSessionSyncTargets().catch(() => [])
    let changed = false

    for (const session of sessions) {
      if (!accessibleMachineIds.has(session.machineId)) {
        await this.store.deleteSession(session.id)
        this.activityCache.delete(session.id)
        this.onChange.onSessionDelete(session.id)
        changed = true
      }
    }

    return changed
  }

  protected async pruneProjectsForMachines(machines: Machine[]): Promise<boolean> {
    const accessibleMachineIds = new Set(machines.map((machine) => machine.id))
    const projects = await this.store.getProjects().catch(() => [])
    const accessibleProjects = projects.filter((project) =>
      accessibleMachineIds.has(project.machineId),
    )
    if (accessibleProjects.length === projects.length) return false
    await this.store.putProjects(accessibleProjects)
    this.onChange.onProjectsChange(accessibleProjects)
    return true
  }

  // ─── Reconnect: re-sync after WS reconnection ────────

  async onReconnect(opts?: { currentSessionId?: string; isTyping?: boolean }): Promise<void> {
    const recovery = this.reconnectInFlight ?? this.startReconnectRecovery()
    try {
      await recovery
    } finally {
      if (this.reconnectInFlight === recovery) this.reconnectInFlight = null
    }
    if (opts?.currentSessionId) {
      void this.reconcileCurrentSessionMachine(opts.currentSessionId)
    }
  }

  protected startReconnectRecovery(): Promise<void> {
    this.cancelMachineRecoveryReconciliation()
    this.onChange.onSyncStart?.()
    const recovery = (async () => {
      try {
        await this.syncRemote({ hasLocalSessions: true })
        await this.rollbackPendingSessionDeletions().catch(() => {})
        await this.retryPendingReadStates().catch(() => {})
      } finally {
        // Sessions are up to date — end the sync indicator before background work.
        this.onChange.onSyncEnd?.()
      }
    })()
    this.reconnectInFlight = recovery
    return recovery
  }

  /**
   * The account Relay can recover before its daemon during a rolling restart.
   * Presence is an event stream, so the online edge may be missed while the
   * client route is warming. Reconcile only the currently visible session's
   * machine for a bounded window; foreground/network recovery remains the
   * long-term fallback and genuinely offline machines are not polled forever.
   */
  protected async reconcileCurrentSessionMachine(sessionId: string): Promise<void> {
    const generation = ++this.machineRecoveryGeneration
    const deadline = Date.now() + SyncEngine.MACHINE_RECOVERY_WINDOW_MS

    const isOnline = async (): Promise<boolean> => {
      const [session, machines] = await Promise.all([
        this.getSessionSyncTarget(sessionId).catch(() => undefined),
        this.store.getMachines().catch(() => [] as Machine[]),
      ])
      if (!session) return true
      return machines.find((machine) => machine.id === session.machineId)?.online === true
    }

    if (await isOnline() || generation !== this.machineRecoveryGeneration) return

    const recheck = async () => {
      this.machineRecoveryTimer = null
      if (generation !== this.machineRecoveryGeneration) return
      await this.refreshMachines().catch(() => {})
      if (generation !== this.machineRecoveryGeneration || await isOnline()) return
      const remaining = deadline - Date.now()
      if (remaining <= 0) return
      this.machineRecoveryTimer = setTimeout(
        () => void recheck(),
        Math.min(SyncEngine.MACHINE_RECOVERY_RECHECK_MS, remaining),
      )
    }

    this.machineRecoveryTimer = setTimeout(
      () => void recheck(),
      Math.min(SyncEngine.MACHINE_RECOVERY_RECHECK_MS, Math.max(0, deadline - Date.now())),
    )
  }

  cancelMachineRecoveryReconciliation(): void {
    this.machineRecoveryGeneration += 1
    if (this.machineRecoveryTimer) clearTimeout(this.machineRecoveryTimer)
    this.machineRecoveryTimer = null
  }

  // ─── Logout: clear all local data ─────────────────────

  async clearLocalData(): Promise<void> {
    await this.store.clearAll()
    this.sessionDeletionBarriers.clear()
    this.booted = false
    this.hasMoreRemoteSessions = true
    this.loadingMoreSessions = false
    this.projectSessionLoadGenerations.clear()
  }
}
