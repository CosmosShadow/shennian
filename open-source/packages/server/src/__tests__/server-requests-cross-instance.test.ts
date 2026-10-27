// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/server-requests.ts

import { describe, expect, it, vi } from 'vitest'
import type { Frame } from '@shennian/wire'
import { ServerRequestRouter } from '../relay/server-requests.js'

type ResponseHandler = (data: string) => void

class SharedTransport {
  readonly isActive = true
  readonly relayHandlers = new Map<string, (data: string) => void>()
  readonly responseHandlers = new Map<string, ResponseHandler>()
  publishedRelay: Array<{ machineId: string; data: string }> = []
  publishedResponses: Array<{ instanceId: string; data: string }> = []

  publishServerRequest(machineId: string, data: string): void {
    this.publishedRelay.push({ machineId, data })
    this.relayHandlers.get(machineId)?.(data)
  }

  publishServerResponse(instanceId: string, data: string): void {
    this.publishedResponses.push({ instanceId, data })
    this.responseHandlers.get(instanceId)?.(data)
  }

  async subscribeServerResponses(instanceId: string, handler: ResponseHandler): Promise<() => void> {
    this.responseHandlers.set(instanceId, handler)
    return () => this.responseHandlers.delete(instanceId)
  }
}

function connections(send: (machineId: string, data: string) => boolean) {
  return { sendToMachine: vi.fn(send), getMachine: vi.fn(() => undefined) }
}

function requestFrame(): Omit<Extract<Frame, { type: 'req' }>, 'id'> {
  return { type: 'req', method: 'session.list', params: {} }
}

describe('server request routing', () => {
  it('keeps the existing direct request/response path on one instance', async () => {
    const transport = new SharedTransport()
    let daemonRequest: Extract<Frame, { type: 'req' }> | null = null
    const local = connections((_machineId, data) => {
      daemonRequest = JSON.parse(data) as Extract<Frame, { type: 'req' }>
      return true
    })
    const router = new ServerRequestRouter('server-1', transport, local)
    await router.init()

    const pending = router.send('machine-1', requestFrame())
    const response: Extract<Frame, { type: 'res' }> = {
      type: 'res', id: daemonRequest!.id, ok: true, payload: { sessions: [] },
    }
    expect(router.resolveOrRoute(response)).toBe(true)

    await expect(pending).resolves.toEqual(response)
    expect(transport.publishedRelay).toHaveLength(0)
    expect(transport.publishedResponses).toHaveLength(0)
    router.destroy()
  })

  it('returns a daemon response to the exact server instance that owns the pending request', async () => {
    const transport = new SharedTransport()
    const origin = new ServerRequestRouter('server-1', transport, connections(() => false))
    let daemonData = ''
    const ownerConnections = connections((_machineId, data) => {
      daemonData = data
      return true
    })
    const machineOwner = new ServerRequestRouter(
      'server-2',
      transport,
      ownerConnections,
    )
    await origin.init()
    await machineOwner.init()
    transport.relayHandlers.set('machine-1', (data) => {
      const forwarded = machineOwner.acceptMachineRelay(data)
      if (forwarded) ownerConnections.sendToMachine('machine-1', forwarded)
    })

    const pending = origin.send('machine-1', requestFrame())
    const daemonRequest = JSON.parse(daemonData) as Extract<Frame, { type: 'req' }>
    expect(daemonRequest).toMatchObject({ type: 'req', method: 'session.list' })
    expect(daemonData).not.toContain('originInstanceId')

    const response: Extract<Frame, { type: 'res' }> = {
      type: 'res', id: daemonRequest.id, ok: true, payload: { sessions: ['session-1'] },
    }
    expect(machineOwner.resolveOrRoute(response)).toBe(true)
    await expect(pending).resolves.toEqual(response)

    expect(transport.publishedResponses).toHaveLength(1)
    expect(transport.publishedResponses[0].instanceId).toBe('server-1')
    expect([...transport.responseHandlers.keys()]).toEqual(['server-1', 'server-2'])
    origin.destroy()
    machineOwner.destroy()
  })

  it('rejects non-internal payloads received on the private server-request channel', () => {
    const transport = new SharedTransport()
    const router = new ServerRequestRouter('server-2', transport, connections(() => false))
    const data = JSON.stringify({ type: 'req', id: 'client-1', method: 'session.list', params: {} })

    expect(router.acceptMachineRelay(data)).toBeNull()
    expect(router.resolveOrRoute({ type: 'res', id: 'client-1', ok: true })).toBe(false)
  })
})
