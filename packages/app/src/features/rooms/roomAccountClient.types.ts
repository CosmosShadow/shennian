// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared'
import type { RoomActivationMode, RoomMessageView, RoomSummary } from '@shennian/wire'
import type { LinkedRoomBindingView, RoomDetailView, RoomMemberView } from './types'

export type RoomBrowserSession = {
  id: string
  clientLabel: string | null
  status: 'active' | 'expired' | 'revoked'
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  endedAt: string | null
}

export type RoomJoinRequest = {
  id: string
  applicant: { id: string; name: string }
  message: string | null
  createdAt: string
}

export type MyRoomJoinRequest = {
  id: string
  roomId: string
  roomName: string
  status: 'pending'
  createdAt: string
}

export type RoomInviteLink = {
  id: string
  status: 'active'
  expiresAt: null
  createdAt?: string
  url: string
  version: number
}

export type RoomAttachmentInitializeInput = {
  clientUploadId: string
  name: string
  mediaKind: 'image' | 'audio' | 'file'
  mimeType: string
  byteSize: number
  sha256: string
}

export type RoomInitializedUpload = {
  attachment: {
    id: string
    roomId: string
    name: string
    mimeType: string
    byteSize: string
    sha256: string
  }
  upload: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export type RoomMessagePage = {
  messages: RoomMessageView[]
  hasMore: boolean
}

export type RoomNotificationPreferences = {
  muteRegularNotifications: boolean
  muteMentionNotifications: boolean
}

export type RoomAccountClient = {
  getSessionBinding(sessionId: string): Promise<LinkedRoomBindingView | null>
  listRooms(): Promise<RoomSummary[]>
  listMyJoinRequests(): Promise<MyRoomJoinRequest[]>
  updatePreference(roomId: string, pinned: boolean): Promise<string | null>
  updateNotificationPreferences(
    roomId: string,
    changes: Partial<RoomNotificationPreferences>,
  ): Promise<RoomNotificationPreferences>
  updateCurrentUserName(name: string): Promise<User>
  createRoom(name: string): Promise<RoomSummary>
  getRoom(roomId: string): Promise<{ room: RoomDetailView; membershipId: string | null }>
  listMembers(roomId: string): Promise<RoomMemberView[]>
  updateRoom(
    roomId: string,
    changes: {
      name?: string
      visibility?: RoomDetailView['visibility']
      joinPolicy?: RoomDetailView['joinPolicy']
      maxAgentsPerMember?: number
    },
  ): Promise<RoomDetailView>
  deleteRoom(roomId: string): Promise<void>
  deleteRoomRecord(roomId: string): Promise<{
    deleted: boolean
    activeMembershipRetained: boolean
    historyFromSequence: string | null
    idempotent: boolean
  }>
  leaveRoom(roomId: string): Promise<void>
  removeMember(roomId: string, membershipId: string): Promise<void>
  listPendingJoinRequests(roomId: string): Promise<RoomJoinRequest[]>
  reviewJoinRequest(
    roomId: string,
    requestId: string,
    decision: 'approve' | 'reject',
  ): Promise<void>
  cancelJoinRequest(roomId: string, requestId: string): Promise<void>
  getInviteLink(roomId: string): Promise<RoomInviteLink>
  resetInviteLink(roomId: string): Promise<RoomInviteLink>
  listBrowserSessions(roomId: string): Promise<RoomBrowserSession[]>
  revokeBrowserSession(
    roomId: string,
    sessionId: string,
  ): Promise<'revoked' | 'expired'>
  listMessages(
    roomId: string,
    page: { after?: string; before?: string; limit?: number },
  ): Promise<RoomMessagePage>
  sendMessage(
    roomId: string,
    message: {
      clientMessageId: string
      text: string
      attachmentIds: string[]
      mentionMembershipIds: string[]
    },
  ): Promise<RoomMessageView>
  updateReadState(roomId: string, lastReadSequence: string): Promise<void>
  updateAgentMode(
    roomId: string,
    membershipId: string,
    update:
      | { activationMode: RoomActivationMode; restorePrevious?: never }
      | { activationMode?: never; restorePrevious: true },
  ): Promise<{ status: 'active' | 'paused'; activationMode: RoomActivationMode }>
  recoverAgent(agentId: string): Promise<void>
  initializeAttachment(
    roomId: string,
    attachment: RoomAttachmentInitializeInput,
  ): Promise<RoomInitializedUpload>
  completeAttachment(
    roomId: string,
    attachmentId: string,
  ): Promise<{ attachment: { attachmentId: string; status: 'ready' } }>
  getAttachmentDownload(
    roomId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string; expiresAt: string }>
}

export function isRoomAccountForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate.code === 'FORBIDDEN' || candidate.status === 403
}

export function isRoomAccountNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate.code === 'NOT_FOUND' || candidate.status === 404
}
