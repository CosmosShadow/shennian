// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-history-relay.test.ts

import { createHash, randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import type {
  Frame,
  ReqFrame,
  SessionBodyDeltaEvent,
  SessionBodyReplicaDeltaEvent,
} from '@shennian/wire'
import {
  SESSION_HISTORY_LIMITS,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type PersonalSyncIdentity,
} from '@shennian/wire'
import { pubsub } from './pubsub.js'
import {
  recordPersonalSyncOperation,
  setPersonalSyncActiveSubscriptions,
} from '../services/personal-sync-operations.js'

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_SOCKET_BUFFER_BYTES = 4 * 1024 * 1024
const REQUEST_ROUTE_TTL_MS = 45_000

export function personalHistoryOpenError(session: {
  machine: {
    online: boolean
    sessionSyncProtocolVersion: number | null
    sessionSyncDataEpoch: number | null
    sessionSyncCapabilities: unknown
    daemonInstallationId: string | null
  }
} | null): 'history_unavailable' | 'machine_offline' | 'upgrade_required' | null {
  if (!session) return 'history_unavailable'
  if (!session.machine.online) return 'machine_offline'
  if (
    session.machine.sessionSyncProtocolVersion !== SESSION_SYNC_PROTOCOL_VERSION
    || session.machine.sessionSyncDataEpoch !== SESSION_SYNC_DATA_EPOCH
    || !Array.isArray(session.machine.sessionSyncCapabilities)
    || !session.machine.daemonInstallationId
  ) return 'upgrade_required'
  return null
}

type ClientMode = 'legacy' | 'multiplex'
type ClientRoute = {
  socket: WebSocket
  machineId: string
  sessionId: string
  subscriptionId: string
  protocolVersion: typeof SESSION_SYNC_PROTOCOL_VERSION
  dataEpoch: typeof SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
  mode: ClientMode
  unsubscribe: () => void
  openTimer: ReturnType<typeof setTimeout>
}
type PendingRequest = {
  machineId: string
  sessionId: string
  subscriptionId: string
  protocolVersion: typeof SESSION_SYNC_PROTOCOL_VERSION
  dataEpoch: typeof SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
  method: 'session.history.open' | 'session.history.page' | 'session.history.close'
  timer: ReturnType<typeof setTimeout>
}
type ReplicaRoute = {
  socket: WebSocket
  machineId: string
  streamId: string
  appInstallationId: string
  generation: number
  protocolVersion: typeof SESSION_SYNC_PROTOCOL_VERSION
  dataEpoch: typeof SESSION_SYNC_DATA_EPOCH
  daemonInstallationId: string
  mode: ClientMode
  unsubscribe: () => void
  openTimer: ReturnType<typeof setTimeout>
}
type PendingReplicaRequest = Omit<
  ReplicaRoute,
  'socket' | 'mode' | 'unsubscribe' | 'openTimer'
> & {
  method: 'session.body.replica.subscribe' | 'session.body.replica.unsubscribe'
  timer: ReturnType<typeof setTimeout>
}

function routeKey(subscriptionId: string): string {
  return createHash('sha256').update(subscriptionId).digest('hex')
}

function replicaRouteKey(streamId: string): string {
  return `replica:${routeKey(streamId)}`
}

export function getPersonalBodyReplicaIdentity(
  frame: ReqFrame,
): (PersonalSyncIdentity & { appInstallationId: string; streamId: string; generation: number }) | null {
  if (frame.method !== 'session.body.replica.subscribe'
    && frame.method !== 'session.body.replica.unsubscribe') return null
  const {
    protocolVersion, dataEpoch, daemonInstallationId, appInstallationId, streamId, generation,
  } = frame.params
  if (protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION || dataEpoch !== SESSION_SYNC_DATA_EPOCH
    || typeof daemonInstallationId !== 'string' || !daemonInstallationId
    || typeof appInstallationId !== 'string' || !appInstallationId || appInstallationId.length > 191
    || typeof streamId !== 'string' || !streamId || streamId.length > 191
    || !Number.isSafeInteger(generation) || (generation as number) < 1) return null
  return {
    protocolVersion, dataEpoch, daemonInstallationId, appInstallationId,
    streamId, generation: generation as number,
  }
}

export function getPersonalHistoryIdentity(
  frame: ReqFrame,
): (PersonalSyncIdentity & { sessionId: string; subscriptionId: string }) | null {
  if (
    frame.method !== 'session.history.open' &&
    frame.method !== 'session.history.page' &&
    frame.method !== 'session.history.close'
  ) return null
  const sessionId = frame.params.sessionId
  const subscriptionId = frame.params.subscriptionId
  const { protocolVersion, dataEpoch, daemonInstallationId } = frame.params
  if (protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION || dataEpoch !== SESSION_SYNC_DATA_EPOCH
    || typeof daemonInstallationId !== 'string' || !daemonInstallationId
    || typeof sessionId !== 'string' || !sessionId || typeof subscriptionId !== 'string' || !subscriptionId) {
    return null
  }
  return { protocolVersion, dataEpoch, daemonInstallationId, sessionId, subscriptionId }
}

function parseFrame(data: string): Frame | null {
  try {
    const frame = JSON.parse(data) as Frame
    return frame && typeof frame === 'object' && typeof frame.type === 'string' ? frame : null
  } catch {
    return null
  }
}

export class PersonalHistoryRelay {
  private routes = new Map<string, ClientRoute>()
  private routesBySocket = new Map<WebSocket, Set<string>>()
  private pendingRequests = new Map<string, PendingRequest>()
  private replicaRoutes = new Map<string, ReplicaRoute>()
  private replicaRoutesBySocket = new Map<WebSocket, Set<string>>()
  private pendingReplicaRequests = new Map<string, PendingReplicaRequest>()

  registerReplicaRoute(input: Omit<ReplicaRoute, 'unsubscribe' | 'openTimer'>): void {
    const existing = this.replicaRoutes.get(input.streamId)
    if (existing) {
      if (existing.socket === input.socket && existing.machineId === input.machineId
        && existing.appInstallationId === input.appInstallationId) {
        if (existing.generation === input.generation) return
        if (input.generation > existing.generation) this.removeReplicaRoute(input.streamId)
        else throw new Error('invalid replica generation')
      } else {
        throw new Error('subscription already belongs to another client')
      }
    }
    const socketRoutes = this.replicaRoutesBySocket.get(input.socket) ?? new Set<string>()
    if (socketRoutes.size >= SESSION_HISTORY_LIMITS.maxReplicaStreamsPerDaemon) {
      throw new Error('subscription_limit_exceeded')
    }
    const unsubscribe = pubsub.subscribeHistory(replicaRouteKey(input.streamId), (data) => {
      if (!this.receivePublishedDelta(data)) this.deliverReplica(input.streamId, data)
    })
    const openTimer = setTimeout(
      () => this.removeReplicaRoute(input.streamId),
      REQUEST_ROUTE_TTL_MS,
    )
    this.replicaRoutes.set(input.streamId, { ...input, unsubscribe, openTimer })
    socketRoutes.add(input.streamId)
    this.replicaRoutesBySocket.set(input.socket, socketRoutes)
    recordPersonalSyncOperation('historyOpens')
    this.updateActiveSubscriptionMetric()
  }

  hasReplicaRoute(socket: WebSocket, machineId: string, streamId: string, generation: number): boolean {
    const route = this.replicaRoutes.get(streamId)
    return Boolean(route && route.socket === socket && route.machineId === machineId
      && route.generation === generation)
  }

  registerClientRoute(
    input: Omit<ClientRoute, 'unsubscribe' | 'openTimer' | keyof PersonalSyncIdentity>
      & Partial<PersonalSyncIdentity>,
  ): void {
    const normalized = {
      ...input,
      protocolVersion: input.protocolVersion ?? SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: input.dataEpoch ?? SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: input.daemonInstallationId ?? '',
    } as Omit<ClientRoute, 'unsubscribe' | 'openTimer'>
    const existing = this.routes.get(normalized.subscriptionId)
    if (existing) {
      if (
        existing.socket === normalized.socket && existing.machineId === normalized.machineId &&
        existing.sessionId === normalized.sessionId
      ) return
      throw new Error('subscription already belongs to another client')
    }
    const socketRoutes = this.routesBySocket.get(normalized.socket) ?? new Set<string>()
    if (socketRoutes.size >= SESSION_HISTORY_LIMITS.maxSubscriptionsPerClient) {
      throw new Error('subscription_limit_exceeded')
    }
    const unsubscribe = pubsub.subscribeHistory(routeKey(normalized.subscriptionId), (data) => {
      if (!this.receivePublishedDelta(data)) this.deliver(normalized.subscriptionId, data)
    })
    const openTimer = setTimeout(
      () => this.removeClientRoute(normalized.subscriptionId),
      REQUEST_ROUTE_TTL_MS,
    )
    this.routes.set(normalized.subscriptionId, { ...normalized, unsubscribe, openTimer })
    socketRoutes.add(normalized.subscriptionId)
    this.routesBySocket.set(normalized.socket, socketRoutes)
    recordPersonalSyncOperation('historyOpens')
    this.updateActiveSubscriptionMetric()
  }

  hasClientRoute(
    socket: WebSocket,
    machineId: string,
    sessionId: string,
    subscriptionId: string,
  ): boolean {
    const route = this.routes.get(subscriptionId)
    return Boolean(
      route && route.socket === socket && route.machineId === machineId && route.sessionId === sessionId,
    )
  }

  observeForwardedRequest(machineId: string, frame: ReqFrame): boolean {
    const replicaIdentity = getPersonalBodyReplicaIdentity(frame)
    if (replicaIdentity) {
      const previous = this.pendingReplicaRequests.get(frame.id)
      if (previous) clearTimeout(previous.timer)
      this.pendingReplicaRequests.set(frame.id, {
        machineId,
        ...replicaIdentity,
        method: frame.method as PendingReplicaRequest['method'],
        timer: setTimeout(() => this.pendingReplicaRequests.delete(frame.id), REQUEST_ROUTE_TTL_MS),
      })
      return true
    }
    const identity = getPersonalHistoryIdentity(frame)
    if (!identity) return false
    const previous = this.pendingRequests.get(frame.id)
    if (previous) clearTimeout(previous.timer)
    const pending: PendingRequest = {
      machineId,
      ...identity,
      method: frame.method as PendingRequest['method'],
      timer: setTimeout(() => this.pendingRequests.delete(frame.id), REQUEST_ROUTE_TTL_MS),
    }
    this.pendingRequests.set(frame.id, pending)
    return true
  }

  routeMachineFrame(machineId: string, data: string): boolean {
    const frame = parseFrame(data)
    if (!frame) return false
    if (frame.type === 'res') {
      const replicaPending = this.pendingReplicaRequests.get(frame.id)
      if (replicaPending?.machineId === machineId) {
        clearTimeout(replicaPending.timer)
        this.pendingReplicaRequests.delete(frame.id)
        const responseIdentity = frame.payload as Partial<PersonalSyncIdentity & {
          appInstallationId: string
          streamId: string
          generation: number
        }> | undefined
        if (frame.ok && (
          responseIdentity?.protocolVersion !== replicaPending.protocolVersion
          || responseIdentity.dataEpoch !== replicaPending.dataEpoch
          || responseIdentity.daemonInstallationId !== replicaPending.daemonInstallationId
          || responseIdentity.appInstallationId !== replicaPending.appInstallationId
          || responseIdentity.streamId !== replicaPending.streamId
          || responseIdentity.generation !== replicaPending.generation
        )) {
          this.publishReplicaError(replicaPending.streamId, 'invalid_identity')
          this.removeReplicaRoute(replicaPending.streamId)
          return true
        }
        recordPersonalSyncOperation('historyResponses')
        recordPersonalSyncOperation('historyBytes', Buffer.byteLength(data, 'utf8'))
        this.publishReplica(replicaPending.streamId, data)
        if (!frame.ok || replicaPending.method === 'session.body.replica.unsubscribe') {
          this.removeReplicaRoute(replicaPending.streamId)
        }
        return true
      }
      const pending = this.pendingRequests.get(frame.id)
      if (!pending || pending.machineId !== machineId) return false
      clearTimeout(pending.timer)
      this.pendingRequests.delete(frame.id)
      const responseIdentity = frame.payload as Partial<PersonalSyncIdentity> | undefined
      if (frame.ok && (
        responseIdentity?.protocolVersion !== pending.protocolVersion ||
        responseIdentity.dataEpoch !== pending.dataEpoch ||
        responseIdentity.daemonInstallationId !== pending.daemonInstallationId
      )) {
        this.publishError(pending.subscriptionId, pending.sessionId, 'invalid_identity')
        this.removeClientRoute(pending.subscriptionId)
        return true
      }
      recordPersonalSyncOperation('historyResponses')
      recordPersonalSyncOperation('historyBytes', Buffer.byteLength(data, 'utf8'))
      this.publish(pending.subscriptionId, data)
      if (!frame.ok || pending.method === 'session.history.close') {
        this.removeClientRoute(pending.subscriptionId)
      }
      return true
    }
    if (frame.type !== 'event') return false
    const replica = frame.event === 'session.body.replica.delta'
    if (!replica && frame.event !== 'session.body.delta') return false
    const delta = frame.payload as SessionBodyReplicaDeltaEvent & SessionBodyDeltaEvent
    const key = replica ? delta?.streamId : delta?.subscriptionId
    if (!key) return true
    // Only the App-owning node has the socket route. The daemon-owning node
    // forwards transiently; authorization is checked at the destination.
    const local = replica ? this.replicaRoutes.has(key) : this.routes.has(key)
    if (local) this.deliverDelta(machineId, frame, data)
    else if (pubsub.isActive && Buffer.byteLength(data, 'utf8') <= SESSION_HISTORY_LIMITS.maxMutationBytes) {
      recordPersonalSyncOperation('historyRedisPublishes')
      pubsub.publishHistory(replica ? replicaRouteKey(key) : routeKey(key), JSON.stringify({
        type: 'personal-history-delta', machineId, frame,
      }))
    }
    return true
  }

  private receivePublishedDelta(data: string): boolean {
    let value: { type?: string; machineId?: string; frame?: Frame }
    try { value = JSON.parse(data) } catch { return true }
    if (value?.type !== 'personal-history-delta') {
      // Old nodes never successfully forwarded cross-node deltas. Do not
      // accept a raw delta that lacks the authenticated source machine.
      const raw = parseFrame(data)
      return raw?.type === 'event' && (raw.event === 'session.body.delta'
        || raw.event === 'session.body.replica.delta')
    }
    if (typeof value.machineId === 'string' && value.frame?.type === 'event') {
      this.deliverDelta(value.machineId, value.frame, JSON.stringify(value.frame))
    }
    return true
  }

  private deliverDelta(machineId: string, frame: Frame, data: string): void {
    if (frame.type !== 'event') return
    const replica = frame.event === 'session.body.replica.delta'
    if (!replica && frame.event !== 'session.body.delta') return
    const delta = frame.payload as SessionBodyReplicaDeltaEvent & SessionBodyDeltaEvent
    const key = replica ? delta?.streamId : delta?.subscriptionId
    const route = replica ? this.replicaRoutes.get(key) : this.routes.get(key)
    // Unknown/closed routes and another machine's frames cannot invalidate
    // an existing authorized subscription or reach its socket.
    if (!route || route.machineId !== machineId) return
    if (delta.protocolVersion !== route.protocolVersion || delta.dataEpoch !== route.dataEpoch
      || delta.daemonInstallationId !== route.daemonInstallationId
      || (replica && (delta.appInstallationId !== (route as ReplicaRoute).appInstallationId
        || delta.generation !== (route as ReplicaRoute).generation))
      || (!replica && delta.sessionId !== (route as ClientRoute).sessionId)) {
      if (replica) {
        this.publishReplicaError(key, 'invalid_identity')
        this.removeReplicaRoute(key)
      } else {
        this.publishError(key, (route as ClientRoute).sessionId, 'invalid_identity')
        this.removeClientRoute(key)
      }
      return
    }
    if (Buffer.byteLength(data, 'utf8') > SESSION_HISTORY_LIMITS.maxMutationBytes) {
      if (replica) this.publishReplicaError(key, 'response_too_large')
      else this.publishError(key, (route as ClientRoute).sessionId, 'response_too_large')
      return
    }
    recordPersonalSyncOperation('historyDeltas')
    recordPersonalSyncOperation('historyBytes', Buffer.byteLength(data, 'utf8'))
    if (replica) this.deliverReplica(key, data)
    else this.deliver(key, data)
  }

  closeSocket(
    socket: WebSocket,
    sendClose: (machineId: string, frame: ReqFrame) => void,
  ): void {
    const subscriptions = [...(this.routesBySocket.get(socket) ?? [])]
    for (const subscriptionId of subscriptions) {
      const route = this.routes.get(subscriptionId)
      if (!route) continue
      sendClose(route.machineId, {
        type: 'req',
        id: `server_close_${randomBytes(8).toString('hex')}`,
        method: 'session.history.close',
        params: {
          protocolVersion: route.protocolVersion,
          dataEpoch: route.dataEpoch,
          daemonInstallationId: route.daemonInstallationId,
          sessionId: route.sessionId,
          subscriptionId,
        },
      })
      this.removeClientRoute(subscriptionId)
    }
    const streams = [...(this.replicaRoutesBySocket.get(socket) ?? [])]
    for (const streamId of streams) {
      const route = this.replicaRoutes.get(streamId)
      if (!route) continue
      sendClose(route.machineId, {
        type: 'req',
        id: `server_replica_close_${randomBytes(8).toString('hex')}`,
        method: 'session.body.replica.unsubscribe',
        params: {
          protocolVersion: route.protocolVersion,
          dataEpoch: route.dataEpoch,
          daemonInstallationId: route.daemonInstallationId,
          appInstallationId: route.appInstallationId,
          streamId,
          generation: route.generation,
        },
      })
      this.removeReplicaRoute(streamId)
    }
  }

  closeSession(sessionId: string, sendClose: (machineId: string, frame: ReqFrame) => void): void {
    for (const route of [...this.routes.values()]) {
      if (route.sessionId !== sessionId) continue
      sendClose(route.machineId, {
        type: 'req',
        id: `server_delete_close_${randomBytes(8).toString('hex')}`,
        method: 'session.history.close',
        params: {
          protocolVersion: route.protocolVersion,
          dataEpoch: route.dataEpoch,
          daemonInstallationId: route.daemonInstallationId,
          sessionId: route.sessionId,
          subscriptionId: route.subscriptionId,
        },
      })
      this.removeClientRoute(route.subscriptionId)
    }
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.sessionId !== sessionId) continue
      clearTimeout(pending.timer)
      this.pendingRequests.delete(requestId)
    }
  }

  removeClientRoute(subscriptionId: string): void {
    const route = this.routes.get(subscriptionId)
    if (!route) return
    route.unsubscribe()
    clearTimeout(route.openTimer)
    this.routes.delete(subscriptionId)
    this.updateActiveSubscriptionMetric()
    const socketRoutes = this.routesBySocket.get(route.socket)
    socketRoutes?.delete(subscriptionId)
    if (socketRoutes?.size === 0) this.routesBySocket.delete(route.socket)
  }

  removeReplicaRoute(streamId: string): void {
    const route = this.replicaRoutes.get(streamId)
    if (!route) return
    route.unsubscribe()
    clearTimeout(route.openTimer)
    this.replicaRoutes.delete(streamId)
    const socketRoutes = this.replicaRoutesBySocket.get(route.socket)
    socketRoutes?.delete(streamId)
    if (socketRoutes?.size === 0) this.replicaRoutesBySocket.delete(route.socket)
    this.updateActiveSubscriptionMetric()
  }

  reset(): void {
    for (const route of this.routes.values()) route.unsubscribe()
    for (const route of this.replicaRoutes.values()) route.unsubscribe()
    for (const pending of this.pendingRequests.values()) clearTimeout(pending.timer)
    for (const pending of this.pendingReplicaRequests.values()) clearTimeout(pending.timer)
    this.routes.clear()
    this.routesBySocket.clear()
    this.pendingRequests.clear()
    this.replicaRoutes.clear()
    this.replicaRoutesBySocket.clear()
    this.pendingReplicaRequests.clear()
    setPersonalSyncActiveSubscriptions(0)
  }

  private publish(subscriptionId: string, data: string): void {
    if (Buffer.byteLength(data, 'utf8') > MAX_RESPONSE_BYTES) {
      const route = this.routes.get(subscriptionId)
      this.publishError(subscriptionId, route?.sessionId ?? '', 'response_too_large')
      return
    }
    if (this.routes.has(subscriptionId)) this.deliver(subscriptionId, data)
    else if (pubsub.isActive) {
      recordPersonalSyncOperation('historyRedisPublishes')
      pubsub.publishHistory(routeKey(subscriptionId), data)
    }
  }

  private publishReplica(streamId: string, data: string): void {
    if (Buffer.byteLength(data, 'utf8') > MAX_RESPONSE_BYTES) {
      this.publishReplicaError(streamId, 'response_too_large')
      return
    }
    if (this.replicaRoutes.has(streamId)) this.deliverReplica(streamId, data)
    else if (pubsub.isActive) {
      recordPersonalSyncOperation('historyRedisPublishes')
      pubsub.publishHistory(replicaRouteKey(streamId), data)
    }
  }

  private publishReplicaError(streamId: string, code: string): void {
    const route = this.replicaRoutes.get(streamId)
    const retryable = code === 'machine_offline'
    const data = JSON.stringify({
      type: 'event', event: 'session.body.replica.error',
      payload: {
        streamId,
        ...(route ? {
          generation: route.generation,
          appInstallationId: route.appInstallationId,
        } : {}),
        rejection: {
          code,
          retryable,
          requiredAction: retryable
            ? 'retry'
            : code === 'invalid_identity' ? 'quarantine_record' : 'stop',
          authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
        },
      },
    })
    if (this.replicaRoutes.has(streamId)) this.deliverReplica(streamId, data)
    else if (pubsub.isActive) pubsub.publishHistory(replicaRouteKey(streamId), data)
  }

  private publishError(subscriptionId: string, sessionId: string, code: string): void {
    const retryable = code === 'machine_offline' || code === 'history_unavailable'
    const data = JSON.stringify({
      type: 'event',
      event: 'session.body.error',
      payload: {
        sessionId, subscriptionId, code, retryable,
        requiredAction: retryable ? 'retry' : code === 'invalid_identity' ? 'quarantine_record' : 'stop',
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      },
    })
    if (this.routes.has(subscriptionId)) this.deliver(subscriptionId, data)
    else if (pubsub.isActive) {
      recordPersonalSyncOperation('historyRedisPublishes')
      pubsub.publishHistory(routeKey(subscriptionId), data)
    }
  }

  private deliver(subscriptionId: string, data: string): void {
    const route = this.routes.get(subscriptionId)
    if (!route || route.socket.readyState !== route.socket.OPEN) return
    if (route.socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
      recordPersonalSyncOperation('slowConsumerDisconnects')
      route.socket.close(4413, 'history backpressure exceeded')
      this.removeClientRoute(subscriptionId)
      return
    }
    const frame = parseFrame(data)
    if (frame?.type === 'res') clearTimeout(route.openTimer)
    if (route.mode === 'multiplex') {
      route.socket.send(JSON.stringify({
        type: 'relay', machineId: route.machineId, frame: JSON.parse(data) as Frame,
      }))
    } else {
      route.socket.send(data)
    }
    if (frame?.type === 'res' && (!frame.ok || (frame.payload as { closed?: unknown } | undefined)?.closed === true)) {
      this.removeClientRoute(subscriptionId)
    }
  }

  private deliverReplica(streamId: string, data: string): void {
    const route = this.replicaRoutes.get(streamId)
    if (!route || route.socket.readyState !== route.socket.OPEN) return
    if (route.socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
      recordPersonalSyncOperation('slowConsumerDisconnects')
      route.socket.close(4413, 'history backpressure exceeded')
      this.removeReplicaRoute(streamId)
      return
    }
    const frame = parseFrame(data)
    if (frame?.type === 'res') clearTimeout(route.openTimer)
    route.socket.send(route.mode === 'multiplex'
      ? JSON.stringify({ type: 'relay', machineId: route.machineId, frame: JSON.parse(data) as Frame })
      : data)
    if (frame?.type === 'res' && (!frame.ok
      || (frame.payload as { closed?: unknown } | undefined)?.closed === true)) {
      this.removeReplicaRoute(streamId)
    }
  }

  private updateActiveSubscriptionMetric(): void {
    setPersonalSyncActiveSubscriptions(this.routes.size + this.replicaRoutes.size)
  }
}

export const personalHistoryRelay = new PersonalHistoryRelay()
