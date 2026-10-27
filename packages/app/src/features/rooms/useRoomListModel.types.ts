// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { Dispatch, SetStateAction } from 'react'
import type { RoomSummary } from '@shennian/wire'
import type { PendingJoinRequest, RoomListItem } from './roomListCache'

export interface RoomListModelOptions {
  onOpenRoom(roomId: string): void
  createRequestKey?: number
  activeRoomId?: string | null
}

export interface RoomListModel {
  accountId: string | null
  rooms: RoomListItem[]
  pendingRequests: PendingJoinRequest[]
  loading: boolean
  failed: boolean
  creating: boolean
  setCreating: Dispatch<SetStateAction<boolean>>
  handleCreated(room: RoomSummary): void
  retry(silent?: boolean): Promise<void>
  togglePin(room: RoomListItem): Promise<void>
  removeRoom(room: RoomListItem): Promise<void>
}
