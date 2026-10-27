// @arch docs/features/network-rooms/ui.md
// @test src/__tests__/room-presentation.test.ts

import type {
  AgentRepairAction,
  AgentRuntimeAvailability,
  RoomActivationMode,
  RoomMessageView,
  RoomPrincipalType,
} from '@shennian/wire'

export type PublicAvatar = {
  version: string
  smallUrl: string
  mediumUrl: string
  updatedAt: string
}

export type RoomMemberView = {
  id: string
  agentIdentityId?: string | null
  principalType: RoomPrincipalType
  ownerUserId: string
  parentHumanMembershipId: string | null
  displayAlias: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  avatar: PublicAvatar | null
  ownerAvatar: PublicAvatar | null
  ownerDisplayName?: string | null
  description?: string
  /** Safe participation projection visible to every active Room member. */
  agentParticipation?: {
    activationMode: RoomActivationMode
    availability: AgentRuntimeAvailability
  }
  ownBinding?: {
    agentMembershipId: string | null
    agentIdentityId?: string
    nianSessionId: string | null
    status: 'pending_approval' | 'active' | 'paused' | 'detached'
    activationMode: RoomActivationMode
    availability?: AgentRuntimeAvailability
    repairAction?: AgentRepairAction
    lastMessagePreview: string | null
  } | null
}

export type RoomDetailView = {
  id: string
  conversationKind?: 'group' | 'published_ai' | 'work'
  name: string
  description: string
  status: 'active' | 'archived' | 'deleted'
  visibility: 'private' | 'public_read'
  joinPolicy: 'open' | 'approval' | 'closed'
  lastSequence: string
  historyFromSequence: string
  historyThroughSequence?: string | null
  membershipStatus?: 'active' | 'left' | 'removed' | null
  /** Missing on older servers and therefore treated as false by clients. */
  muteRegularNotifications?: boolean
  muteMentionNotifications?: boolean
  limits?: {
    maxHumanMembers: number
    maxAgentsPerMember: number
    maxAgentsPerRoom: number
    maxAutoFollowAgents: number
  }
}

export type RoomConversationData = {
  room: RoomDetailView
  membershipId: string | null
  messages: RoomMessageView[]
  members: RoomMemberView[]
}

export type LinkedRoomBindingView = {
  id: string
  status: 'pending_approval' | 'active' | 'paused' | 'detached'
  activationMode: 'auto_follow' | 'mention_only' | 'paused'
  agentDisplayName: string
  room: Pick<RoomDetailView, 'id' | 'name' | 'status'>
}
