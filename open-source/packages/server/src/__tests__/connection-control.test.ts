// @covers open-source/packages/server/src/relay/connection-control.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConnections, mockCloseRoomBrowserSessionSockets, mockPubsub } = vi.hoisted(() => ({
  mockConnections: {
    closeByDeviceId: vi.fn(),
    closeByUserId: vi.fn(),
    revokeMachineAccess: vi.fn(),
    revokeAllMachineAccess: vi.fn(),
  },
  mockCloseRoomBrowserSessionSockets: vi.fn(),
  mockPubsub: {
    subscribeConnectionControl: vi.fn(),
    publishConnectionControl: vi.fn(),
  },
}))

vi.mock('../relay/connections.js', () => ({ connections: mockConnections }))
vi.mock('../services/room-browser-events.js', () => ({
  closeRoomBrowserSessionSockets: mockCloseRoomBrowserSessionSockets,
}))
vi.mock('../relay/pubsub.js', () => ({ pubsub: mockPubsub }))

import {
  applyConnectionControlEvent,
  destroyConnectionControl,
  initConnectionControl,
  publishDeviceRevoked,
  publishMachineAccessRevoked,
  publishMachineAccessPaused,
  publishRoomBrowserSessionRevoked,
  publishUserLogout,
} from '../relay/connection-control.js'

describe('cross-instance connection control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPubsub.subscribeConnectionControl.mockResolvedValue(vi.fn())
  })

  it('waits for the shared control subscription during Server startup', async () => {
    let subscribed!: (data: string) => boolean
    mockPubsub.subscribeConnectionControl.mockImplementation(async (handler) => {
      subscribed = handler
      return vi.fn()
    })

    await initConnectionControl()

    expect(mockPubsub.subscribeConnectionControl).toHaveBeenCalledOnce()
    expect(subscribed('{"version":1,"type":"device.revoke","deviceId":"remote-device"}')).toBe(true)
    expect(mockConnections.closeByDeviceId).toHaveBeenCalledWith('remote-device')
    destroyConnectionControl()
  })

  it('closes only the resource named by each valid remote event', () => {
    expect(applyConnectionControlEvent(JSON.stringify({
      version: 1, type: 'device.revoke', deviceId: 'device-1',
    }))).toBe(true)
    expect(applyConnectionControlEvent(JSON.stringify({
      version: 1, type: 'user.logout', userId: 'user-1',
    }))).toBe(true)
    expect(applyConnectionControlEvent(JSON.stringify({
      version: 1, type: 'room_browser_session.revoke', sessionId: 'browser-1',
    }))).toBe(true)
    expect(applyConnectionControlEvent(JSON.stringify({
      version: 1, type: 'machine_access.revoke', machineId: 'machine-1', userId: 'user-2',
    }))).toBe(true)
    expect(applyConnectionControlEvent(JSON.stringify({
      version: 1, type: 'machine_access.pause', machineId: 'machine-1',
    }))).toBe(true)

    expect(mockConnections.closeByDeviceId).toHaveBeenCalledWith('device-1')
    expect(mockConnections.closeByUserId).toHaveBeenCalledWith('user-1')
    expect(mockCloseRoomBrowserSessionSockets).toHaveBeenCalledWith('browser-1')
    expect(mockConnections.revokeMachineAccess).toHaveBeenCalledWith('machine-1', 'user-2')
    expect(mockConnections.revokeAllMachineAccess).toHaveBeenCalledWith('machine-1')
  })

  it('ignores malformed, unknown, and unsupported-version events', () => {
    expect(applyConnectionControlEvent('not-json')).toBe(false)
    expect(applyConnectionControlEvent(JSON.stringify({ version: 2, type: 'user.logout', userId: 'u1' }))).toBe(false)
    expect(applyConnectionControlEvent(JSON.stringify({ version: 1, type: 'user.logout', userId: '' }))).toBe(false)
    expect(applyConnectionControlEvent(JSON.stringify({ version: 1, type: 'unknown', userId: 'u1' }))).toBe(false)

    expect(mockConnections.closeByDeviceId).not.toHaveBeenCalled()
    expect(mockConnections.closeByUserId).not.toHaveBeenCalled()
    expect(mockCloseRoomBrowserSessionSockets).not.toHaveBeenCalled()
  })

  it('applies locally before publishing the idempotent cross-instance event', () => {
    publishDeviceRevoked('d1')
    publishUserLogout('u1')
    publishRoomBrowserSessionRevoked('s1')
    publishMachineAccessRevoked('m1', 'u2')
    publishMachineAccessPaused('m2')

    expect(mockConnections.closeByDeviceId).toHaveBeenCalledWith('d1')
    expect(mockConnections.closeByUserId).toHaveBeenCalledWith('u1')
    expect(mockCloseRoomBrowserSessionSockets).toHaveBeenCalledWith('s1')
    expect(mockPubsub.publishConnectionControl.mock.calls.map(([data]) => JSON.parse(data))).toEqual([
      { version: 1, type: 'device.revoke', deviceId: 'd1' },
      { version: 1, type: 'user.logout', userId: 'u1' },
      { version: 1, type: 'room_browser_session.revoke', sessionId: 's1' },
      { version: 1, type: 'machine_access.revoke', machineId: 'm1', userId: 'u2' },
      { version: 1, type: 'machine_access.pause', machineId: 'm2' },
    ])
  })
})
