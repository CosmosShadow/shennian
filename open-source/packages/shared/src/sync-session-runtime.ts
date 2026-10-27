// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine.test.ts

import type {
  NativeCleanupPolicy,
  NianProject,
  NianSession,
  SessionActivitySnapshot,
  SessionReadWatermark,
  SessionUserState,
} from '@shennian/wire'
import { isOrdinaryVisibleSession, isProjectVisibleSession } from './lib/session-list'
import {
  activityProjectionEqual,
  mergeReadWatermark,
  mergeSessionPatch,
  normalizeSession,
  sessionSnapshotEqual,
} from './lib/sync-session-state'
import { incrementRuntimeMetric } from './runtime-metrics'
import type { ClientIndexStore, LocalSessionDeletion } from './storage'

import type { ApiClient, ChangeNotifier, SyncEngineOptions } from './sync-engine-types'
import {
  apiErrorStatus,
  hasCoherentPreviewTuple,
  isCompleteSessionProjection,
} from './sync-engine-types'

export abstract class SyncSessionRuntime {
  protected store: ClientIndexStore
  protected api: ApiClient
  protected onChange: ChangeNotifier
  protected booted = false
  /** Boot and foreground/relay recovery must not apply the same remote index concurrently. */
  protected remoteSyncInFlight: Promise<void> | null = null
  /** A reconnect burst shares one full recovery, including pending local retries. */
  protected reconnectInFlight: Promise<void> | null = null
  protected hasMoreRemoteSessions = true
  protected loadingMoreSessions = false
  protected sessionQueues = new Map<string, Promise<unknown>>()
  protected sessionDeletionBarriers = new Set<string>()
  /** SQLite permits only one active write transaction on the shared connection. */
  protected localSessionDeletionQueue: Promise<void> = Promise.resolve()
  protected pendingBackfill: Promise<void> | null = null
  protected lastBackfillAt = 0
  protected sessionRepairAttempts = new Map<string, number>()
  protected sessionRepairTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Only the newest page request for a project may update its durable projection. */
  protected projectSessionLoadGenerations = new Map<string, number>()
  protected cacheVersion: string | null
  protected onPersonalDataReset: (() => Promise<void> | void) | null
  protected activityCache = new Map<string, { session: NianSession; lastCheckpointAt: number }>()
  /** Reject delayed status frames after a newer status or an explicit removal. */
  protected machineStatusRevisions = new Map<string, number>()
  protected removedMachineIds = new Set<string>()
  protected knownMachineIds = new Set<string>()
  protected pendingReadRetryPromise: Promise<void> | null = null
  protected machineRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  protected machineRecoveryGeneration = 0
  protected static readonly ACTIVITY_CHECKPOINT_MS = 60_000
  protected static readonly MACHINE_RECOVERY_RECHECK_MS = 5_000
  protected static readonly MACHINE_RECOVERY_WINDOW_MS = 30_000

  constructor(opts: SyncEngineOptions) {
    this.store = opts.store
    this.api = opts.api
    this.onChange = opts.onChange
    const cacheVersion = opts.cacheVersion?.trim()
    this.cacheVersion = cacheVersion ? cacheVersion : null
    this.onPersonalDataReset = opts.onPersonalDataReset ?? null
  }

  protected abstract getSessionSyncTarget(sessionId: string): Promise<NianSession | undefined>
  protected abstract publishSessionFromStore(sessionId: string): Promise<NianSession | undefined>
  protected abstract publishSessionsFromStore(): Promise<NianSession[]>
  protected abstract backfillMissingSessions(): Promise<void>

  protected queueSessionWork<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.sessionQueues.get(sessionId) ?? Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(work)
      .finally(() => {
        if (this.sessionQueues.get(sessionId) === next) {
          this.sessionQueues.delete(sessionId)
        }
      })
    this.sessionQueues.set(sessionId, next)
    return next
  }

  protected async queueSessionUpdate(
    sessionId: string,
    mutate: (session: NianSession) => Promise<NianSession | undefined> | NianSession | undefined,
    notify = true,
  ): Promise<NianSession | undefined> {
    return this.queueSessionWork(sessionId, async () => {
      const deletion = await this.store.getSessionDeletion(sessionId).catch(() => undefined)
      if (deletion || this.sessionDeletionBarriers.has(sessionId)) return undefined
      const session = await this.getSessionSyncTarget(sessionId).catch(() => undefined)
      if (!session) return undefined

      const next = await mutate(session)
      if (!next) return undefined
      const nextSession = normalizeSession(next)
      if (sessionSnapshotEqual(session, nextSession)) return undefined
      await this.store.putSession(nextSession)
      const cachedActivity = this.activityCache.get(sessionId)
      this.activityCache.set(sessionId, {
        session: nextSession,
        lastCheckpointAt: cachedActivity?.lastCheckpointAt ?? Date.now(),
      })
      if (notify) await this.publishSessionFromStore(sessionId)
      return nextSession
    })
  }

  protected enqueueSessionUpdate(sessionId: string, work: () => Promise<void>): void {
    void this.queueSessionWork(sessionId, work).catch((error) => {
      console.warn('[SyncEngine] queued session write failed:', error)
    })
  }

  protected async insertRealtimeSession(session: NianSession): Promise<void> {
    const projected = normalizeSession(session)
    const existed = Boolean(await this.getSessionSyncTarget(projected.id).catch(() => undefined))
    await this.store.putSession(projected)
    this.onChange.onSessionIndexTargetChange?.(projected.id)
    this.activityCache.set(projected.id, {
      session: projected,
      lastCheckpointAt: Date.now(),
    })
    this.sessionRepairAttempts.delete(projected.id)
    const timer = this.sessionRepairTimers.get(projected.id)
    if (timer) clearTimeout(timer)
    this.sessionRepairTimers.delete(projected.id)
    incrementRuntimeMetric(existed ? 'sync.session_realtime_repair' : 'sync.session_realtime_insert')
    await this.publishSessionFromStore(projected.id)
  }

  protected scheduleSessionRepair(sessionId: string): void {
    if (this.sessionRepairTimers.has(sessionId) || this.sessionDeletionBarriers.has(sessionId)) return
    const attempt = (this.sessionRepairAttempts.get(sessionId) ?? 0) + 1
    this.sessionRepairAttempts.set(sessionId, attempt)
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5))
    incrementRuntimeMetric('sync.session_repair_retry_scheduled')
    const timer = setTimeout(() => {
      this.sessionRepairTimers.delete(sessionId)
      this.enqueueSessionUpdate(sessionId, async () => {
        await this.repairMissingSession(sessionId)
      })
    }, delay)
    this.sessionRepairTimers.set(sessionId, timer)
  }

  protected async repairMissingSession(sessionId: string): Promise<void> {
    try {
      const response = await this.api<{ session: NianSession }>(
        `/sessions/index/${encodeURIComponent(sessionId)}`,
      )
      if (!isCompleteSessionProjection(response.session)) {
        throw new Error('incomplete session index repair projection')
      }
      await this.insertRealtimeSession(response.session)
      incrementRuntimeMetric('sync.session_repair_succeeded')
    } catch (error) {
      incrementRuntimeMetric('sync.session_repair_failed')
      console.warn(`[SyncEngine] exact session repair failed for ${sessionId.slice(0, 8)}:`, error)
      // Compatibility with a Server that predates the exact endpoint. This is
      // supplemental only; the dirty target remains scheduled until the exact
      // projection is present locally.
      await this.backfillMissingSessions().catch(() => {})
      const repaired = await this.getSessionSyncTarget(sessionId).catch(() => undefined)
      if (repaired) {
        this.sessionRepairAttempts.delete(sessionId)
        return
      }
      this.scheduleSessionRepair(sessionId)
    }
  }

  protected handleSessionPatch(sessionPatch: Partial<NianSession> & Pick<NianSession, 'id'>): void {
    if (this.sessionDeletionBarriers.has(sessionPatch.id)) return
    const ordinaryVisible = isOrdinaryVisibleSession(sessionPatch)

    this.enqueueSessionUpdate(sessionPatch.id, async () => {
      const deletion = await this.store.getSessionDeletion(sessionPatch.id).catch(() => undefined)
      if (deletion || this.sessionDeletionBarriers.has(sessionPatch.id)) return
      const existing = await this.getSessionSyncTarget(sessionPatch.id).catch(() => undefined)

      if (!existing) {
        // Worker sessions stay out of the ordinary list and are retained only
        // after an explicit linked-conversation open has cached their index.
        if (!ordinaryVisible) return
        if (isCompleteSessionProjection(sessionPatch)) {
          await this.insertRealtimeSession(sessionPatch)
          return
        }

        // Compatibility fallback for an older/incomplete producer. Current
        // daemon index events carry the full projection and take the direct
        // path above, so a new row is never dependent on leaving/re-entering
        // the list or on its position in a recent-page query.
        console.log(
          `[SyncEngine] handleSessionPatch: session ${sessionPatch.id.slice(0, 8)} not local, backfilling`,
        )
        await this.repairMissingSession(sessionPatch.id)
        return
      }

      const incomingRevision = sessionPatch.indexRevision
      const existingRevision = existing.indexRevision ?? 0
      const isOlderRevision = incomingRevision !== undefined
        && incomingRevision < existingRevision
      const hasRevisionGap = incomingRevision !== undefined
        && incomingRevision > existingRevision + 1
      if (
        !isOlderRevision && (
          !hasCoherentPreviewTuple(sessionPatch) ||
          (hasRevisionGap && !isCompleteSessionProjection(sessionPatch))
        )
      ) {
        incrementRuntimeMetric('sync.session_revision_repair_requested')
        await this.repairMissingSession(sessionPatch.id)
        return
      }

      const merged = mergeSessionPatch(existing, sessionPatch)

      if (merged.deletedAt) {
        await this.confirmLocalSessionDeletion(merged.id, merged.deletedAt)
        this.onChange.onSessionDelete(merged.id)
        return
      }

      if (sessionSnapshotEqual(existing, merged)) return

      await this.store.putSession(merged)
      this.onChange.onSessionIndexTargetChange?.(merged.id)
      const cachedActivity = this.activityCache.get(merged.id)
      this.activityCache.set(merged.id, {
        session: merged,
        lastCheckpointAt: cachedActivity?.lastCheckpointAt ?? Date.now(),
      })
      if (isProjectVisibleSession(merged)) await this.publishSessionFromStore(merged.id)
      else if (isProjectVisibleSession(existing)) {
        // An ownership change removes only the list row. onSessionDelete also
        // tombstones linked bodies/outbound work in App, so it must not run here.
        this.onChange.onSessionUpdate(merged)
      }
    })
  }

  protected handleSessionUserState(sessionId: string, userState: SessionUserState | null): void {
    void this.queueSessionUpdate(sessionId, (session) => mergeSessionPatch(session, { userState }))
  }

  /** Flushes low-frequency index/activity freshness checkpoints. */
  async flushPendingWork(): Promise<void> {
    await Promise.all([
      this.flushActivityCheckpoints(),
      this.retryPendingReadStates().catch(() => {}),
    ])
  }

  protected handleSessionActivity(sessionId: string, activity: SessionActivitySnapshot | null): void {
    this.enqueueSessionUpdate(sessionId, async () => {
      const cached = this.activityCache.get(sessionId)
      let session = cached?.session ?? (await this.getSessionSyncTarget(sessionId).catch(() => undefined))
      if (!session) {
        console.log(
          `[SyncEngine] handleSessionActivity: session ${sessionId.slice(0, 8)} not in local store, backfilling`,
        )
        await this.backfillMissingSessions().catch(() => {})
        session = await this.getSessionSyncTarget(sessionId).catch(() => undefined)
        if (!session) return
      }
      const nextSession = { ...session, activity }
      if (sessionSnapshotEqual(session, nextSession)) return
      const semanticChanged = !activityProjectionEqual(session.activity, activity)
      const now = Date.now()
      this.activityCache.set(sessionId, {
        session: nextSession,
        lastCheckpointAt: semanticChanged ? now : (cached?.lastCheckpointAt ?? 0),
      })
      // Heartbeats refresh the persisted staleness watermark, but a timestamp-
      // only change must not rebuild every project/session list in React.
      if (semanticChanged) {
        await this.store.putSession(nextSession)
        const activityDesc = activity
          ? `${activity.runPhase}(${activity.runId?.slice(0, 8)})`
          : 'null'
        console.log(
          `[SyncEngine] handleSessionActivity: sessionId=${sessionId.slice(0, 8)} activity=${activityDesc}`,
        )
        await this.publishSessionFromStore(sessionId)
      } else if (now - (cached?.lastCheckpointAt ?? 0) >= SyncSessionRuntime.ACTIVITY_CHECKPOINT_MS) {
        await this.store.putSession(nextSession)
        this.activityCache.set(sessionId, { session: nextSession, lastCheckpointAt: now })
      }
    })
  }

  protected async flushActivityCheckpoints(): Promise<void> {
    const now = Date.now()
    const checkpoints: Array<{ sessionId: string; session: NianSession }> = []
    for (const [sessionId, entry] of this.activityCache) {
      if (now - entry.lastCheckpointAt < SyncSessionRuntime.ACTIVITY_CHECKPOINT_MS) continue
      checkpoints.push({ sessionId, session: entry.session })
    }
    if (checkpoints.length === 0) return
    try {
      await this.store.putSessions(checkpoints.map((entry) => entry.session))
      incrementRuntimeMetric('storage.activity_checkpoint_transactions')
      incrementRuntimeMetric('storage.activity_checkpoint_sessions', checkpoints.length)
    } catch {
      return
    }
    for (const { sessionId, session } of checkpoints) {
      this.activityCache.set(sessionId, { session, lastCheckpointAt: now })
    }
  }

  async persistSession(session: NianSession): Promise<void> {
    await this.queueSessionWork(session.id, async () => {
      const deletion = await this.store.getSessionDeletion(session.id).catch(() => undefined)
      if (deletion || this.sessionDeletionBarriers.has(session.id)) return
      const existing = await this.getSessionSyncTarget(session.id).catch(() => undefined)
      // Strip ephemeral `activity` before merging — activity is managed
      // exclusively by handleSessionActivity and must not be overwritten
      // by stale snapshots from the Zustand store.
      const sessionWithoutActivity = { ...session }
      delete sessionWithoutActivity.activity
      const nextSession = existing
        ? mergeSessionPatch(existing, sessionWithoutActivity)
        : normalizeSession({ ...sessionWithoutActivity, activity: null })
      await this.store.putSession(nextSession)
    })
  }

  async updateSessionUserState(
    sessionId: string,
    patch: {
      pinned?: boolean
      manualUnread?: boolean
      lastReadAt?: string | null
      readWatermark?: SessionReadWatermark
    },
  ): Promise<void> {
    const nowIso = new Date().toISOString()
    const marksRead = patch.lastReadAt !== undefined || patch.readWatermark !== undefined
    const nextSession = await this.queueSessionUpdate(sessionId, async (existing) => {
      const existingReadBodyRevision = existing.userState?.lastReadBodyRevision ?? 0
      const existingReadAttentionCount = existing.userState?.lastReadAttentionCount ?? 0
      const acceptReadBody = Boolean(
        patch.readWatermark && patch.readWatermark.bodyRevision >= existingReadBodyRevision,
      )
      const acceptReadAttention = Boolean(
        patch.readWatermark && patch.readWatermark.attentionCount >= existingReadAttentionCount,
      )
      const nextUserState: SessionUserState = {
        ...(existing.userState ?? {
          sessionId,
          userId: existing.userId,
          updatedAt: nowIso,
        }),
        sessionId,
        userId: existing.userId,
        ...(patch.pinned !== undefined ? { pinnedAt: patch.pinned ? nowIso : null } : {}),
        ...(patch.manualUnread !== undefined ? { manualUnread: patch.manualUnread } : {}),
        ...(marksRead ? { readSyncPending: true } : {}),
        ...(patch.lastReadAt !== undefined
          ? { lastReadAt: mergeReadWatermark(existing.userState?.lastReadAt, patch.lastReadAt) }
          : {}),
        ...(patch.readWatermark
          ? {
              lastReadBodyRevision: acceptReadBody
                ? patch.readWatermark.bodyRevision
                : existingReadBodyRevision,
              lastReadVisibleMessageCount: acceptReadBody
                ? patch.readWatermark.visibleMessageCount
                : (existing.userState?.lastReadVisibleMessageCount ?? 0),
              lastReadVisibleMessageId: acceptReadBody
                ? patch.readWatermark.lastVisibleMessageId
                : (existing.userState?.lastReadVisibleMessageId ?? null),
              lastReadAttentionCount: acceptReadAttention
                ? patch.readWatermark.attentionCount
                : existingReadAttentionCount,
              lastReadAttentionId: acceptReadAttention
                ? patch.readWatermark.lastAttentionId
                : (existing.userState?.lastReadAttentionId ?? null),
            }
          : {}),
        updatedAt: nowIso,
      }

      return {
        ...existing,
        userState: nextUserState,
      }
    })
    if (!nextSession) return

    await this.api<{ ok: boolean }>(`/sessions/${sessionId}/user-state`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.manualUnread !== undefined ? { manualUnread: patch.manualUnread } : {}),
        ...(patch.lastReadAt !== undefined ? { lastReadAt: patch.lastReadAt } : {}),
        ...(patch.readWatermark ? { readWatermark: patch.readWatermark } : {}),
      }),
    })
    if (marksRead && nextSession.userState) {
      await this.clearReadSyncPending(sessionId, nextSession.userState)
    }
  }

  async markSessionRead(
    sessionId: string,
    lastReadAt = new Date().toISOString(),
    readWatermark?: SessionReadWatermark,
  ): Promise<void> {
    await this.updateSessionUserState(sessionId, {
      manualUnread: false,
      lastReadAt,
      readWatermark,
    })
  }

  async retryPendingReadStates(): Promise<void> {
    if (this.pendingReadRetryPromise) return this.pendingReadRetryPromise
    const retry = (async () => {
      const sessions = await this.store.getSessions().catch(() => [])
      for (const session of sessions) {
        const state = session.userState
        if (!state?.readSyncPending || !state.lastReadAt) continue
        try {
          await this.api<{ ok: boolean }>(`/sessions/${session.id}/user-state`, {
            method: 'PATCH',
            body: JSON.stringify({
              manualUnread: false,
              lastReadAt: state.lastReadAt,
              readWatermark: {
                bodyRevision: state.lastReadBodyRevision ?? 0,
                visibleMessageCount: state.lastReadVisibleMessageCount ?? 0,
                lastVisibleMessageId: state.lastReadVisibleMessageId ?? null,
                attentionCount: state.lastReadAttentionCount ?? 0,
                lastAttentionId: state.lastReadAttentionId ?? null,
              },
            }),
          })
          await this.clearReadSyncPending(session.id, state)
          incrementRuntimeMetric('sync.read_watermark_retry_succeeded')
        } catch {
          incrementRuntimeMetric('sync.read_watermark_retry_failed')
        }
      }
    })().finally(() => {
      this.pendingReadRetryPromise = null
    })
    this.pendingReadRetryPromise = retry
    return retry
  }

  protected async clearReadSyncPending(
    sessionId: string,
    acknowledged: NonNullable<NianSession['userState']>,
  ): Promise<void> {
    await this.queueSessionUpdate(sessionId, (session) => {
      if (!session.userState?.readSyncPending) return session
      const current = session.userState
      const unchangedWhileRequestWasInFlight =
        current.lastReadAt === acknowledged.lastReadAt &&
        (current.lastReadBodyRevision ?? 0) === (acknowledged.lastReadBodyRevision ?? 0) &&
        (current.lastReadVisibleMessageCount ?? 0) ===
          (acknowledged.lastReadVisibleMessageCount ?? 0) &&
        (current.lastReadVisibleMessageId ?? null) ===
          (acknowledged.lastReadVisibleMessageId ?? null) &&
        (current.lastReadAttentionCount ?? 0) === (acknowledged.lastReadAttentionCount ?? 0) &&
        (current.lastReadAttentionId ?? null) === (acknowledged.lastReadAttentionId ?? null)
      if (!unchangedWhileRequestWasInFlight) return session
      return {
        ...session,
        userState: { ...current, readSyncPending: false },
      }
    })
  }

  // ─── Explicit, fail-closed session deletion ───────────

  protected confirmLocalSessionDeletion(sessionId: string, deletedAt?: string): Promise<void> {
    // A batch prune emits one realtime delete event per session before its API
    // response returns the same IDs. Serialize both paths globally: different
    // session IDs still share one Expo SQLite connection and concurrent
    // withTransactionAsync calls can otherwise invalidate each other's commit.
    const confirmation = this.localSessionDeletionQueue.catch(() => {}).then(async () => {
      this.sessionDeletionBarriers.add(sessionId)
      const existing = await this.store.getSessionDeletion(sessionId).catch(() => undefined)
      const deletion: LocalSessionDeletion = {
        sessionId,
        deletedAt: deletedAt ?? existing?.deletedAt ?? new Date().toISOString(),
        state: 'confirmed',
      }
      await this.store.putSessionDeletion(deletion)
      await this.store.deleteSession(sessionId)
    })
    this.localSessionDeletionQueue = confirmation
    return confirmation
  }

  protected async sendSessionDeletion(
    sessionId: string,
    nativeCleanupPolicy: NativeCleanupPolicy,
  ): Promise<'confirmed'> {
    try {
      const result = await this.api<{
        ok: boolean
        deletedAt?: string
        deletionRevision?: number
      }>(
        `/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE', body: JSON.stringify({ nativeCleanupPolicy }) },
      )
      await this.confirmLocalSessionDeletion(sessionId, result.deletedAt)
      if (result.deletionRevision !== undefined) {
        this.onChange.onSessionDelete(sessionId, result.deletionRevision)
      }
      return 'confirmed'
    } catch (error) {
      const status = apiErrorStatus(error)
      // Compatibility with old servers: missing already satisfies DELETE semantics.
      if (status === 404) {
        await this.confirmLocalSessionDeletion(sessionId)
        return 'confirmed'
      }
      throw error
    }
  }

  async requestSessionDeletion(
    sessionId: string,
    nativeCleanupPolicy: NativeCleanupPolicy,
  ): Promise<'confirmed'> {
    const previous = await this.store.getSession(sessionId).catch(() => undefined)
    const existing = await this.store.getSessionDeletion(sessionId).catch(() => undefined)
    if (existing?.state === 'confirmed') {
      this.onChange.onSessionDelete(sessionId)
      return 'confirmed'
    }

    this.sessionDeletionBarriers.add(sessionId)
    await this.store.putSessionDeletion({
      sessionId,
      deletedAt: existing?.deletedAt ?? new Date().toISOString(),
      state: 'pending',
      nativeCleanupPolicy,
    })
    this.onChange.onSessionDelete(sessionId)

    try {
      return await this.sendSessionDeletion(sessionId, nativeCleanupPolicy)
    } catch (error) {
      // A thrown request or local persistence failure must never leave a
      // destructive intent queued for a later lifecycle to execute.
      await this.store.removeSessionDeletion(sessionId)
      this.sessionDeletionBarriers.delete(sessionId)
      if (previous) this.onChange.onSessionUpdate(previous)
      throw error
    }
  }

  async rollbackPendingSessionDeletions(): Promise<void> {
    const rollback = this.localSessionDeletionQueue.catch(() => {}).then(async () => {
      const pending = await this.store.getPendingSessionDeletions().catch(() => [])
      let changed = false
      for (const deletion of pending) {
        try {
          await this.store.removeSessionDeletion(deletion.sessionId)
          this.sessionDeletionBarriers.delete(deletion.sessionId)
          changed = true
        } catch {
          // Keep the barrier if durable rollback failed; the next recovery may retry
          // the local cleanup, but it must never retry the network DELETE.
        }
      }
      if (changed) await this.publishSessionsFromStore()
    })
    this.localSessionDeletionQueue = rollback
    return rollback
  }

  async deleteProject(projectId: string): Promise<void> {
    const existingProjects = await this.store.getProjects()
    const result = await this.api<{ deletedSessionIds?: string[] }>(
      `/projects/${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    )
    const deletedSessionIds = new Set(result.deletedSessionIds ?? [])
    for (const sessionId of deletedSessionIds) {
      await this.confirmLocalSessionDeletion(sessionId)
      this.onChange.onSessionDelete(sessionId)
    }
    const projects = existingProjects.filter((project) => project.id !== projectId)
    await this.store.putProjects(projects)
    this.onChange.onProjectsChange(projects)
  }

  async pruneOldestProjectSessions(
    projectId: string,
    count = 20,
  ): Promise<{ deletedSessionIds: string[]; protectedCount: number }> {
    const result = await this.api<{ deletedSessionIds?: string[]; protectedCount?: number }>(
      `/projects/${encodeURIComponent(projectId)}/sessions/prune-oldest`,
      { method: 'POST', body: JSON.stringify({ count }) },
    )
    const deletedSessionIds = result.deletedSessionIds ?? []
    for (const sessionId of deletedSessionIds) {
      await this.confirmLocalSessionDeletion(sessionId)
      this.onChange.onSessionDelete(sessionId)
    }
    return { deletedSessionIds, protectedCount: result.protectedCount ?? 0 }
  }

  async persistProject(project: NianProject): Promise<void> {
    const existingProjects = await this.store.getProjects()
    const projects = [project, ...existingProjects.filter((item) => item.id !== project.id)]
    await this.store.putProjects(projects)
    this.onChange.onProjectsChange(projects)
  }

}
