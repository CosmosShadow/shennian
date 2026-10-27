// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/e2e-relay.ts

import WebSocket from 'ws'
import crypto from 'node:crypto'
import type {
  EventFrame,
  Frame,
  ReqFrame,
  ResFrame,
  SessionSyncCapability,
  SessionSyncRejection,
} from '@shennian/wire'
import {
  parseProjectFsNegotiationChallenge,
  projectFsNegotiationProofPayload,
  PROJECT_FS_NEGOTIATION_METHOD,
  PROJECT_FS_OPAQUE_CAPABILITY,
  PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
  isProjectFsMethod,
} from '@shennian/wire'
import { generateTraceId } from '../log-reporter.js'
import type { RuntimeAutoUpgradePolicy } from '../config/index.js'
import { recordPersonalSyncLocalMetric } from '../personal-sync/metrics.js'

export type CliRelayOptions = {
  serverUrl: string
  machineToken: string
  cliVersion?: string
  agentList?: string[]
  autoUpgradePolicy?: RuntimeAutoUpgradePolicy
  sessionSyncProtocolVersion?: number
  sessionSyncCapabilities?: readonly SessionSyncCapability[]
  daemonInstallationId?: string
  dataEpoch?: number
  updaterProtocolVersion?: number
  onReq?: (req: ReqFrame) => void
  onConnected?: () => void
  onDisconnected?: (info: CliRelayDisconnectInfo) => void
  onProjectFsCapabilityChanged?: (active: boolean) => void
}

export class SessionSyncRejectedError extends Error {
  constructor(readonly rejection: SessionSyncRejection) {
    super(rejection.message || rejection.code)
    this.name = 'SessionSyncRejectedError'
  }
}

export type CliRelayState = 'connecting' | 'connected' | 'disconnected'

export type CliRelayDisconnectInfo = {
  code?: number
  reason?: string
  error?: string
  phase: 'connecting' | 'connected' | 'disconnected'
  trigger?: 'connect-timeout' | 'pong-timeout' | 'heartbeat-timeout' | 'socket-error' | 'socket-close'
  reconnectAttempt: number
}

const HEARTBEAT_TIMEOUT = 90_000
const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000
const JITTER_FACTOR = 0.2
const PING_INTERVAL = 20_000
const PONG_TIMEOUT = 10_000
const CONNECT_TIMEOUT = 15_000
const MAX_SEND_BUFFER = 1000

const PERMANENT_RELAY_CLOSE_CODES = new Set([4001, 4003, 4004, 4009, 4402, 4403, 4406])
const PERMANENT_RELAY_CLOSE_REASONS = [
  'upgrade_required',
  'epoch_mismatch',
  'token_revoked',
  'ownership_transferred',
  'invalid_identity',
] as const

export function isPermanentRelayClose(code: number, reason: string): boolean {
  if (PERMANENT_RELAY_CLOSE_CODES.has(code)) return true
  const normalized = reason.trim().toLowerCase()
  return PERMANENT_RELAY_CLOSE_REASONS.some((value) => normalized.startsWith(value))
}

export class CliRelayClient {
  private ws: WebSocket | null = null
  private state: CliRelayState = 'disconnected'
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private projectFsNegotiated = false
  private closeTrigger: CliRelayDisconnectInfo['trigger'] | undefined
  private lastSocketError: string | undefined
  /** Buffered agent events awaiting server ack, keyed by event id */
  private sendBuffer = new Map<string, EventFrame>()
  private pendingAcks = new Map<string, {
    resolve: (frame: ResFrame) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private pendingRequests = new Map<string, {
    resolve: (frame: ResFrame) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private options: CliRelayOptions) {}

  connect(): void {
    if (this.disposed) return
    this.setProjectFsNegotiated(false)

    // Always clean up stale connection before creating a new one
    if (this.ws) {
      this.cleanup(false)
    }

    this.state = 'connecting'
    const sep = this.options.serverUrl.includes('?') ? '&' : '?'
    const vParam = this.options.cliVersion ? `&v=${encodeURIComponent(this.options.cliVersion)}` : ''
    const agentsParam = this.options.agentList?.length
      ? `&agents=${encodeURIComponent(this.options.agentList.join(','))}`
      : ''
    const upgradePolicyParam = this.options.autoUpgradePolicy
      ? `&upgradePolicy=${encodeURIComponent(this.options.autoUpgradePolicy)}`
      : ''
    const syncProtocolParam = this.options.sessionSyncProtocolVersion
      ? `&syncProtocol=${this.options.sessionSyncProtocolVersion}`
      : ''
    // The Project FS capability is connection-negotiated below. It must never
    // leak into the unauthenticated URL advertisement, even if a caller passes it.
    const initialCapabilities = this.options.sessionSyncCapabilities?.filter(
      (capability) => capability !== PROJECT_FS_OPAQUE_CAPABILITY,
    )
    const syncCapabilitiesParam = initialCapabilities?.length
      ? `&syncCapabilities=${encodeURIComponent(initialCapabilities.join(','))}`
      : ''
    const daemonInstallationParam = this.options.daemonInstallationId
      ? `&daemonInstallationId=${encodeURIComponent(this.options.daemonInstallationId)}`
      : ''
    const dataEpochParam = this.options.dataEpoch
      ? `&dataEpoch=${encodeURIComponent(this.options.dataEpoch)}`
      : ''
    const updaterProtocolParam = this.options.updaterProtocolVersion
      ? `&updaterProtocol=${encodeURIComponent(this.options.updaterProtocolVersion)}`
      : ''
    const url = `${this.options.serverUrl}${sep}token=${encodeURIComponent(this.options.machineToken)}${vParam}${agentsParam}${upgradePolicyParam}${syncProtocolParam}${syncCapabilitiesParam}${daemonInstallationParam}${dataEpochParam}${updaterProtocolParam}`

    const ws = new WebSocket(url)
    this.ws = ws

    // Guard against connections that never open (DNS hang, TCP timeout, etc.)
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && this.state === 'connecting') {
        this.closeTrigger = 'connect-timeout'
        ws.terminate()
      }
    }, CONNECT_TIMEOUT)

    ws.on('open', () => {
      if (this.ws !== ws) return
      this.clearConnectTimer()
      this.state = 'connected'
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.startPing(ws)
      this.flushSendBuffer()
      this.options.onConnected?.()
    })

    ws.on('pong', () => {
      if (this.ws !== ws) return
      this.clearPongTimer()
      this.resetHeartbeat()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      if (this.ws !== ws) return
      let frame: Frame
      try {
        frame = JSON.parse(data.toString()) as Frame
      } catch {
        this.noteRelayProblem('unreadable-frame', 'ignored a frame from the server that is not valid JSON')
        return
      }
      this.handleFrame(frame)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return
      const phase = this.state
      const reasonText = reason.toString()
      const permanent = isPermanentRelayClose(code, reasonText)
      const info: CliRelayDisconnectInfo = {
        code,
        reason: reasonText,
        error: this.lastSocketError,
        phase,
        trigger: this.closeTrigger ?? 'socket-close',
        reconnectAttempt: this.reconnectAttempts + 1,
      }
      if (permanent) {
        this.disposed = true
        recordPersonalSyncLocalMetric('permanentStops')
      }
      this.cleanup(permanent)
      this.options.onDisconnected?.(info)
      if (!permanent) this.scheduleReconnect()
    })

    ws.on('error', (error: Error) => {
      this.lastSocketError = error.message
      this.closeTrigger = 'socket-error'
      ws.close()
    })
  }

  disconnect(): void {
    this.disposed = true
    this.cleanup(true)
  }

  sendRes(res: ResFrame): void {
    if (this.state !== 'connected' || !this.ws) return
    if (!res.traceId) res.traceId = generateTraceId()
    this.ws.send(JSON.stringify(res))
  }

  sendResAndWait(res: ResFrame): Promise<void> {
    if (this.state !== 'connected' || !this.ws) {
      return Promise.reject(new Error('Relay is not connected'))
    }
    if (!res.traceId) res.traceId = generateTraceId()
    const socket = this.ws
    return new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(res), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  sendEvent(event: EventFrame): void {
    if (this.state !== 'connected' || !this.ws) return
    if (!event.traceId) event.traceId = generateTraceId()
    recordPersonalSyncLocalMetric('relayEventsSent')
    this.ws.send(JSON.stringify(event))
  }

  sendReq(req: ReqFrame, timeoutMs = 60_000): Promise<ResFrame> {
    if (this.state !== 'connected' || !this.ws) {
      return Promise.reject(new Error('Relay is not connected'))
    }
    if (!req.traceId) req.traceId = generateTraceId()
    recordPersonalSyncLocalMetric('relayRequestsSent')
    return new Promise<ResFrame>((resolve, reject) => {
      const existing = this.pendingRequests.get(req.id)
      if (existing) {
        clearTimeout(existing.timer)
        existing.reject(new Error('Superseded by a newer relay request'))
      }
      const timer = setTimeout(() => {
        this.pendingRequests.delete(req.id)
        reject(new Error('Relay request timed out'))
      }, timeoutMs)
      this.pendingRequests.set(req.id, { resolve, reject, timer })
      this.ws?.send(JSON.stringify(req))
    })
  }

  sendBufferedEvent(event: EventFrame, timeoutMs = 120_000): Promise<ResFrame | void> {
    if (!event.traceId) event.traceId = generateTraceId()
    if (!event.id) {
      this.sendEvent(event)
      return Promise.resolve()
    }
    const eventId = event.id
    recordPersonalSyncLocalMetric('relayEventsSent')

    return new Promise<ResFrame>((resolve, reject) => {
      const existing = this.pendingAcks.get(eventId)
      if (existing) {
        clearTimeout(existing.timer)
        existing.reject(new Error('Superseded by a newer buffered event'))
      }

      const timer = setTimeout(() => {
        this.pendingAcks.delete(eventId)
        this.sendBuffer.delete(eventId)
        reject(new Error('Relay event acknowledgement timed out'))
      }, timeoutMs)

      this.pendingAcks.set(eventId, { resolve, reject, timer })
      this.bufferEvent(event)
    })
  }

  /**
   * Send an agent event with at-least-once delivery guarantee.
   * The event is buffered until the server acknowledges it.
   * On reconnect, all unacked events are resent in order.
   */
  sendAgentEvent(event: EventFrame): void {
    void this.sendBufferedEvent(event).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      // Replaced by a newer copy of the same event: nothing was lost.
      if (reason.startsWith('Superseded')) return
      const state = (event.payload as { state?: unknown } | undefined)?.state
      this.noteRelayProblem(
        'agent-event-undelivered',
        `agent event ${event.event}${typeof state === 'string' ? `/${state}` : ''} was not delivered: ${reason}`,
      )
    })
  }

  private relayProblemLoggedAt = new Map<string, number>()
  private relayProblemSuppressed = new Map<string, number>()

  /** Logs a relay problem at most once per 30 s per kind, with how many were folded into it. */
  private noteRelayProblem(kind: string, message: string): void {
    const now = Date.now()
    if (now - (this.relayProblemLoggedAt.get(kind) ?? 0) < 30_000) {
      this.relayProblemSuppressed.set(kind, (this.relayProblemSuppressed.get(kind) ?? 0) + 1)
      return
    }
    const folded = this.relayProblemSuppressed.get(kind) ?? 0
    this.relayProblemLoggedAt.set(kind, now)
    this.relayProblemSuppressed.delete(kind)
    console.error(`[relay] ${message}${folded ? ` (+${folded} more since the last report)` : ''}`)
  }

  getState(): CliRelayState {
    return this.state
  }

  private handleFrame(frame: Frame): void {
    recordPersonalSyncLocalMetric('relayFramesReceived')
    if (frame.type === 'res' && frame.rejection) {
      recordPersonalSyncLocalMetric('structuredRejections')
    }
    if (frame.type === 'event' && frame.event === 'tick') {
      this.resetHeartbeat()
      return
    }

    if (frame.type === 'res' && frame.id) {
      // Server ack for a buffered agent event — remove from buffer
      this.sendBuffer.delete(frame.id)
      const pending = this.pendingAcks.get(frame.id)
      if (pending) {
        this.pendingAcks.delete(frame.id)
        clearTimeout(pending.timer)
        if (frame.ok) pending.resolve(frame)
        else {
          const rejection = frame.rejection
          pending.reject(rejection
            ? new SessionSyncRejectedError(rejection)
            : new Error(frame.error ?? 'Relay event failed'))
        }
      }
      const pendingRequest = this.pendingRequests.get(frame.id)
      if (pendingRequest) {
        this.pendingRequests.delete(frame.id)
        clearTimeout(pendingRequest.timer)
        pendingRequest.resolve(frame)
      }
      return
    }

    if (frame.type === 'req' && frame.method === PROJECT_FS_NEGOTIATION_METHOD) {
      this.handleProjectFsNegotiation(frame)
      return
    }

    if (frame.type === 'req' && isProjectFsMethod(frame.method) && !this.projectFsNegotiated) {
      this.sendRes({
        type: 'res',
        id: frame.id,
        ok: false,
        error: 'capability_required',
        payload: {
          rejection: {
            code: 'capability_required',
            retryable: false,
            requiredAction: 'upgrade_daemon',
          },
        },
      })
      return
    }

    if (frame.type === 'req') {
      this.options.onReq?.(frame)
    }
  }

  private handleProjectFsNegotiation(frame: ReqFrame): void {
    // Every challenge starts a fresh authority generation. Clear old handles
    // before accepting it, including for invalid or replayed challenges.
    this.setProjectFsNegotiated(false, true)
    const challenge = parseProjectFsNegotiationChallenge(frame.params)
    if (!challenge || challenge.daemonInstallationId !== this.options.daemonInstallationId) {
      this.sendRes({ type: 'res', id: frame.id, ok: false, error: 'invalid_identity' })
      return
    }
    const proof = crypto
      .createHmac('sha256', this.options.machineToken)
      .update(projectFsNegotiationProofPayload(frame.id, challenge))
      .digest('base64url')
    this.sendRes({
      type: 'res',
      id: frame.id,
      ok: true,
      payload: {
        version: PROJECT_FS_SENSITIVE_AUTHORITY_VERSION,
        capability: PROJECT_FS_OPAQUE_CAPABILITY,
        nonce: challenge.nonce,
        daemonInstallationId: challenge.daemonInstallationId,
        proof,
      },
    })
    this.setProjectFsNegotiated(true)
  }

  private setProjectFsNegotiated(active: boolean, forceNotify = false): void {
    if (!forceNotify && this.projectFsNegotiated === active) return
    this.projectFsNegotiated = active
    this.options.onProjectFsCapabilityChanged?.(active)
  }

  /** Resend all buffered agent events after reconnect, in insertion order */
  private flushSendBuffer(): void {
    if (this.sendBuffer.size === 0 || !this.ws) return
    for (const event of this.sendBuffer.values()) {
      if (this.state !== 'connected' || !this.ws) break
      this.ws.send(JSON.stringify(event))
    }
  }

  private bufferEvent(event: EventFrame): void {
    if (!event.id) {
      this.sendEvent(event)
      return
    }

    this.sendBuffer.set(event.id, event)
    if (this.sendBuffer.size > MAX_SEND_BUFFER) {
      const oldest = this.sendBuffer.keys().next().value as string | undefined
      if (oldest) {
        this.sendBuffer.delete(oldest)
        const pending = this.pendingAcks.get(oldest)
        if (pending) {
          this.pendingAcks.delete(oldest)
          clearTimeout(pending.timer)
          pending.reject(new Error('Relay send buffer overflow'))
        }
      }
    }

    if (this.state === 'connected' && this.ws) {
      this.ws.send(JSON.stringify(event))
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private startPing(ws: WebSocket): void {
    this.clearPing()
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws || this.state !== 'connected') return
      // Set pong timeout before sending ping
      this.pongTimer = setTimeout(() => {
        // No pong received — connection is dead, force close
        this.closeTrigger = 'pong-timeout'
        ws.close()
      }, PONG_TIMEOUT)
      try {
        ws.ping()
      } catch {
        this.clearPongTimer()
        this.closeTrigger = 'socket-error'
        ws.close()
      }
    }, PING_INTERVAL)
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    this.clearPongTimer()
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      this.closeTrigger = 'heartbeat-timeout'
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
    recordPersonalSyncLocalMetric('relayReconnects')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private cleanup(rejectAll: boolean): void {
    this.setProjectFsNegotiated(false)
    this.state = 'disconnected'
    this.closeTrigger = undefined
    this.lastSocketError = undefined
    this.clearConnectTimer()
    this.clearHeartbeat()
    this.clearPing()

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      const ws = this.ws
      this.ws = null
      ws.removeAllListeners()
      // `ws.close()` can emit a late error when the opening handshake is still
      // pending. The socket no longer belongs to this client generation, but it
      // still needs an error listener until ws finishes disposing it; otherwise
      // Node treats that late event as an uncaught exception and kills daemon.
      ws.on('error', () => {})
      try {
        ws.close()
      } catch {
        // already closed
      }
    }

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Relay client disconnected'))
      this.pendingRequests.delete(id)
    }

    if (rejectAll) {
      for (const [id, pending] of this.pendingAcks) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Relay client disconnected'))
        this.pendingAcks.delete(id)
      }
    }
  }
}
