// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test ../../__tests__/desktop-room-data-port.test.ts

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import {
  bindDesktopRoomConversationPort,
  type DesktopRoomConversationPort,
} from '../desktop-rooms/desktopRoomDataPort'
import { subscribeRoomEvents } from '../rooms/roomEvents'
import { removeRoomDraft } from '../rooms/roomDraftStorage'
import type {
  RoomConversationModel,
  RoomConversationModelOptions,
} from '../rooms/useRoomConversationModel.types'
import { DesktopRoomConversationModel } from './desktopRoomConversationModel'
import { desktopAccountActions } from './useDesktopAccountSync'

export function useDesktopRoomConversationModel({
  roomId,
  accountId,
  active,
  onNewMessages,
}: RoomConversationModelOptions): RoomConversationModel {
  const controller = useMemo(() => new DesktopRoomConversationModel({
    roomId,
    isCurrent: () => accountId !== null && useAuthStore.getState().user?.id === accountId,
    client: accountId ? bindDesktopRoomConversationPort(accountId) : signedOutPort(),
    subscribeRevision: listener => subscribeRoomEvents(event => {
      if (
        event.event === 'room.replica.updated' &&
        (event.roomId === null || event.roomId === roomId)
      ) listener()
    }),
    requestSync: async () => { await desktopAccountActions.reconcile() },
    onNewMessages,
    onForbidden: () => { if (accountId) removeRoomDraft(accountId, roomId) },
  }), [accountId, onNewMessages, roomId])
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  )
  useEffect(() => controller.start(), [controller])
  const presentedSequence = state.messages[state.messages.length - 1]?.sequence
  useEffect(
    () => controller.setPresented(active, presentedSequence),
    [active, controller, presentedSequence, state.messages],
  )
  return {
    ...state,
    setRoom: controller.setRoom,
    setMembers: controller.setMembers,
    loadInitial: controller.retry,
    loadOlderMessages: controller.loadOlderMessages,
    sendMessage: controller.sendMessage,
    isCurrent: controller.isCurrent,
  }
}

function signedOutPort(): DesktopRoomConversationPort {
  const reject = () => Promise.reject(new Error('Desktop Room account is unavailable.'))
  return {
    getRoom: reject,
    listMembers: reject,
    listMessages: reject,
    sendMessage: reject,
    updateReadState: reject,
  }
}
