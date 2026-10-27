// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/handler-authorization.ts
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import type { ReqFrame } from '@shennian/wire'
vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
import { authorizeMachineUseRequest } from '../relay/handler-authorization.js'

describe('Server-origin project task events', () => {
  it.each(['legacy', 'multiplex'] as const)('rejects a client-origin notification in %s mode before checking machine grants', async (mode) => {
    const send = vi.fn()
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket
    const request: ReqFrame = { type: 'req', id: 'event-1', method: 'project.taskEvent', params: { watchId: 'watch-1', eventId: 'event-1' } }
    expect(await authorizeMachineUseRequest(socket, mode, 'machine-1', 'owner', request)).toBe(false)
    expect(send).toHaveBeenCalledWith(expect.stringContaining('server_request_required'))
  })
})
