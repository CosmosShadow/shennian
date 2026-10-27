// @arch docs/features/network-rooms/local-first-persistence.md
// @test src/__tests__/room-replica-sync.test.ts

import {
  ApiError,
  applyIncomingRoomMessageUnread,
  incrementRuntimeMetric,
  setRuntimeGauge,
  type LocalRoomJoinRequest,
  type LocalRoomSummary,
  type LocalRoomSyncState,
  type RoomStore,
} from '@shennian/shared'
import type { RoomMessageView, RoomSummary } from '@shennian/wire'

const PAGE_SIZE = 100
const MAX_PARALLEL_ROOMS = 2
const RETRY_DELAY_MS = 5_000

export type RoomReplicaApi = (path: string) => Promise<unknown>

export type RoomInventorySnapshot = {
  rooms: LocalRoomSummary[]
  pendingRequests: LocalRoomJoinRequest[]
}

export type RoomReplicaSyncRequest = {
  refreshInventory?: boolean
  allRooms?: boolean
  roomId?: string
}

export type RoomReplicaSyncCoordinatorOptions = {
  accountId: string
  store: RoomStore
  api: RoomReplicaApi
  onInventory?: (snapshot: RoomInventorySnapshot) => void
  onRoomRemoved?: (roomId: string) => void
}

type MessagePage = { messages: RoomMessageView[]; hasMore: boolean; retentionCutoff?: string }

export class RoomReplicaSyncCoordinator {
  private stopped = false
  private running: Promise<void> | null = null
  private inventoryRequested = false
  private allRoomsRequested = false
  private readonly roomIdsRequested = new Set<string>()
  private retryInventory = false
  private retryAllRooms = false
  private readonly retryRoomIds = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: RoomReplicaSyncCoordinatorOptions) {}

  requestSync(request: RoomReplicaSyncRequest = { allRooms: true }): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (request.refreshInventory) this.inventoryRequested = true
    if (request.allRooms) this.allRoomsRequested = true
    if (request.roomId) this.roomIdsRequested.add(request.roomId)
    if (!this.running) {
      const running = this.run()
      this.running = running.finally(() => {
        this.running = null
        if (this.hasPendingWork() && !this.stopped) void this.requestSync({})
      })
    }
    return this.running
  }

  async ingestMessage(message: RoomMessageView): Promise<void> {
    if (this.stopped) return
    await this.options.store.saveRoomMessages(this.options.accountId, message.roomId, [message])
    const summaries = await this.options.store.getRoomSummaries(this.options.accountId)
    const room = summaries.find((item) => item.id === message.roomId)
    if (!room) {
      await this.requestSync({ refreshInventory: true, roomId: message.roomId })
      return
    }
    const previousLatest = room.latestMessage
    if (!previousLatest || compareSequence(message.sequence, previousLatest.sequence) > 0) {
      const unread = applyIncomingRoomMessageUnread(room, message, this.options.accountId)
      await this.options.store.upsertRoomSummary(this.options.accountId, {
        ...room,
        lastSequence: maxSequence(room.lastSequence, message.sequence),
        latestMessage: message,
        updatedAt: message.createdAt,
        ...(unread.lastReadSequence !== undefined ? { lastReadSequence: unread.lastReadSequence } : {}),
        unreadCount: unread.unreadCount,
      })
    }
    await this.requestSync({ roomId: message.roomId })
  }

  stop(): void {
    this.stopped = true
    this.inventoryRequested = false
    this.allRoomsRequested = false
    this.roomIdsRequested.clear()
    this.retryInventory = false
    this.retryAllRooms = false
    this.retryRoomIds.clear()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private hasPendingWork(): boolean {
    return this.inventoryRequested || this.allRoomsRequested || this.roomIdsRequested.size > 0
  }

  private async run(): Promise<void> {
    while (this.hasPendingWork() && !this.stopped) {
      const refreshInventory = this.inventoryRequested
      const syncAllRooms = this.allRoomsRequested
      const requestedRoomIds = new Set(this.roomIdsRequested)
      this.inventoryRequested = false
      this.allRoomsRequested = false
      this.roomIdsRequested.clear()

      if (refreshInventory) {
        try {
          await this.refreshInventory()
        } catch {
          incrementRuntimeMetric('room_replica.inventory_failed')
          this.scheduleRetry({ refreshInventory: true, allRooms: true })
        }
      }

      let summaries: LocalRoomSummary[]
      try {
        summaries = await this.options.store.getRoomSummaries(this.options.accountId)
      } catch {
        incrementRuntimeMetric('room_replica.rooms_failed')
        this.scheduleRetry({ allRooms: syncAllRooms })
        for (const roomId of requestedRoomIds) this.scheduleRetry({ roomId })
        continue
      }
      const candidates = summaries
        .filter((room) => syncAllRooms || requestedRoomIds.has(room.id))
        .sort(compareRooms)
      setRuntimeGauge('room_replica.pending_rooms', candidates.length)
      let cursor = 0
      const workers = Array.from(
        { length: Math.min(MAX_PARALLEL_ROOMS, candidates.length) },
        async () => {
          while (!this.stopped) {
            const room = candidates[cursor++]
            if (!room) return
            try {
              await this.syncRoom(room)
              incrementRuntimeMetric('room_replica.rooms_completed')
            } catch (error) {
              incrementRuntimeMetric('room_replica.rooms_failed')
              if (error instanceof ApiError && error.status === 403) {
                await this.options.store.removeRoom(this.options.accountId, room.id).catch(() => {})
                this.options.onRoomRemoved?.(room.id)
              } else {
                this.scheduleRetry({ roomId: room.id })
              }
            }
          }
        },
      )
      await Promise.all(workers)
      if (candidates.length > 0) await this.publishInventory()
    }
    setRuntimeGauge('room_replica.pending_rooms', 0)
  }

  private scheduleRetry(request: RoomReplicaSyncRequest): void {
    if (this.stopped) return
    if (request.refreshInventory) this.retryInventory = true
    if (request.allRooms) this.retryAllRooms = true
    if (request.roomId) this.retryRoomIds.add(request.roomId)
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      const refreshInventory = this.retryInventory
      const allRooms = this.retryAllRooms
      const roomIds = [...this.retryRoomIds]
      this.retryInventory = false
      this.retryAllRooms = false
      this.retryRoomIds.clear()
      void this.requestSync({ refreshInventory, allRooms })
      for (const roomId of roomIds) void this.requestSync({ roomId })
    }, RETRY_DELAY_MS)
  }

  private async refreshInventory(): Promise<void> {
    const [previousRooms, roomResult, requestResult] = await Promise.all([
      this.options.store.getRoomSummaries(this.options.accountId),
      this.options.api('/rooms?includeDirect=1') as Promise<{ rooms: RoomSummary[] }>,
      this.options.api('/rooms/join-requests/mine') as Promise<{
        joinRequests: LocalRoomJoinRequest[]
      }>,
    ])
    const previousById = new Map(previousRooms.map((room) => [room.id, room]))
    const advancedHistoryFloors = roomResult.rooms.filter((room) => {
      const floor = room.historyFromSequence
      return Boolean(
        floor && historyFloorAdvanced(previousById.get(room.id)?.historyFromSequence, floor),
      )
    })
    await Promise.all(advancedHistoryFloors.map((room) =>
      this.options.store.applyRoomHistoryFloor(
        this.options.accountId,
        room.id,
        room.historyFromSequence!,
      )))
    await Promise.all([
      this.options.store.replaceRoomSummaries(this.options.accountId, roomResult.rooms),
      this.options.store.replaceRoomJoinRequests(
        this.options.accountId,
        requestResult.joinRequests,
      ),
    ])
    const visibleRoomIds = new Set(roomResult.rooms.map((room) => room.id))
    for (const room of previousRooms) {
      if (!visibleRoomIds.has(room.id)) this.options.onRoomRemoved?.(room.id)
    }
    await this.publishInventory()
    incrementRuntimeMetric('room_replica.inventory_completed')
  }

  private async publishInventory(): Promise<void> {
    if (!this.options.onInventory) return
    const [rooms, pendingRequests] = await Promise.all([
      this.options.store.getRoomSummaries(this.options.accountId),
      this.options.store.getRoomJoinRequests(this.options.accountId),
    ])
    this.options.onInventory({ rooms, pendingRequests })
  }

  private async syncRoom(room: LocalRoomSummary): Promise<void> {
    let state = await this.options.store.getRoomSyncState(this.options.accountId, room.id)

    if (state?.hasOlder && state.windowStartSequence !== '0') {
      state = await this.backfillOlder(room, state)
    }

    let after = state?.windowEndSequence ?? '0'
    let firstSequence = state?.windowStartSequence ?? '0'
    let lastSequence = after
    while (!this.stopped) {
      const page = await this.fetchPage(room.id, 'after', after)
      if (page.retentionCutoff) {
        await this.options.store.pruneRoomMessagesBefore(
          this.options.accountId,
          room.id,
          page.retentionCutoff,
        )
      }
      if (page.messages.length > 0) {
        await this.options.store.saveRoomMessages(this.options.accountId, room.id, page.messages)
        const latest = page.messages[page.messages.length - 1]
        if (
          latest &&
          (!room.latestMessage || compareSequence(latest.sequence, room.latestMessage.sequence) > 0)
        ) {
          room = {
            ...room,
            latestMessage: latest,
            lastSequence: maxSequence(room.lastSequence, latest.sequence),
            updatedAt: latest.createdAt,
          }
          await this.options.store.upsertRoomSummary(this.options.accountId, room)
        }
        firstSequence = firstSequence === '0' ? page.messages[0].sequence : firstSequence
        lastSequence = page.messages[page.messages.length - 1].sequence
        after = lastSequence
        incrementRuntimeMetric('room_replica.messages', page.messages.length)
        incrementRuntimeMetric('room_replica.pages')
      }
      state = {
        accountId: this.options.accountId,
        roomId: room.id,
        windowStartSequence: firstSequence,
        windowEndSequence: lastSequence,
        hasOlder: state?.hasOlder ?? false,
        serverLastSequence: maxSequence(room.lastSequence, lastSequence),
        needsRepair: false,
        updatedAt: new Date().toISOString(),
      }
      await this.options.store.putRoomSyncState(state)
      if (!page.hasMore || page.messages.length === 0) break
    }
  }

  private async backfillOlder(
    room: LocalRoomSummary,
    initialState: LocalRoomSyncState,
  ): Promise<LocalRoomSyncState> {
    let state = initialState
    let before = state.windowStartSequence
    while (state.hasOlder && !this.stopped) {
      const page = await this.fetchPage(room.id, 'before', before)
      if (page.retentionCutoff) {
        await this.options.store.pruneRoomMessagesBefore(
          this.options.accountId,
          room.id,
          page.retentionCutoff,
        )
      }
      if (page.messages.length > 0) {
        await this.options.store.saveRoomMessages(this.options.accountId, room.id, page.messages)
        before = page.messages[0].sequence
        incrementRuntimeMetric('room_replica.messages', page.messages.length)
        incrementRuntimeMetric('room_replica.backfill_pages')
      }
      state = {
        ...state,
        windowStartSequence: page.messages[0]?.sequence ?? state.windowStartSequence,
        hasOlder: page.hasMore && page.messages.length > 0,
        serverLastSequence: maxSequence(room.lastSequence, state.serverLastSequence),
        needsRepair: false,
        updatedAt: new Date().toISOString(),
      }
      await this.options.store.putRoomSyncState(state)
      if (page.messages.length === 0) break
    }
    return state
  }

  private fetchPage(roomId: string, direction: 'after' | 'before', sequence: string) {
    return this.options.api(
      `/rooms/${encodeURIComponent(roomId)}/messages?${direction}=${encodeURIComponent(sequence)}&limit=${PAGE_SIZE}`,
    ) as Promise<MessagePage>
  }
}

function compareRooms(left: LocalRoomSummary, right: LocalRoomSummary): number {
  if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) return left.pinnedAt ? -1 : 1
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

function compareSequence(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function maxSequence(left: string, right: string): string {
  return compareSequence(left, right) >= 0 ? left : right
}

function historyFloorAdvanced(previous: string | undefined, next: string): boolean {
  return previous === undefined ? BigInt(next) > 1n : BigInt(next) > BigInt(previous)
}
