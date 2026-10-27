// @arch docs/features/network-rooms/ui.md#六移动端
// @covers packages/app/src/features/rooms/roomListCache.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyRoomMessageToListSnapshot,
  clearRoomListSnapshots,
  getRoomListSnapshot,
  getRoomBodyPreview,
  mergeRoomListSnapshot,
  setRoomBodyPreview,
  setRoomListSnapshot,
  subscribeRoomListSnapshots,
  type RoomListSnapshot,
} from '../features/rooms/roomListCache'
import type { RoomMessageView } from '@shennian/wire'

const emptySnapshot: RoomListSnapshot = { rooms: [], pendingRequests: [] }

describe('Room list cache', () => {
  beforeEach(() => clearRoomListSnapshots())

  it('keeps an empty successful snapshot so returning to the tab can refresh silently', () => {
    expect(getRoomListSnapshot('user-a')).toBeNull()
    setRoomListSnapshot('user-a', emptySnapshot)
    expect(getRoomListSnapshot('user-a')).toEqual(emptySnapshot)
  })

  it('does not expose one account room snapshot to another account', () => {
    setRoomListSnapshot('user-a', emptySnapshot)
    expect(getRoomListSnapshot('user-b')).toBeNull()
    expect(getRoomListSnapshot(null)).toBeNull()
  })

  it('notifies global unread consumers when a snapshot changes', () => {
    let changes = 0
    const unsubscribe = subscribeRoomListSnapshots(() => changes++)
    setRoomListSnapshot('user-a', emptySnapshot)
    unsubscribe()
    setRoomListSnapshot('user-a', emptySnapshot)
    expect(changes).toBe(1)
  })

  it('publishes the newest Room message to list subscribers and reorders the list', () => {
    const room = (id: string, sequence: string) => ({
      id,
      name: id,
      status: 'active' as const,
      visibility: 'private' as const,
      joinPolicy: 'open' as const,
      humanCount: 1,
      agentCount: 0,
      lastSequence: sequence,
      unreadCount: 0,
      updatedAt: new Date(Number(sequence) * 1_000).toISOString(),
    })
    const message: RoomMessageView = {
      id: 'message-3',
      roomId: 'room-a',
      sequence: '3',
      kind: 'text',
      author: {
        membershipId: 'member-1',
        principalType: 'human',
        ownerUserId: 'user-a',
        displayName: 'User',
      },
      text: 'newest',
      attachments: [],
      createdAt: new Date(3_000).toISOString(),
    }
    setRoomListSnapshot('user-a', {
      rooms: [room('room-b', '2'), room('room-a', '1')],
      pendingRequests: [],
    })
    let changes = 0
    const unsubscribe = subscribeRoomListSnapshots(() => changes++)

    applyRoomMessageToListSnapshot('user-a', message)
    applyRoomMessageToListSnapshot('user-a', { ...message, sequence: '2' })

    unsubscribe()
    expect(changes).toBe(1)
    expect(getRoomListSnapshot('user-a')?.rooms.map((item) => item.id)).toEqual([
      'room-a',
      'room-b',
    ])
    expect(getRoomListSnapshot('user-a')?.rooms[0]?.latestMessage?.text).toBe('newest')
    expect(getRoomListSnapshot('user-a')?.rooms[0]?.unreadCount).toBe(1)
  })

  it('keeps the list read when the account sends its own message, but not for others', () => {
    const room = {
      id: 'room-a', name: 'room-a', status: 'active' as const, visibility: 'private' as const,
      joinPolicy: 'open' as const, humanCount: 2, agentCount: 0, lastSequence: '9',
      lastReadSequence: '9', unreadCount: 0, updatedAt: new Date(9_000).toISOString(),
    }
    const message = (sequence: string, ownerUserId: string): RoomMessageView => ({
      id: `message-${sequence}`, roomId: 'room-a', sequence, kind: 'text',
      author: { membershipId: 'member-1', principalType: 'human', ownerUserId, displayName: 'U' },
      text: 'hi', attachments: [], createdAt: new Date(Number(sequence) * 1_000).toISOString(),
    })
    setRoomListSnapshot('user-a', { rooms: [room], pendingRequests: [] })

    applyRoomMessageToListSnapshot('user-a', message('10', 'user-a'))
    expect(getRoomListSnapshot('user-a')?.rooms[0]).toEqual(
      expect.objectContaining({ lastSequence: '10', lastReadSequence: '10', unreadCount: 0 }),
    )

    applyRoomMessageToListSnapshot('user-a', message('11', 'user-b'))
    expect(getRoomListSnapshot('user-a')?.rooms[0]).toEqual(
      expect.objectContaining({ lastSequence: '11', lastReadSequence: '10', unreadCount: 1 }),
    )

    // Writing on top of a message someone else sent must not mark that message read.
    applyRoomMessageToListSnapshot('user-a', message('12', 'user-a'))
    expect(getRoomListSnapshot('user-a')?.rooms[0]).toEqual(
      expect.objectContaining({ lastReadSequence: '10', unreadCount: 1 }),
    )
  })

  it('normalizes every snapshot with pinned, activity, and stable id ordering', () => {
    const room = (id: string, updatedAt: string, pinnedAt: string | null = null) => ({
      id, name: id, status: 'active' as const, visibility: 'private' as const,
      joinPolicy: 'open' as const, humanCount: 1, agentCount: 0,
      lastSequence: '1', unreadCount: 0, updatedAt, pinnedAt,
    })
    setRoomListSnapshot('user-a', {
      rooms: [
        room('room-z', '2026-09-16T10:00:00Z'),
        room('room-b', '2026-09-16T10:00:00Z'),
        room('room-a', '2026-09-16T10:00:00Z'),
        room('pinned-old', '2026-09-01T10:00:00Z', '2026-09-15T10:00:00Z'),
        room('pinned-new', '2026-09-01T10:00:00Z', '2026-09-16T10:00:00Z'),
      ],
      pendingRequests: [],
    })
    expect(getRoomListSnapshot('user-a')?.rooms.map((item) => item.id)).toEqual([
      'pinned-new', 'pinned-old', 'room-a', 'room-b', 'room-z',
    ])
  })

  it('deduplicates transient repeated Room rows by id and keeps the newest sequence', () => {
    const room = (sequence: string) => ({
      id: 'room-a', name: `Room ${sequence}`, status: 'active' as const,
      visibility: 'private' as const, joinPolicy: 'open' as const,
      humanCount: 1, agentCount: 1, lastSequence: sequence, unreadCount: Number(sequence),
      updatedAt: new Date(Number(sequence) * 1_000).toISOString(),
    })
    setRoomListSnapshot('user-a', {
      rooms: [room('2'), room('4'), room('3')],
      pendingRequests: [],
    })
    expect(getRoomListSnapshot('user-a')?.rooms).toHaveLength(1)
    expect(getRoomListSnapshot('user-a')?.rooms[0]).toMatchObject({
      id: 'room-a',
      name: 'Room 4',
      lastSequence: '4',
    })
  })

  it('does not let a stale inventory response overwrite a newer Relay message', () => {
    const room = (sequence: string, latestMessage?: RoomMessageView) => ({
      id: 'room-a', name: 'Room', status: 'active' as const, visibility: 'private' as const,
      joinPolicy: 'open' as const, humanCount: 1, agentCount: 0,
      lastSequence: sequence, unreadCount: Number(sequence),
      updatedAt: new Date(Number(sequence) * 1_000).toISOString(), latestMessage,
    })
    const newest: RoomMessageView = {
      id: 'message-4', roomId: 'room-a', sequence: '4', kind: 'text', text: 'new',
      attachments: [], createdAt: new Date(4_000).toISOString(),
      author: { membershipId: 'm', principalType: 'human', ownerUserId: 'u', displayName: 'U' },
    }
    const merged = mergeRoomListSnapshot(
      { rooms: [room('4', newest)], pendingRequests: [] },
      { rooms: [room('3')], pendingRequests: [] },
    )
    expect(merged.rooms[0]?.lastSequence).toBe('4')
    expect(merged.rooms[0]?.latestMessage?.id).toBe('message-4')
    expect(merged.rooms[0]?.unreadCount).toBe(1)
  })

  it('does not restore unread after a read receipt beats an older inventory response', () => {
    const room = (lastSequence: string, lastReadSequence: string, unreadCount: number) => ({
      id: 'room-a', name: 'Room', status: 'active' as const, visibility: 'private' as const,
      joinPolicy: 'open' as const, humanCount: 1, agentCount: 0, lastSequence,
      lastReadSequence, unreadCount, updatedAt: '2026-09-23T12:00:00Z',
    })
    const merged = mergeRoomListSnapshot(
      { rooms: [room('11', '11', 0)], pendingRequests: [] },
      { rooms: [room('11', '10', 1)], pendingRequests: [] },
    )
    expect(merged.rooms[0]).toMatchObject({
      lastSequence: '11', lastReadSequence: '11', unreadCount: 0,
    })

    const newerMessage = mergeRoomListSnapshot(
      { rooms: [room('11', '11', 0)], pendingRequests: [] },
      { rooms: [room('12', '10', 1)], pendingRequests: [] },
    )
    expect(newerMessage.rooms[0]).toMatchObject({
      lastSequence: '12', lastReadSequence: '11', unreadCount: 1,
    })
  })
})


describe('Room body preview cache across tab remounts', () => {
  const body: RoomMessageView = {
    id: 'body', roomId: 'room-a', sequence: '8', kind: 'text', text: 'OK',
    attachments: [], createdAt: '2026-09-11T00:00:00Z',
    author: { membershipId: 'member', principalType: 'human', ownerUserId: 'user-a', displayName: '小龙' },
  }
  const latest: RoomMessageView = { ...body, id: 'system', sequence: '9', kind: 'system' }

  beforeEach(() => clearRoomListSnapshots())

  it('restores the resolved body synchronously with a fresh summary object on tab return', () => {
    expect(getRoomBodyPreview('user-a', 'room-a', latest)).toBeUndefined()
    setRoomBodyPreview('user-a', 'room-a', latest, body)
    expect(getRoomBodyPreview('user-a', 'room-a', JSON.parse(JSON.stringify(latest)))).toEqual(body)
    expect(latest.sequence).toBe('9')
    expect(latest.kind).toBe('system')
  })

  it('isolates accounts and rooms, and invalidates changed latest events', () => {
    setRoomBodyPreview('user-a', 'room-a', latest, body)
    expect(getRoomBodyPreview('user-b', 'room-a', latest)).toBeUndefined()
    expect(getRoomBodyPreview(null, 'room-a', latest)).toBeUndefined()
    expect(getRoomBodyPreview('user-a', 'room-b', latest)).toBeUndefined()
    expect(getRoomBodyPreview('user-a', 'room-a', { ...latest, sequence: '10' })).toBeUndefined()
    expect(getRoomBodyPreview('user-a', 'room-a', { ...latest, deletedAt: latest.createdAt })).toBeUndefined()
    expect(getRoomBodyPreview('user-a', 'room-a', null)).toBeUndefined()
  })

  it('accepts background revalidation including removal of the previously displayed body', () => {
    setRoomBodyPreview('user-a', 'room-a', latest, body)
    setRoomBodyPreview('user-a', 'room-a', latest, null)
    expect(getRoomBodyPreview('user-a', 'room-a', latest)).toBeNull()
  })

  it('clears derived previews on logout or when a room leaves the list', () => {
    setRoomBodyPreview('user-a', 'room-a', latest, body)
    clearRoomListSnapshots()
    expect(getRoomBodyPreview('user-a', 'room-a', latest)).toBeUndefined()
    setRoomBodyPreview('user-a', 'room-a', latest, body)
    setRoomListSnapshot('user-a', emptySnapshot)
    expect(getRoomBodyPreview('user-a', 'room-a', latest)).toBeUndefined()
  })
})
