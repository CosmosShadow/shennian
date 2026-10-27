// @covers open-source/packages/server/src/services/room-policy.ts

import { describe, expect, it } from 'vitest'
import {
  assertHumanRoomCapacity,
  buildPendingJoinKey,
  buildRoomPrincipalKey,
  canRemoveMembership,
  canReviewJoinRequest,
  resolveInviteJoinResult,
  RoomPolicyError,
} from '../services/room-policy.ts'

describe('Room membership identity', () => {
  it('builds server-owned principal keys for humans and agents', () => {
    expect(
      buildRoomPrincipalKey({
        principalType: 'human',
        userId: 'user_1',
        ownerUserId: 'user_1',
      }),
    ).toBe('human:user_1')
    expect(
      buildRoomPrincipalKey({
        principalType: 'agent',
        agentIdentityId: 'agent_1',
        ownerUserId: 'user_1',
        parentHumanMembershipId: 'member_1',
      }),
    ).toBe('agent:agent_1')
  })

  it('rejects mixed, orphaned, or impersonating principals', () => {
    expect(() =>
      buildRoomPrincipalKey({
        principalType: 'human',
        userId: 'user_1',
        agentIdentityId: 'agent_1',
        ownerUserId: 'user_1',
      }),
    ).toThrow(RoomPolicyError)
    expect(() =>
      buildRoomPrincipalKey({
        principalType: 'agent',
        agentIdentityId: 'agent_1',
        ownerUserId: 'user_1',
      }),
    ).toThrow(/parent human membership/)
    expect(() =>
      buildRoomPrincipalKey({
        principalType: 'human',
        userId: 'user_1',
        ownerUserId: 'user_2',
      }),
    ).toThrow(/same user/)
  })

  it('uses a unique pending key only while a request is pending', () => {
    expect(buildPendingJoinKey('room_1', 'user_1')).toBe('room_1:user_1')
  })
})

describe('Room permission and limits', () => {
  it('lets only the active creator-owner review join requests', () => {
    expect(canReviewJoinRequest('owner', true)).toBe(true)
    expect(canReviewJoinRequest('admin', true)).toBe(false)
    expect(canReviewJoinRequest('member', true)).toBe(false)
    expect(canReviewJoinRequest('owner', false)).toBe(false)
  })

  it('protects the owner, gives no admin power, and lets users remove their own Agents', () => {
    expect(
      canRemoveMembership({
        actorRole: 'owner',
        actorActive: true,
        targetRole: 'owner',
        targetPrincipalType: 'human',
      }),
    ).toBe(false)
    expect(
      canRemoveMembership({
        actorRole: 'admin',
        actorActive: true,
        targetRole: 'admin',
        targetPrincipalType: 'human',
      }),
    ).toBe(false)
    expect(
      canRemoveMembership({
        actorRole: 'admin',
        actorActive: true,
        actorOwnerUserId: 'user_admin',
        targetRole: 'member',
        targetPrincipalType: 'agent',
        targetOwnerUserId: 'user_other',
      }),
    ).toBe(false)
    expect(
      canRemoveMembership({
        actorRole: 'member',
        actorActive: true,
        actorOwnerUserId: 'user_1',
        targetRole: 'member',
        targetPrincipalType: 'agent',
        targetOwnerUserId: 'user_1',
      }),
    ).toBe(true)
  })

  it('caps human members', () => {
    expect(() => assertHumanRoomCapacity({ activeHumanCount: 999 })).not.toThrow()
    expect(() => assertHumanRoomCapacity({ activeHumanCount: 1_000 })).toThrowError(
      expect.objectContaining({ code: 'room_human_limit_reached' }),
    )
  })
})

describe('Room invite policy', () => {
  it('keeps visibility separate from join policy', () => {
    expect(
      resolveInviteJoinResult({
        roomStatus: 'active',
        visibility: 'public_read',
        joinPolicy: 'approval',
        inviteActive: true,
        inviteExpired: false,
        inviteUseCount: 0,
      }),
    ).toBe('pending_approval')
  })

  it('closes revoked, expired, exhausted, archived, and closed invites', () => {
    expect(
      resolveInviteJoinResult({
        roomStatus: 'active',
        visibility: 'private',
        joinPolicy: 'open',
        inviteActive: true,
        inviteExpired: false,
        inviteUseCount: 1,
        inviteMaxUses: 1,
      }),
    ).toBe('closed')
  })
})
