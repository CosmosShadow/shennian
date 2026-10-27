// @covers packages/app/src/features/rooms/roomReplicaSyncCoordinator.ts

import { describe, expect, it, vi } from 'vitest'
import type {
  LocalRoomJoinRequest,
  LocalRoomMember,
  LocalRoomSummary,
  LocalRoomSyncState,
  RoomStore,
} from '@shennian/shared'
import type { RoomMessageView } from '@shennian/wire'
import { RoomReplicaSyncCoordinator } from '../features/rooms/roomReplicaSyncCoordinator'
import { mergeRoomSyncWindow } from '../features/rooms/roomSyncWindow'

function message(roomId: string, sequence: number): RoomMessageView {
  return {
    id: `${roomId}-message-${sequence}`,
    roomId,
    sequence: String(sequence),
    kind: 'text',
    author: {
      membershipId: 'member-1',
      principalType: 'human',
      ownerUserId: 'user-1',
      displayName: 'User',
    },
    text: `message ${sequence}`,
    attachments: [],
    createdAt: new Date(sequence * 1_000).toISOString(),
  }
}

function summary(roomId: string, lastSequence: number): LocalRoomSummary {
  return {
    id: roomId,
    name: roomId,
    status: 'active',
    visibility: 'private',
    joinPolicy: 'open',
    humanCount: 1,
    agentCount: 0,
    lastSequence: String(lastSequence),
    unreadCount: 0,
    updatedAt: new Date(lastSequence * 1_000).toISOString(),
  }
}

function createMemoryStore(initial?: {
  rooms?: LocalRoomSummary[]
  messages?: RoomMessageView[]
  states?: LocalRoomSyncState[]
}) {
  let rooms = [...(initial?.rooms ?? [])]
  let requests: LocalRoomJoinRequest[] = []
  const messages = new Map((initial?.messages ?? []).map((item) => [item.id, item]))
  const states = new Map((initial?.states ?? []).map((item) => [item.roomId, item]))
  const store: RoomStore = {
    async getRoomSummaries() {
      return rooms
    },
    async replaceRoomSummaries(_accountId, next) {
      rooms = [...next]
    },
    async upsertRoomSummary(_accountId, room) {
      rooms = [room, ...rooms.filter((item) => item.id !== room.id)]
    },
    async removeRoom(_accountId, roomId) {
      rooms = rooms.filter((room) => room.id !== roomId)
      for (const [id, item] of messages) if (item.roomId === roomId) messages.delete(id)
      states.delete(roomId)
    },
    async getRoomMessages(_accountId, roomId, opts) {
      let values = [...messages.values()].filter((item) => item.roomId === roomId)
      if (opts?.before)
        values = values.filter((item) => BigInt(item.sequence) < BigInt(opts.before!))
      if (opts?.after) values = values.filter((item) => BigInt(item.sequence) > BigInt(opts.after!))
      values.sort((left, right) => Number(BigInt(left.sequence) - BigInt(right.sequence)))
      return opts?.limit ? values.slice(-opts.limit) : values
    },
    async saveRoomMessages(_accountId, _roomId, next) {
      for (const item of next) messages.set(item.id, item)
    },
    async applyRoomHistoryFloor(_accountId, roomId, historyFromSequence) {
      for (const [id, item] of messages) {
        if (item.roomId === roomId && BigInt(item.sequence) < BigInt(historyFromSequence)) {
          messages.delete(id)
        }
      }
      states.delete(roomId)
    },
    async pruneRoomMessagesBefore(_accountId, roomId, cutoffIso) {
      for (const [id, item] of messages) {
        if (item.roomId === roomId && item.createdAt < cutoffIso) messages.delete(id)
      }
    },
    async getRoomMembers() {
      return []
    },
    async replaceRoomMembers(_accountId, _roomId, _members: LocalRoomMember[]) {},
    async getRoomSyncState(_accountId, roomId) {
      return states.get(roomId) ?? null
    },
    async putRoomSyncState(state) {
      states.set(state.roomId, state)
    },
    async getRoomJoinRequests() {
      return requests
    },
    async replaceRoomJoinRequests(_accountId, next) {
      requests = [...next]
    },
    async clearRoomAccount() {
      rooms = []
      requests = []
      messages.clear()
      states.clear()
    },
  }
  return { store, rooms: () => rooms, messages, states }
}

function pageFrom(
  history: RoomMessageView[],
  direction: 'after' | 'before',
  cursor: string,
  limit: number,
) {
  const filtered = history.filter((item) =>
    direction === 'after'
      ? BigInt(item.sequence) > BigInt(cursor)
      : BigInt(item.sequence) < BigInt(cursor),
  )
  if (direction === 'before') {
    const selected = filtered.slice(-(limit + 1))
    return { messages: selected.slice(-limit), hasMore: selected.length > limit }
  }
  const selected = filtered.slice(0, limit)
  return { messages: selected, hasMore: selected.length === limit }
}

function historyApi(history: RoomMessageView[]) {
  return vi.fn(async (path: string): Promise<unknown> => {
    const match = path.match(/\/rooms\/([^/]+)\/messages\?(after|before)=([^&]+)&limit=(\d+)/)
    if (!match) throw new Error(`unexpected path: ${path}`)
    const [, roomId, direction, cursor, limit] = match
    return pageFrom(
      history.filter((item) => item.roomId === decodeURIComponent(roomId)),
      direction as 'after' | 'before',
      decodeURIComponent(cursor),
      Number(limit),
    )
  })
}

describe('RoomReplicaSyncCoordinator', () => {
  it('does not regress a complete SQLite history window when the screen reads only its tail', () => {
    const existing: LocalRoomSyncState = {
      accountId: 'account-1',
      roomId: 'room-1',
      windowStartSequence: '1',
      windowEndSequence: '205',
      hasOlder: false,
      serverLastSequence: '205',
      needsRepair: false,
      updatedAt: new Date().toISOString(),
    }
    expect(
      mergeRoomSyncWindow(existing, {
        accountId: 'account-1',
        roomId: 'room-1',
        windowStartSequence: '156',
        windowEndSequence: '205',
        hasOlder: true,
        serverLastSequence: '205',
      }),
    ).toMatchObject({
      windowStartSequence: '1',
      windowEndSequence: '205',
      hasOlder: false,
    })
  })

  it('refreshes the inventory and downloads every visible message in pages', async () => {
    const room = summary('room-1', 205)
    const history = Array.from({ length: 205 }, (_, index) => message(room.id, index + 1))
    const memory = createMemoryStore()
    const historyRequest = historyApi(history)
    const api = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/rooms?includeDirect=1') return { rooms: [room] }
      if (path === '/rooms/join-requests/mine') return { joinRequests: [] }
      return historyRequest(path)
    })
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api,
    })

    await coordinator.requestSync({ refreshInventory: true, allRooms: true })

    expect(memory.messages.size).toBe(205)
    expect(memory.states.get(room.id)).toMatchObject({
      windowStartSequence: '1',
      windowEndSequence: '205',
      hasOlder: false,
      serverLastSequence: '205',
    })
    expect(memory.rooms()[0]?.latestMessage).toMatchObject({ sequence: '205' })
    expect(api).toHaveBeenCalledWith('/rooms/room-1/messages?after=0&limit=100')
    expect(api).toHaveBeenCalledWith('/rooms/room-1/messages?after=200&limit=100')
  })

  it('reports rooms removed by the authoritative inventory so device-local drafts are cleared', async () => {
    const removedRoom = summary('room-removed', 1)
    const visibleRoom = summary('room-visible', 0)
    const memory = createMemoryStore({ rooms: [removedRoom] })
    const onRoomRemoved = vi.fn()
    const api = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/rooms?includeDirect=1') return { rooms: [visibleRoom] }
      if (path === '/rooms/join-requests/mine') return { joinRequests: [] }
      return { messages: [], hasMore: false }
    })
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api,
      onRoomRemoved,
    })

    await coordinator.requestSync({ refreshInventory: true })

    expect(onRoomRemoved).toHaveBeenCalledWith(removedRoom.id)
    expect(onRoomRemoved).not.toHaveBeenCalledWith(visibleRoom.id)
  })

  it('clears only old local messages when an active Room history floor advances', async () => {
    const previous = {
      ...summary('room-1', 4),
      historyFromSequence: '1',
      latestMessage: message('room-1', 4),
    }
    const cleared = {
      ...previous,
      historyFromSequence: '5',
      latestMessage: null,
      unreadCount: 0,
    }
    const memory = createMemoryStore({
      rooms: [previous],
      messages: [1, 2, 3, 4].map((sequence) => message(previous.id, sequence)),
      states: [{
        accountId: 'account-1', roomId: previous.id,
        windowStartSequence: '1', windowEndSequence: '4', hasOlder: false,
        serverLastSequence: '4', needsRepair: false, updatedAt: new Date().toISOString(),
      }],
    })
    const api = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/rooms?includeDirect=1') return { rooms: [cleared] }
      if (path === '/rooms/join-requests/mine') return { joinRequests: [] }
      return { messages: [], hasMore: false }
    })
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1', store: memory.store, api,
    })

    await coordinator.requestSync({ refreshInventory: true, allRooms: true })

    expect(memory.rooms()).toEqual([cleared])
    expect(memory.messages.size).toBe(0)
    expect(memory.states.get(previous.id)).toMatchObject({
      windowStartSequence: '0',
      windowEndSequence: '0',
      serverLastSequence: '4',
    })
  })

  it('backfills an existing recent window before advancing its tail cursor', async () => {
    const room = summary('room-1', 205)
    const history = Array.from({ length: 205 }, (_, index) => message(room.id, index + 1))
    const memory = createMemoryStore({
      rooms: [room],
      messages: history.slice(150, 200),
      states: [
        {
          accountId: 'account-1',
          roomId: room.id,
          windowStartSequence: '151',
          windowEndSequence: '200',
          hasOlder: true,
          serverLastSequence: '200',
          needsRepair: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    const api = historyApi(history)
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api,
    })

    await coordinator.requestSync({ allRooms: true })

    expect(memory.messages.size).toBe(205)
    expect(memory.states.get(room.id)).toMatchObject({
      windowStartSequence: '1',
      windowEndSequence: '205',
      hasOlder: false,
    })
    expect(api).toHaveBeenCalledWith('/rooms/room-1/messages?before=151&limit=100')
    expect(api).toHaveBeenCalledWith('/rooms/room-1/messages?after=200&limit=100')
  })

  it('persists duplicate realtime messages idempotently and only repairs that Room', async () => {
    const room = { ...summary('room-1', 1), latestMessage: message('room-1', 1) }
    const other = summary('room-2', 1)
    const next = message(room.id, 2)
    const memory = createMemoryStore({
      rooms: [room, other],
      messages: [room.latestMessage, message(other.id, 1)],
      states: [room, other].map((item) => ({
        accountId: 'account-1',
        roomId: item.id,
        windowStartSequence: '1',
        windowEndSequence: '1',
        hasOlder: false,
        serverLastSequence: '1',
        needsRepair: false,
        updatedAt: new Date().toISOString(),
      })),
    })
    const api = historyApi([room.latestMessage, next, message(other.id, 1)])
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api,
    })

    await coordinator.ingestMessage(next)
    await coordinator.ingestMessage(next)

    expect([...memory.messages.values()].filter((item) => item.roomId === room.id)).toHaveLength(2)
    expect(memory.rooms().find((item) => item.id === room.id)?.unreadCount).toBe(1)
    expect(memory.states.get(room.id)?.windowEndSequence).toBe('2')
    expect(api.mock.calls.every(([path]) => !path.includes('room-2'))).toBe(true)
  })

  it('does not mark the Room unread when the account\'s own message arrives after it had read everything', async () => {
    const room = { ...summary('room-1', 1), lastReadSequence: '1', latestMessage: message('room-1', 1) }
    const own = {
      ...message(room.id, 2),
      author: { ...message(room.id, 2).author, ownerUserId: 'account-1' },
    }
    const memory = createMemoryStore({
      rooms: [room],
      messages: [room.latestMessage],
      states: [{
        accountId: 'account-1', roomId: room.id, windowStartSequence: '1', windowEndSequence: '1',
        hasOlder: false, serverLastSequence: '1', needsRepair: false, updatedAt: new Date().toISOString(),
      }],
    })
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api: historyApi([room.latestMessage, own]),
    })

    await coordinator.ingestMessage(own)

    expect(memory.rooms().find((item) => item.id === room.id)).toEqual(
      expect.objectContaining({ lastSequence: '2', lastReadSequence: '2', unreadCount: 0 }),
    )
  })

  it('prunes device-local Room messages using the server retention cutoff', async () => {
    const room = summary('room-1', 2)
    const oldMessage = {
      ...message(room.id, 1),
      createdAt: '2026-03-01T00:00:00.000Z',
    }
    const freshMessage = {
      ...message(room.id, 2),
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const memory = createMemoryStore({ rooms: [room], messages: [oldMessage] })
    const api = vi.fn(async () => ({
      messages: [freshMessage],
      hasMore: false,
      retentionCutoff: '2026-03-07T00:00:00.000Z',
    }))
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId: 'account-1',
      store: memory.store,
      api,
    })

    await coordinator.requestSync({ allRooms: true })

    expect([...memory.messages.values()]).toEqual([freshMessage])
  })
})
