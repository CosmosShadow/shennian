// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/relay.test.ts

import {
  classifyRelayClose,
  type Frame,
  type ReqFrame,
  type ResFrame,
  type EventFrame,
  type RoutedFrame,
  type RelayConnectivityEvent,
  type RelayConnectivitySnapshot,
} from '@shennian/wire'
import { generateTraceId } from './lib/trace'
import { incrementRuntimeMetric } from './runtime-metrics'

export type RelayOptions = {
  url: string
  token: string
  onEvent?: (event: EventFrame) => void
  onResponse?: (res: ResFrame) => void
  onConnected?: () => void
  onDisconnected?: () => void
}

export type RelayState = 'connecting' | 'connected' | 'disconnected'

export type MultiplexRelayOptions = {
  url: string
  token: string
  onEvent?: (machineId: string, event: EventFrame) => void
  onUserEvent?: (event: EventFrame) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onUnavailable?: () => void
  onConnectivityChange?: (snapshot: RelayConnectivitySnapshot) => void
  onConnectivityEvent?: (event: RelayConnectivityEvent) => void
}

const REQUEST_TIMEOUT = 30_000
const HEARTBEAT_TIMEOUT = 45_000
const CONNECT_ATTEMPT_TIMEOUT = 10_000
const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000
const JITTER_FACTOR = 0.2
// Authentication, authorization, revocation and release-gate failures require
// external state to change. Reconnecting the same socket can never recover and
// only creates a battery/network retry storm.
const NON_RETRYABLE_CLOSE_CODES = new Set([4001, 4003, 4004, 4009, 4402, 4406])

export const DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT: RelayConnectivitySnapshot = {
  phase: 'recovering',
  reason: 'unknown',
  closeCode: null,
  closeReason: null,
  retryable: true,
  retryAttempt: 0,
  nextRetryAt: null,
  disconnectedAt: null,
  lastConnectedAt: null,
  connectionId: null,
}

let idCounter = 0
function nextId(): string {
  return `req_${Date.now()}_${++idCounter}`
}

export class RelayClient {
  private ws: WebSocket | null = null
  private state: RelayState = 'disconnected'
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private pendingRequests = new Map<
    string,
    {
      resolve: (res: ResFrame) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(private options: RelayOptions) {}

  connect(): void {
    if (this.disposed) return
    if (this.state === 'connecting' || this.state === 'connected') return

    this.state = 'connecting'
    const sep = this.options.url.includes('?') ? '&' : '?'
    const url = `${this.options.url}${sep}token=${encodeURIComponent(this.options.token)}`

    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.state = 'connected'
      this.resetReconnect()
      this.startHeartbeat()
      this.options.onConnected?.()
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return
      let frame: Frame
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as Frame
      } catch {
        return
      }
      this.handleFrame(frame)
    }

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return
      // Requests are not replayed after reconnect. Reject them immediately so
      // callers can publish an offline/upgrade state instead of waiting 30s.
      this.cleanup(true)
      this.options.onDisconnected?.()
      if (!NON_RETRYABLE_CLOSE_CODES.has(event.code)) {
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  disconnect(): void {
    this.disposed = true
    this.cleanup(true)
  }

  send(frame: Omit<ReqFrame, 'id'>, timeoutMs?: number): Promise<ResFrame> {
    return new Promise<ResFrame>((resolve, reject) => {
      if (this.state !== 'connected' || !this.ws) {
        reject(new Error('Not connected'))
        return
      }

      const id = nextId()
      const req: ReqFrame = { ...frame, id, traceId: generateTraceId() } as ReqFrame

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request ${id} timed out`))
      }, timeoutMs ?? REQUEST_TIMEOUT)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify(req))
    })
  }

  sendEvent(event: EventFrame): void {
    if (this.state !== 'connected' || !this.ws) return
    const frame: EventFrame = { ...event, traceId: event.traceId ?? generateTraceId() }
    this.ws.send(JSON.stringify(frame))
  }

  getState(): RelayState {
    return this.state
  }

  private handleFrame(frame: Frame): void {
    if (frame.type === 'res') {
      const pending = this.pendingRequests.get(frame.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(frame.id)
        pending.resolve(frame)
      }
      this.options.onResponse?.(frame)
      return
    }

    if (frame.type === 'event') {
      if (frame.event === 'tick') {
        this.resetHeartbeat()
        return
      }
      this.options.onEvent?.(frame)
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      this.ws?.close()
    }, HEARTBEAT_TIMEOUT)
  }

  private resetHeartbeat(): void {
    this.startHeartbeat()
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return

    const base = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY,
    )
    const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1)
    const delay = Math.round(base + jitter)

    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private resetReconnect(): void {
    this.reconnectAttempts = 0
  }

  private cleanup(rejectPending: boolean): void {
    this.state = 'disconnected'
    this.clearHeartbeat()

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (rejectPending) {
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Client disconnected'))
        this.pendingRequests.delete(id)
      }
    }

    if (this.ws) {
      const ws = this.ws
      this.ws = null
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      try {
        ws.close()
      } catch {
        // already closed
      }
    }
  }
}

export class MultiplexRelayClient {
  private ws: WebSocket | null = null
  private state: RelayState = 'disconnected'
  private reconnectAttempts = 0
  private unavailableAttempts = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private connectAttemptTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private networkOnline = true
  private connectStartedAt = 0
  private connectivity: RelayConnectivitySnapshot = { ...DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT }
  private subscriptions = new Set<string>()
  private connectedNotified = false
  private pendingRequests = new Map<
    string,
    {
      resolve: (res: ResFrame) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(private options: MultiplexRelayOptions) {}

  connect(): void {
    if (this.disposed || !this.networkOnline) return
    if (this.state === 'connecting' || this.state === 'connected') return

    this.state = 'connecting'
    this.connectStartedAt = Date.now()
    const connectionId = `relay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.updateConnectivity({
      phase: 'connecting',
      reason: this.connectivity.lastConnectedAt ? 'transient_transport' : 'initial_connect',
      closeCode: null,
      closeReason: null,
      retryable: true,
      nextRetryAt: null,
      connectionId,
    })
    this.emitConnectivityEvent('relay_connect_started')
    const sep = this.options.url.includes('?') ? '&' : '?'
    const url = `${this.options.url}${sep}token=${encodeURIComponent(this.options.token)}&connectionId=${encodeURIComponent(connectionId)}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.state = 'disconnected'
      this.scheduleReconnect('transient_transport', 0, 'websocket_constructor_failed')
      return
    }
    this.ws = ws
    this.startConnectAttemptDeadline(ws)

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.connectedNotified = false
      this.startHeartbeat()
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return
      let frame: Frame | RoutedFrame
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as Frame | RoutedFrame
      } catch {
        return
      }
      if (this.state !== 'connected') {
        if (frame.type !== 'event' || frame.event !== 'tick') return
        this.confirmConnected()
      }
      this.handleIncoming(frame)
    }

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return
      incrementRuntimeMetric(`relay.main.close_code.${event.code || 0}`)
      const classification = classifyRelayClose(event.code, event.reason)
      // A reconnect creates a fresh route and does not replay in-flight frames.
      this.cleanup(true)
      this.options.onDisconnected?.()
      this.updateConnectivity({
        phase: classification.retryable ? 'recovering' : 'blocked',
        reason: classification.reason,
        closeCode: event.code || 0,
        closeReason: event.reason || null,
        retryable: classification.retryable,
        retryAttempt: this.reconnectAttempts,
        nextRetryAt: null,
        disconnectedAt: this.connectivity.disconnectedAt ?? Date.now(),
      })
      this.emitConnectivityEvent('relay_disconnected')
      if (event.code === 4406) {
        this.options.onUnavailable?.()
        this.emitConnectivityEvent('relay_recovery_failed')
        return
      }
      if (event.code === 4004) {
        this.options.onUnavailable?.()
        // onopen resets ordinary reconnect attempts, but an unsupported
        // endpoint can accept the upgrade and immediately close with 4004.
        // Preserve a separate backoff sequence so that path cannot become a
        // one-second battery-draining reconnect loop.
        this.reconnectAttempts = this.unavailableAttempts
        this.unavailableAttempts += 1
        this.scheduleReconnect(classification.reason, event.code, event.reason)
        return
      }
      if (classification.retryable) {
        this.scheduleReconnect(classification.reason, event.code, event.reason)
      } else {
        this.emitConnectivityEvent('relay_recovery_failed')
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  disconnect(): void {
    this.disposed = true
    this.cleanup(true)
  }

  reconnectNow(source: 'manual' | 'watchdog' | 'foreground' | 'network-restored' = 'manual'): boolean {
    if (!this.networkOnline) return false
    if (this.state === 'connected' || this.state === 'connecting') return true
    this.disposed = false
    this.clearReconnect()
    this.reconnectAttempts = 0
    this.unavailableAttempts = 0
    this.emitConnectivityEvent(source === 'watchdog' ? 'relay_watchdog_rebuild' : 'relay_manual_retry')
    this.connect()
    return true
  }

  setNetworkOnline(online: boolean): void {
    if (this.networkOnline === online) return
    this.networkOnline = online
    if (!online) {
      this.cleanup(true)
      this.updateConnectivity({
        phase: 'offline',
        reason: 'network_offline',
        retryable: true,
        nextRetryAt: null,
        disconnectedAt: this.connectivity.disconnectedAt ?? Date.now(),
      })
      this.options.onDisconnected?.()
      this.emitConnectivityEvent('relay_disconnected')
      return
    }
    this.reconnectNow('network-restored')
  }

  subscribe(machineId: string): void {
    this.subscriptions.add(machineId)
    this.sendControl('relay.subscribe', machineId)
  }

  unsubscribe(machineId: string): void {
    this.subscriptions.delete(machineId)
    this.sendControl('relay.unsubscribe', machineId)
  }

  send(machineId: string, frame: Omit<ReqFrame, 'id'>, timeoutMs?: number): Promise<ResFrame> {
    return new Promise<ResFrame>((resolve, reject) => {
      if (this.state !== 'connected' || !this.ws) {
        reject(new Error('Not connected'))
        return
      }

      const id = nextId()
      const req: ReqFrame = { ...frame, id, traceId: generateTraceId() } as ReqFrame
      const key = this.requestKey(machineId, id)

      const timer = setTimeout(() => {
        this.pendingRequests.delete(key)
        reject(new Error(`Request ${id} timed out`))
      }, timeoutMs ?? REQUEST_TIMEOUT)

      this.pendingRequests.set(key, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ type: 'relay', machineId, frame: req }))
    })
  }

  sendEvent(machineId: string, event: EventFrame): void {
    if (this.state !== 'connected' || !this.ws) return
    const frame: EventFrame = { ...event, traceId: event.traceId ?? generateTraceId() }
    this.ws.send(JSON.stringify({ type: 'relay', machineId, frame }))
  }

  getState(): RelayState {
    return this.state
  }

  getConnectivitySnapshot(): RelayConnectivitySnapshot {
    return { ...this.connectivity }
  }

  private handleIncoming(frame: Frame | RoutedFrame): void {
    this.unavailableAttempts = 0
    if (frame.type === 'relay') {
      this.handleRoutedFrame(frame.machineId, frame.frame)
      return
    }

    if (frame.type === 'event') {
      if (frame.event === 'tick') {
        this.resetHeartbeat()
        return
      }
      this.options.onUserEvent?.(frame)
    }
  }

  /** The upgrade can open before Server authentication and release gates finish. */
  private confirmConnected(): void {
    if (this.connectedNotified || this.state !== 'connecting') return
    this.connectedNotified = true
    this.state = 'connected'
    this.clearConnectAttemptDeadline()
    const wasRecovering = this.connectivity.lastConnectedAt !== null
    this.resetReconnect()
    this.updateConnectivity({
      phase: 'connected',
      reason: 'initial_connect',
      closeCode: null,
      closeReason: null,
      retryable: true,
      retryAttempt: 0,
      nextRetryAt: null,
      disconnectedAt: null,
      lastConnectedAt: Date.now(),
    })
    this.emitConnectivityEvent(wasRecovering ? 'relay_recovery_succeeded' : 'relay_connected', {
      durationMs: Math.max(0, Date.now() - this.connectStartedAt),
    })
    for (const machineId of this.subscriptions) this.sendControl('relay.subscribe', machineId)
    this.options.onConnected?.()
  }

  private handleRoutedFrame(machineId: string, frame: Frame): void {
    if (frame.type === 'res') {
      const key = this.requestKey(machineId, frame.id)
      const pending = this.pendingRequests.get(key)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(key)
        pending.resolve(frame)
      }
      return
    }

    if (frame.type === 'event') {
      if (frame.event === 'tick') {
        this.resetHeartbeat()
        return
      }
      this.options.onEvent?.(machineId, frame)
    }
  }

  private sendControl(type: 'relay.subscribe' | 'relay.unsubscribe', machineId: string): void {
    if (this.state !== 'connected' || !this.ws) return
    this.ws.send(JSON.stringify({ type, machineId }))
  }

  private requestKey(machineId: string, id: string): string {
    return `${machineId}:${id}`
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      this.ws?.close()
    }, HEARTBEAT_TIMEOUT)
  }

  private resetHeartbeat(): void {
    this.startHeartbeat()
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startConnectAttemptDeadline(ws: WebSocket): void {
    this.clearConnectAttemptDeadline()
    this.connectAttemptTimer = setTimeout(() => {
      this.connectAttemptTimer = null
      if (this.ws !== ws || this.state !== 'connecting') return

      incrementRuntimeMetric('relay.main.connect_timeout')
      this.cleanup(true)
      this.options.onDisconnected?.()
      this.updateConnectivity({
        phase: 'recovering',
        reason: 'transient_transport',
        closeCode: 0,
        closeReason: 'connect_timeout',
        retryable: true,
        retryAttempt: this.reconnectAttempts,
        nextRetryAt: null,
        disconnectedAt: this.connectivity.disconnectedAt ?? Date.now(),
      })
      this.emitConnectivityEvent('relay_disconnected')
      this.scheduleReconnect('transient_transport', 0, 'connect_timeout')
    }, CONNECT_ATTEMPT_TIMEOUT)
  }

  private clearConnectAttemptDeadline(): void {
    if (this.connectAttemptTimer !== null) {
      clearTimeout(this.connectAttemptTimer)
      this.connectAttemptTimer = null
    }
  }

  private scheduleReconnect(
    reason: RelayConnectivitySnapshot['reason'],
    closeCode: number,
    closeReason: string,
  ): void {
    if (this.disposed || !this.networkOnline || this.reconnectTimer !== null) return

    const base = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY,
    )
    const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1)
    const delay = Math.round(base + jitter)

    this.reconnectAttempts++
    this.updateConnectivity({
      phase: 'recovering',
      reason,
      closeCode,
      closeReason: closeReason || null,
      retryable: true,
      retryAttempt: this.reconnectAttempts,
      nextRetryAt: Date.now() + delay,
      disconnectedAt: this.connectivity.disconnectedAt ?? Date.now(),
    })
    this.emitConnectivityEvent('relay_retry_scheduled')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private resetReconnect(): void {
    this.reconnectAttempts = 0
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private updateConnectivity(patch: Partial<RelayConnectivitySnapshot>): void {
    this.connectivity = { ...this.connectivity, ...patch }
    this.options.onConnectivityChange?.(this.getConnectivitySnapshot())
  }

  private emitConnectivityEvent(
    name: RelayConnectivityEvent['name'],
    extra?: Pick<RelayConnectivityEvent, 'durationMs'>,
  ): void {
    this.options.onConnectivityEvent?.({
      name,
      snapshot: this.getConnectivitySnapshot(),
      at: Date.now(),
      ...extra,
    })
  }

  private cleanup(rejectPending: boolean): void {
    this.state = 'disconnected'
    this.connectedNotified = false
    this.clearConnectAttemptDeadline()
    this.clearHeartbeat()

    this.clearReconnect()

    if (rejectPending) {
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Client disconnected'))
        this.pendingRequests.delete(id)
      }
    }

    if (this.ws) {
      const ws = this.ws
      this.ws = null
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      try {
        ws.close()
      } catch {
        // already closed
      }
    }
  }
}
