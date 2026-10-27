// @arch docs/features/network-rooms/local-first-persistence.md
// @test src/__tests__/room-replica-sync.test.ts

import { useEffect } from 'react'
import { Platform } from 'react-native'
import { setRuntimeGauge } from '@shennian/shared'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { scheduleNativeBadgeSync } from '../../lib/push-badge'
import {
  applyRoomMessageToListSnapshot,
  getRoomListSnapshot,
  mergeRoomListSnapshot,
  setRoomListSnapshot,
} from './roomListCache'
import { subscribeRoomEvents } from './roomEvents'
import { RoomReplicaSyncCoordinator } from './roomReplicaSyncCoordinator'
import { removeRoomDraft } from './roomDraftStorage'
import { isAccountReplicaSyncEnabled } from '../../utils/controlSurfaceLayout'
import { compareRoomSequence } from './roomConversationUtils'

export function useRoomReplicaSync(): void {
  const accountId = useAuthStore((state) => state.user?.id ?? null)

  useEffect(() => {
    if (!accountId || !isAccountReplicaSyncEnabled(Platform.OS)) return
    let stopped = false
    const coordinator = new RoomReplicaSyncCoordinator({
      accountId,
      store: db,
      api: authApi,
      onInventory: ({ rooms, pendingRequests }) => {
        const incoming = {
          rooms: rooms as never[],
          pendingRequests,
        }
        setRoomListSnapshot(
          accountId,
          mergeRoomListSnapshot(getRoomListSnapshot(accountId), incoming),
        )
        scheduleNativeBadgeSync()
      },
      onRoomRemoved: (roomId) => removeRoomDraft(accountId, roomId),
    })
    const unsubscribe = subscribeRoomEvents((event) => {
      if (event.event === 'room.message.created') {
        applyRoomMessageToListSnapshot(accountId, event.message)
        scheduleNativeBadgeSync()
        void coordinator.ingestMessage(event.message)
        return
      }
      if (event.event === 'room.read.local') {
        const snapshot = getRoomListSnapshot(accountId)
        if (!snapshot) return
        const next = {
          ...snapshot,
          rooms: snapshot.rooms.map((room) => {
            if (room.id !== event.roomId) return room
            const lastReadSequence = compareRoomSequence(
              room.lastReadSequence ?? '0', event.lastReadSequence,
            ) > 0 ? room.lastReadSequence! : event.lastReadSequence
            return {
              ...room,
              lastReadSequence,
              unreadCount: compareRoomSequence(room.lastSequence, lastReadSequence) > 0 ? 1 : 0,
            }
          }),
        }
        setRoomListSnapshot(accountId, next)
        void db.replaceRoomSummaries(accountId, next.rooms as never[])
        scheduleNativeBadgeSync()
        return
      }
      void coordinator.requestSync({ refreshInventory: true, allRooms: true })
    })
    void (async () => {
      const [rooms, pendingRequests] = await Promise.all([
        db.getRoomSummaries(accountId),
        db.getRoomJoinRequests(accountId),
      ])
      if (stopped) return
      // SQLite is only a cold-start seed. It must never replace a newer
      // in-memory projection that survived a tab remount or received Relay data.
      if (!getRoomListSnapshot(accountId)) {
        setRoomListSnapshot(accountId, { rooms: rooms as never[], pendingRequests })
      }
      await coordinator.requestSync({ refreshInventory: true, allRooms: true })
    })().catch(() => {
      if (!stopped && !getRoomListSnapshot(accountId)) {
        setRoomListSnapshot(accountId, { rooms: [], pendingRequests: [] })
      }
      if (!stopped) void coordinator.requestSync({ refreshInventory: true, allRooms: true })
    })
    return () => {
      stopped = true
      unsubscribe()
      coordinator.stop()
      setRuntimeGauge('room_replica.pending_rooms', 0)
    }
  }, [accountId])
}
