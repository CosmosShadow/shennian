// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { Dispatch, SetStateAction } from 'react'
import type { RoomMessageView } from '@shennian/wire'
import type { RoomAccountClient } from './roomAccountClient.types'
import type { RoomDetailView, RoomMemberView } from './types'
import type { RoomLoadStateValue } from './components/RoomLoadState'

export type RoomSendInput = Parameters<RoomAccountClient['sendMessage']>[1]
export interface RoomConversationModelOptions {
  roomId: string
  accountId: string | null
  networkStatus: string
  active: boolean
  onNewMessages(): void
}
export interface RoomConversationModel {
  room: RoomDetailView | null
  membershipId: string | null
  members: RoomMemberView[]
  messages: RoomMessageView[]
  hasOlder: boolean
  loadingOlder: boolean
  olderLoadFailed: boolean
  state: RoomLoadStateValue
  setRoom: Dispatch<SetStateAction<RoomDetailView | null>>
  setMembers: Dispatch<SetStateAction<RoomMemberView[]>>
  loadInitial(): Promise<void>
  loadOlderMessages(): Promise<void>
  sendMessage(input: RoomSendInput): Promise<RoomMessageView>
  isCurrent(): boolean
}
