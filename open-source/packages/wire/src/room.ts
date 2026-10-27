// @arch open-source/docs/wire.md
// @test src/__tests__/room.test.ts

import { isAvailableAgentType, type AgentType } from './session.ts'

export type RoomVisibility = 'private' | 'public_read'
export type RoomJoinPolicy = 'open' | 'approval' | 'closed'
export type RoomStatus = 'active' | 'archived' | 'deleted'
export type ConversationKind = 'group' | 'published_ai' | 'work'
export type RoomPrincipalType = 'human' | 'agent'
export type RoomMembershipRole = 'owner' | 'admin' | 'member'
export type RoomMembershipStatus = 'active' | 'removed' | 'left'
export type RoomMessageKind = 'text' | 'attachment' | 'mixed' | 'system'
export type RoomActivationMode = 'auto_follow' | 'mention_only' | 'paused'
/** Runtime reachability is orthogonal to the owner's persisted activation mode. */
export type AgentRuntimeAvailability = 'available' | 'unavailable' | 'recovering'
export type AgentRepairAction = 'configure' | 'retry' | null
export type RoomAgentParticipation = {
  activationMode: RoomActivationMode
  availability: AgentRuntimeAvailability
}
export type RoomActivationCapability = 'managed' | 'idle_resume' | 'notify_only'
export type RoomBindingMode = 'managed' | 'hook_native'
export type RoomBindingStatus = 'pending_approval' | 'active' | 'paused' | 'detached'
/** `claude_code` is accepted only as a legacy wire value. New writers use the real AgentType. */
export type RoomRuntimeAdapter = Exclude<AgentType, 'manager' | 'pi' | 'openclaw'> | 'claude_code'
export type RoomAttachmentKind = 'image' | 'audio' | 'video' | 'file'
export type RoomAttachmentStatus =
  | 'pending'
  | 'uploaded'
  | 'scanning'
  | 'ready'
  | 'rejected'
  | 'expired'
  | 'deleted'

/** JSON-safe representation of the database BIGINT sequence. */
export type RoomSequence = string

export function roomRuntimeAgentType(value: string): AgentType | null {
  if (value === 'claude_code') return 'claude'
  if (
    !isAvailableAgentType(value) ||
    value === 'manager' ||
    value === 'pi' ||
    value === 'openclaw'
  ) {
    return null
  }
  return value
}

export function isRoomRuntimeAdapter(value: string): value is RoomRuntimeAdapter {
  return roomRuntimeAgentType(value) !== null
}

export function roomRuntimeAdapterForAgent(agentType: AgentType): RoomRuntimeAdapter | null {
  return roomRuntimeAgentType(agentType) ? (agentType as RoomRuntimeAdapter) : null
}

export type RoomSummary = {
  id: string
  name: string
  /** One canonical Room model; older servers omit this additive discriminator. */
  conversationKind?: ConversationKind
  status: RoomStatus
  visibility: RoomVisibility
  joinPolicy: RoomJoinPolicy
  humanCount: number
  agentCount: number
  lastSequence: RoomSequence
  /** First sequence still visible to this account. Older servers may omit it. */
  historyFromSequence?: RoomSequence
  lastReadSequence?: RoomSequence
  unreadCount?: number
  membershipRole?: RoomMembershipRole
  /** The signed-in human's relationship to this Room. Older servers may omit it. */
  membershipStatus?: 'active' | 'left' | 'removed'
  pinnedAt?: string | null
  /** Account-scoped Room notification preferences. Older servers omit these fields. */
  muteRegularNotifications?: boolean
  muteMentionNotifications?: boolean
  updatedAt: string
  /** Optional list projection used by local-first clients to avoid per-room requests. */
  latestMessage?: RoomMessageView | null
  /** Compact active-member projection for the list avatar. */
  avatarMembers?: Array<{
    id: string
    principalType: RoomPrincipalType
    displayAlias: string
    /** Stable membership ordering key; older servers may omit it. */
    joinedAt?: string
    avatar?: Record<string, unknown> | null
    ownerAvatar?: Record<string, unknown> | null
  }>
}

/** Targeted Room invitation grants no membership or message history until accepted. */
export type RoomTargetedInvitationView = {
  invitationId: string
  roomId: string
  roomName: string
  inviterUserId: string
  inviterName: string
  status: 'pending'
  createdAt: string
  expiresAt: string
}

export type RoomTargetedInvitationResponse = {
  roomId: string
  status: 'accepted' | 'declined'
  membershipId: string | null
  idempotent: boolean
}

export type RoomSentInvitationView = {
  invitationId: string
  roomId: string
  roomName: string
  targetUserId: string
  status: 'pending' | 'accepted' | 'declined' | 'expired'
  createdAt: string
  expiresAt: string | null
}

export type RoomAuthorSnapshot = {
  membershipId: string
  principalType: RoomPrincipalType
  ownerUserId: string
  displayName: string
  ownerDisplayName?: string | null
  avatar?: Record<string, unknown> | null
}

export type RoomMentionSnapshot = {
  membershipId: string
  principalType: RoomPrincipalType
  displayName: string
}

export type RoomAttachmentView = {
  attachmentId: string
  mediaKind: RoomAttachmentKind
  name: string
  mimeType: string
  byteSize: RoomSequence
  sha256: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  status: RoomAttachmentStatus
  /** Authoritative object-retention deadline. Older servers may omit it. */
  expiresAt?: string | null
  downloadRef: string
  /** Binding-scoped bearer link for direct, on-demand download by an Agent. */
  downloadUrl?: string
  downloadExpiresAt?: string
}

export type RoomMessageView = {
  id: string
  roomId: string
  sequence: RoomSequence
  kind: RoomMessageKind
  source?: 'app' | 'cli' | 'managed_agent' | 'system'
  /** Public AI execution state; absent for ordinary Room messages and older servers. */
  deliveryStatus?: 'pending' | 'running' | 'answered' | 'failed' | 'cancelled' | 'sent'
    | 'queued' | 'committed' | 'executing' | 'completed' | null
  author: RoomAuthorSnapshot
  mentions?: RoomMentionSnapshot[]
  text?: string | null
  replyToMessageId?: string | null
  attachments: RoomAttachmentView[]
  createdAt: string
  editedAt?: string | null
  deletedAt?: string | null
  activationCause?: {
    causeMessageId: string
    rootCauseMessageId: string
    hopCount: number
  } | null
  /** Structured meaning for server-authored Room timeline events. Older servers omit it. */
  systemEvent?: {
    type:
      | 'membership_joined'
      | 'membership_left'
      | 'membership_removed'
      | 'room_renamed'
      | 'binding_mode_changed'
      | 'agent_unavailable'
    subjectMembershipId?: string
    subjectPrincipalType?: RoomPrincipalType
  } | null
}

export type RoomMessageCreatedEvent = {
  event: 'room.message.created'
  roomId: string
  sequence: RoomSequence
  message: RoomMessageView
}

export type RoomRefreshEvent = {
  event:
    | 'room.created'
    | 'room.updated'
    | 'room.membership.updated'
    | 'room.join_request.created'
    | 'room.join_request.updated'
    | 'room.binding.updated'
  roomId: string
  sequence?: RoomSequence
  entityId?: string
}

export type RoomEvent = RoomMessageCreatedEvent | RoomRefreshEvent

export type RoomSyncParams = {
  roomId: string
  afterSequence: RoomSequence
  limit?: number
}

/** Public Skill + CLI read contract. It intentionally omits Room and membership IDs. */
export type RoomCliReadParams = {
  before?: RoomSequence
  after?: RoomSequence
  limit?: number
}

export type RoomCliAttachmentView = {
  attachmentId: string
  mediaKind: RoomAttachmentKind
  name: string
  mimeType: string
  byteSize: RoomSequence
  sha256: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  status: RoomAttachmentStatus
  downloaded?: boolean
  localPath?: string | null
}

export type RoomCliMessageView = {
  sequence: RoomSequence
  kind: RoomMessageKind
  source: 'app' | 'cli' | 'managed_agent' | 'system'
  author: {
    nickname: string
    type: RoomPrincipalType
    ownerNickname?: string
    avatar?: Record<string, unknown> | null
  }
  mentions: Array<{ nickname: string; type: RoomPrincipalType }>
  text: string | null
  attachments: RoomCliAttachmentView[]
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

export type RoomCliReadResult = { messages: RoomCliMessageView[] }

export type RoomSendParams = {
  roomId: string
  clientMessageId: string
  text?: string
  mentionMembershipIds?: string[]
  attachmentIds?: string[]
  replyToMessageId?: string
  bindingId?: string
}

export type RoomBindParams = {
  roomId: string
  agentIdentityId: string
  invocationToken: string
  activationCapability?: RoomActivationCapability
  activationMode?: RoomActivationMode
}

export type RoomUnbindParams = {
  bindingId: string
}
