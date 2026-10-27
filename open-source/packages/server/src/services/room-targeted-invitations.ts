// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-targeted-invitations.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { createRoomWithOwnerInTransaction, normalizeRoomName } from './room-core.js'
import { activateHumanMembership, appendSystemMessage } from './room-membership.js'
import { assertHumanRoomCapacity, RoomPolicyError } from './room-policy.js'

const MAX_TARGETS = 20
const INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const CREATE_OPERATION = /^[A-Za-z0-9:_-]{8,128}$/

function creationIdentity(ownerUserId: string, operationId: unknown,
  name: string, targetUserIds: string[]) {
  if (typeof operationId !== 'string' || !CREATE_OPERATION.test(operationId)) {
    throw new RoomPolicyError('room_create_operation_required',
      'A stable client operation ID is required.')
  }
  const roomId = `room_contact_${crypto.createHash('sha256')
    .update(`${ownerUserId}\0${operationId}`).digest('hex').slice(0, 32)}`
  const creationRequestHash = crypto.createHash('sha256')
    .update(JSON.stringify({ ownerUserId, name,
      targetUserIds: [...targetUserIds].sort() })).digest('hex')
  return { roomId, creationRequestHash }
}

function normalizeTargets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS
    || value.some((item) => typeof item !== 'string'
      || !/^[A-Za-z0-9_-]{8,191}$/.test(item))) {
    throw new RoomPolicyError('room_invite_targets_invalid', 'Select valid saved contacts.')
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) {
    throw new RoomPolicyError('room_invite_targets_invalid', 'Each contact may be selected once.')
  }
  return ids
}

/** Invitees join immediately; a declined contact stays blocked until re-saved. */
async function inviteSavedContacts(tx: Prisma.TransactionClient, input: {
  roomId: string; actorUserId: string; targetUserIds: string[]; now: Date
}) {
  await tx.$queryRaw`SELECT id FROM Room WHERE id = ${input.roomId} FOR UPDATE`
  const actor = await tx.roomMembership.findUnique({ where: {
    roomId_principalKey: { roomId: input.roomId,
      principalKey: `human:${input.actorUserId}` },
  }, include: { room: true } })
  if (!actor || actor.status !== 'active' || actor.role !== 'owner'
    || actor.room.status !== 'active' || actor.room.conversationKind !== 'group') {
    throw new RoomPolicyError('room_admin_forbidden', 'Only the active Room owner can invite contacts.')
  }
  if (input.targetUserIds.includes(input.actorUserId)) {
    throw new RoomPolicyError('room_invite_targets_invalid', 'A Room owner is already a member.')
  }
  const saved = await tx.userContact.findMany({ where: {
    ownerUserId: input.actorUserId, targetUserId: { in: input.targetUserIds },
  }, select: { targetUserId: true } })
  if (saved.length !== input.targetUserIds.length) {
    throw new RoomPolicyError('room_invite_targets_invalid', 'All invitees must be saved contacts.')
  }
  let nextSequence = actor.room.nextSequence
  const invitations = []
  for (const targetUserId of input.targetUserIds) {
    const member = await tx.roomMembership.findUnique({ where: {
      roomId_principalKey: { roomId: input.roomId,
        principalKey: `human:${targetUserId}` },
    }, select: { id: true, status: true, membershipEpoch: true } })
    if (member?.status === 'active') {
      invitations.push({ targetUserId, invitationId: null, status: 'already_member' as const })
      continue
    }
    const declined = await tx.roomInvite.findFirst({ where: {
      roomId: input.roomId, targetUserId, status: 'declined',
    }, select: { id: true } })
    if (declined) {
      invitations.push({ targetUserId, invitationId: declined.id, status: 'declined' as const })
      continue
    }
    const activeHumanCount = await tx.roomMembership.count({ where: {
      roomId: input.roomId, principalType: 'human', status: 'active',
    } })
    assertHumanRoomCapacity({ activeHumanCount, maxHumanMembers: actor.room.maxHumanMembers })
    const user = await tx.user.findUnique({ where: { id: targetUserId }, select: { name: true } })
    if (!user?.name.trim()) {
      throw new RoomPolicyError('profile_name_required', 'The contact has no display name yet.')
    }
    const historyFromSequence = nextSequence + 1n
    const membership = await activateHumanMembership(tx, { roomId: input.roomId,
      userId: targetUserId, displayName: user.name.trim(),
      existing: member ? { id: member.id, membershipEpoch: member.membershipEpoch } : null,
      historyFromSequence, now: input.now })
    await appendSystemMessage(tx, { roomId: input.roomId, author: membership,
      text: `${membership.displayAlias} joined the Room.`,
      clientMessageId: `system:membership-joined:${membership.id}:${membership.membershipEpoch}` })
    nextSequence += 1n
    const previousInvite = await tx.roomInvite.findFirst({ where: {
      roomId: input.roomId, targetUserId, status: { in: ['active', 'used'] },
    }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    const invite = previousInvite
      ? await tx.roomInvite.update({ where: { id: previousInvite.id },
          data: { status: 'used', useCount: { increment: 1 } }, select: { id: true } })
      // The random bearer is discarded; this row only records who invited whom.
      : await tx.roomInvite.create({ data: {
          roomId: input.roomId, createdByUserId: input.actorUserId, targetUserId,
          tokenHash: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
          status: 'used', maxUses: 1, useCount: 1,
          expiresAt: new Date(input.now.getTime() + INVITE_LIFETIME_MS),
        }, select: { id: true } })
    invitations.push({ targetUserId, invitationId: invite.id, status: 'joined' as const })
  }
  return invitations
}

/** Create one Room and join all invitees atomically. */
export async function createRoomWithContactInvitations(input: {
  ownerUserId: string; name: string; targetUserIds: unknown;
  clientOperationId: unknown; now?: Date
}) {
  const name = normalizeRoomName(input.name)
  const targetUserIds = normalizeTargets(input.targetUserIds)
  const identity = creationIdentity(input.ownerUserId, input.clientOperationId,
    name, targetUserIds)
  const now = input.now ?? new Date()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await createRoomWithOwnerInTransaction(tx, {
          userId: input.ownerUserId, name, visibility: 'private', joinPolicy: 'closed',
          roomId: identity.roomId, creationRequestHash: identity.creationRequestHash,
        })
        const invitations = result.idempotent
          ? await readExistingCreationInvitations(tx, result.room.id, targetUserIds)
          : await inviteSavedContacts(tx, {
              roomId: result.room.id, actorUserId: input.ownerUserId, targetUserIds, now,
            })
        return { ...result, invitations }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      const retryable = typeof error === 'object' && error !== null
        && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')
      if (!retryable || attempt === 2) throw error
    }
  }
  throw new RoomPolicyError('room_operation_conflict', 'Room creation could not settle.')
}

async function readExistingCreationInvitations(tx: Prisma.TransactionClient,
  roomId: string, targetUserIds: string[]) {
  const invitations = []
  for (const targetUserId of targetUserIds) {
    const member = await tx.roomMembership.findUnique({ where: {
      roomId_principalKey: { roomId, principalKey: `human:${targetUserId}` },
    }, select: { status: true } })
    if (member?.status === 'active') {
      invitations.push({ targetUserId, invitationId: null, status: 'already_member' as const })
      continue
    }
    const invite = await tx.roomInvite.findFirst({ where: { roomId, targetUserId },
      orderBy: { createdAt: 'desc' }, select: { id: true, status: true } })
    if (!invite) throw new RoomPolicyError('room_operation_conflict',
      'The previous Room creation is incomplete.')
    const status = invite.status === 'declined' ? 'declined' as const : 'joined' as const
    invitations.push({ targetUserId, invitationId: invite.id, status })
  }
  return invitations
}

export async function inviteRoomSavedContacts(input: {
  roomId: string; actorUserId: string; targetUserIds: unknown; now?: Date
}) {
  const targetUserIds = normalizeTargets(input.targetUserIds)
  return prisma.$transaction((tx) => inviteSavedContacts(tx, {
    roomId: input.roomId, actorUserId: input.actorUserId,
    targetUserIds, now: input.now ?? new Date(),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function listMyTargetedRoomInvitations(userId: string, now = new Date()) {
  const rows = await prisma.roomInvite.findMany({ where: {
    targetUserId: userId, status: 'active', expiresAt: { gt: now },
    room: { status: 'active', conversationKind: 'group' },
  }, select: { id: true, roomId: true, createdAt: true, expiresAt: true,
    room: { select: { name: true, memberships: { where: {
      userId, principalType: 'human', status: 'active',
    }, select: { id: true }, take: 1 } } },
    createdBy: { select: { id: true, name: true } } },
  orderBy: { createdAt: 'desc' }, take: 100 })
  return { invitations: rows.filter((row) => row.room.memberships.length === 0).map((row) => ({
    invitationId: row.id, roomId: row.roomId, roomName: row.room.name,
    inviterUserId: row.createdBy.id, inviterName: row.createdBy.name,
    status: 'pending' as const, createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt!.toISOString(),
  })) }
}

/** Sender-only projection for reopening a contact detail without recreating its Room. */
export async function listSentTargetedRoomInvitations(input: {
  senderUserId: string; targetUserId?: unknown; now?: Date
}) {
  if (input.targetUserId !== undefined
    && (typeof input.targetUserId !== 'string'
      || !/^[A-Za-z0-9_-]{8,191}$/.test(input.targetUserId))) {
    throw new RoomPolicyError('room_invite_targets_invalid', 'Invalid contact ID.')
  }
  const rows = await prisma.roomInvite.findMany({ where: {
    createdByUserId: input.senderUserId, targetUserId: input.targetUserId === undefined
      ? { not: null } : input.targetUserId,
  }, select: { id: true, roomId: true, targetUserId: true,
    status: true, createdAt: true, expiresAt: true,
    room: { select: { name: true, status: true } } },
  orderBy: { createdAt: 'desc' }, take: 100 })
  const roomIds = [...new Set(rows.map((row) => row.roomId))]
  const memberships = roomIds.length ? await prisma.roomMembership.findMany({ where: {
    roomId: { in: roomIds }, principalType: 'human', status: 'active',
    userId: { in: rows.flatMap((row) => row.targetUserId ? [row.targetUserId] : []) },
  }, select: { roomId: true, userId: true } }) : []
  const activeKeys = new Set(memberships.map((member) => `${member.roomId}\0${member.userId}`))
  const seen = new Set<string>()
  const now = input.now ?? new Date()
  return { sentInvitations: rows.flatMap((row) => {
    if (!row.targetUserId || row.room.status !== 'active') return []
    const key = `${row.roomId}\0${row.targetUserId}`
    if (seen.has(key)) return []
    seen.add(key)
    const status = activeKeys.has(key) || row.status === 'used' ? 'accepted'
      : row.status === 'active' && row.expiresAt && row.expiresAt > now ? 'pending'
      : row.status === 'declined' ? 'declined' : 'expired'
    return [{ invitationId: row.id, roomId: row.roomId, roomName: row.room.name,
      targetUserId: row.targetUserId, status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null }]
  }) }
}

export async function respondToTargetedRoomInvitation(input: {
  invitationId: string; userId: string; decision: 'accept' | 'decline'; now?: Date
}) {
  if (!/^[A-Za-z0-9_-]{8,191}$/.test(input.invitationId)) {
    throw new RoomPolicyError('room_invite_not_found', 'Invitation not found.')
  }
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM RoomInvite WHERE id = ${input.invitationId} FOR UPDATE`
    const invite = await tx.roomInvite.findUnique({ where: { id: input.invitationId },
      include: { room: true } })
    if (!invite || invite.targetUserId !== input.userId) {
      throw new RoomPolicyError('room_invite_not_found', 'Invitation not found.')
    }
    const existing = await tx.roomMembership.findUnique({ where: {
      roomId_principalKey: { roomId: invite.roomId, principalKey: `human:${input.userId}` },
    } })
    if (invite.status === 'used' && input.decision === 'accept'
      && existing?.status === 'active') {
      return { roomId: invite.roomId, status: 'accepted' as const,
        membershipId: existing.id, message: null, idempotent: true }
    }
    if (invite.status === 'declined' && input.decision === 'decline') {
      return { roomId: invite.roomId, status: 'declined' as const,
        membershipId: null, message: null, idempotent: true }
    }
    if (invite.status !== 'active' || invite.expiresAt == null
      || invite.expiresAt <= now || invite.room.status !== 'active'
      || invite.room.conversationKind !== 'group') {
      throw new RoomPolicyError('room_invite_unavailable', 'Invitation is unavailable.')
    }
    if (input.decision === 'decline') {
      await tx.roomInvite.update({ where: { id: invite.id },
        data: { status: 'declined', revokedAt: now } })
      return { roomId: invite.roomId, status: 'declined' as const,
        membershipId: null, message: null, idempotent: false }
    }
    if (existing?.status !== 'active') {
      const activeHumanCount = await tx.roomMembership.count({ where: {
        roomId: invite.roomId, principalType: 'human', status: 'active',
      } })
      assertHumanRoomCapacity({ activeHumanCount,
        maxHumanMembers: invite.room.maxHumanMembers })
    }
    const user = await tx.user.findUnique({ where: { id: input.userId },
      select: { name: true } })
    if (!user?.name.trim()) {
      throw new RoomPolicyError('profile_name_required', 'Set a display name before joining.')
    }
    const membership = existing?.status === 'active' ? existing
      : await activateHumanMembership(tx, { roomId: invite.roomId,
        userId: input.userId, displayName: user.name.trim(),
        existing: existing ? { id: existing.id, membershipEpoch: existing.membershipEpoch } : null,
        historyFromSequence: invite.room.nextSequence + 1n, now })
    const message = existing?.status === 'active' ? null : await appendSystemMessage(tx, {
      roomId: invite.roomId, author: membership,
      text: `${membership.displayAlias} joined the Room.`,
      clientMessageId: `system:membership-joined:${membership.id}:${membership.membershipEpoch}`,
    })
    await tx.roomInvite.update({ where: { id: invite.id },
      data: { status: 'used', useCount: { increment: 1 } } })
    return { roomId: invite.roomId, status: 'accepted' as const,
      membershipId: membership.id, message, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
