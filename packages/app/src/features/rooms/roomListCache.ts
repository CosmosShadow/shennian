// @arch docs/features/network-rooms/ui.md#六移动端
// @test packages/app/src/__tests__/room-list-cache.test.ts

import { applyIncomingRoomMessageUnread } from '@shennian/shared'
import type { RoomMessageView, RoomSummary } from '@shennian/wire'
import type { RoomMemberView } from './types'

export type PendingJoinRequest = {
  id: string
  roomId: string
  roomName: string
  status: 'pending'
  createdAt: string
}

export type RoomListItem = Omit<RoomSummary, 'latestMessage' | 'avatarMembers'> & {
  latestMessage?: RoomMessageView | null
  avatarMembers?: RoomMemberView[]
}

export type RoomListSnapshot = {
  rooms: RoomListItem[]
  pendingRequests: PendingJoinRequest[]
}

const snapshots = new Map<string, RoomListSnapshot>()
const listeners = new Set<() => void>()

// Derived body previews survive row unmounts, but never replace event/sync watermarks.
const bodyPreviews = new Map<string, Map<string, {
  latestKey: string
  message: RoomMessageView | null
}>>()

export function getRoomBodyPreview(
  accountId: string | null,
  roomId: string,
  latest: RoomMessageView | null | undefined,
): RoomMessageView | null | undefined {
  if (!accountId || !latest) return undefined
  const cached = bodyPreviews.get(accountId)?.get(roomId)
  return cached?.latestKey === JSON.stringify(latest) ? cached.message : undefined
}

export function setRoomBodyPreview(
  accountId: string | null,
  roomId: string,
  latest: RoomMessageView,
  message: RoomMessageView | null,
): void {
  if (!accountId) return
  let rooms = bodyPreviews.get(accountId)
  if (!rooms) bodyPreviews.set(accountId, (rooms = new Map()))
  rooms.set(roomId, { latestKey: JSON.stringify(latest), message })
}

export function getRoomListSnapshot(accountId: string | null): RoomListSnapshot | null {
  return accountId ? (snapshots.get(accountId) ?? null) : null
}

export function setRoomListSnapshot(accountId: string | null, snapshot: RoomListSnapshot): void {
  if (!accountId) return
  const normalized = {
    ...snapshot,
    rooms: sortRoomListItems(snapshot.rooms.map((room) => ({
      ...room,
      unreadCount: (room.unreadCount ?? 0) > 0 ? 1 : 0,
    }))),
  }
  snapshots.set(accountId, normalized)
  const previews = bodyPreviews.get(accountId)
  if (previews) {
    const roomIds = new Set(normalized.rooms.map((room) => room.id))
    for (const roomId of previews.keys()) {
      if (!roomIds.has(roomId)) previews.delete(roomId)
    }
  }
  for (const listener of listeners) listener()
}

export function applyRoomMessageToListSnapshot(
  accountId: string | null,
  message: RoomMessageView,
): void {
  if (!accountId) return
  const snapshot = snapshots.get(accountId)
  if (!snapshot) return
  let changed = false
  const rooms = snapshot.rooms.map((room) => {
    if (room.id !== message.roomId) return room
    if (room.latestMessage && compareSequence(room.latestMessage.sequence, message.sequence) >= 0) {
      return room
    }
    changed = true
    const unread = applyIncomingRoomMessageUnread(room, message, accountId)
    return {
      ...room,
      latestMessage: message,
      lastSequence: maxSequence(room.lastSequence, message.sequence),
      updatedAt: message.createdAt,
      ...(unread.lastReadSequence !== undefined ? { lastReadSequence: unread.lastReadSequence } : {}),
      unreadCount: unread.unreadCount,
    }
  })
  if (!changed) return
  setRoomListSnapshot(accountId, {
    ...snapshot,
    rooms: sortRoomListItems(rooms),
  })
}

export function sortRoomListItems(rooms: RoomListItem[]): RoomListItem[] {
  const unique = new Map<string, RoomListItem>()
  for (const room of rooms) {
    const existing = unique.get(room.id)
    if (!existing || compareSequence(existing.lastSequence, room.lastSequence) < 0) {
      unique.set(room.id, room)
    }
  }
  return [...unique.values()].sort((left, right) => {
    if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) return left.pinnedAt ? -1 : 1
    if (left.pinnedAt && right.pinnedAt) {
      const pinnedDifference = toTimestamp(right.pinnedAt) - toTimestamp(left.pinnedAt)
      if (pinnedDifference !== 0) return pinnedDifference
    }
    const activityDifference = roomActivityAt(right) - roomActivityAt(left)
    if (activityDifference !== 0) return activityDifference
    return left.id.localeCompare(right.id)
  })
}

/**
 * Inventory refreshes can finish after a newer Relay message. Keep the server's
 * authoritative membership inventory while preserving a locally observed
 * higher message sequence for Rooms that are still visible.
 */
export function mergeRoomListSnapshot(
  previous: RoomListSnapshot | null,
  incoming: RoomListSnapshot,
): RoomListSnapshot {
  if (!previous) return { ...incoming, rooms: sortRoomListItems(incoming.rooms) }
  const previousById = new Map(previous.rooms.map((room) => [room.id, room]))
  return {
    ...incoming,
    rooms: sortRoomListItems(incoming.rooms.map((room) => {
      const existing = previousById.get(room.id)
      if (!existing) return room
      const locallyNewerMessage = compareSequence(existing.lastSequence, room.lastSequence) > 0
      const locallyNewerRead = compareSequence(
        existing.lastReadSequence ?? '0', room.lastReadSequence ?? '0',
      ) > 0
      const lastSequence = locallyNewerMessage ? existing.lastSequence : room.lastSequence
      const lastReadSequence = locallyNewerRead ? existing.lastReadSequence : room.lastReadSequence
      return {
        ...room,
        lastSequence,
        lastReadSequence,
        ...(locallyNewerMessage ? {
          latestMessage: existing.latestMessage ?? room.latestMessage,
          updatedAt: existing.latestMessage?.createdAt ?? existing.updatedAt,
        } : {}),
        unreadCount: locallyNewerRead
          ? compareSequence(lastReadSequence ?? '0', lastSequence) >= 0 ? 0 : 1
          : locallyNewerMessage ? (existing.unreadCount ?? 0) > 0 ? 1 : 0 : room.unreadCount,
      }
    })),
  }
}

export function subscribeRoomListSnapshots(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearRoomListSnapshots(): void {
  snapshots.clear()
  bodyPreviews.clear()
  for (const listener of listeners) listener()
}

function roomActivityAt(room: RoomListItem): number {
  return toTimestamp(room.latestMessage?.createdAt ?? room.updatedAt)
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function compareSequence(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function maxSequence(left: string, right: string): string {
  return compareSequence(left, right) >= 0 ? left : right
}
