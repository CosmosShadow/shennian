// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/connections.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Re-create ConnectionManager for each test by importing fresh
let ConnectionManagerModule: typeof import('../relay/connections.js')

beforeEach(async () => {
  vi.resetModules()
  ConnectionManagerModule = await import('../relay/connections.js')
})

function createMockWs(readyState: number = 1 /* OPEN */): any {
  return {
    readyState,
    OPEN: 1,
    send: vi.fn(),
    close: vi.fn(),
  }
}

describe('ConnectionManager', () => {
  describe('broadcastToOtherClients', () => {
    it('sends to all clients except the sender', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()
      const ws2 = createMockWs()
      const ws3 = createMockWs()

      connections.addClient('m1', ws1, 'u1', 'd1')
      connections.addClient('m1', ws2, 'u1', 'd2')
      connections.addClient('m1', ws3, 'u1', 'd3')

      const sent = connections.broadcastToOtherClients('m1', '{"test":1}', ws1)

      expect(sent).toBe(2)
      expect(ws1.send).not.toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalledWith('{"test":1}')
      expect(ws3.send).toHaveBeenCalledWith('{"test":1}')
    })

    it('returns 0 when no other clients', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()
      connections.addClient('m1', ws1, 'u1', 'd1')

      const sent = connections.broadcastToOtherClients('m1', 'data', ws1)
      expect(sent).toBe(0)
    })
  })

  describe('broadcastToClients', () => {
    it('sends to all clients including sender', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()
      const ws2 = createMockWs()

      connections.addClient('m1', ws1, 'u1', 'd1')
      connections.addClient('m1', ws2, 'u1', 'd2')

      const sent = connections.broadcastToClients('m1', 'data')
      expect(sent).toBe(2)
      expect(ws1.send).toHaveBeenCalled()
      expect(ws2.send).toHaveBeenCalled()
    })

    it('skips closed connections', () => {
      const { connections } = ConnectionManagerModule
      const wsOpen = createMockWs(1)
      const wsClosed = createMockWs(3)

      connections.addClient('m1', wsOpen, 'u1', 'd1')
      connections.addClient('m1', wsClosed, 'u1', 'd2')

      const sent = connections.broadcastToClients('m1', 'data')
      expect(sent).toBe(1)
      expect(wsOpen.send).toHaveBeenCalled()
      expect(wsClosed.send).not.toHaveBeenCalled()
    })

    it('wraps machine frames for multiplex clients', () => {
      const { connections } = ConnectionManagerModule
      const legacy = createMockWs()
      const multiplex = createMockWs()

      connections.addClient('m1', legacy, 'u1', 'd1', 'web')
      connections.addClient('m1', multiplex, 'u1', 'd2', 'web', 'multiplex')

      connections.broadcastToClients('m1', '{"type":"event","event":"session.update"}')

      expect(legacy.send).toHaveBeenCalledWith('{"type":"event","event":"session.update"}')
      expect(multiplex.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'relay',
        machineId: 'm1',
        frame: { type: 'event', event: 'session.update' },
      }))
    })

    it('relays the daemon durable send ACK without synthesizing or dropping fields', () => {
      const { connections } = ConnectionManagerModule
      const mobile = createMockWs()
      connections.addClient('m1', mobile, 'u1', 'ios-1', 'ios', 'multiplex')
      const daemonResponse = {
        type: 'res', id: 'send-1', ok: true,
        payload: {
          sessionId: 'session-1', clientMessageId: 'client-1', messageId: 'client-1',
          deliveryState: 'queued', bodyRevision: 9,
          committedAt: '2026-09-02T00:00:00.000Z',
        },
      }

      connections.broadcastToClients('m1', JSON.stringify(daemonResponse))

      expect(mobile.send).toHaveBeenCalledOnce()
      expect(JSON.parse(mobile.send.mock.calls[0][0])).toEqual({
        type: 'relay', machineId: 'm1', frame: daemonResponse,
      })
    })
  })

  describe('closeByDeviceId', () => {
    it('closes all WS connections for a device', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()
      const ws2 = createMockWs()
      const ws3 = createMockWs()

      connections.addClient('m1', ws1, 'u1', 'target-device')
      connections.addClient('m1', ws2, 'u1', 'target-device')
      connections.addClient('m1', ws3, 'u1', 'other-device')

      const closed = connections.closeByDeviceId('target-device')

      expect(closed).toBe(2)
      expect(ws1.close).toHaveBeenCalledWith(4009, 'Device revoked')
      expect(ws2.close).toHaveBeenCalledWith(4009, 'Device revoked')
      expect(ws3.close).not.toHaveBeenCalled()
    })

    it('returns 0 when device has no connections', () => {
      const { connections } = ConnectionManagerModule
      const closed = connections.closeByDeviceId('nonexistent')
      expect(closed).toBe(0)
    })
  })

  describe('closeByUserId', () => {
    it('closes every local socket for the user without touching another user', () => {
      const { connections } = ConnectionManagerModule
      const first = createMockWs()
      const multiplex = createMockWs()
      const other = createMockWs()

      connections.addClient('m1', first, 'u1', 'd1')
      connections.addClient('m2', multiplex, 'u1', 'd2', 'ios', 'multiplex')
      connections.addClient('m1', other, 'u2', 'd3')

      expect(connections.closeByUserId('u1')).toBe(2)
      expect(first.close).toHaveBeenCalledWith(4009, 'User logged out')
      expect(multiplex.close).toHaveBeenCalledWith(4009, 'User logged out')
      expect(other.close).not.toHaveBeenCalled()
    })
  })

  describe('machine access revocation', () => {
    it('runs only callbacks for the named user and machine', () => {
      const { connections } = ConnectionManagerModule
      const target = vi.fn()
      const otherMachine = vi.fn()
      const otherUser = vi.fn()
      const unregister = connections.registerMachineAccessRevoker('m1', 'u1', target)
      connections.registerMachineAccessRevoker('m2', 'u1', otherMachine)
      connections.registerMachineAccessRevoker('m1', 'u2', otherUser)

      expect(connections.revokeMachineAccess('m1', 'u1')).toBe(1)
      expect(target).toHaveBeenCalledOnce()
      expect(otherMachine).not.toHaveBeenCalled()
      expect(otherUser).not.toHaveBeenCalled()
      unregister()
      expect(connections.revokeMachineAccess('m1', 'u1')).toBe(0)
    })

    it('revokes every user on one machine without touching another machine', () => {
      const { connections } = ConnectionManagerModule
      const owner = vi.fn()
      const grantee = vi.fn()
      const otherMachine = vi.fn()
      connections.registerMachineAccessRevoker('m1', 'owner', owner)
      connections.registerMachineAccessRevoker('m1', 'guest', grantee)
      connections.registerMachineAccessRevoker('m2', 'guest', otherMachine)
      expect(connections.revokeAllMachineAccess('m1')).toBe(2)
      expect(owner).toHaveBeenCalledOnce()
      expect(grantee).toHaveBeenCalledOnce()
      expect(otherMachine).not.toHaveBeenCalled()
    })
  })

  describe('device tracking through client lifecycle', () => {
    it('cleans up device-to-ws mapping on removeClient', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()

      connections.addClient('m1', ws1, 'u1', 'dev1')
      connections.removeClient('m1', ws1)

      // After removing, closeByDeviceId should find nothing
      expect(connections.closeByDeviceId('dev1')).toBe(0)
    })

    it('handles multiple connections per device correctly', () => {
      const { connections } = ConnectionManagerModule
      const ws1 = createMockWs()
      const ws2 = createMockWs()

      connections.addClient('m1', ws1, 'u1', 'dev1')
      connections.addClient('m2', ws2, 'u1', 'dev1')

      // Remove one — other should remain
      connections.removeClient('m1', ws1)
      expect(connections.closeByDeviceId('dev1')).toBe(1)
      expect(ws2.close).toHaveBeenCalledWith(4009, 'Device revoked')
    })
  })

  describe('online user presence', () => {
    it('detects any connected client for a user', () => {
      const { connections } = ConnectionManagerModule
      const webClient = createMockWs()

      connections.addClient('m1', webClient, 'u1', 'web-dev', 'web')

      expect(connections.hasAnyClientForUser('u1')).toBe(true)
      expect(connections.hasAnyClientForUser('u2')).toBe(false)
    })

    it('only counts ios/android sockets as mobile clients', () => {
      const { connections } = ConnectionManagerModule
      const webClient = createMockWs()
      const iosClient = createMockWs()

      connections.addClient('m1', webClient, 'u1', 'web-dev', 'web')
      expect(connections.hasAnyMobileClientForUser('u1')).toBe(false)

      connections.addClient('m1', iosClient, 'u1', 'ios-dev', 'ios')
      expect(connections.hasAnyMobileClientForUser('u1')).toBe(true)
    })
  })

  describe('machine connection replacement', () => {
    it('does not remove the current machine connection when an old socket closes', () => {
      const { connections } = ConnectionManagerModule
      const oldWs = createMockWs()
      const newWs = createMockWs()

      connections.addMachine('m1', oldWs, 'u1', 'cn')
      connections.addMachine('m1', newWs, 'u1', 'cn')

      expect(oldWs.close).toHaveBeenCalledWith(4410, 'ownership_replaced')
      expect(connections.removeMachine('m1', oldWs)).toBe(false)
      expect(connections.getMachine('m1')).toBe(newWs)

      expect(connections.removeMachine('m1', newWs)).toBe(true)
      expect(connections.getMachine('m1')).toBeUndefined()
    })

    it('keeps App sockets registered when a machine disconnects or moves to another instance', () => {
      const { connections } = ConnectionManagerModule
      const machine = createMockWs()
      const client = createMockWs()
      connections.addMachine('m1', machine, 'u1', 'cn')
      connections.addClient('m1', client, 'u1', 'd1', 'ios')

      expect(connections.removeMachine('m1', machine)).toBe(true)
      expect(connections.getClients('m1')).toEqual(new Set([client]))

      connections.broadcastToClients('m1', 'still-connected')
      expect(client.send).toHaveBeenCalledWith('still-connected')
    })
  })
})
