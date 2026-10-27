// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/desktop-room-conversation-model.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import { DesktopRoomConversationModel } from '../desktop-control/desktopRoomConversationModel'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { roomAccountClient } from './roomAccountClient.web'
import { subscribeRoomEvents } from './roomEvents'
import { removeRoomDraft } from './roomDraftStorage'
import type { RoomConversationModel, RoomConversationModelOptions } from './useRoomConversationModel.types'

export function useRoomConversationModel({ roomId, accountId, active, onNewMessages }: RoomConversationModelOptions): RoomConversationModel {
  const controller = useMemo(() => new DesktopRoomConversationModel({
    roomId,
    isCurrent: () => accountId !== null && useAuthStore.getState().user?.id === accountId,
    client: roomAccountClient,
    subscribeRevision: (listener) => subscribeRoomEvents((event) => {
      if (event.event === 'room.replica.updated' && (event.roomId === null || event.roomId === roomId)) listener()
    }),
    requestSync: async () => { await desktopAccountActions.reconcile() },
    onNewMessages,
    onForbidden: () => { if (accountId) removeRoomDraft(accountId, roomId) },
  }), [accountId, onNewMessages, roomId])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => controller.start(), [controller])
  const presentedSequence = state.messages[state.messages.length - 1]?.sequence
  useEffect(() => controller.setPresented(active, presentedSequence), [active, controller, presentedSequence, state.messages])
  return { ...state, setRoom: controller.setRoom, setMembers: controller.setMembers,
    loadInitial: controller.retry, loadOlderMessages: controller.loadOlderMessages,
    sendMessage: controller.sendMessage, isCurrent: controller.isCurrent }
}
