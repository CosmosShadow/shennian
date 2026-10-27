// @arch open-source/docs/server-runtime.md
// @test src/__tests__/project-fs-sensitive-relay.test.ts

import crypto from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  isProjectFsMethod,
  parseProjectFsCloseResult,
  parseProjectFsListResult,
  parseProjectFsOpenResult,
  parseProjectFsReadResult,
  parseProjectFsRejection,
  parseProjectFsTrustedEnvelope,
  PROJECT_FS_AUTHORITY_PARAM,
  type Frame,
  type ProjectFsMethod,
  type ProjectFsRejection,
  type ReqFrame,
} from '@shennian/wire'
import { pubsub } from './pubsub.js'

const RESPONSE_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 400 * 1024
type ClientMode = 'legacy' | 'multiplex'

type ClientRoute = {
  socket: WebSocket
  mode: ClientMode
  machineId: string
  method: ProjectFsMethod
  unsubscribe: () => void
  timer: ReturnType<typeof setTimeout>
}

type PendingRequest = {
  machineId: string
  method: ProjectFsMethod
  timer: ReturnType<typeof setTimeout>
}

function routeKey(requestId: string): string {
  return crypto.createHash('sha256').update(`project-fs:${requestId}`).digest('hex')
}

export class ProjectFsSensitiveRelay {
  private readonly routes = new Map<string, ClientRoute>()
  private readonly routesBySocket = new Map<WebSocket, Set<string>>()
  private readonly pending = new Map<string, PendingRequest>()

  registerClientRequest(input: {
    socket: WebSocket
    mode: ClientMode
    machineId: string
    frame: ReqFrame
  }): void {
    if (!isProjectFsMethod(input.frame.method)) throw new Error('invalid_project_fs_request')
    if (this.routes.has(input.frame.id)) throw new Error('request_id_conflict')
    const unsubscribe = pubsub.subscribeHistory(routeKey(input.frame.id), (data) => {
      this.deliver(input.frame.id, data)
    })
    const timer = setTimeout(() => {
      this.deliver(input.frame.id, rejectionResponse(input.frame.id, {
        code: 'io_error', retryable: true, requiredAction: 'retry',
      }))
    }, RESPONSE_TIMEOUT_MS)
    this.routes.set(input.frame.id, {
      socket: input.socket,
      mode: input.mode,
      machineId: input.machineId,
      method: input.frame.method,
      unsubscribe,
      timer,
    })
    const ids = this.routesBySocket.get(input.socket) ?? new Set<string>()
    ids.add(input.frame.id)
    this.routesBySocket.set(input.socket, ids)
  }

  observeForwardedRequest(machineId: string, frame: ReqFrame): boolean {
    if (!isProjectFsMethod(frame.method)) return false
    const envelope = parseProjectFsTrustedEnvelope(frame.params[PROJECT_FS_AUTHORITY_PARAM])
    if (!envelope || envelope.requestId !== frame.id || envelope.method !== frame.method) return false
    const previous = this.pending.get(frame.id)
    if (previous) clearTimeout(previous.timer)
    this.pending.set(frame.id, {
      machineId,
      method: frame.method,
      timer: setTimeout(() => this.pending.delete(frame.id), RESPONSE_TIMEOUT_MS),
    })
    return true
  }

  routeMachineFrame(machineId: string, data: string): boolean {
    let frame: Frame
    try { frame = JSON.parse(data) as Frame } catch { return false }
    if (frame?.type !== 'res') return false
    const pending = this.pending.get(frame.id)
    if (!pending || pending.machineId !== machineId) return false
    clearTimeout(pending.timer)
    this.pending.delete(frame.id)
    const safe = Buffer.byteLength(data, 'utf8') <= MAX_RESPONSE_BYTES && validResponse(pending.method, frame)
      ? data
      : rejectionResponse(frame.id, { code: 'io_error', retryable: false, requiredAction: 'retry' })
    this.publish(frame.id, safe)
    return true
  }

  rejectMachineOffline(requestId: string): boolean {
    if (!this.routes.has(requestId)) return false
    this.deliver(requestId, rejectionResponse(requestId, {
      code: 'machine_offline', retryable: true, requiredAction: 'retry',
    }))
    const pending = this.pending.get(requestId)
    if (pending) clearTimeout(pending.timer)
    this.pending.delete(requestId)
    return true
  }

  closeSocket(socket: WebSocket): void {
    for (const requestId of this.routesBySocket.get(socket) ?? []) this.removeRoute(requestId)
  }

  reset(): void {
    for (const route of this.routes.values()) {
      route.unsubscribe()
      clearTimeout(route.timer)
    }
    for (const request of this.pending.values()) clearTimeout(request.timer)
    this.routes.clear()
    this.routesBySocket.clear()
    this.pending.clear()
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
    this.removeRoute(requestId)
  }

  private removeRoute(requestId: string): void {
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

function validResponse(method: ProjectFsMethod, frame: Extract<Frame, { type: 'res' }>): boolean {
  if (!frame.ok) {
    const payload = frame.payload as { rejection?: unknown } | undefined
    return parseProjectFsRejection(payload?.rejection) !== null
  }
  return method === 'project.fs.open'
    ? parseProjectFsOpenResult(frame.payload) !== null
    : method === 'project.fs.list'
      ? parseProjectFsListResult(frame.payload) !== null
      : method === 'project.fs.read'
        ? parseProjectFsReadResult(frame.payload) !== null
        : parseProjectFsCloseResult(frame.payload) !== null
}

function rejectionResponse(id: string, rejection: ProjectFsRejection): string {
  return JSON.stringify({ type: 'res', id, ok: false, error: rejection.code, payload: { rejection } })
}

export const projectFsSensitiveRelay = new ProjectFsSensitiveRelay()
