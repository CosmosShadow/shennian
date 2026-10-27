// @covers open-source/packages/server/src/services/room-membership.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    room: { update: vi.fn(), findUnique: vi.fn() },
    roomInvite: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    roomInviteBrowserState: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    roomJoinRequest: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    roomMembership: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    roomReadState: { create: vi.fn(), upsert: vi.fn() },
    roomMessage: { create: vi.fn() },
    roomBinding: { count: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/room-session-cleanup.js', () => ({
  commitExclusiveRoomSessionDeletions: vi.fn(async (_tx, targets) => targets),
}))

import {
  cancelRoomJoinRequest,
  createRoomInvite,
  deleteRoomRecord,
  getHumanRoomInviteEntryState,
  getCanonicalRoomInvite,
  joinRoomFromBrowserState,
  joinOpenRoomFromLink,
  leaveRoom,
  normalizeInviteOptions,
  normalizeJoinMessage,
  reviewRoomJoinRequest,
  resetCanonicalRoomInvite,
  revokeRoomInvite,
} from '../services/room-membership.js'

const now = new Date('2026-08-23T08:00:00.000Z')
const room = {
  id: 'room_1',
  createdByUserId: 'owner_1',
  inviteVersion: 1,
  status: 'active',
  visibility: 'private',
  joinPolicy: 'approval',
  nextSequence: 4n,
  ownerUserId: 'owner_1',
  maxHumanMembers: 1_000,
  maxAgentsPerUser: 8,
  maxAgentsPerRoom: 32,
  maxAutoFollowAgents: 8,
  updatedAt: new Date('2026-08-23T07:00:00.000Z'),
}
const owner = {
  id: 'member_owner',
  roomId: 'room_1',
  principalType: 'human',
  status: 'active',
  role: 'owner',
  ownerUserId: 'owner_1',
  displayAlias: 'Owner',
  membershipEpoch: 1,
  room,
}
const invite = {
  id: 'invite_1',
  roomId: 'room_1',
  status: 'active',
  expiresAt: new Date('2026-08-30T00:00:00.000Z'),
  maxUses: 20,
  useCount: 0,
  requestCount: 0,
  room,
}
const browserState = {
  id: 'state_1',
  status: 'active',
  expiresAt: new Date('2026-08-23T08:15:00.000Z'),
  invite,
}
const membership = {
  id: 'member_2',
  roomId: 'room_1',
  principalType: 'human',
  status: 'active',
  role: 'member',
  ownerUserId: 'user_2',
  displayAlias: 'Alice',
  membershipEpoch: 1,
}

describe('Room membership lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_2', name: 'Alice' })
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 5n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'system_1' })
    mockPrisma.roomMembership.create.mockResolvedValue(membership)
    mockPrisma.roomMembership.update.mockResolvedValue({ ...membership, membershipEpoch: 2 })
    mockPrisma.roomMembership.findMany.mockResolvedValue([])
    mockPrisma.roomMembership.count.mockResolvedValue(0)
    mockPrisma.roomMembership.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomReadState.upsert.mockResolvedValue({})
    mockPrisma.roomReadState.create.mockResolvedValue({})
    mockPrisma.roomBinding.count.mockResolvedValue(0)
    mockPrisma.roomBinding.update.mockResolvedValue({})
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.roomInvite.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...invite,
        ...(data.status ? { status: data.status } : {}),
      }),
    )
    mockPrisma.roomInvite.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomInviteBrowserState.update.mockResolvedValue({})
    mockPrisma.roomInviteBrowserState.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    mockPrisma.roomJoinRequest.updateMany.mockResolvedValue({ count: 1 })
  })

  it('normalizes safe invitation and application inputs', () => {
    expect(normalizeInviteOptions({})).toEqual({ expiresInDays: 7, maxUses: null })
    expect(normalizeInviteOptions({ maxUses: null })).toEqual({ expiresInDays: 7, maxUses: null })
    expect(normalizeJoinMessage('  hello  ')).toBe('hello')
    expect(() => normalizeInviteOptions({ expiresInDays: 31 })).toThrow(/between 1 and 30/)
    expect(() => normalizeInviteOptions({ maxUses: 101 })).toThrow(/between 1 and 100/)
    expect(() => normalizeJoinMessage('x'.repeat(501))).toThrow(/too long/)
  })

  it('recognizes an existing active member before showing the native join action', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ status: 'active' })

    await expect(
      getHumanRoomInviteEntryState({ roomId: 'room_1', userId: 'user_2' }),
    ).resolves.toBe('joined')
    expect(mockPrisma.roomJoinRequest.findUnique).toHaveBeenCalledWith({
      where: { pendingKey: 'room_1:user_2' },
      select: { status: true },
    })
  })

  it('recognizes an existing pending request and otherwise allows the join form', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({ status: 'pending' })
    await expect(
      getHumanRoomInviteEntryState({ roomId: 'room_1', userId: 'user_2' }),
    ).resolves.toBe('pending_approval')

    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    await expect(
      getHumanRoomInviteEntryState({ roomId: 'room_1', userId: 'user_2' }),
    ).resolves.toBe('can_join')
  })

  it('lets only an active owner/admin create a hashed, expiring invitation', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.roomInvite.create.mockResolvedValue({ ...invite, tokenHash: 'a'.repeat(64) })

    const result = await createRoomInvite({
      roomId: 'room_1',
      actorUserId: 'owner_1',
      expiresInDays: 3,
      maxUses: 5,
      now,
    })

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mockPrisma.roomInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 'room_1',
        createdByUserId: 'owner_1',
        maxUses: 5,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: new Date('2026-08-26T08:00:00.000Z'),
      }),
    })
    expect(JSON.stringify(mockPrisma.roomInvite.create.mock.calls)).not.toContain(result.rawToken)
  })

  it('creates one permanent canonical invitation without persisting its raw token', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.roomInvite.findUnique.mockResolvedValue(null)
    mockPrisma.roomInvite.create.mockImplementation(async ({ data }) => ({
      id: 'invite_canonical_1',
      status: 'active',
      ...data,
    }))

    const result = await getCanonicalRoomInvite({ roomId: 'room_1', actorUserId: 'owner_1' })

    expect(result.version).toBe(1)
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mockPrisma.roomInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 'room_1',
        createdByUserId: 'owner_1',
        expiresAt: null,
        maxUses: null,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
    expect(JSON.stringify(mockPrisma.roomInvite.create.mock.calls)).not.toContain(result.rawToken)
  })

  it('lets every active human member retrieve the shared canonical invitation', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ ...membership, room })
    mockPrisma.roomInvite.findUnique.mockResolvedValue({
      id: 'invite_canonical_1',
      status: 'active',
      tokenCiphertext: 'encrypted',
    })

    await getCanonicalRoomInvite({ roomId: 'room_1', actorUserId: 'user_2' })

    expect(mockPrisma.roomMembership.findUnique).toHaveBeenCalledWith({
      where: { roomId_principalKey: { roomId: 'room_1', principalKey: 'human:user_2' } },
      include: { room: true },
    })
  })

  it('never reactivates a revoked canonical capability when the management page reloads', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.roomInvite.findUnique.mockResolvedValue({
      id: 'invite_canonical_revoked',
      status: 'revoked',
    })
    mockPrisma.room.update.mockResolvedValue({ ...room, inviteVersion: 2 })
    mockPrisma.roomInvite.create.mockResolvedValue({ id: 'invite_canonical_2', status: 'active' })

    const result = await getCanonicalRoomInvite({ roomId: 'room_1', actorUserId: 'owner_1' })

    expect(result.version).toBe(2)
    expect(mockPrisma.roomInvite.update).not.toHaveBeenCalled()
    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: { inviteVersion: { increment: 1 } },
    })
  })

  it('resets the canonical invitation by revoking the old capability and incrementing its version', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.room.update.mockResolvedValue({ ...room, inviteVersion: 2 })
    mockPrisma.roomInvite.create.mockResolvedValue({ id: 'invite_canonical_2', status: 'active' })

    const result = await resetCanonicalRoomInvite({
      roomId: 'room_1',
      actorUserId: 'owner_1',
      now,
    })

    expect(result.version).toBe(2)
    expect(mockPrisma.room.update).toHaveBeenCalledWith({
      where: { id: 'room_1' },
      data: { inviteVersion: { increment: 1 } },
    })
    expect(mockPrisma.roomInviteBrowserState.updateMany).toHaveBeenCalledWith({
      where: { invite: { roomId: 'room_1' }, status: 'active' },
      data: { status: 'revoked' },
    })
    expect(mockPrisma.roomInvite.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'room_1', status: 'active', targetUserId: null },
      data: { status: 'revoked', revokedAt: now },
    })
  })

  it('rejects resetting a stale canonical invitation version', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)

    await expect(resetCanonicalRoomInvite({
      roomId: 'room_1',
      actorUserId: 'owner_1',
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'room_invite_version_conflict' })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('returns the current invitation for an idempotent reset retry', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...owner,
      room: { ...room, inviteVersion: 2 },
    })
    mockPrisma.roomInvite.findUnique.mockResolvedValue({ id: 'invite_canonical_2', status: 'active' })

    await expect(resetCanonicalRoomInvite({
      roomId: 'room_1',
      actorUserId: 'owner_1',
      expectedVersion: 1,
    })).resolves.toMatchObject({ version: 2, idempotent: true })
    expect(mockPrisma.room.update).not.toHaveBeenCalled()
  })

  it('joins an open Room atomically and consumes an invite use only after membership activation', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      ...browserState,
      invite: { ...invite, room: { ...room, joinPolicy: 'open' } },
    })
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomMembership.count.mockResolvedValue(999)

    const result = await joinRoomFromBrowserState({
      browserState: 's'.repeat(43),
      applicantUserId: 'user_2',
      now,
    })

    expect(result).toMatchObject({ outcome: 'joined', roomId: 'room_1', idempotent: false })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ principalKey: 'human:user_2', historyFromSequence: 5n }),
    })
    expect(mockPrisma.roomReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ lastReadSequence: 4n, lastDeliveredSequence: 4n }),
      }),
    )
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'system',
        clientMessageId: 'system:membership-joined:member_2:1',
      }),
    })
    expect(mockPrisma.roomInvite.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite_1', status: 'active', useCount: { lt: 20 } },
      data: { useCount: { increment: 1 } },
    })
    expect(mockPrisma.roomInviteBrowserState.update).toHaveBeenCalledWith({
      where: { id: 'state_1' },
      data: { status: 'consumed', consumedAt: now, lastSeenAt: now },
    })
  })

  it('joins from a shared stable link only while the conversation is open', async () => {
    mockPrisma.room.findUnique.mockResolvedValue({ ...room, joinPolicy: 'open' })
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    await expect(joinOpenRoomFromLink({ roomId: 'room_1', userId: 'user_2', now }))
      .resolves.toMatchObject({ joined: true, membership: { id: 'member_2' } })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma))
    mockPrisma.room.findUnique.mockResolvedValue({ ...room, joinPolicy: 'closed' })
    await expect(joinOpenRoomFromLink({ roomId: 'room_1', userId: 'user_2', now }))
      .rejects.toMatchObject({ code: 'room_join_unavailable' })
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
  })

  it('lets an existing member enter before applying the closed policy for newcomers', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      ...browserState,
      invite: { ...invite, room: { ...room, joinPolicy: 'closed' } },
    })
    mockPrisma.roomMembership.findUnique.mockResolvedValue(membership)

    await expect(
      joinRoomFromBrowserState({
        browserState: 's'.repeat(43),
        applicantUserId: 'user_2',
        now,
      }),
    ).resolves.toMatchObject({ outcome: 'joined', membership, idempotent: true })
    expect(mockPrisma.roomInviteBrowserState.update).toHaveBeenCalledWith({
      where: { id: 'state_1' },
      data: { status: 'consumed', consumedAt: now, lastSeenAt: now },
    })
  })

  it('rejects a new human before creating membership when the Room already has 1,000 people', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      ...browserState,
      invite: { ...invite, room: { ...room, joinPolicy: 'open' } },
    })
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomMembership.count.mockResolvedValue(1_000)

    await expect(
      joinRoomFromBrowserState({
        browserState: 's'.repeat(43),
        applicantUserId: 'user_2',
        now,
      }),
    ).rejects.toMatchObject({ code: 'room_human_limit_reached' })
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
  })

  it('creates one pending request for approval without consuming invite capacity', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue(browserState)
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomJoinRequest.create.mockResolvedValue({ id: 'request_1', status: 'pending' })

    const result = await joinRoomFromBrowserState({
      browserState: 's'.repeat(43),
      applicantUserId: 'user_2',
      message: 'Please add me',
      now,
    })

    expect(result).toMatchObject({ outcome: 'pending_approval', idempotent: false })
    expect(mockPrisma.roomJoinRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pendingKey: 'room_1:user_2', message: 'Please add me' }),
    })
    expect(mockPrisma.roomInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite_1' },
      data: { requestCount: { increment: 1 } },
    })
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomInvite.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { useCount: { increment: 1 } },
      }),
    )
  })

  it('requires a short introduction before creating an approval request', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue(browserState)
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)

    await expect(
      joinRoomFromBrowserState({
        browserState: 's'.repeat(43),
        applicantUserId: 'user_2',
        message: '   ',
        now,
      }),
    ).rejects.toMatchObject({ code: 'join_message_required' })
    expect(mockPrisma.roomJoinRequest.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomInviteBrowserState.update).not.toHaveBeenCalled()
  })

  it('recovers a concurrent duplicate application as the same pending request', async () => {
    mockPrisma.$transaction
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) =>
        callback(mockPrisma),
      )
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue(browserState)
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_winner',
      roomId: 'room_1',
      applicantUserId: 'user_2',
      status: 'pending',
    })

    await expect(
      joinRoomFromBrowserState({
        browserState: 's'.repeat(43),
        applicantUserId: 'user_2',
        now,
      }),
    ).resolves.toMatchObject({
      outcome: 'pending_approval',
      joinRequest: { id: 'request_winner' },
      idempotent: true,
    })
    expect(mockPrisma.roomInviteBrowserState.update).toHaveBeenCalledWith({
      where: { id: 'state_1' },
      data: { status: 'consumed', consumedAt: now, lastSeenAt: now },
    })
  })

  it('rejects a cookie for a different room before either joining or recovering a consumed action', async () => {
    for (const status of ['active', 'consumed']) {
      mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({ ...browserState, status })
      await expect(
        joinRoomFromBrowserState({
          browserState: 'b'.repeat(43),
          applicantUserId: 'user_2',
          expectedRoomId: 'room_other',
          now,
        }),
      ).rejects.toMatchObject({ code: 'room_invite_unavailable' })
    }
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomJoinRequest.create).not.toHaveBeenCalled()
  })

  it('returns the same result when a successful browser action retries after its state was consumed', async () => {
    mockPrisma.roomInviteBrowserState.findUnique.mockResolvedValue({
      ...browserState,
      status: 'consumed',
    })
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      applicantUserId: 'user_2',
      status: 'pending',
    })

    await expect(
      joinRoomFromBrowserState({
        browserState: 's'.repeat(43),
        applicantUserId: 'user_2',
        now,
      }),
    ).resolves.toMatchObject({
      outcome: 'pending_approval',
      joinRequest: { id: 'request_1' },
      idempotent: true,
    })
    expect(mockPrisma.roomJoinRequest.create).not.toHaveBeenCalled()
  })

  it('approves a request by reactivating the stable human membership and incrementing its epoch', async () => {
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce({ ...membership, status: 'removed' })
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      inviteId: 'invite_1',
      applicantUserId: 'user_2',
      status: 'pending',
      invite,
      applicant: { id: 'user_2', name: 'Alice' },
      room,
    })
    mockPrisma.roomJoinRequest.update.mockResolvedValue({ id: 'request_1', status: 'approved' })

    const result = await reviewRoomJoinRequest({
      roomId: 'room_1',
      requestId: 'request_1',
      reviewerUserId: 'owner_1',
      decision: 'approve',
      now,
    })

    expect(result).toMatchObject({ outcome: 'approved', idempotent: false })
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'member_2' },
      data: expect.objectContaining({
        status: 'active',
        membershipEpoch: { increment: 1 },
        removedAt: null,
      }),
    })
    expect(mockPrisma.roomJoinRequest.update).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: expect.objectContaining({
        status: 'approved',
        pendingKey: null,
        reviewedByUserId: 'owner_1',
      }),
    })
    expect(mockPrisma.roomJoinRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request_1', status: 'pending' },
      data: { pendingKey: null, reviewedByUserId: 'owner_1', reviewedAt: now },
    })
  })

  it('activates the exact pending Agent Binding when its human application is approved', async () => {
    const activeHuman = { ...membership, historyFromSequence: 5n }
    const pendingBinding = {
      id: 'binding_pending',
      userId: 'user_2',
      agentIdentityId: 'agent_1',
      activationMode: 'auto_follow',
      status: 'pending_approval',
      agentIdentity: { id: 'agent_1', displayName: 'Alice Agent' },
    }
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(activeHuman)
    mockPrisma.roomMembership.create.mockResolvedValue({ id: 'agent_member_1' })
    mockPrisma.roomBinding.update.mockResolvedValue({
      ...pendingBinding,
      agentMembershipId: 'agent_member_1',
      status: 'active',
    })
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      inviteId: 'invite_1',
      applicantUserId: 'user_2',
      pendingBindingId: 'binding_pending',
      status: 'pending',
      invite,
      applicant: { id: 'user_2', name: 'Alice' },
      room,
      pendingBinding,
    })
    mockPrisma.roomJoinRequest.update.mockResolvedValue({ id: 'request_1', status: 'approved' })

    const result = await reviewRoomJoinRequest({
      roomId: 'room_1',
      requestId: 'request_1',
      reviewerUserId: 'owner_1',
      decision: 'approve',
      now,
    })

    expect(result).toMatchObject({
      outcome: 'approved',
      agentMembership: { id: 'agent_member_1' },
      binding: { id: 'binding_pending', status: 'active' },
      idempotent: false,
    })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        principalType: 'agent',
        parentHumanMembershipId: 'member_2',
        displayAlias: 'Alice Agent',
      }),
    })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_pending' },
      data: { agentMembershipId: 'agent_member_1', status: 'active' },
    })
  })

  it('rejects a request without creating membership or consuming invite capacity', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      status: 'pending',
      pendingBindingId: 'binding_pending',
      invite,
      applicant: {},
      room,
    })
    mockPrisma.roomJoinRequest.update.mockResolvedValue({ id: 'request_1', status: 'rejected' })

    const result = await reviewRoomJoinRequest({
      roomId: 'room_1',
      requestId: 'request_1',
      reviewerUserId: 'owner_1',
      decision: 'reject',
      now,
    })

    expect(result).toMatchObject({ outcome: 'rejected', idempotent: false })
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomInvite.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: 'binding_pending', status: 'pending_approval' },
      data: { status: 'detached', activationMode: 'paused' },
    })
  })

  it('lets only the applicant cancel a pending request', async () => {
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      applicantUserId: 'user_2',
      status: 'pending',
      pendingBindingId: 'binding_pending',
    })
    mockPrisma.roomJoinRequest.update.mockResolvedValue({ id: 'request_1', status: 'cancelled' })

    await expect(
      cancelRoomJoinRequest({
        roomId: 'room_1',
        requestId: 'request_1',
        applicantUserId: 'user_2',
        now,
      }),
    ).resolves.toMatchObject({ request: { status: 'cancelled' }, idempotent: false })
    expect(mockPrisma.roomJoinRequest.update).toHaveBeenCalledWith({
      where: { id: 'request_1' },
      data: { status: 'cancelled', pendingKey: null, reviewedAt: now },
    })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: 'binding_pending', status: 'pending_approval' },
      data: { status: 'detached', activationMode: 'paused' },
    })

    await expect(
      cancelRoomJoinRequest({
        roomId: 'room_1',
        requestId: 'request_1',
        applicantUserId: 'attacker',
        now,
      }),
    ).rejects.toMatchObject({ code: 'join_request_not_found' })
  })

  it('fails closed when concurrent approvals exhaust the invitation capacity', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValueOnce(owner).mockResolvedValueOnce(null)
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      roomId: 'room_1',
      inviteId: 'invite_1',
      applicantUserId: 'user_2',
      status: 'pending',
      invite: { ...invite, maxUses: 1 },
      applicant: {},
      room,
    })
    mockPrisma.roomInvite.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      reviewRoomJoinRequest({
        roomId: 'room_1',
        requestId: 'request_1',
        reviewerUserId: 'owner_1',
        decision: 'approve',
        now,
      }),
    ).rejects.toMatchObject({ code: 'room_invite_unavailable' })
  })

  it('leaves with all child Agents and bindings, while the owner cannot leave', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ ...membership, room })
    mockPrisma.roomMembership.findMany.mockResolvedValue([
      {
        id: 'agent_member_1',
        principalType: 'agent',
        ownerUserId: 'user_2',
        displayAlias: 'Alice Agent',
        membershipEpoch: 1,
        binding: { nianSessionId: 'session_1', userId: 'user_2' },
      },
    ])
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })

    await expect(leaveRoom({ roomId: 'room_1', userId: 'user_2', now })).resolves.toEqual({
      leftMembershipIds: ['member_2', 'agent_member_1'],
      detachedBindingCount: 1,
      committedSessionDeletions: [{ sessionId: 'session_1', userId: 'user_2' }],
      messages: [{ id: 'system_1' }, { id: 'system_1' }],
      idempotent: false,
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.roomMessage.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          text: 'Alice Agent left the Room.',
          clientMessageId: 'system:membership-left:agent_member_1:1',
        }),
      }),
    )
    expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['member_2', 'agent_member_1'] }, status: 'active' },
      data: { status: 'left', removedAt: now, historyThroughSequence: 4n },
    })

    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    await expect(leaveRoom({ roomId: 'room_1', userId: 'owner_1', now })).rejects.toMatchObject({
      code: 'owner_leave_forbidden',
    })
  })

  it('lets every member remove an archived Room record without writing to its transcript', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...owner,
      room: { ...room, status: 'archived' },
    })
    mockPrisma.roomMembership.findMany.mockResolvedValue([
      {
        id: 'agent_member_1',
        principalType: 'agent',
        ownerUserId: 'owner_1',
        displayAlias: 'Owner Agent',
        membershipEpoch: 1,
        binding: { nianSessionId: 'session_1', userId: 'owner_1' },
      },
    ])
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })

    await expect(leaveRoom({ roomId: 'room_1', userId: 'owner_1', now })).resolves.toEqual({
      leftMembershipIds: ['member_owner', 'agent_member_1'],
      detachedBindingCount: 1,
      committedSessionDeletions: [],
      messages: [],
      idempotent: false,
    })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['member_owner', 'agent_member_1'] }, status: 'active' },
      data: { status: 'left', removedAt: now, historyThroughSequence: 4n },
    })
  })

  it('clears an active chat record without ending the human or Agent memberships', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ ...membership, room })

    await expect(deleteRoomRecord({ roomId: room.id, userId: 'user_2' })).resolves.toEqual({
      deleted: true,
      activeMembershipRetained: true,
      historyFromSequence: '5',
      idempotent: false,
    })
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: membership.id },
      data: {
        historyFromSequence: 5n,
        historyThroughSequence: null,
      },
    })
    expect(mockPrisma.roomBinding.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomReadState.upsert).toHaveBeenCalledWith({
      where: { membershipId: membership.id },
      create: {
        roomId: room.id,
        membershipId: membership.id,
        lastReadSequence: 4n,
        lastDeliveredSequence: 4n,
      },
      update: { lastReadSequence: 4n, lastDeliveredSequence: 4n },
    })
  })

  it('hides only the leaving human record after clearing it', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...membership,
      status: 'left',
      historyThroughSequence: 4n,
      room,
    })

    await expect(deleteRoomRecord({ roomId: room.id, userId: 'user_2' })).resolves.toMatchObject({
      deleted: true,
      activeMembershipRetained: false,
      historyFromSequence: '5',
    })
    expect(mockPrisma.roomMembership.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId_principalKey: { roomId: room.id, principalKey: 'human:user_2' } },
    }))
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: membership.id },
      data: { status: 'deleted', historyFromSequence: 5n, historyThroughSequence: null, pinnedAt: null },
    })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('rejects deleting a chat record with a stale Room version', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({ ...membership, room })

    await expect(deleteRoomRecord({
      roomId: room.id,
      userId: 'user_2',
      expectedUpdatedAt: new Date('2026-08-22T07:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'room_version_conflict' })
    expect(mockPrisma.roomMembership.update).not.toHaveBeenCalled()
  })

  it('treats a repeated active chat-record deletion as idempotent', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...membership,
      historyFromSequence: room.nextSequence + 1n,
      room,
    })

    await expect(deleteRoomRecord({
      roomId: room.id,
      userId: 'user_2',
      expectedUpdatedAt: room.updatedAt,
    })).resolves.toMatchObject({ deleted: true, activeMembershipRetained: true, idempotent: true })
    expect(mockPrisma.roomMembership.update).not.toHaveBeenCalled()
  })

  it('revokes an invitation and every outstanding browser capability atomically', async () => {
    mockPrisma.roomMembership.findUnique.mockResolvedValue(owner)
    mockPrisma.roomInvite.findUnique.mockResolvedValue(invite)

    const result = await revokeRoomInvite({
      roomId: 'room_1',
      inviteId: 'invite_1',
      actorUserId: 'owner_1',
      now,
    })

    expect(result).toMatchObject({ idempotent: false, invite: { status: 'revoked' } })
    expect(mockPrisma.roomInviteBrowserState.updateMany).toHaveBeenCalledWith({
      where: { inviteId: 'invite_1', status: 'active' },
      data: { status: 'revoked' },
    })
  })
})
