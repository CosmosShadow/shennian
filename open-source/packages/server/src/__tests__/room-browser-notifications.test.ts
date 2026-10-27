// @covers open-source/packages/server/src/services/room-browser-notifications.ts
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ local: vi.fn(), pubsub: { isActive: false, publishToUser: vi.fn() } }))
vi.mock('../relay/connections.js', () => ({ connections: { broadcastToClientsOfUser: mocks.local } }))
vi.mock('../relay/pubsub.js', () => ({ pubsub: mocks.pubsub }))
import { notifyRoomBrowserAccessChanged } from '../services/room-browser-notifications.js'
beforeEach(() => { vi.clearAllMocks(); mocks.pubsub.isActive = false })
it.each([false, true])('invalidates only this user’s Room metadata, with cross-instance delivery=%s', (active) => {
  mocks.pubsub.isActive = active
  notifyRoomBrowserAccessChanged('user_1', 'room_1')
  const receiver = active ? mocks.pubsub.publishToUser : mocks.local
  expect(receiver).toHaveBeenCalledOnce()
  expect(receiver.mock.calls[0][0]).toBe('user_1')
  expect(JSON.parse(receiver.mock.calls[0][1])).toEqual({ type: 'event', event: 'room.updated', payload: { event: 'room.updated', roomId: 'room_1', entityId: 'room_1' } })
  expect(active ? mocks.local : mocks.pubsub.publishToUser).not.toHaveBeenCalled()
})
