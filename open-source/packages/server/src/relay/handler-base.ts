// @arch open-source/docs/server-runtime.md

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-version-gate.test.ts
// @test src/__tests__/machine-connection-rate-limit.test.ts
// @test src/__tests__/machine-ownership.test.ts
import WebSocket, { type RawData } from 'ws'
import type { FastifyRequest } from 'fastify'
import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  type Frame,
  type RoutedFrame,
  type SessionSyncRejection,
  isProjectFsMethod,
  type ProjectFsRejection,
} from '@shennian/wire'
import { isDiagnosticUserId } from '../services/log-policy.js'
import { checkMachineConnectionRateLimit } from './machine-connection-rate-limit.js'
import {
  checkMachineCliVersion,
  checkMachineVersionQuarantine,
  clearMachineVersionQuarantine,
  MIN_MACHINE_CLI_VERSION,
  recordMachineVersionBlock,
} from './machine-version-gate.js'
import { sensitivePersonalRelay } from './sensitive-personal-relay.js'
import { recordPersonalSyncRejection } from '../services/personal-sync-operations.js'
import {
  normalizeSessionSyncRejection,
  SessionSyncRejectionError,
} from '../services/session-sync-rejection.js'
import { RepeatedLogThrottle } from './repeated-log-throttle.js'
import { clientConnectionLeases, type ClientConnectionLease } from './client-connection-leases.js'
import {
  createAuthorizedProjectFsFrame,
  ProjectFsAuthorizationError,
} from '../services/project-fs-authority.js'
import { projectFsSensitiveRelay } from './project-fs-sensitive-relay.js'
import { isProjectFsNegotiationRequest } from './project-fs-negotiation.js'

const WS_LARGE_FRAME_WARN_BYTES = readPositiveInteger(
  process.env.RELAY_WS_LARGE_FRAME_WARN_BYTES,
  128 * 1024,
)
const WS_SUMMARY_LOG_BYTES = readPositiveInteger(
  process.env.RELAY_WS_SUMMARY_LOG_BYTES,
  1024 * 1024,
)
const ATTACHMENT_RELAY_MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const WS_SUMMARY_INTERVAL_MS = readPositiveInteger(process.env.RELAY_WS_SUMMARY_INTERVAL_MS, 60_000)
const RELAY_EVENT_TRACE_ENABLED = process.env.RELAY_EVENT_TRACE === '1'
const relayRejectionLogThrottle = new RepeatedLogThrottle()
const MANAGED_AGENT_DIRECT_MIN_CLI_VERSION = '0.4.11'
/** First Client that understands steward sessions (fixed workspace, `steward say`). */
const STEWARD_MIN_CLI_VERSION = '0.5.15'

function startClientLeaseRenewal(socket: WebSocket, lease: ClientConnectionLease): NodeJS.Timeout {
  let renewalInFlight = false
  const timer = setInterval(() => {
    if (renewalInFlight || socket.readyState !== WebSocket.OPEN) return
    renewalInFlight = true
    void lease
      .renew()
      .then((renewed) => {
        if (!renewed && socket.readyState === WebSocket.OPEN) {
          socket.close(1013, 'Client capacity lease lost')
        }
      })
      .finally(() => {
        renewalInFlight = false
      })
  }, clientConnectionLeases.renewIntervalMs)
  timer.unref()
  return timer
}

type EventFrame = {
  type: 'event'
  event: string
  payload?: Record<string, unknown>
  id?: string
}

const PERSONAL_EVENT_METHODS = new Set([
  'session.index.updated',
  'session.update',
  'session.message',
  'native.session.events',
])

type ClientAuthContext = {
  userId: string
  deviceId: string
  installationId: string | null
  platform: string
}

type ClientControlFrame = {
  type: 'relay.subscribe' | 'relay.unsubscribe'
  machineId: string
}

type WsDirection = 'in' | 'out'

type WsTrafficStats = {
  connectionType: 'machine' | 'client' | 'multiplex-client'
  machineId?: string
  userId?: string
  ip?: string
  openedAt: number
  lastSummaryAt: number
  inBytes: number
  outBytes: number
  inFrames: number
  outFrames: number
  byKey: Map<string, { frames: number; bytes: number }>
  diagnosticRequests: Map<string, string>
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function stringBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function rawDataBytes(raw: RawData): number {
  if (typeof raw === 'string') return stringBytes(raw)
  if (Buffer.isBuffer(raw)) return raw.byteLength
  if (Array.isArray(raw)) return raw.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  return raw.byteLength
}

function bytesOfUnknown(value: unknown): number | undefined {
  if (typeof value === 'string') return stringBytes(value)
  if (value == null) return undefined
  try {
    return stringBytes(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function describeFrame(data: string): {
  key: string
  requestId?: string
  ok?: boolean
  event?: string
  state?: string
  sessionId?: string
  runId?: string
  frameType?: string
  payloadBytes?: number
  resultBytes?: number
  textBytes?: number
  argsBytes?: number
} {
  try {
    const frame = JSON.parse(data) as {
      type?: unknown
      id?: unknown
      ok?: unknown
      event?: unknown
      method?: unknown
      payload?: Record<string, unknown>
      params?: Record<string, unknown>
      frame?: unknown
    }
    const frameType = typeof frame.type === 'string' ? frame.type : undefined
    if (frameType === 'event') {
      const event = typeof frame.event === 'string' ? frame.event : 'unknown'
      const payload = frame.payload && typeof frame.payload === 'object' ? frame.payload : undefined
      const state = typeof payload?.state === 'string' ? payload.state : undefined
      return {
        key: state ? `${event}:${state}` : event,
        requestId: typeof frame.id === 'string' ? frame.id : undefined,
        event,
        state,
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
        runId: typeof payload?.runId === 'string' ? payload.runId : undefined,
        frameType,
        payloadBytes: bytesOfUnknown(payload),
        resultBytes: bytesOfUnknown(payload?.result),
        textBytes: bytesOfUnknown(payload?.text),
        argsBytes: bytesOfUnknown(payload?.args),
      }
    }
    if (frameType === 'relay' && frame.frame && typeof frame.frame === 'object') {
      const inner = frame.frame as {
        type?: unknown
        id?: unknown
        ok?: unknown
        event?: unknown
        payload?: Record<string, unknown>
        params?: Record<string, unknown>
        method?: unknown
      }
      const innerType = typeof inner.type === 'string' ? inner.type : 'unknown'
      const innerEvent = typeof inner.event === 'string' ? inner.event : undefined
      const innerMethod = typeof inner.method === 'string' ? inner.method : undefined
      const payload = inner.payload && typeof inner.payload === 'object' ? inner.payload : undefined
      const params = inner.params && typeof inner.params === 'object' ? inner.params : undefined
      const state =
        typeof payload?.state === 'string'
          ? payload.state
          : typeof payload?.deliveryState === 'string'
            ? payload.deliveryState
            : undefined
      return {
        key: innerEvent
          ? `relay:${innerEvent}${state ? `:${state}` : ''}`
          : innerMethod
            ? `relay:req:${innerMethod}`
            : `relay:${innerType}`,
        requestId: typeof inner.id === 'string' ? inner.id : undefined,
        ok: typeof inner.ok === 'boolean' ? inner.ok : undefined,
        event: innerEvent,
        state,
        sessionId:
          typeof payload?.sessionId === 'string'
            ? payload.sessionId
            : typeof params?.sessionId === 'string'
              ? params.sessionId
              : undefined,
        runId: typeof payload?.runId === 'string' ? payload.runId : undefined,
        frameType: `relay:${innerType}`,
        payloadBytes: bytesOfUnknown(payload),
        resultBytes: bytesOfUnknown(payload?.result),
        textBytes: bytesOfUnknown(payload?.text),
        argsBytes: bytesOfUnknown(payload?.args),
      }
    }
    const payload = frame.payload && typeof frame.payload === 'object' ? frame.payload : undefined
    const params = frame.params && typeof frame.params === 'object' ? frame.params : undefined
    const state =
      typeof payload?.state === 'string'
        ? payload.state
        : typeof payload?.deliveryState === 'string'
          ? payload.deliveryState
          : undefined
    return {
      key: typeof frame.method === 'string' ? `req:${frame.method}` : frameType || 'unknown',
      requestId: typeof frame.id === 'string' ? frame.id : undefined,
      ok: typeof frame.ok === 'boolean' ? frame.ok : undefined,
      state,
      sessionId:
        typeof payload?.sessionId === 'string'
          ? payload.sessionId
          : typeof params?.sessionId === 'string'
            ? params.sessionId
            : undefined,
      frameType,
    }
  } catch {
    return { key: 'unparsed' }
  }
}

function createWsTrafficStats(
  params: Pick<WsTrafficStats, 'connectionType' | 'machineId' | 'userId' | 'ip'>,
): WsTrafficStats {
  const now = Date.now()
  return {
    ...params,
    openedAt: now,
    lastSummaryAt: now,
    inBytes: 0,
    outBytes: 0,
    inFrames: 0,
    outFrames: 0,
    byKey: new Map(),
    diagnosticRequests: new Map(),
  }
}

function addTrafficKey(stats: WsTrafficStats, key: string, bytes: number): void {
  const current = stats.byKey.get(key) ?? { frames: 0, bytes: 0 }
  current.frames += 1
  current.bytes += bytes
  stats.byKey.set(key, current)
}

function trafficSummary(stats: WsTrafficStats, reason: string): Record<string, unknown> {
  const diagnostic = isDiagnosticUserId(stats.userId)
  return {
    reason,
    connectionType: stats.connectionType,
    ...(diagnostic
      ? {
          diagnostic: true,
          machineId: stats.machineId,
          userId: stats.userId,
        }
      : {}),
    ageMs: Date.now() - stats.openedAt,
    inBytes: stats.inBytes,
    outBytes: stats.outBytes,
    inFrames: stats.inFrames,
    outFrames: stats.outFrames,
    ...(diagnostic
      ? {
          top: [...stats.byKey.entries()]
            .sort((left, right) => right[1].bytes - left[1].bytes)
            .slice(0, 8)
            .map(([key, value]) => ({ key, frames: value.frames, bytes: value.bytes })),
        }
      : {}),
  }
}

function maybeLogTrafficSummary(stats: WsTrafficStats, reason: string, force = false): void {
  const now = Date.now()
  const totalBytes = stats.inBytes + stats.outBytes
  if (!force && totalBytes < WS_SUMMARY_LOG_BYTES) return
  if (!force && now - stats.lastSummaryAt < WS_SUMMARY_INTERVAL_MS) return
  stats.lastSummaryAt = now
  const message = `[relay:ws-summary] ${JSON.stringify(trafficSummary(stats, reason))}`
  if (reason === 'pong_timeout' || reason === 'ping_error') console.warn(message)
  else console.info(message)
}

function recordWsIn(
  stats: WsTrafficStats,
  data: string,
  bytes: number,
): ReturnType<typeof describeFrame> {
  stats.inBytes += bytes
  stats.inFrames += 1
  const described = describeFrame(data)
  addTrafficKey(stats, `in:${described.key}`, bytes)
  logDiagnosticRelayFrame(stats, 'in', described, bytes)
  if (bytes >= WS_LARGE_FRAME_WARN_BYTES) {
    console.warn(
      `[relay:large-frame] ${JSON.stringify({
        direction: 'in' as WsDirection,
        connectionType: stats.connectionType,
        machineId: stats.machineId,
        userId: stats.userId,
        ip: stats.ip,
        bytes,
        ...described,
      })}`,
    )
  }
  maybeLogTrafficSummary(stats, 'interval')
  return described
}

function recordWsOut(stats: WsTrafficStats, data: string): void {
  const bytes = stringBytes(data)
  stats.outBytes += bytes
  stats.outFrames += 1
  const described = describeFrame(data)
  addTrafficKey(stats, `out:${described.key}`, bytes)
  logDiagnosticRelayFrame(stats, 'out', described, bytes)
  if (bytes >= WS_LARGE_FRAME_WARN_BYTES) {
    console.warn(
      `[relay:large-frame] ${JSON.stringify({
        direction: 'out' as WsDirection,
        connectionType: stats.connectionType,
        machineId: stats.machineId,
        userId: stats.userId,
        ip: stats.ip,
        bytes,
        ...described,
      })}`,
    )
  }
  maybeLogTrafficSummary(stats, 'interval')
}

function logDiagnosticRelayFrame(
  stats: WsTrafficStats,
  direction: WsDirection,
  frame: ReturnType<typeof describeFrame>,
  bytes: number,
): void {
  if (!isDiagnosticUserId(stats.userId)) return
  const traceableRequest =
    frame.key.startsWith('req:chat.') ||
    frame.key.startsWith('relay:req:chat.') ||
    frame.key.startsWith('relay:req:room.agent.')
  if (traceableRequest && frame.requestId) {
    stats.diagnosticRequests.set(frame.requestId, frame.key)
  }
  const relatedRequest = frame.requestId ? stats.diagnosticRequests.get(frame.requestId) : undefined
  const traceableResponse = Boolean(
    relatedRequest && (frame.frameType === 'res' || frame.frameType === 'relay:res'),
  )
  const traceableEvent =
    frame.key.startsWith('session.queue.') ||
    frame.key.startsWith('session.activity') ||
    frame.key.startsWith('agent')
  if (!traceableRequest && !traceableResponse && !traceableEvent) return
  console.info(
    `[relay:diagnostic-frame] ${JSON.stringify({
      direction,
      connectionType: stats.connectionType,
      userId: stats.userId,
      machineId: stats.machineId,
      bytes,
      relatedRequest,
      ...frame,
    })}`,
  )
  if (traceableResponse && frame.requestId) stats.diagnosticRequests.delete(frame.requestId)
}

function sendTracked(socket: WebSocket, stats: WsTrafficStats, data: string): void {
  recordWsOut(stats, data)
  socket.send(data)
}

function rejectBlockedMachineVersion(
  socket: WebSocket,
  request: FastifyRequest,
  machineId: string,
  cliVersion: string | null,
): boolean {
  const versionDecision = checkMachineCliVersion(cliVersion)
  if (versionDecision.allowed) {
    clearMachineVersionQuarantine(machineId, request.ip)
    return false
  }

  const quarantine = checkMachineVersionQuarantine(machineId, request.ip)
  if (quarantine.quarantined) {
    logRepeatedRelayRejection(request, `machine:${machineId}:${cliVersion ?? 'missing'}`, {
      event: 'relay.version-rejected',
      machineId,
      cliVersion: cliVersion ?? 'missing',
      minCliVersion: MIN_MACHINE_CLI_VERSION,
      state: 'quarantined',
      retryAfterMs: quarantine.retryAfterMs,
    })
    socket.close(4406, `CLI upgrade required; min=${MIN_MACHINE_CLI_VERSION}`)
    return true
  }

  const block = recordMachineVersionBlock(machineId, request.ip)
  logRepeatedRelayRejection(request, `machine:${machineId}:${cliVersion ?? 'missing'}`, {
    event: 'relay.version-rejected',
    machineId,
    cliVersion: cliVersion ?? 'missing',
    minCliVersion: MIN_MACHINE_CLI_VERSION,
    reason: versionDecision.reason,
    attempts: block.attempts,
    state: block.quarantined ? 'quarantined' : 'blocked',
  })
  socket.close(4406, `CLI upgrade required; min=${MIN_MACHINE_CLI_VERSION}`)
  return true
}

function logRepeatedRelayRejection(
  request: FastifyRequest,
  key: string,
  fields: Record<string, unknown>,
): void {
  const decision = relayRejectionLogThrottle.take(key)
  if (!decision.shouldLog) return
  request.log.warn(
    { ...fields, suppressedSinceLastLog: decision.suppressed },
    'relay connection rejected',
  )
}

function rejectMachineConnectionRateLimit(
  socket: WebSocket,
  request: FastifyRequest,
  machineId: string,
  cliVersion: string | null,
): boolean {
  const rateLimit = checkMachineConnectionRateLimit(machineId, request.ip)
  if (rateLimit.allowed) return false

  logRepeatedRelayRejection(request, `machine:${machineId}:${cliVersion ?? 'missing'}`, {
    event: 'relay.connection-rate-limited',
    machineId,
    attempts: rateLimit.attempts,
    retryAfterMs: rateLimit.retryAfterMs,
  })
  socket.close(4429, 'Too many machine reconnects')
  return true
}

function tryParseEventFrame(data: string): EventFrame | null {
  try {
    const frame = JSON.parse(data)
    if (frame?.type === 'event' && typeof frame.event === 'string') {
      return frame as EventFrame
    }
  } catch {
    // not JSON or not an event frame
  }
  return null
}

function tryParseRoutedFrame(data: string): RoutedFrame | ClientControlFrame | null {
  try {
    const frame = JSON.parse(data) as {
      type?: unknown
      machineId?: unknown
      frame?: unknown
    }
    if (
      frame?.type === 'relay' &&
      typeof frame.machineId === 'string' &&
      frame.frame &&
      typeof frame.frame === 'object'
    ) {
      return frame as RoutedFrame
    }
    if (
      (frame?.type === 'relay.subscribe' || frame?.type === 'relay.unsubscribe') &&
      typeof frame.machineId === 'string'
    ) {
      return frame as ClientControlFrame
    }
  } catch {
    // not JSON or not a routed frame
  }
  return null
}

function buildRoutedData(machineId: string, data: string): string {
  try {
    return JSON.stringify({
      type: 'relay',
      machineId,
      frame: JSON.parse(data) as Frame,
    })
  } catch {
    return data
  }
}

/**
 * Machine is offline — immediately reject req frames with an error response.
 * V2: no offline queue. User gets immediate feedback.
 */
function rejectIfMachineOffline(data: string, clientWs: WebSocket): void {
  try {
    const frame = JSON.parse(data) as { type?: string; id?: string }
    if (frame?.type === 'req' && frame.id) {
      if (projectFsSensitiveRelay.rejectMachineOffline(frame.id)) return
      if (sensitivePersonalRelay.rejectMachineOffline(frame.id)) return
      const errorRes = JSON.stringify({
        type: 'res',
        id: frame.id,
        ok: false,
        error: '机器离线，请确认机器上的 shennian 正在运行。',
      })
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(errorRes)
      }
    }
  } catch {
    // not parseable — ignore
  }
}

function rejectRoutedIfMachineOffline(machineId: string, frame: Frame, clientWs: WebSocket): void {
  if (frame.type !== 'req') return
  if (projectFsSensitiveRelay.rejectMachineOffline(frame.id)) return
  if (sensitivePersonalRelay.rejectMachineOffline(frame.id)) return
  const errorRes = JSON.stringify({
    type: 'relay',
    machineId,
    frame: {
      type: 'res',
      id: frame.id,
      ok: false,
      error: '机器离线，请确认机器上的 shennian 正在运行。',
    },
  })
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(errorRes)
  }
}

function sendMachineRes(
  socket: WebSocket,
  id: string,
  ok: boolean,
  payloadOrError?: unknown,
  rejection?: SessionSyncRejection,
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(
    JSON.stringify({
      type: 'res',
      id,
      ok,
      ...(ok
        ? { payload: payloadOrError ?? {} }
        : {
            error: rejection?.code ?? String(payloadOrError || 'unknown error'),
            ...(rejection ? { rejection } : {}),
          }),
    }),
  )
}

function sendMachineRejection(
  socket: WebSocket,
  id: string,
  rejectionError: SessionSyncRejectionError,
): void {
  recordPersonalSyncRejection(rejectionError.rejection)
  sendMachineRes(socket, id, false, rejectionError.rejection.code, rejectionError.rejection)
}

function sendClientRes(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  id: string,
  error: string,
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const rejection = normalizeSessionSyncRejection(new Error(error))
  const frame: Frame = { type: 'res', id, ok: false, error: rejection.code, rejection }
  socket.send(
    mode === 'multiplex'
      ? JSON.stringify({ type: 'relay', machineId, frame })
      : JSON.stringify(frame),
  )
}

function sendClientError(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  id: string,
  error: string,
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const frame: Frame = { type: 'res', id, ok: false, error }
  socket.send(
    mode === 'multiplex'
      ? JSON.stringify({ type: 'relay', machineId, frame })
      : JSON.stringify(frame),
  )
}

function sendProjectFsRejection(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  id: string,
  rejection: ProjectFsRejection,
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const frame: Frame = {
    type: 'res',
    id,
    ok: false,
    error: rejection.code,
    payload: { rejection },
  }
  socket.send(
    mode === 'multiplex'
      ? JSON.stringify({ type: 'relay', machineId, frame })
      : JSON.stringify(frame),
  )
}

async function prepareProjectFsRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<Extract<Frame, { type: 'req' }> | null> {
  if (isProjectFsNegotiationRequest(frame)) {
    sendProjectFsRejection(socket, mode, machineId, frame.id, {
      code: 'permission_denied',
      retryable: false,
      requiredAction: 'none',
    })
    return null
  }
  if (!isProjectFsMethod(frame.method)) return frame
  try {
    const authorized = await createAuthorizedProjectFsFrame({ userId, machineId, frame })
    projectFsSensitiveRelay.registerClientRequest({ socket, mode, machineId, frame: authorized })
    return authorized
  } catch (error) {
    const rejection =
      error instanceof ProjectFsAuthorizationError
        ? error.rejection
        : ({ code: 'io_error', retryable: true, requiredAction: 'retry' } as const)
    sendProjectFsRejection(socket, mode, machineId, frame.id, rejection)
    return null
  }
}

function sendClientCloseAck(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  frame: Extract<Frame, { type: 'req' }>,
  identity: {
    protocolVersion: typeof SESSION_SYNC_PROTOCOL_VERSION
    dataEpoch: typeof SESSION_SYNC_DATA_EPOCH
    daemonInstallationId: string
    sessionId: string
    subscriptionId: string
  },
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const response: Frame = {
    type: 'res',
    id: frame.id,
    ok: true,
    payload: { ...identity, closed: true },
  }
  socket.send(
    mode === 'multiplex'
      ? JSON.stringify({ type: 'relay', machineId, frame: response })
      : JSON.stringify(response),
  )
}

export {
  ATTACHMENT_RELAY_MAX_BUFFERED_BYTES,
  ClientAuthContext,
  ClientControlFrame,
  EventFrame,
  MANAGED_AGENT_DIRECT_MIN_CLI_VERSION,
  STEWARD_MIN_CLI_VERSION,
  PERSONAL_EVENT_METHODS,
  RELAY_EVENT_TRACE_ENABLED,
  WS_LARGE_FRAME_WARN_BYTES,
  WS_SUMMARY_INTERVAL_MS,
  WS_SUMMARY_LOG_BYTES,
  WsDirection,
  WsTrafficStats,
  addTrafficKey,
  buildRoutedData,
  bytesOfUnknown,
  createWsTrafficStats,
  describeFrame,
  logDiagnosticRelayFrame,
  logRepeatedRelayRejection,
  maybeLogTrafficSummary,
  prepareProjectFsRequest,
  rawDataBytes,
  readPositiveInteger,
  recordWsIn,
  recordWsOut,
  rejectBlockedMachineVersion,
  rejectIfMachineOffline,
  rejectMachineConnectionRateLimit,
  rejectRoutedIfMachineOffline,
  relayRejectionLogThrottle,
  sendClientCloseAck,
  sendClientError,
  sendClientRes,
  sendMachineRejection,
  sendMachineRes,
  sendProjectFsRejection,
  sendTracked,
  startClientLeaseRenewal,
  stringBytes,
  trafficSummary,
  tryParseEventFrame,
  tryParseRoutedFrame,
}
