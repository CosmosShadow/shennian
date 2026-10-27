// @arch docs/features/network-rooms/implementation-plan.md#44-实时事件
// @test src/__tests__/room-events.test.ts

import type { EventFrame, RoomEvent } from '@shennian/wire'

export type RoomClientEvent =
  | RoomEvent
  | {
      event: 'room.read.local'
      roomId: string
      lastReadSequence: string
    }
  | {
      event: 'room.sync.request'
      reason: 'relay-reconnect' | 'app-foreground' | 'network-restored' | 'tab-focused'
    }
  | {
      event: 'room.replica.updated'
      roomId: string | null
      scopes: string[]
    }

type Listener = (event: RoomClientEvent) => void
const listeners = new Set<Listener>()
const ROOM_EVENTS = new Set([
  'room.message.created',
  'room.created',
  'room.updated',
  'room.membership.updated',
  'room.join_request.created',
  'room.join_request.updated',
  'room.binding.updated',
])

export function publishRoomRelayEvent(frame: EventFrame): boolean {
  if (!ROOM_EVENTS.has(frame.event) || !frame.payload || typeof frame.payload !== 'object') {
    return false
  }
  const event = frame.payload as Partial<RoomEvent>
  if (event.event !== frame.event || typeof event.roomId !== 'string' || !event.roomId) {
    return false
  }
  for (const listener of listeners) listener(event as RoomEvent)
  return true
}

export function subscribeRoomEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishRoomLocalRead(roomId: string, lastReadSequence: string): void {
  for (const listener of listeners) {
    listener({ event: 'room.read.local', roomId, lastReadSequence })
  }
}

/** Requests a sequence-based recovery pass; realtime Room events remain the fast path. */
export function publishRoomSyncRequest(
  reason: 'relay-reconnect' | 'app-foreground' | 'network-restored' | 'tab-focused',
): void {
  for (const listener of listeners) listener({ event: 'room.sync.request', reason })
}

export function publishRoomReplicaRevision(roomId: string | null, scopes: string[]): void {
  for (const listener of listeners) listener({ event: 'room.replica.updated', roomId, scopes })
}
