import type { RoomSummary } from '@shennian/wire'
import { authApi } from '../../config/api'

export type SentContactInvitation = {
  invitationId: string
  roomId: string
  roomName: string
  targetUserId: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  createdAt: string
  expiresAt: string | null
}

export const roomContactInvitationClient = {
  createWithoutHumanInvite(name: string) {
    return authApi<{ room: RoomSummary }>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, visibility: 'private', joinPolicy: 'closed' }),
    })
  },
  /** Invitees are added to the Room immediately; no acceptance step. */
  create(name: string, inviteeUserIds: string[], clientOperationId: string) {
    return authApi<{ room: RoomSummary; membershipId: string; invitations: Array<{
      targetUserId: string; invitationId: string | null; status: 'joined' | 'already_member' | 'declined'
    }> }>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, inviteeUserIds, clientOperationId }),
    })
  },
  listSent(targetUserId: string) {
    return authApi<{ sentInvitations: SentContactInvitation[] }>(
      `/rooms/invitations/sent?targetUserId=${encodeURIComponent(targetUserId)}`,
    )
  },
  /** Invitees are added to the Room immediately; no acceptance step. */
  inviteExisting(roomId: string, targetUserIds: string[]) {
    return authApi<{ invitations: Array<{ targetUserId: string;
      invitationId: string | null; status: 'joined' | 'already_member' | 'declined' }> }>(
      `/rooms/${encodeURIComponent(roomId)}/invitations`, {
        method: 'POST', body: JSON.stringify({ targetUserIds }),
      },
    )
  },
}
