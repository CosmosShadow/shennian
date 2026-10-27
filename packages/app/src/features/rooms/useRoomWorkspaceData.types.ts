// @arch docs/features/desktop-local-first-client.md#33-进程职责
import type { Dispatch, SetStateAction } from 'react'
import type { RoomDetailView, RoomMemberView } from './types'
export type WorkspaceLoadState = 'loading' | 'ready' | 'unavailable' | 'failed'
export type RoomWorkspaceDataOptions = { roomId: string; currentUserId?: string }
export type RoomWorkspaceData = {
  room: RoomDetailView | null
  members: RoomMemberView[]
  membersLoaded: boolean
  loadState: WorkspaceLoadState
  hasCurrentRoom: boolean
  setMembers: Dispatch<SetStateAction<RoomMemberView[]>>
  load(options?: { preserveContent?: boolean }): Promise<void>
  cancelLoad(): void
}
