// @covers open-source/packages/server/src/services/room-targeted-invitations.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), createRoom: vi.fn(), activate: vi.fn(), append: vi.fn(),
  sentFindMany: vi.fn(), activeMemberFindMany: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction,
  roomInvite: { findMany: mocks.sentFindMany },
  roomMembership: { findMany: mocks.activeMemberFindMany } } }))
vi.mock('../services/room-core.js', () => ({
  normalizeRoomName: (value: string) => value.trim(),
  createRoomWithOwnerInTransaction: mocks.createRoom,
}))
vi.mock('../services/room-membership.js', () => ({
  activateHumanMembership: mocks.activate,
  appendSystemMessage: mocks.append,
}))

import { createRoomWithContactInvitations, inviteRoomSavedContacts,
  listSentTargetedRoomInvitations,
  respondToTargetedRoomInvitation } from '../services/room-targeted-invitations.js'

const now = new Date('2026-09-27T00:00:00Z')
const group = { id: 'room-1', name: 'Team', status: 'active',
  conversationKind: 'group', nextSequence: 5n, maxHumanMembers: 100 }

function transaction() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'room-1' }]),
    roomMembership: {
      findUnique: vi.fn().mockImplementation(({ where }: {
        where: { roomId_principalKey: { principalKey: string } }
      }) => Promise.resolve(where.roomId_principalKey.principalKey === 'human:owner-1'
        ? { id: 'owner-membership', status: 'active', role: 'owner', room: group } : null)),
      count: vi.fn().mockResolvedValue(1),
    },
    userContact: { findMany: vi.fn().mockResolvedValue([{ targetUserId: 'visitor-1' }]) },
    roomInvite: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'invitation-1' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'invitation-1', roomId: 'room-1',
        targetUserId: 'visitor-1', status: 'active',
        expiresAt: new Date('2026-10-01T00:00:00Z'), room: group }),
      update: vi.fn().mockResolvedValue({}),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Visitor' }) },
  }
}

describe('direct-join Room invitations to saved contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activate.mockResolvedValue({ id: 'visitor-membership', displayAlias: 'Visitor',
      membershipEpoch: 1 })
    mocks.append.mockResolvedValue({ id: 'join-message' })
    mocks.createRoom.mockResolvedValue({ room: group,
      membership: { id: 'owner-membership' }, idempotent: false })
  })

  it('joins the target immediately instead of waiting for acceptance', async () => {
    const tx = transaction()
    mocks.transaction.mockImplementation((fn) => fn(tx))
    const invitations = await inviteRoomSavedContacts({ roomId: group.id,
      actorUserId: 'owner-1', targetUserIds: ['visitor-1'], now })
    expect(invitations).toEqual([{ targetUserId: 'visitor-1',
      invitationId: 'invitation-1', status: 'joined' }])
    expect(mocks.activate).toHaveBeenCalledWith(tx, expect.objectContaining({
      roomId: group.id, userId: 'visitor-1', historyFromSequence: 6n,
    }))
    expect(tx.roomInvite.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      roomId: group.id, targetUserId: 'visitor-1', maxUses: 1, status: 'used',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }), select: { id: true } })
  })

  it('creates the Room and joins all invitees in one transaction', async () => {
    const tx = transaction()
    mocks.transaction.mockImplementation((fn) => fn(tx))
    const result = await createRoomWithContactInvitations({ ownerUserId: 'owner-1',
      name: 'Team', targetUserIds: ['visitor-1'],
      clientOperationId: 'operation-123', now })
    expect(result.invitations).toEqual([{ targetUserId: 'visitor-1',
      invitationId: 'invitation-1', status: 'joined' }])
    expect(mocks.createRoom).toHaveBeenCalledWith(tx, expect.objectContaining({
      userId: 'owner-1', name: 'Team', visibility: 'private', joinPolicy: 'closed',
      roomId: expect.stringMatching(/^room_contact_[a-f0-9]{32}$/),
      creationRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it('replays the same create operation without reinviting a declined contact', async () => {
    const tx = transaction()
    mocks.transaction.mockImplementation((fn) => fn(tx))
    mocks.createRoom.mockResolvedValue({ room: group,
      membership: { id: 'owner-membership' }, idempotent: true })
    tx.roomInvite.findFirst.mockResolvedValue({ id: 'invitation-1', status: 'declined' })
    const result = await createRoomWithContactInvitations({ ownerUserId: 'owner-1',
      name: 'Team', targetUserIds: ['visitor-1'],
      clientOperationId: 'operation-123', now })
    expect(result.invitations).toEqual([{ targetUserId: 'visitor-1',
      invitationId: 'invitation-1', status: 'declined' }])
    expect(tx.roomInvite.create).not.toHaveBeenCalled()
  })

  it('retries a concurrent Room ID collision and reads the committed operation', async () => {
    const tx = transaction()
    mocks.transaction.mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce((fn) => fn(tx))
    mocks.createRoom.mockResolvedValue({ room: group,
      membership: { id: 'owner-membership' }, idempotent: true })
    tx.roomInvite.findFirst.mockResolvedValue({ id: 'invitation-1', status: 'used' })
    const result = await createRoomWithContactInvitations({ ownerUserId: 'owner-1',
      name: 'Team', targetUserIds: ['visitor-1'],
      clientOperationId: 'operation-123', now })
    expect(result.idempotent).toBe(true)
    expect(result.invitations).toMatchObject([{ status: 'joined' }])
    expect(tx.roomInvite.create).not.toHaveBeenCalled()
  })

  it('heals a legacy pending invitation into an active membership on the next invite', async () => {
    const tx = transaction()
    tx.roomInvite.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'invitation-1' })
    tx.roomInvite.update.mockResolvedValue({ id: 'invitation-1' })
    mocks.transaction.mockImplementation((fn) => fn(tx))
    const invitations = await inviteRoomSavedContacts({ roomId: group.id,
      actorUserId: 'owner-1', targetUserIds: ['visitor-1'], now })
    expect(invitations).toEqual([{ targetUserId: 'visitor-1',
      invitationId: 'invitation-1', status: 'joined' }])
    expect(tx.roomInvite.update).toHaveBeenCalledWith({ where: { id: 'invitation-1' },
      data: { status: 'used', useCount: { increment: 1 } }, select: { id: true } })
    expect(tx.roomInvite.create).not.toHaveBeenCalled()
  })

  it('rejects unsaved contacts before joining them', async () => {
    const tx = transaction()
    tx.userContact.findMany.mockResolvedValue([])
    mocks.transaction.mockImplementation((fn) => fn(tx))
    await expect(inviteRoomSavedContacts({ roomId: group.id,
      actorUserId: 'owner-1', targetUserIds: ['visitor-1'], now }))
      .rejects.toMatchObject({ code: 'room_invite_targets_invalid' })
    expect(tx.roomInvite.create).not.toHaveBeenCalled()
  })

  it('still lets a legacy client resolve a leftover pending invitation directly', async () => {
    const tx = transaction()
    mocks.transaction.mockImplementation((fn) => fn(tx))
    await expect(respondToTargetedRoomInvitation({ invitationId: 'invitation-1',
      userId: 'other-user', decision: 'accept', now }))
      .rejects.toMatchObject({ code: 'room_invite_not_found' })
    const accepted = await respondToTargetedRoomInvitation({ invitationId: 'invitation-1',
      userId: 'visitor-1', decision: 'accept', now })
    expect(accepted).toMatchObject({ roomId: 'room-1', status: 'accepted',
      membershipId: 'visitor-membership', idempotent: false })
    expect(mocks.activate).toHaveBeenCalledWith(tx, expect.objectContaining({
      roomId: 'room-1', userId: 'visitor-1', historyFromSequence: 6n,
    }))
    expect(tx.roomInvite.update).toHaveBeenCalledWith({ where: { id: 'invitation-1' },
      data: { status: 'used', useCount: { increment: 1 } } })
  })

  it('shows only the sender their most recent pending invitation and Room ID', async () => {
    mocks.sentFindMany.mockResolvedValue([{ id: 'invitation-1', roomId: 'room-1',
      targetUserId: 'visitor-1', status: 'active',
      createdAt: now, expiresAt: new Date('2026-10-01T00:00:00Z'),
      room: { name: 'Team', status: 'active' } }])
    mocks.activeMemberFindMany.mockResolvedValue([])
    const result = await listSentTargetedRoomInvitations({
      senderUserId: 'owner-1', targetUserId: 'visitor-1', now,
    })
    expect(result.sentInvitations).toMatchObject([{ invitationId: 'invitation-1',
      roomId: 'room-1', targetUserId: 'visitor-1', status: 'pending' }])
    expect(mocks.sentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdByUserId: 'owner-1', targetUserId: 'visitor-1' },
    }))
  })
})
