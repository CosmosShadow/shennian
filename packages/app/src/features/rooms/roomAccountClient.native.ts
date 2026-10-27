// @arch docs/features/desktop-local-first-client.md#33-进程职责

import type { User } from '@shennian/shared'
import type { RoomMessageView, RoomSummary } from '@shennian/wire'
import { authApi } from '../../config/api'
import type {
  RoomAccountClient,
  RoomBrowserSession,
  RoomInitializedUpload,
  RoomInviteLink,
  RoomJoinRequest,
  MyRoomJoinRequest,
  RoomMessagePage,
  RoomNotificationPreferences,
} from './roomAccountClient.types'
import type { LinkedRoomBindingView, RoomDetailView, RoomMemberView } from './types'

export type {
  RoomBrowserSession,
  RoomInviteLink,
  RoomJoinRequest,
} from './roomAccountClient.types'
export {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
} from './roomAccountClient.types'

const segment = encodeURIComponent

export const roomAccountClient: RoomAccountClient = {
  async getSessionBinding(sessionId) {
    return (await authApi<{ binding: LinkedRoomBindingView | null }>(
      `/rooms/session/${segment(sessionId)}/binding`,
    )).binding
  },
  async listRooms() {
    return (await authApi<{ rooms: RoomSummary[] }>('/rooms?includeDirect=1')).rooms
  },
  async listMyJoinRequests() {
    return authApi<{ joinRequests: MyRoomJoinRequest[] }>('/rooms/join-requests/mine').then(
      (result) => result.joinRequests,
    )
  },
  async updatePreference(roomId, pinned) {
    return (await authApi<{ pinnedAt: string | null }>(`/rooms/${segment(roomId)}/preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    })).pinnedAt
  },
  async updateNotificationPreferences(roomId, changes) {
    const result = await authApi<RoomNotificationPreferences>(
      `/rooms/${segment(roomId)}/preferences`,
      { method: 'PATCH', body: JSON.stringify(changes) },
    )
    return {
      muteRegularNotifications: result.muteRegularNotifications ?? false,
      muteMentionNotifications: result.muteMentionNotifications ?? false,
    }
  },
  async updateCurrentUserName(name) {
    return (await authApi<{ user: User }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })).user
  },
  async createRoom(name) {
    return (await authApi<{ room: RoomSummary }>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, visibility: 'private', joinPolicy: 'open' }),
    })).room
  },
  async getRoom(roomId) {
    return authApi<{ room: RoomDetailView; membershipId: string | null }>(
      `/rooms/${segment(roomId)}`,
    )
  },
  async listMembers(roomId) {
    return (await authApi<{ memberships: RoomMemberView[] }>(
      `/rooms/${segment(roomId)}/members`,
    )).memberships
  },
  async updateRoom(roomId, changes) {
    return (await authApi<{ room: RoomDetailView }>(`/rooms/${segment(roomId)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })).room
  },
  async deleteRoom(roomId) {
    await authApi(`/rooms/${segment(roomId)}`, { method: 'DELETE' })
  },
  async deleteRoomRecord(roomId) {
    return authApi<{
      deleted: boolean
      activeMembershipRetained: boolean
      historyFromSequence: string | null
      idempotent: boolean
    }>(`/rooms/${segment(roomId)}/record`, { method: 'DELETE' })
  },
  async leaveRoom(roomId) {
    await authApi(`/rooms/${segment(roomId)}/leave`, { method: 'POST' })
  },
  async removeMember(roomId, membershipId) {
    await authApi(`/rooms/${segment(roomId)}/members/${segment(membershipId)}`, {
      method: 'DELETE',
    })
  },
  async listPendingJoinRequests(roomId) {
    return (await authApi<{ joinRequests: RoomJoinRequest[] }>(
      `/rooms/${segment(roomId)}/join-requests?status=pending`,
    )).joinRequests
  },
  async reviewJoinRequest(roomId, requestId, decision) {
    await authApi(`/rooms/${segment(roomId)}/join-requests/${segment(requestId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
  },
  async cancelJoinRequest(roomId, requestId) {
    await authApi(`/rooms/${segment(roomId)}/join-requests/${segment(requestId)}/cancel`, {
      method: 'POST',
    })
  },
  async getInviteLink(roomId) {
    return (await authApi<{ invite: RoomInviteLink }>(
      `/rooms/${segment(roomId)}/invite-link`,
    )).invite
  },
  async resetInviteLink(roomId) {
    return (await authApi<{ invite: RoomInviteLink }>(
      `/rooms/${segment(roomId)}/invite-link/reset`,
      { method: 'POST' },
    )).invite
  },
  async listBrowserSessions(roomId) {
    return (await authApi<{ sessions: RoomBrowserSession[] }>(
      `/rooms/${segment(roomId)}/browser-sessions`,
    )).sessions
  },
  async revokeBrowserSession(roomId, sessionId) {
    return (await authApi<{ status: 'revoked' | 'expired' }>(
      `/rooms/${segment(roomId)}/browser-sessions/${segment(sessionId)}`,
      { method: 'DELETE' },
    )).status
  },
  async listMessages(roomId, page) {
    const query = new URLSearchParams()
    if (page.after !== undefined) query.set('after', page.after)
    if (page.before !== undefined) query.set('before', page.before)
    if (page.limit !== undefined) query.set('limit', String(page.limit))
    return authApi<RoomMessagePage>(
      `/rooms/${segment(roomId)}/messages${query.size ? `?${query}` : ''}`,
    )
  },
  async sendMessage(roomId, message) {
    return (await authApi<{ message: RoomMessageView }>(`/rooms/${segment(roomId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    })).message
  },
  async updateReadState(roomId, lastReadSequence) {
    await authApi(`/rooms/${segment(roomId)}/read-state`, {
      method: 'POST',
      body: JSON.stringify({ lastReadSequence }),
    })
  },
  async updateAgentMode(roomId, membershipId, update) {
    return authApi(`/rooms/${segment(roomId)}/members/${segment(membershipId)}/agent-mode`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })
  },
  async recoverAgent(agentId) {
    await authApi(`/agents/${segment(agentId)}/recover`, { method: 'POST' })
  },
  async initializeAttachment(roomId, attachment) {
    return authApi<RoomInitializedUpload>(`/rooms/${segment(roomId)}/attachments/init`, {
      method: 'POST',
      body: JSON.stringify(attachment),
    })
  },
  async completeAttachment(roomId, attachmentId) {
    return authApi(`/rooms/${segment(roomId)}/attachments/${segment(attachmentId)}/complete`, {
      method: 'POST',
    })
  },
  async getAttachmentDownload(roomId, attachmentId) {
    return authApi(`/rooms/${segment(roomId)}/attachments/${segment(attachmentId)}/download`)
  },
}
