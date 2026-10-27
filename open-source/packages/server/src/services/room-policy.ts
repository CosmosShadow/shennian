// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-policy.test.ts

import type {
  RoomJoinPolicy,
  RoomMembershipRole,
  RoomPrincipalType,
  RoomVisibility,
} from '@shennian/wire'

export const DEFAULT_ROOM_LIMITS = Object.freeze({
  maxHumanMembers: 1_000,
  maxAgentsPerUser: 1,
  maxAgentsPerRoom: 20,
  maxAutoFollowAgents: 3,
})

export type RoomLimits = {
  maxHumanMembers: number
  maxAgentsPerUser: number
  maxAgentsPerRoom: number
  maxAutoFollowAgents: number
}

export class RoomPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomPolicyError'
  }
}

export type MembershipIdentityInput = {
  principalType: RoomPrincipalType
  userId?: string | null
  agentIdentityId?: string | null
  ownerUserId: string
  parentHumanMembershipId?: string | null
}

export function buildRoomPrincipalKey(input: MembershipIdentityInput): string {
  if (input.principalType === 'human') {
    if (!input.userId || input.agentIdentityId || input.parentHumanMembershipId) {
      throw new RoomPolicyError(
        'invalid_human_membership',
        'Human membership requires only userId and cannot have a parent membership.',
      )
    }
    if (input.ownerUserId !== input.userId) {
      throw new RoomPolicyError(
        'invalid_human_owner',
        'Human membership owner must be the same user.',
      )
    }
    return `human:${input.userId}`
  }

  if (!input.agentIdentityId || input.userId || !input.parentHumanMembershipId) {
    throw new RoomPolicyError(
      'invalid_agent_membership',
      'Agent membership requires only agentIdentityId and an active parent human membership.',
    )
  }
  return `agent:${input.agentIdentityId}`
}

export function buildPendingJoinKey(roomId: string, applicantUserId: string): string {
  if (!roomId || !applicantUserId) {
    throw new RoomPolicyError('invalid_pending_join_key', 'Room and applicant are required.')
  }
  return `${roomId}:${applicantUserId}`
}

export function assertHumanRoomCapacity(input: {
  activeHumanCount: number
  maxHumanMembers?: number
}): void {
  const maxHumanMembers = input.maxHumanMembers ?? DEFAULT_ROOM_LIMITS.maxHumanMembers
  if (input.activeHumanCount >= maxHumanMembers) {
    throw new RoomPolicyError(
      'room_human_limit_reached',
      'This Room has reached the human member limit.',
    )
  }
}

export function normalizeRoomMemberAgentLimit(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 5) {
    throw new RoomPolicyError(
      'invalid_member_agent_limit',
      'The per-member Agent limit must be an integer between 0 and 5.',
    )
  }
  return value as number
}

export function canReviewJoinRequest(role: RoomMembershipRole, active: boolean): boolean {
  return active && role === 'owner'
}

export function canRemoveMembership(input: {
  actorRole: RoomMembershipRole
  actorActive: boolean
  actorOwnerUserId?: string
  targetRole: RoomMembershipRole
  targetPrincipalType: RoomPrincipalType
  targetOwnerUserId?: string
}): boolean {
  if (!input.actorActive || input.targetRole === 'owner') return false
  if (
    input.targetPrincipalType === 'agent' &&
    input.actorOwnerUserId &&
    input.actorOwnerUserId === input.targetOwnerUserId
  ) {
    return true
  }
  if (input.actorRole === 'owner') return true
  return false
}

export function resolveInviteJoinResult(input: {
  roomStatus: 'active' | 'archived' | 'deleted'
  visibility: RoomVisibility
  joinPolicy: RoomJoinPolicy
  inviteActive: boolean
  inviteExpired: boolean
  inviteUseCount: number
  inviteMaxUses?: number | null
}): 'joined' | 'pending_approval' | 'closed' {
  if (
    input.roomStatus !== 'active' ||
    !input.inviteActive ||
    input.inviteExpired ||
    (input.inviteMaxUses != null && input.inviteUseCount >= input.inviteMaxUses)
  ) {
    return 'closed'
  }
  if (input.joinPolicy === 'open') return 'joined'
  if (input.joinPolicy === 'approval') return 'pending_approval'
  return 'closed'
}
