// @arch docs/features/network-rooms/ui.md#六群聊列表
// @test src/__tests__/room-navigation.test.ts
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect } from 'expo-router'
import type { RoomSummary } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { db } from '../../storage/db'
import { scheduleNativeBadgeSync } from '../../lib/push-badge'
import { publishRoomSyncRequest } from './roomEvents'
import { getRoomListSnapshot, setRoomListSnapshot, subscribeRoomListSnapshots,
  type RoomListSnapshot, type RoomListItem } from './roomListCache'
import type { RoomMemberView } from './types'
import { removeRoomDraft } from './roomDraftStorage'
import { roomAccountClient } from './roomAccountClient'
import type { RoomListModel, RoomListModelOptions } from './useRoomListModel.types'

const EMPTY_SNAPSHOT: RoomListSnapshot = { rooms: [], pendingRequests: [] }

export function useRoomListModel({
  onOpenRoom,
  createRequestKey = 0,
}: RoomListModelOptions): RoomListModel {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const getSnapshot = useCallback(
    () => getRoomListSnapshot(accountId),
    [accountId],
  )
  const snapshot = useSyncExternalStore(subscribeRoomListSnapshots, getSnapshot, getSnapshot)
  const { rooms, pendingRequests } = snapshot ?? EMPTY_SNAPSHOT
  const [creating, setCreating] = useState(false)

  const handleCreated = useCallback(
    (room: RoomSummary) => {
      const current = getRoomListSnapshot(accountId) ?? EMPTY_SNAPSHOT
      setRoomListSnapshot(accountId, {
        ...current,
        rooms: [{
          ...room,
          latestMessage: room.latestMessage ?? null,
          avatarMembers: (room.avatarMembers ?? []) as RoomMemberView[],
        }, ...current.rooms.filter((item) => item.id !== room.id)],
      })
      publishRoomSyncRequest('tab-focused')
      onOpenRoom(room.id)
    },
    [accountId, onOpenRoom],
  )

  const load = useCallback(async () => publishRoomSyncRequest('tab-focused'), [])

  useFocusEffect(
    useCallback(() => {
      publishRoomSyncRequest('tab-focused')
    }, []),
  )

  useEffect(() => {
    if (createRequestKey > 0) setCreating(true)
  }, [createRequestKey])

  const togglePin = useCallback(
    async (room: RoomListItem) => {
      const pinned = !room.pinnedAt
      const optimistic = pinned ? new Date().toISOString() : null
      const current = getRoomListSnapshot(accountId) ?? EMPTY_SNAPSHOT
      setRoomListSnapshot(accountId, {
        ...current,
        rooms: current.rooms.map((item) => item.id === room.id
          ? { ...item, pinnedAt: optimistic }
          : item),
      })
      try {
        const pinnedAt = await roomAccountClient.updatePreference(room.id, pinned)
        const latest = getRoomListSnapshot(accountId) ?? EMPTY_SNAPSHOT
        setRoomListSnapshot(accountId, {
          ...latest,
          rooms: latest.rooms.map((item) => item.id === room.id ? { ...item, pinnedAt } : item),
        })
        publishRoomSyncRequest('tab-focused')
      } catch {
        const latest = getRoomListSnapshot(accountId) ?? EMPTY_SNAPSHOT
        setRoomListSnapshot(accountId, {
          ...latest,
          rooms: latest.rooms.map((item) => item.id === room.id ? room : item),
        })
        Alert.alert(t('spaces_pin_failed'))
      }
    },
    [accountId, t],
  )

  const removeRoom = useCallback(
    async (room: RoomListItem) => {
      const active = room.membershipStatus === 'active' && room.status === 'active'
      const previous = getRoomListSnapshot(accountId) ?? EMPTY_SNAPSHOT
      const clearedRoom = {
        ...room,
        latestMessage: null,
        unreadCount: 0,
        lastReadSequence: room.lastSequence,
      }
      setRoomListSnapshot(accountId, {
        ...previous,
        rooms: active
          ? previous.rooms.map((item) => item.id === room.id ? clearedRoom : item)
          : previous.rooms.filter((item) => item.id !== room.id),
      })
      try {
        const result = await roomAccountClient.deleteRoomRecord(room.id)
        if (accountId) {
          if (result.activeMembershipRetained) {
            const floor = result.historyFromSequence ?? (BigInt(room.lastSequence) + 1n).toString()
            await db.applyRoomHistoryFloor(accountId, room.id, floor)
            await db.upsertRoomSummary(accountId, { ...clearedRoom, historyFromSequence: floor })
          } else {
            await db.removeRoom(accountId, room.id)
            removeRoomDraft(accountId, room.id)
          }
        }
        scheduleNativeBadgeSync()
        publishRoomSyncRequest('tab-focused')
      } catch {
        setRoomListSnapshot(accountId, previous)
        Alert.alert(t('spaces_delete_failed'))
        publishRoomSyncRequest('tab-focused')
      }
    },
    [accountId, t],
  )

  return {
    accountId,
    rooms,
    pendingRequests,
    loading: snapshot === null,
    failed: false,
    creating,
    setCreating,
    handleCreated,
    retry: load,
    togglePin,
    removeRoom,
  }
}
