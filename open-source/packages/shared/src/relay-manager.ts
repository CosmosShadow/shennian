// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/relay-manager.test.ts

import {
  DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT,
  MultiplexRelayClient,
  RelayClient,
  type RelayState,
} from './relay'
import type {
  EventFrame,
  ResFrame,
  ReqFrame,
  RelayConnectivityEvent,
  RelayConnectivitySnapshot,
} from '@shennian/wire'
import { incrementRuntimeMetric, recordRuntimeDuration, setRuntimeGauge } from './runtime-metrics'

export type RelayEventHandler = (machineId: string, event: EventFrame) => void

export type RelayClientHandle = {
  getState(): RelayState
  send(frame: Omit<ReqFrame, 'id'>, timeoutMs?: number): Promise<ResFrame>
  sendEvent(event: EventFrame): void
}

const RELAY_WATCHDOG_DELAY_MS = 10_000
// MultiplexRelayClient owns the 10s handshake deadline and normal backoff.
// This slightly later guard only repairs a lost client timer/state transition.
const RELAY_CONNECTING_WATCHDOG_DELAY_MS = 12_000

export class RelayConnectionError extends Error {
  constructor(public snapshot: RelayConnectivitySnapshot) {
    super(`Relay unavailable: ${snapshot.reason}`)
    this.name = 'RelayConnectionError'
  }
}

export class RelayManager {
  private connections = new Map<string, RelayClient>()
  private refCounts = new Map<string, number>()
  private localHandlers = new Map<string, Set<(event: EventFrame) => void>>()
  private stateListeners = new Map<string, Set<(state: RelayState) => void>>()
  private userStateListeners = new Set<(state: RelayState) => void>()
  private userConnectivityListeners = new Set<(snapshot: RelayConnectivitySnapshot) => void>()
  private lastUserState: RelayState = 'disconnected'
  private globalEventHandler: RelayEventHandler | null = null
  private connectedOnce = new Set<string>()
  private multiplexConnectedOnce = false
  private onReconnectCallback: (() => void) | null = null
  private reconnectDebounce: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null

  private buildUrl: (machineId: string) => string
  private buildClientUrl?: () => string
  private getToken: () => string | null
  private multiplexClient: MultiplexRelayClient | null = null
  private suspended = false
  private networkOnline = true
  private onConnectivityEvent?: (event: RelayConnectivityEvent) => void

  constructor(opts: {
    buildUrl: (machineId: string) => string
    buildClientUrl?: () => string
    getToken: () => string | null
    onConnectivityEvent?: (event: RelayConnectivityEvent) => void
  }) {
    this.buildUrl = opts.buildUrl
    this.buildClientUrl = opts.buildClientUrl
    this.getToken = opts.getToken
    this.onConnectivityEvent = opts.onConnectivityEvent
  }

  setOnReconnect(handler: () => void): void {
    this.onReconnectCallback = handler
  }

  setEventHandler(handler: RelayEventHandler): void {
    this.globalEventHandler = handler
  }

  /** Connect the user-scoped event stream even when the account has no machine subscriptions. */
  connectUserEvents(): boolean {
    const token = this.getToken()
    if (!token || this.suspended || !this.canUseMultiplex()) return false
    return Boolean(this.ensureMultiplexClient(token))
  }

  getUserConnectionState(): RelayState {
    return this.multiplexClient?.getState() ?? 'disconnected'
  }

  getUserConnectivitySnapshot(): RelayConnectivitySnapshot {
    return this.multiplexClient?.getConnectivitySnapshot() ?? {
      ...DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT,
      phase: this.networkOnline ? 'recovering' : 'offline',
      reason: this.networkOnline ? 'unknown' : 'network_offline',
    }
  }

  onUserConnectionStateChange(listener: (state: RelayState) => void): () => void {
    this.userStateListeners.add(listener)
    return () => this.userStateListeners.delete(listener)
  }

  onUserConnectivityChange(
    listener: (snapshot: RelayConnectivitySnapshot) => void,
  ): () => void {
    this.userConnectivityListeners.add(listener)
    return () => this.userConnectivityListeners.delete(listener)
  }

  /** Update native/browser reachability without coupling Shared to a platform API. */
  setNetworkOnline(online: boolean): void {
    this.networkOnline = online
    this.multiplexClient?.setNetworkOnline(online)
    if (online && !this.suspended) this.reconnectNow('network-restored')
  }

  /**
   * Rebuild the account socket. Ordinary repeated calls share an active
   * attempt; the watchdog may replace an expired one.
   */
  reconnectNow(
    source: 'manual' | 'watchdog' | 'foreground' | 'network-restored' = 'manual',
  ): boolean {
    if (this.suspended || !this.networkOnline || !this.canUseMultiplex()) return false
    const token = this.getToken()
    if (!token) return false
    const current = this.multiplexClient
    if (current?.getState() === 'connected') return true
    // Foreground/network/manual signals share the active attempt. Only the
    // watchdog may replace a connecting socket, after its bounded deadline.
    if (current?.getState() === 'connecting' && source !== 'watchdog') return true

    this.clearWatchdog()
    if (source === 'manual' || source === 'watchdog') {
      this.onConnectivityEvent?.({
        name: source === 'watchdog' ? 'relay_watchdog_rebuild' : 'relay_manual_retry',
        snapshot: this.getUserConnectivitySnapshot(),
        at: Date.now(),
      })
    }
    current?.disconnect()
    this.multiplexClient = null
    incrementRuntimeMetric(`relay.main.rebuild.${source}`)
    const client = this.ensureMultiplexClient(token)
    if (!client) return false
    for (const machineId of this.refCounts.keys()) client.subscribe(machineId)
    return true
  }

  acquire(machineId: string, onEvent?: (event: EventFrame) => void): RelayClientHandle | null {
    const token = this.getToken()
    if (!token) return null

    if (onEvent) {
      let handlers = this.localHandlers.get(machineId)
      if (!handlers) {
        handlers = new Set()
        this.localHandlers.set(machineId, handlers)
      }
      handlers.add(onEvent)
    }

    if (this.canUseMultiplex()) {
      this.refCounts.set(machineId, (this.refCounts.get(machineId) ?? 0) + 1)
      if (this.suspended) return this.createMultiplexHandle(machineId)
      const client = this.ensureMultiplexClient(token)
      if (!client) return null
      client.subscribe(machineId)
      if (client.getState() === 'connected') {
        this.notifyState(machineId, 'connected')
        // The account socket may have connected before this machine was
        // acquired. Remember that baseline so its next physical reconnect
        // still triggers the reconciliation round for this subscription.
        this.connectedOnce.add(machineId)
      }
      return this.createMultiplexHandle(machineId)
    }

    const existing = this.connections.get(machineId)
    if (existing) {
      this.refCounts.set(machineId, (this.refCounts.get(machineId) ?? 0) + 1)
      return existing
    }

    const client = new RelayClient({
      url: this.buildUrl(machineId),
      token,
      onEvent: (event) => {
        incrementRuntimeMetric(`relay.inbound.${event.event}`)
        const handlers = this.localHandlers.get(machineId)
        if (handlers) {
          for (const fn of handlers) fn(event)
        }
        this.globalEventHandler?.(machineId, event)
      },
      onConnected: () => {
        const hadConnected = this.connectedOnce.has(machineId)
        this.notifyState(machineId, 'connected')
        this.connectedOnce.add(machineId)
        if (hadConnected) {
          this.fireReconnect()
        }
      },
      onDisconnected: () => this.notifyState(machineId, 'disconnected'),
    })

    this.connections.set(machineId, client)
    incrementRuntimeMetric('relay.legacy.socket_created')
    this.refCounts.set(machineId, 1)
    client.connect()
    return client
  }

  release(machineId: string, onEvent?: (event: EventFrame) => void): void {
    if (onEvent) {
      const handlers = this.localHandlers.get(machineId)
      if (handlers) {
        handlers.delete(onEvent)
        if (handlers.size === 0) this.localHandlers.delete(machineId)
      }
    }
    const count = (this.refCounts.get(machineId) ?? 1) - 1
    if (count <= 0) {
      if (this.canUseMultiplex()) {
        this.multiplexClient?.unsubscribe(machineId)
      }
      this.connections.get(machineId)?.disconnect()
      this.connections.delete(machineId)
      this.refCounts.delete(machineId)
      this.stateListeners.delete(machineId)
      this.localHandlers.delete(machineId)
      this.connectedOnce.delete(machineId)
    } else {
      this.refCounts.set(machineId, count)
    }
  }

  getClient(machineId: string): RelayClientHandle | undefined {
    if (this.canUseMultiplex() && this.refCounts.has(machineId)) {
      return this.createMultiplexHandle(machineId)
    }
    return this.connections.get(machineId)
  }

  getState(machineId: string): RelayState {
    if (this.canUseMultiplex() && this.refCounts.has(machineId)) {
      return this.multiplexClient?.getState() ?? 'disconnected'
    }
    return this.connections.get(machineId)?.getState() ?? 'disconnected'
  }

  onStateChange(machineId: string, listener: (state: RelayState) => void): () => void {
    let set = this.stateListeners.get(machineId)
    if (!set) {
      set = new Set()
      this.stateListeners.set(machineId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }

  send(machineId: string, frame: Omit<ReqFrame, 'id'>, timeoutMs?: number): Promise<ResFrame> {
    if (this.canUseMultiplex() && this.multiplexClient) {
      return this.multiplexClient.send(machineId, frame, timeoutMs)
    }
    const client = this.connections.get(machineId)
    if (!client) return Promise.reject(new Error('No connection for machine'))
    return client.send(frame, timeoutMs)
  }

  /**
   * Like send(), but auto-acquires a connection if none exists, waits for
   * it to become connected, sends the frame, then releases the connection.
   *
   * @param connectTimeoutMs — max wait for WebSocket to connect (when not already connected)
   * @param requestTimeoutMs — max wait for `res` after send; defaults to RelayClient's 30s when omitted
   */
  sendWhenReady(
    machineId: string,
    frame: Omit<ReqFrame, 'id'>,
    connectTimeoutMs = 10_000,
    requestTimeoutMs?: number,
  ): Promise<ResFrame> {
    const existing = this.connections.get(machineId)
    if (existing?.getState() === 'connected') {
      return existing.send(frame, requestTimeoutMs)
    }
    if (this.canUseMultiplex() && this.multiplexClient?.getState() === 'connected') {
      return this.multiplexClient.send(machineId, frame, requestTimeoutMs)
    }

    const client = this.acquire(machineId)
    if (!client) return Promise.reject(new Error('Not authenticated'))

    return new Promise<ResFrame>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        clearTimeout(timer)
        unsub()
        unsubConnectivity()
      }

      const doSend = () => {
        if (settled) return
        settled = true
        cleanup()
        // release AFTER the send promise settles, not before
        client
          .send(frame, requestTimeoutMs)
          .then(resolve)
          .catch(reject)
          .finally(() => this.release(machineId))
      }

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        this.release(machineId)
        reject(err)
      }

      const timer = setTimeout(() => {
        fail(new RelayConnectionError(this.getUserConnectivitySnapshot()))
      }, connectTimeoutMs)

      const unsub = this.onStateChange(machineId, (state) => {
        if (state === 'connected') doSend()
      })
      const unsubConnectivity = this.onUserConnectivityChange((snapshot) => {
        if (snapshot.phase === 'blocked' || snapshot.phase === 'offline') {
          fail(new RelayConnectionError(snapshot))
        }
      })

      // May already be connected by the time we register the listener
      if (client.getState() === 'connected') doSend()
      else {
        const snapshot = this.getUserConnectivitySnapshot()
        if (snapshot.phase === 'blocked' || snapshot.phase === 'offline') {
          fail(new RelayConnectionError(snapshot))
        }
      }
    })
  }

  disconnectAll(): void {
    incrementRuntimeMetric('relay.manager.disconnect_all')
    if (this.reconnectDebounce) {
      clearTimeout(this.reconnectDebounce)
      this.reconnectDebounce = null
    }
    this.clearWatchdog()
    for (const [, client] of this.connections) {
      client.disconnect()
    }
    this.multiplexClient?.disconnect()
    this.multiplexClient = null
    setRuntimeGauge('relay.main.open', 0)
    this.connections.clear()
    this.refCounts.clear()
    this.stateListeners.clear()
    this.userStateListeners.clear()
    this.userConnectivityListeners.clear()
    this.localHandlers.clear()
    this.connectedOnce.clear()
    this.multiplexConnectedOnce = false
    this.lastUserState = 'disconnected'
    this.suspended = false
  }

  /** Stop ordinary relay traffic while preserving logical subscriptions. */
  suspend(): void {
    if (this.suspended) return
    incrementRuntimeMetric('relay.manager.suspend')
    this.suspended = true
    this.clearWatchdog()
    for (const machineId of this.refCounts.keys()) this.notifyState(machineId, 'disconnected')
    for (const [, client] of this.connections) client.disconnect()
    this.connections.clear()
    this.multiplexClient?.disconnect()
    this.multiplexClient = null
    setRuntimeGauge('relay.main.open', 0)
  }

  /** Restore the single user-scoped relay and its machine subscriptions. */
  resume(): boolean {
    incrementRuntimeMetric('relay.manager.resume')
    if (!this.suspended) {
      const token = this.getToken()
      if (!token) return false
      if (this.canUseMultiplex()) {
        if (this.multiplexClient?.getState() === 'disconnected') {
          return this.reconnectNow('foreground')
        }
        const client = this.ensureMultiplexClient(token)
        if (!client) return false
        for (const machineId of this.refCounts.keys()) client.subscribe(machineId)
        return true
      }
      for (const machineId of this.refCounts.keys()) this.ensureLegacyConnection(machineId)
      return this.connections.size > 0
    }
    this.suspended = false
    const token = this.getToken()
    if (!token) return false
    if (this.canUseMultiplex()) {
      const client = this.ensureMultiplexClient(token)
      if (!client) return false
      for (const machineId of this.refCounts.keys()) client.subscribe(machineId)
      return true
    }
    for (const machineId of this.refCounts.keys()) this.ensureLegacyConnection(machineId)
    return this.connections.size > 0
  }

  private fireReconnect(): void {
    if (!this.onReconnectCallback) return
    if (this.reconnectDebounce) clearTimeout(this.reconnectDebounce)
    this.reconnectDebounce = setTimeout(() => {
      this.reconnectDebounce = null
      this.onReconnectCallback?.()
    }, 500)
  }

  private notifyState(machineId: string, state: RelayState): void {
    const listeners = this.stateListeners.get(machineId)
    if (listeners) {
      for (const fn of listeners) {
        fn(state)
      }
    }
  }

  private canUseMultiplex(): boolean {
    return Boolean(this.buildClientUrl)
  }

  private ensureMultiplexClient(token: string): MultiplexRelayClient | null {
    if (this.multiplexClient) {
      this.multiplexClient.connect()
      return this.multiplexClient
    }
    if (!this.buildClientUrl) return null

    const client = new MultiplexRelayClient({
      url: this.buildClientUrl(),
      token,
      onEvent: (machineId, event) => {
        incrementRuntimeMetric(`relay.inbound.${event.event}`)
        const handlers = this.localHandlers.get(machineId)
        if (handlers) {
          for (const fn of handlers) fn(event)
        }
        this.globalEventHandler?.(machineId, event)
      },
      onUserEvent: (event) => {
        incrementRuntimeMetric(`relay.inbound.${event.event}`)
        const payload = event.payload as { machineId?: string } | undefined
        this.globalEventHandler?.(payload?.machineId ?? '', event)
      },
      onConnected: () => {
        setRuntimeGauge('relay.main.open', 1)
        this.notifyUserState('connected')
        const isReconnect = this.multiplexConnectedOnce
        this.multiplexConnectedOnce = true
        for (const machineId of this.refCounts.keys()) {
          this.notifyState(machineId, 'connected')
          this.connectedOnce.add(machineId)
        }
        if (isReconnect) {
          incrementRuntimeMetric('relay.main.reconnected')
          this.fireReconnect()
        }
      },
      onDisconnected: () => {
        setRuntimeGauge('relay.main.open', 0)
        this.notifyUserState('disconnected')
        incrementRuntimeMetric('relay.main.disconnected')
        for (const machineId of this.refCounts.keys()) {
          this.notifyState(machineId, 'disconnected')
        }
      },
      onUnavailable: () => {
        // A current client never changes topology from one user-scoped socket
        // to N machine sockets. Multiplex reconnect/backoff owns recovery.
      },
      onConnectivityChange: (snapshot) => {
        this.notifyUserConnectivity(snapshot)
        const relayState = snapshot.phase === 'connected'
          ? 'connected'
          : snapshot.phase === 'connecting'
            ? 'connecting'
            : 'disconnected'
        this.notifyUserState(relayState)
        for (const machineId of this.refCounts.keys()) this.notifyState(machineId, relayState)
        this.updateWatchdog(snapshot)
      },
      onConnectivityEvent: (event) => {
        incrementRuntimeMetric(event.name)
        if (event.durationMs !== undefined) {
          recordRuntimeDuration(event.name, event.durationMs)
        }
        this.onConnectivityEvent?.(event)
      },
    })

    this.multiplexClient = client
    incrementRuntimeMetric('relay.main.socket_created')
    this.notifyUserState('connecting')
    client.connect()
    return client
  }

  private notifyUserState(state: RelayState): void {
    if (this.lastUserState === state) return
    this.lastUserState = state
    for (const listener of this.userStateListeners) listener(state)
  }

  private notifyUserConnectivity(snapshot: RelayConnectivitySnapshot): void {
    for (const listener of this.userConnectivityListeners) listener({ ...snapshot })
  }

  private updateWatchdog(snapshot: RelayConnectivitySnapshot): void {
    this.clearWatchdog()
    if (
      this.suspended ||
      !this.networkOnline ||
      snapshot.phase === 'connected' ||
      snapshot.phase === 'blocked' ||
      snapshot.phase === 'offline'
    ) return

    const watchdogDelay = snapshot.phase === 'connecting'
      ? RELAY_CONNECTING_WATCHDOG_DELAY_MS
      : RELAY_WATCHDOG_DELAY_MS
    const earliestCheck = Date.now() + watchdogDelay
    const retryCheck = snapshot.nextRetryAt ? snapshot.nextRetryAt + 1_000 : earliestCheck
    const delay = Math.max(watchdogDelay, retryCheck - Date.now())
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null
      const current = this.getUserConnectivitySnapshot()
      if (
        (current.phase !== 'recovering' && current.phase !== 'connecting') ||
        (current.nextRetryAt !== null && current.nextRetryAt > Date.now())
      ) return
      this.reconnectNow('watchdog')
    }, delay)
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private createMultiplexHandle(
    machineId: string,
  ): RelayClientHandle {
    return {
      // Resolve through the manager on every call. suspend()/resume() replaces
      // the physical socket, so a handle must never retain the retired client.
      getState: () => this.getState(machineId),
      send: (frame, timeoutMs) => this.send(machineId, frame, timeoutMs),
      sendEvent: (event) => this.multiplexClient?.sendEvent(machineId, event),
    }
  }

  private ensureLegacyConnection(machineId: string): RelayClient | null {
    const token = this.getToken()
    if (!token) return null

    const existing = this.connections.get(machineId)
    if (existing) return existing

    const client = new RelayClient({
      url: this.buildUrl(machineId),
      token,
      onEvent: (event) => {
        incrementRuntimeMetric(`relay.inbound.${event.event}`)
        const handlers = this.localHandlers.get(machineId)
        if (handlers) {
          for (const fn of handlers) fn(event)
        }
        this.globalEventHandler?.(machineId, event)
      },
      onConnected: () => {
        const hadConnected = this.connectedOnce.has(machineId)
        this.notifyState(machineId, 'connected')
        this.connectedOnce.add(machineId)
        if (hadConnected) {
          this.fireReconnect()
        }
      },
      onDisconnected: () => this.notifyState(machineId, 'disconnected'),
    })
    this.connections.set(machineId, client)
    incrementRuntimeMetric('relay.legacy.socket_created')
    client.connect()
    return client
  }
}
