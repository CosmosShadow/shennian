// @covers packages/app/src/features/rooms/roomEvents.ts

import { describe, expect, it, vi } from 'vitest'
import {
  publishRoomLocalRead,
  publishRoomRelayEvent,
  publishRoomSyncRequest,
  subscribeRoomEvents,
} from '../features/rooms/roomEvents'

describe('Room relay event bus', () => {
  it('publishes only matching validated Room event payloads', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRoomEvents(listener)
    const event = { event: 'room.updated' as const, roomId: 'room_1' }

    expect(publishRoomRelayEvent({ type: 'event', event: 'room.updated', payload: event })).toBe(
      true,
    )
    expect(listener).toHaveBeenCalledWith(event)
    expect(publishRoomRelayEvent({ type: 'event', event: 'session.update', payload: event })).toBe(
      false,
    )
    expect(
      publishRoomRelayEvent({
        type: 'event',
        event: 'room.updated',
        payload: { roomId: 'room_1' },
      }),
    ).toBe(false)

    unsubscribe()
    publishRoomRelayEvent({ type: 'event', event: 'room.updated', payload: event })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies the list after a visible conversation is marked read', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRoomEvents(listener)
    publishRoomLocalRead('room_1', '9')
    expect(listener).toHaveBeenCalledWith({
      event: 'room.read.local',
      roomId: 'room_1',
      lastReadSequence: '9',
    })
    unsubscribe()
  })

  it('publishes explicit sequence recovery requests without pretending they are messages', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeRoomEvents(listener)
    publishRoomSyncRequest('relay-reconnect')
    expect(listener).toHaveBeenCalledWith({
      event: 'room.sync.request',
      reason: 'relay-reconnect',
    })
    unsubscribe()
  })
})
