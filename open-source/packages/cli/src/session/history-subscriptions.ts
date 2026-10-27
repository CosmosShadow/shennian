// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/history-subscriptions.test.ts

import {
  SESSION_HISTORY_LIMITS,
  type ReqFrame,
  type SessionHistoryCloseParams,
  type SessionHistoryOpenParams,
  type SessionHistoryPageParams,
  type SessionHistorySyncParams,
  type SessionBodyReplicaSubscribeParams,
  type SessionBodyReplicaUnsubscribeParams,
} from '@shennian/wire'
import type { CliRelayClient } from '../relay/client.js'
import type { CanonicalMutation, CanonicalSessionStore } from './canonical-store.js'
import { getCanonicalSessionStore, listSessionRecords } from './store.js'
import {
  recordPersonalSyncLocalMetric,
  setPersonalSyncLocalSubscriptions,
} from '../personal-sync/metrics.js'
import { assertPersonalSyncIdentity, getPersonalSyncIdentity } from '../personal-sync/epoch.js'

type Subscription = {
  sessionId: string
  subscriptionId: string
  snapshotRevision: number
  lastSentRevision: number
  active: boolean
  buffered: CanonicalMutation[]
  pending: CanonicalMutation[]
  pendingBytes: number
  flushTimer: ReturnType<typeof setTimeout> | null
  lastQueuedRevision: number
}

type ReplicaStream = {
  appInstallationId: string
  streamId: string
  generation: number
  active: boolean
  buffered: CanonicalMutation[]
  highWaterBySession: Map<string, number>
  lastSentBySession: Map<string, number>
  lastQueuedBySession: Map<string, number>
  pendingBySession: Map<string, CanonicalMutation[]>
  pendingCount: number
  pendingBytes: number
  flushTimer: ReturnType<typeof setTimeout> | null
}

export const PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS = 100
export const PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS = SESSION_HISTORY_LIMITS.maxDeltaMutations
const PERSONAL_HISTORY_DELTA_BATCH_MAX_BYTES = SESSION_HISTORY_LIMITS.maxMutationBytes - 4_096
const PERSONAL_HISTORY_REPLICA_PAGE_MAX_BYTES = SESSION_HISTORY_LIMITS.maxReplicaPageBytes - 16_384

export class PersonalHistorySubscriptions {
  private subscriptions = new Map<string, Subscription>()
  private replicaStreams = new Map<string, ReplicaStream>()
  private unsubscribeStore: () => void

  constructor(
    private client: Pick<CliRelayClient, 'sendRes' | 'sendEvent'>,
    private store: CanonicalSessionStore = getCanonicalSessionStore(),
    private hasLocalSession: (sessionId: string) => boolean = (sessionId) =>
      listSessionRecords().some((record) => record.sessionId === sessionId),
  ) {
    this.unsubscribeStore = store.subscribe((mutation) => this.handleMutation(mutation))
  }

  handleOpen(req: ReqFrame): void {
    const params = req.params as SessionHistoryOpenParams
    assertPersonalSyncIdentity(params)
    validateIdentity(params.sessionId, params.subscriptionId)
    // A missing canonical manifest is valid only for a locally known, newly
    // created empty session. Server metadata from an earlier hard-cut epoch
    // must never be projected as a successful empty transcript.
    if (!this.hasLocalSession(params.sessionId) && !this.store.getManifest(params.sessionId)) {
      throw new Error('history_unavailable')
    }
    if (this.subscriptions.has(params.subscriptionId)) throw new Error('subscription already exists')
    const sameSessionCount = [...this.subscriptions.values()]
      .filter((item) => item.sessionId === params.sessionId).length
    if (sameSessionCount >= SESSION_HISTORY_LIMITS.maxSubscriptionsPerSession) {
      this.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: 'subscription_limit_exceeded',
        rejection: {
          code: 'subscription_limit_exceeded',
          retryable: true,
          requiredAction: 'retry',
        },
      })
      return
    }
    const subscription: Subscription = {
      sessionId: params.sessionId,
      subscriptionId: params.subscriptionId,
      snapshotRevision: 0,
      lastSentRevision: 0,
      active: false,
      buffered: [],
      pending: [],
      pendingBytes: 0,
      flushTimer: null,
      lastQueuedRevision: 0,
    }
    this.subscriptions.set(params.subscriptionId, subscription)
    this.updateSubscriptionMetric()
    try {
      const page = this.store.readPage(params.sessionId, {
        limit: normalizeLimit(params.limit, SESSION_HISTORY_LIMITS.defaultSnapshotMessages),
        ...(params.beforeSequence === undefined ? {} : { beforeSequence: params.beforeSequence }),
      })
      subscription.snapshotRevision = page.bodyRevision
      subscription.lastSentRevision = page.bodyRevision
      subscription.lastQueuedRevision = page.bodyRevision
      this.client.sendRes({
        type: 'res', id: req.id, ok: true,
        payload: {
          ...getPersonalSyncIdentity(this.store.daemonInstallationId),
          sessionId: params.sessionId,
          subscriptionId: params.subscriptionId,
          storageMode: 'machine_local',
          snapshotRevision: page.bodyRevision,
          firstAvailableSeq: page.firstAvailableSeq,
          lastAvailableSeq: page.lastAvailableSeq,
          hasOlder: page.hasOlder,
          messages: page.entries,
        },
      })
      recordPersonalSyncLocalMetric('historySnapshots')
      recordPersonalSyncLocalMetric('historyBytesServed', Buffer.byteLength(JSON.stringify(page.entries), 'utf8'))
      subscription.active = true
      for (const mutation of subscription.buffered) this.queueMutation(subscription, mutation)
      subscription.buffered = []
    } catch (error) {
      this.subscriptions.delete(params.subscriptionId)
      this.updateSubscriptionMetric()
      throw error
    }
  }

  handleSync(req: ReqFrame): void {
    const params = req.params as SessionHistorySyncParams
    assertPersonalSyncIdentity(params)
    validateIdentity(params.sessionId, params.syncId)
    if (!Number.isSafeInteger(params.afterRevision) || params.afterRevision < 0) {
      throw new Error('invalid history sync revision')
    }
    if (!this.hasLocalSession(params.sessionId) && !this.store.getManifest(params.sessionId)) {
      throw new Error('history_unavailable')
    }
    const targetRevision = this.store.getManifest(params.sessionId)?.bodyRevision ?? 0
    if (params.afterRevision > targetRevision) throw new Error('revision_gap')
    const limit = normalizeSyncLimit(params.limit)
    const available = this.store.readDeltas(params.sessionId, params.afterRevision, limit)
    const mutations: Array<CanonicalMutation & { subscriptionId: string }> = []
    let bytes = 0
    for (const mutation of available) {
      const projected = { ...mutation, subscriptionId: params.syncId }
      const mutationBytes = Buffer.byteLength(JSON.stringify(projected), 'utf8') + 1
      if (mutations.length > 0 && bytes + mutationBytes > PERSONAL_HISTORY_REPLICA_PAGE_MAX_BYTES) break
      if (mutationBytes > PERSONAL_HISTORY_REPLICA_PAGE_MAX_BYTES) {
        this.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'response_too_large' })
        return
      }
      mutations.push(projected)
      bytes += mutationBytes
    }
    const toRevision = mutations.at(-1)?.revision ?? params.afterRevision
    this.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        sessionId: params.sessionId,
        syncId: params.syncId,
        fromRevision: params.afterRevision,
        toRevision,
        targetRevision,
        hasMore: toRevision < targetRevision,
        mutations,
      },
    })
    recordPersonalSyncLocalMetric('historyDeltas')
    recordPersonalSyncLocalMetric('historyBytesServed', bytes)
  }

  handleReplicaSubscribe(req: ReqFrame): void {
    const params = req.params as SessionBodyReplicaSubscribeParams
    assertPersonalSyncIdentity(params)
    validateStreamIdentity(params.appInstallationId, params.streamId, params.generation)
    if (!this.replicaStreams.has(params.streamId)
      && this.replicaStreams.size >= SESSION_HISTORY_LIMITS.maxReplicaStreamsPerDaemon) {
      this.client.sendRes({
        type: 'res', id: req.id, ok: false, error: 'subscription_limit_exceeded',
        rejection: {
          code: 'subscription_limit_exceeded', retryable: true, requiredAction: 'retry',
        },
      })
      return
    }

    const previous = this.replicaStreams.get(params.streamId)
    if (previous && params.generation < previous.generation) {
      throw new Error('invalid body replica generation')
    }
    if (previous) this.flushReplicaStream(previous)
    const stream: ReplicaStream = {
      appInstallationId: params.appInstallationId,
      streamId: params.streamId,
      generation: params.generation,
      active: false,
      buffered: [],
      highWaterBySession: new Map(),
      lastSentBySession: new Map(),
      lastQueuedBySession: new Map(),
      pendingBySession: new Map(),
      pendingCount: 0,
      pendingBytes: 0,
      flushTimer: null,
    }
    // Register before capturing high-water marks. Commits racing this scan are
    // buffered, then filtered against the captured revision after the response.
    this.replicaStreams.set(params.streamId, stream)
    this.updateSubscriptionMetric()
    const highWatermarks = this.store.listSessionIds().map((sessionId) => {
      const bodyRevision = this.store.getManifest(sessionId)?.bodyRevision ?? 0
      stream.highWaterBySession.set(sessionId, bodyRevision)
      stream.lastSentBySession.set(sessionId, bodyRevision)
      stream.lastQueuedBySession.set(sessionId, bodyRevision)
      return { sessionId, bodyRevision }
    })
    this.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        appInstallationId: params.appInstallationId,
        streamId: params.streamId,
        generation: params.generation,
        highWatermarks,
      },
    })
    stream.active = true
    for (const mutation of stream.buffered) this.queueReplicaMutation(stream, mutation)
    stream.buffered = []
  }

  handleReplicaUnsubscribe(req: ReqFrame): void {
    const params = req.params as SessionBodyReplicaUnsubscribeParams
    assertPersonalSyncIdentity(params)
    validateStreamIdentity(params.appInstallationId, params.streamId, params.generation)
    const stream = this.replicaStreams.get(params.streamId)
    if (stream && stream.generation === params.generation) {
      this.flushReplicaStream(stream)
      this.replicaStreams.delete(params.streamId)
      this.updateSubscriptionMetric()
    }
    this.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        appInstallationId: params.appInstallationId,
        streamId: params.streamId,
        generation: params.generation,
        closed: true,
      },
    })
  }

  handlePage(req: ReqFrame): void {
    const params = req.params as SessionHistoryPageParams
    assertPersonalSyncIdentity(params)
    const subscription = this.requireSubscription(params.sessionId, params.subscriptionId)
    let page: ReturnType<CanonicalSessionStore['readPageAtRevision']>
    try {
      page = this.store.readPageAtRevision(params.sessionId, {
        beforeSequence: params.beforeSequence,
        limit: normalizeLimit(params.limit, SESSION_HISTORY_LIMITS.defaultPageMessages),
        revision: subscription.snapshotRevision,
      })
    } catch {
      throw new Error('snapshot_compacted')
    }
    this.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        sessionId: params.sessionId,
        subscriptionId: params.subscriptionId,
        snapshotRevision: subscription.snapshotRevision,
        firstAvailableSeq: page.firstAvailableSeq,
        hasOlder: page.hasOlder,
          messages: page.entries,
      },
    })
    recordPersonalSyncLocalMetric('historyPages')
    recordPersonalSyncLocalMetric('historyBytesServed', Buffer.byteLength(JSON.stringify(page.entries), 'utf8'))
  }

  handleClose(req: ReqFrame): void {
    const params = req.params as SessionHistoryCloseParams
    assertPersonalSyncIdentity(params)
    validateIdentity(params.sessionId, params.subscriptionId)
    const subscription = this.subscriptions.get(params.subscriptionId)
    if (subscription?.sessionId === params.sessionId) {
      this.flushSubscription(subscription)
      this.subscriptions.delete(params.subscriptionId)
      this.updateSubscriptionMetric()
    }
    this.client.sendRes({
      type: 'res', id: req.id, ok: true,
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        sessionId: params.sessionId, subscriptionId: params.subscriptionId, closed: true,
      },
    })
  }

  closeAll(): void {
    for (const subscription of this.subscriptions.values()) this.flushSubscription(subscription)
    for (const stream of this.replicaStreams.values()) this.flushReplicaStream(stream)
    this.subscriptions.clear()
    this.replicaStreams.clear()
    setPersonalSyncLocalSubscriptions(0)
    this.unsubscribeStore()
  }

  closeSession(sessionId: string): void {
    for (const [subscriptionId, subscription] of this.subscriptions.entries()) {
      if (subscription.sessionId !== sessionId) continue
      this.flushSubscription(subscription)
      this.subscriptions.delete(subscriptionId)
    }
    this.updateSubscriptionMetric()
  }

  private handleMutation(mutation: CanonicalMutation): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.sessionId !== mutation.sessionId) continue
      if (!subscription.active) subscription.buffered.push(mutation)
      else this.queueMutation(subscription, mutation)
    }
    for (const stream of this.replicaStreams.values()) {
      if (!stream.active) stream.buffered.push(mutation)
      else this.queueReplicaMutation(stream, mutation)
    }
  }

  private queueReplicaMutation(stream: ReplicaStream, mutation: CanonicalMutation): void {
    const lastQueued = stream.lastQueuedBySession.get(mutation.sessionId) ?? 0
    if (mutation.revision <= lastQueued) return
    const mutationBytes = Buffer.byteLength(JSON.stringify({
      ...mutation,
      subscriptionId: stream.streamId,
    }), 'utf8') + 1
    if (stream.pendingCount > 0
      && stream.pendingBytes + mutationBytes > PERSONAL_HISTORY_DELTA_BATCH_MAX_BYTES) {
      this.flushReplicaStream(stream)
    }
    const pending = stream.pendingBySession.get(mutation.sessionId) ?? []
    pending.push(mutation)
    stream.pendingBySession.set(mutation.sessionId, pending)
    stream.pendingCount++
    stream.pendingBytes += mutationBytes
    stream.lastQueuedBySession.set(mutation.sessionId, mutation.revision)
    if (stream.pendingCount >= PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS) {
      this.flushReplicaStream(stream)
      return
    }
    if (stream.flushTimer) return
    stream.flushTimer = setTimeout(
      () => this.flushReplicaStream(stream),
      PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS,
    )
  }

  private flushReplicaStream(stream: ReplicaStream): void {
    if (stream.flushTimer) {
      clearTimeout(stream.flushTimer)
      stream.flushTimer = null
    }
    if (stream.pendingCount === 0) return
    const batches = [...stream.pendingBySession.entries()].flatMap(([sessionId, pending]) => {
      const lastSent = stream.lastSentBySession.get(sessionId) ?? 0
      const mutations = pending.filter((mutation) => mutation.revision > lastSent)
      if (mutations.length === 0) return []
      const toRevision = mutations[mutations.length - 1]!.revision
      stream.lastSentBySession.set(sessionId, toRevision)
      return [{
        sessionId,
        fromRevision: lastSent,
        toRevision,
        mutations: mutations.map((mutation) => ({
          ...mutation,
          subscriptionId: stream.streamId,
        })),
      }]
    })
    stream.pendingBySession.clear()
    stream.pendingCount = 0
    stream.pendingBytes = 0
    if (batches.length === 0) return
    this.client.sendEvent({
      type: 'event',
      event: 'session.body.replica.delta',
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        appInstallationId: stream.appInstallationId,
        streamId: stream.streamId,
        generation: stream.generation,
        batches,
      },
    })
    recordPersonalSyncLocalMetric('historyDeltas')
    recordPersonalSyncLocalMetric(
      'historyBytesServed',
      Buffer.byteLength(JSON.stringify(batches), 'utf8'),
    )
  }

  private queueMutation(subscription: Subscription, mutation: CanonicalMutation): void {
    if (mutation.revision <= subscription.lastQueuedRevision) return
    const mutationBytes = Buffer.byteLength(JSON.stringify({
      ...mutation,
      subscriptionId: subscription.subscriptionId,
    }), 'utf8') + 1
    if (
      subscription.pending.length > 0 &&
      subscription.pendingBytes + mutationBytes > PERSONAL_HISTORY_DELTA_BATCH_MAX_BYTES
    ) this.flushSubscription(subscription)
    subscription.pending.push(mutation)
    subscription.pendingBytes += mutationBytes
    subscription.lastQueuedRevision = mutation.revision
    if (subscription.pending.length >= PERSONAL_HISTORY_DELTA_BATCH_MAX_MUTATIONS) {
      this.flushSubscription(subscription)
      return
    }
    if (subscription.flushTimer) return
    subscription.flushTimer = setTimeout(
      () => this.flushSubscription(subscription),
      PERSONAL_HISTORY_DELTA_BATCH_WINDOW_MS,
    )
  }

  private flushSubscription(subscription: Subscription): void {
    if (subscription.flushTimer) {
      clearTimeout(subscription.flushTimer)
      subscription.flushTimer = null
    }
    if (subscription.pending.length === 0) return
    const mutations = subscription.pending
      .filter((mutation) => mutation.revision > subscription.lastSentRevision)
    subscription.pending = []
    subscription.pendingBytes = 0
    if (mutations.length === 0) return
    const toRevision = mutations[mutations.length - 1]!.revision
    this.client.sendEvent({
      type: 'event',
      event: 'session.body.delta',
      payload: {
        ...getPersonalSyncIdentity(this.store.daemonInstallationId),
        sessionId: subscription.sessionId,
        subscriptionId: subscription.subscriptionId,
        fromRevision: subscription.lastSentRevision,
        toRevision,
        mutations: mutations.map((mutation) => ({
          ...mutation,
          subscriptionId: subscription.subscriptionId,
        })),
      },
    })
    recordPersonalSyncLocalMetric('historyDeltas')
    recordPersonalSyncLocalMetric(
      'historyBytesServed',
      Buffer.byteLength(JSON.stringify(mutations), 'utf8'),
    )
    subscription.lastSentRevision = toRevision
  }

  private requireSubscription(sessionId: string, subscriptionId: string): Subscription {
    validateIdentity(sessionId, subscriptionId)
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription || subscription.sessionId !== sessionId) throw new Error('subscription_not_found')
    return subscription
  }

  private updateSubscriptionMetric(): void {
    setPersonalSyncLocalSubscriptions(this.subscriptions.size + this.replicaStreams.size)
  }
}

function validateIdentity(sessionId: unknown, subscriptionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== 'string' || !sessionId || typeof subscriptionId !== 'string' || !subscriptionId) {
    throw new Error('invalid history subscription identity')
  }
}
function validateStreamIdentity(
  appInstallationId: unknown,
  streamId: unknown,
  generation: unknown,
): asserts streamId is string {
  if (typeof appInstallationId !== 'string' || !appInstallationId
    || typeof streamId !== 'string' || !streamId
    || !Number.isSafeInteger(generation) || (generation as number) < 1) {
    throw new Error('invalid body replica stream identity')
  }
}
function normalizeLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SESSION_HISTORY_LIMITS.maxPageMessages) {
    throw new Error('invalid history limit')
  }
  return limit
}

function normalizeSyncLimit(value: number | undefined): number {
  const limit = value ?? SESSION_HISTORY_LIMITS.maxDeltaMutations
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SESSION_HISTORY_LIMITS.maxDeltaMutations) {
    throw new Error('invalid history sync limit')
  }
  return limit
}
