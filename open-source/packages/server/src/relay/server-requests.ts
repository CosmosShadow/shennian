// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/server-requests-cross-instance.test.ts

import { randomBytes } from 'crypto'
import { hostname } from 'node:os'
import type { Frame } from '@shennian/wire'
import { connections } from './connections.js'
import { pubsub } from './pubsub.js'

type PendingRequest = {
  resolve: (frame: Extract<Frame, { type: 'res' }>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type ServerRequestEnvelope = {
  version: 1
  type: 'server.request'
  originInstanceId: string
  replyTo: string
  frame: Extract<Frame, { type: 'req' }>
}

type ServerResponseEnvelope = {
  version: 1
  type: 'server.response'
  requestId: string
  frame: Extract<Frame, { type: 'res' }>
}

type RequestTransport = {
  readonly isActive: boolean
  publishServerRequest(machineId: string, data: string): void
  publishServerResponse(instanceId: string, data: string): void
  subscribeServerResponses(instanceId: string, handler: (data: string) => void): Promise<() => void>
}

type LocalMachineConnections = {
  sendToMachine(machineId: string, data: string): boolean
  getMachine(machineId: string): unknown
}

function isRequestFrame(value: unknown): value is Extract<Frame, { type: 'req' }> {
  if (!value || typeof value !== 'object') return false
  const frame = value as { type?: unknown; id?: unknown; method?: unknown }
  return frame.type === 'req' && typeof frame.id === 'string' && typeof frame.method === 'string'
}

function isResponseFrame(value: unknown): value is Extract<Frame, { type: 'res' }> {
  if (!value || typeof value !== 'object') return false
  const frame = value as { type?: unknown; id?: unknown; ok?: unknown }
  return frame.type === 'res' && typeof frame.id === 'string' && typeof frame.ok === 'boolean'
}

export class ServerRequestRouter {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly responseRoutes = new Map<string, { replyTo: string; expiresAt: number }>()
  private unsubscribeResponses: (() => void) | null = null

  constructor(
    readonly instanceId: string,
    private readonly transport: RequestTransport,
    private readonly localConnections: LocalMachineConnections,
  ) {}

  async init(): Promise<void> {
    if (!this.transport.isActive || this.unsubscribeResponses) return
    this.unsubscribeResponses = await this.transport.subscribeServerResponses(
      this.instanceId,
      (data) => this.acceptServerResponse(data),
    )
  }

  destroy(): void {
    this.unsubscribeResponses?.()
    this.unsubscribeResponses = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Server request router stopped'))
    }
    this.pending.clear()
    this.responseRoutes.clear()
  }

  resolveOrRoute(frame: Extract<Frame, { type: 'res' }>): boolean {
    const request = this.pending.get(frame.id)
    if (request) {
      this.pending.delete(frame.id)
      clearTimeout(request.timer)
      request.resolve(frame)
      return true
    }

    const route = this.responseRoutes.get(frame.id)
    if (!route) return false
    this.responseRoutes.delete(frame.id)
    if (route.expiresAt <= Date.now()) return true
    const envelope: ServerResponseEnvelope = {
      version: 1,
      type: 'server.response',
      requestId: frame.id,
      frame,
    }
    this.transport.publishServerResponse(route.replyTo, JSON.stringify(envelope))
    return true
  }

  acceptMachineRelay(data: string): string | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const envelope = parsed as Partial<ServerRequestEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.type !== 'server.request' ||
      typeof envelope.originInstanceId !== 'string' ||
      typeof envelope.replyTo !== 'string' ||
      envelope.replyTo !== envelope.originInstanceId ||
      !isRequestFrame(envelope.frame)
    ) {
      return null
    }
    this.sweepExpiredRoutes()
    this.responseRoutes.set(envelope.frame.id, {
      replyTo: envelope.replyTo,
      expiresAt: Date.now() + 65_000,
    })
    return JSON.stringify(envelope.frame)
  }

  async send(
    machineId: string,
    frame: Omit<Extract<Frame, { type: 'req' }>, 'id'>,
    timeoutMs = 60_000,
  ): Promise<Extract<Frame, { type: 'res' }>> {
    const id = `srv_${Date.now()}_${randomBytes(6).toString('hex')}`
    const reqFrame: Extract<Frame, { type: 'req' }> = { ...frame, id }
    const data = JSON.stringify(reqFrame)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Agent response timeout'))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      const sent = this.localConnections.sendToMachine(machineId, data)
      if (!sent) {
        if (this.transport.isActive) {
          const envelope: ServerRequestEnvelope = {
            version: 1,
            type: 'server.request',
            originInstanceId: this.instanceId,
            replyTo: this.instanceId,
            frame: reqFrame,
          }
          this.transport.publishServerRequest(machineId, JSON.stringify(envelope))
        } else if (!this.localConnections.getMachine(machineId)) {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(new Error('Machine offline'))
        }
      }
    })
  }

  private acceptServerResponse(data: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const envelope = parsed as Partial<ServerResponseEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.type !== 'server.response' ||
      typeof envelope.requestId !== 'string' ||
      !isResponseFrame(envelope.frame) ||
      envelope.requestId !== envelope.frame.id
    ) return
    this.resolveOrRoute(envelope.frame)
  }

  private sweepExpiredRoutes(now = Date.now()): void {
    for (const [requestId, route] of this.responseRoutes) {
      if (route.expiresAt <= now) this.responseRoutes.delete(requestId)
    }
  }
}

const instanceId = process.env.INSTANCE_ID?.trim() || hostname()
const router = new ServerRequestRouter(instanceId, pubsub, connections)

export async function initServerRequestRouting(): Promise<void> {
  await router.init()
}

export function destroyServerRequestRouting(): void {
  router.destroy()
}

export function acceptServerRequestRelay(data: string): string | null {
  return router.acceptMachineRelay(data)
}

export function resolveServerRequest(frame: Extract<Frame, { type: 'res' }>): boolean {
  return router.resolveOrRoute(frame)
}

export async function sendServerReqToMachine(
  machineId: string,
  frame: Omit<Extract<Frame, { type: 'req' }>, 'id'>,
  timeoutMs = 60_000,
): Promise<Extract<Frame, { type: 'res' }>> {
  return router.send(machineId, frame, timeoutMs)
}
