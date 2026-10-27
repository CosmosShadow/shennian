// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sensitive-personal-relay.test.ts

import { createHash } from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  SESSION_HISTORY_LIMITS,
  SESSION_TOOL_DETAIL_LIMITS,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type Frame,
  type ReqFrame,
  type SessionToolDetailRequest,
  type SessionToolDetailResponse,
  type SessionMessageStatusParams,
  type SessionHistorySyncParams,
  type ToolDetailUnavailableReason,
  type PersonalSyncIdentity,
} from '@shennian/wire'
import { pubsub } from './pubsub.js'

type ClientMode = 'legacy' | 'multiplex'
type AttachmentTransferMethod =
  | 'fs.transfer.start'
  | 'fs.transfer.chunk'
  | 'fs.transfer.finish'
  | 'fs.transfer.abort'
export type SensitiveRequest =
  | ({ kind: 'tool_detail' } & SessionToolDetailRequest)
  | ({ kind: 'message_status' } & SessionMessageStatusParams)
  | ({ kind: 'history_sync' } & SessionHistorySyncParams)
  | ({
      kind: 'attachment_transfer'
      method: AttachmentTransferMethod
      transferId: string
    } & PersonalSyncIdentity)

type ClientRoute = {
  socket: WebSocket
  machineId: string
  request: SensitiveRequest
  mode: ClientMode
  unsubscribe: () => void
  timer: ReturnType<typeof setTimeout>
}
type PendingRequest = {
  machineId: string
  request: SensitiveRequest
  timer: ReturnType<typeof setTimeout>
}

function routeKey(requestId: string): string {
  return createHash('sha256').update(`personal-sensitive:${requestId}`).digest('hex')
}

function parseFrame(data: string): Frame | null {
  try {
    const frame = JSON.parse(data) as Frame
    return frame && typeof frame === 'object' && typeof frame.type === 'string' ? frame : null
  } catch {
    return null
  }
}

export function getToolDetailIdentity(frame: ReqFrame): SessionToolDetailRequest | null {
  if (frame.method !== 'session.tool.detail') return null
  const { sessionId, toolCallId, detailRevision, maxBytes } = frame.params
  const identity = getFramePersonalIdentity(frame)
  if (
    !identity || typeof sessionId !== 'string' || !sessionId ||
    typeof toolCallId !== 'string' || !toolCallId ||
    typeof detailRevision !== 'number' || !Number.isSafeInteger(detailRevision) || detailRevision < 0 ||
    (maxBytes !== undefined && (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes)))
  ) return null
  return { ...identity, sessionId, toolCallId, detailRevision, ...(maxBytes === undefined ? {} : { maxBytes }) }
}

function getFramePersonalIdentity(frame: ReqFrame): PersonalSyncIdentity | null {
  const { protocolVersion, dataEpoch, daemonInstallationId } = frame.params
  if (protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION || dataEpoch !== SESSION_SYNC_DATA_EPOCH
    || typeof daemonInstallationId !== 'string' || !daemonInstallationId
    || daemonInstallationId.length > 191) return null
  return { protocolVersion, dataEpoch, daemonInstallationId }
}

export function getSensitivePersonalIdentity(frame: ReqFrame): SensitiveRequest | null {
  const toolDetail = getToolDetailIdentity(frame)
  if (toolDetail) return { kind: 'tool_detail', ...toolDetail }
  if (isAttachmentTransferMethod(frame.method)) return getAttachmentTransferIdentity(frame)
  if (frame.method === 'session.history.sync') {
    const identity = getFramePersonalIdentity(frame)
    const { sessionId, syncId, afterRevision, limit } = frame.params
    if (
      !identity || typeof sessionId !== 'string' || !sessionId || sessionId.length > 191 ||
      typeof syncId !== 'string' || !syncId || syncId.length > 191 ||
      typeof afterRevision !== 'number' || !Number.isSafeInteger(afterRevision) || afterRevision < 0 ||
      (limit !== undefined && (
        typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 ||
        limit > SESSION_HISTORY_LIMITS.maxDeltaMutations
      ))
    ) return null
    return {
      kind: 'history_sync', ...identity, sessionId, syncId, afterRevision,
      ...(limit === undefined ? {} : { limit }),
    }
  }
  if (frame.method !== 'session.message.status') return null
  const identity = getFramePersonalIdentity(frame)
  const { sessionId, clientMessageId } = frame.params
  if (
    !identity || typeof sessionId !== 'string' || !sessionId || sessionId.length > 191 ||
    typeof clientMessageId !== 'string' || !clientMessageId || clientMessageId.length > 191
  ) return null
  return { kind: 'message_status', ...identity, sessionId, clientMessageId }
}

const MAX_ATTACHMENT_CHUNK_BASE64_CHARS = 1_398_104
const MAX_ATTACHMENT_MANIFEST_ENTRIES = 2000
const MAX_ATTACHMENT_START_BYTES = 2 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 1024 * 1024 * 1024
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export function isAttachmentTransferMethod(method: string): method is AttachmentTransferMethod {
  return method === 'fs.transfer.start' || method === 'fs.transfer.chunk' ||
    method === 'fs.transfer.finish' || method === 'fs.transfer.abort'
}

function getAttachmentTransferIdentity(frame: ReqFrame): SensitiveRequest | null {
  if (!isAttachmentTransferMethod(frame.method)) return null
  const identity = getFramePersonalIdentity(frame)
  const { transferId, rootPath } = frame.params
  if (
    !identity || typeof transferId !== 'string' || !TRANSFER_ID_PATTERN.test(transferId) ||
    typeof rootPath !== 'string' || !rootPath || rootPath.length > 4096
  ) return null
  if (frame.method === 'fs.transfer.start') {
    const { name, totalSize, sha256, mimeType, kind, manifest } = frame.params
    if (
      Buffer.byteLength(JSON.stringify(frame.params), 'utf8') > MAX_ATTACHMENT_START_BYTES ||
      frame.params.data !== undefined ||
      typeof name !== 'string' || !name || name.length > 255 ||
      typeof totalSize !== 'number' || !Number.isSafeInteger(totalSize) ||
      totalSize < 0 || totalSize > MAX_ATTACHMENT_TOTAL_BYTES ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) ||
      typeof mimeType !== 'string' || !mimeType || mimeType.length > 255 ||
      (kind !== 'file' && kind !== 'folder') ||
      (manifest !== undefined && (!Array.isArray(manifest) || manifest.length > MAX_ATTACHMENT_MANIFEST_ENTRIES))
    ) return null
    if (Array.isArray(manifest) && manifest.some((item) => {
      if (!item || typeof item !== 'object') return true
      const entry = item as Record<string, unknown>
      return (
        typeof entry.relativePath !== 'string' || !entry.relativePath || entry.relativePath.length > 1024 ||
        typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) ||
        entry.size < 0 || entry.size > MAX_ATTACHMENT_TOTAL_BYTES ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) ||
        (entry.mimeType !== undefined &&
          (typeof entry.mimeType !== 'string' || entry.mimeType.length > 255))
      )
    })) return null
  }
  if (frame.method === 'fs.transfer.chunk') {
    const { offset, data } = frame.params
    if (
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof data !== 'string' || !data || data.length > MAX_ATTACHMENT_CHUNK_BASE64_CHARS
    ) return null
  }
  return { kind: 'attachment_transfer', ...identity, method: frame.method, transferId }
}

function unavailable(
  request: SessionToolDetailRequest,
  reason: ToolDetailUnavailableReason,
): SessionToolDetailResponse {
  return {
    protocolVersion: request.protocolVersion,
    dataEpoch: request.dataEpoch,
    daemonInstallationId: request.daemonInstallationId,
    sessionId: request.sessionId,
    toolCallId: request.toolCallId,
    detailRevision: request.detailRevision,
    detailStatus: 'unavailable',
    resultOmitted: true,
    redacted: true,
    byteSize: 0,
    expiresAt: new Date().toISOString(),
    source: 'unavailable',
    reason,
  }
}

export class SensitivePersonalRelay {
  private routes = new Map<string, ClientRoute>()
  private routesBySocket = new Map<WebSocket, Set<string>>()
  private pendingRequests = new Map<string, PendingRequest>()

  registerClientRequest(input: {
    socket: WebSocket
    machineId: string
    frame: ReqFrame
    mode: ClientMode
  }): boolean {
    const request = getSensitivePersonalIdentity(input.frame)
    if (!request) return false
    if (this.routes.has(input.frame.id)) throw new Error('request_id_conflict')
    const unsubscribe = pubsub.subscribeHistory(routeKey(input.frame.id), (data) => {
      this.deliver(input.frame.id, data)
    })
    const timer = setTimeout(() => {
      this.deliver(input.frame.id, timeoutResponse(input.frame.id, request))
    }, SESSION_TOOL_DETAIL_LIMITS.relayTimeoutMs)
    this.routes.set(input.frame.id, { ...input, request, unsubscribe, timer })
    const ids = this.routesBySocket.get(input.socket) ?? new Set<string>()
    ids.add(input.frame.id)
    this.routesBySocket.set(input.socket, ids)
    return true
  }

  observeForwardedRequest(machineId: string, frame: ReqFrame): boolean {
    const request = getSensitivePersonalIdentity(frame)
    if (!request) return false
    const prior = this.pendingRequests.get(frame.id)
    if (prior) clearTimeout(prior.timer)
    this.pendingRequests.set(frame.id, {
      machineId,
      request,
      timer: setTimeout(
        () => this.pendingRequests.delete(frame.id),
        SESSION_TOOL_DETAIL_LIMITS.relayTimeoutMs,
      ),
    })
    return true
  }

  routeMachineFrame(machineId: string, data: string): boolean {
    const frame = parseFrame(data)
    if (frame?.type !== 'res') return false
    const pending = this.pendingRequests.get(frame.id)
    if (!pending || pending.machineId !== machineId) return false
    clearTimeout(pending.timer)
    this.pendingRequests.delete(frame.id)
    const maxEnvelopeBytes = pending.request.kind === 'tool_detail'
      ? Math.min(
          Math.max(
            pending.request.maxBytes ?? SESSION_TOOL_DETAIL_LIMITS.defaultMaxBytes,
            SESSION_TOOL_DETAIL_LIMITS.minMaxBytes,
          ),
          SESSION_TOOL_DETAIL_LIMITS.maxMaxBytes,
        ) + 4 * 1024
      : pending.request.kind === 'history_sync'
        ? SESSION_HISTORY_LIMITS.maxReplicaPageBytes
        : 8 * 1024
    const payloadIdentity = frame.payload as Partial<PersonalSyncIdentity> | undefined
    const identityMatches = !frame.ok || (
      payloadIdentity?.protocolVersion === pending.request.protocolVersion &&
      payloadIdentity.dataEpoch === pending.request.dataEpoch &&
      payloadIdentity.daemonInstallationId === pending.request.daemonInstallationId
    )
    const response = !identityMatches
      ? rejectionResponse(frame.id, 'invalid_identity', false, 'quarantine_record')
      : Buffer.byteLength(data, 'utf8') <= maxEnvelopeBytes
        ? data
        : responseTooLarge(frame.id, pending.request)
    this.publish(frame.id, response)
    return true
  }

  rejectMachineOffline(requestId: string): boolean {
    const route = this.routes.get(requestId)
    if (!route) return false
    this.deliver(requestId, offlineResponse(requestId, route.request))
    const pending = this.pendingRequests.get(requestId)
    if (pending) clearTimeout(pending.timer)
    this.pendingRequests.delete(requestId)
    return true
  }

  closeSocket(socket: WebSocket): void {
    for (const requestId of [...(this.routesBySocket.get(socket) ?? [])]) {
      this.removeClientRoute(requestId)
    }
  }

  invalidateSession(sessionId: string): void {
    for (const [requestId, route] of this.routes.entries()) {
      if (!('sessionId' in route.request) || route.request.sessionId !== sessionId) continue
      this.deliver(requestId, JSON.stringify({
        type: 'res', requestId, id: requestId, ok: false, error: 'session_deleted',
        rejection: {
          code: 'session_deleted', retryable: false, requiredAction: 'purge_session',
          authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
        },
      }))
    }
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (!('sessionId' in pending.request) || pending.request.sessionId !== sessionId) continue
      clearTimeout(pending.timer)
      this.pendingRequests.delete(requestId)
    }
  }

  reset(): void {
    for (const route of this.routes.values()) {
      route.unsubscribe()
      clearTimeout(route.timer)
    }
    for (const pending of this.pendingRequests.values()) clearTimeout(pending.timer)
    this.routes.clear()
    this.routesBySocket.clear()
    this.pendingRequests.clear()
  }

  private publish(requestId: string, data: string): void {
    if (this.routes.has(requestId)) this.deliver(requestId, data)
    else if (pubsub.isActive) pubsub.publishHistory(routeKey(requestId), data)
  }

  private deliver(requestId: string, data: string): void {
    const route = this.routes.get(requestId)
    if (!route) return
    if (route.socket.readyState === route.socket.OPEN) {
      route.socket.send(route.mode === 'multiplex'
        ? JSON.stringify({ type: 'relay', machineId: route.machineId, frame: JSON.parse(data) as Frame })
        : data)
    }
    this.removeClientRoute(requestId)
  }

  private removeClientRoute(requestId: string): void {
    const route = this.routes.get(requestId)
    if (!route) return
    route.unsubscribe()
    clearTimeout(route.timer)
    this.routes.delete(requestId)
    const ids = this.routesBySocket.get(route.socket)
    ids?.delete(requestId)
    if (ids?.size === 0) this.routesBySocket.delete(route.socket)
  }
}

export const sensitivePersonalRelay = new SensitivePersonalRelay()

function timeoutResponse(requestId: string, request: SensitiveRequest): string {
  return request.kind === 'tool_detail'
    ? JSON.stringify({
        type: 'res', id: requestId, ok: true,
        payload: unavailable(request, 'request_timeout'),
      })
    : rejectionResponse(requestId, 'temporary_unavailable', true, 'retry')
}

function offlineResponse(requestId: string, request: SensitiveRequest): string {
  return request.kind === 'tool_detail'
    ? JSON.stringify({
        type: 'res', id: requestId, ok: true,
        payload: unavailable(request, 'machine_offline'),
      })
    : rejectionResponse(requestId, 'machine_offline', true, 'retry')
}

function responseTooLarge(requestId: string, request: SensitiveRequest): string {
  return request.kind === 'tool_detail'
    ? JSON.stringify({
        type: 'res', id: requestId, ok: true,
        payload: unavailable(request, 'response_too_large'),
      })
    : rejectionResponse(requestId, 'response_too_large', false, 'stop')
}

function rejectionResponse(
  requestId: string,
  code: 'invalid_identity' | 'temporary_unavailable' | 'machine_offline' | 'response_too_large',
  retryable: boolean,
  requiredAction: 'quarantine_record' | 'retry' | 'stop',
): string {
  return JSON.stringify({
    type: 'res', id: requestId, ok: false, error: code,
    rejection: { code, retryable, requiredAction, authoritativeEpoch: SESSION_SYNC_DATA_EPOCH },
  })
}
