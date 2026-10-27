// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-room-list-model.test.ts
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { getRoomListSnapshot, subscribeRoomListSnapshots } from '../rooms/roomListCache'
import type { RoomListItem } from '../rooms/roomListCache'
import type { RoomListModel, RoomListModelOptions } from '../rooms/useRoomListModel.types'
import { desktopRoomDataPort } from '../desktop-rooms/desktopRoomDataPort'
import { desktopAccountActions } from './useDesktopAccountSync'
import { DesktopRoomListModel } from './desktopRoomListModel'

export function useDesktopRoomListModel({ onOpenRoom, createRequestKey = 0 }: RoomListModelOptions): RoomListModel {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const [creating, setCreating] = useState(false)
  const controller = useMemo(() => new DesktopRoomListModel({
    initial: getRoomListSnapshot(accountId),
    isCurrent: () => accountId !== null && useAuthStore.getState().user?.id === accountId,
    read: () => accountId
      ? desktopRoomDataPort.readList(accountId)
      : Promise.reject(new Error('Desktop Room account is unavailable.')),
    subscribe: (listener) => subscribeRoomListSnapshots(() => {
      const snapshot = getRoomListSnapshot(accountId)
      if (snapshot) listener(snapshot)
    }),
    requestSync: () => desktopAccountActions.reconcile(),
    updatePreference: desktopRoomDataPort.updatePreference,
    deleteRoomRecord: desktopRoomDataPort.deleteRoomRecord,
  }), [accountId])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => controller.start(), [controller])
  useEffect(() => { setCreating(false) }, [accountId])
  useEffect(() => { if (createRequestKey > 0) setCreating(true) }, [createRequestKey])
  const togglePin = useCallback(async (room: RoomListItem) => {
    try { await controller.togglePin(room) }
    catch { if (useAuthStore.getState().user?.id === accountId) Alert.alert(t('spaces_pin_failed')) }
  }, [accountId, controller, t])
  const removeRoom = useCallback(async (room: RoomListItem) => {
    try { await controller.removeRoom(room) }
    catch { if (useAuthStore.getState().user?.id === accountId) Alert.alert(t('spaces_delete_failed')) }
  }, [accountId, controller, t])
  return { ...state, accountId, creating, setCreating, retry: controller.retry, togglePin, removeRoom,
    handleCreated: (room) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void controller.retry(true)
      onOpenRoom(room.id)
    },
  }
}
