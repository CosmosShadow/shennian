// @covers open-source/packages/server/src/relay/handler-authorization.ts
import WebSocket from 'ws'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReqFrame } from '@shennian/wire'
const { machine } = vi.hoisted(() => ({ machine: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: machine } } }))
import { authorizeMachineOwnerRequest } from '../relay/handler-authorization.js'
const socket = () => ({ readyState: WebSocket.OPEN, send: vi.fn() }) as unknown as WebSocket
describe('local service direct Relay authorization', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each(['personal.apps.list', 'personal.apps.register', 'personal.apps.remove', 'personal.service'] as const)('requires an active paired owner for %s, not a machine grant', async method => {
    const req: ReqFrame = { type: 'req', id: 'unit', method, params: {} }, ws = socket()
    machine.mockResolvedValue(null)
    expect(await authorizeMachineOwnerRequest(ws, 'multiplex', 'mine', 'grantee', req)).toBe(false)
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('machine_owner_required'))
    expect(machine).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mine', userId: 'grantee', paired: true, remoteAccessDisabledAt: null } }))
    machine.mockResolvedValue({ id: 'mine' })
    expect(await authorizeMachineOwnerRequest(socket(), 'legacy', 'mine', 'owner', req)).toBe(true)
  })
})
