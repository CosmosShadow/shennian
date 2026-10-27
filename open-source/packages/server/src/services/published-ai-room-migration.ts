// @arch open-source/docs/server-runtime.md
// @test src/__tests__/published-ai-room-migration.test.ts

import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

const COPY_BATCH = 200

export class PublishedAiRoomMigrationError extends Error {
  constructor(readonly code: 'not_found' | 'identity_conflict' | 'in_flight' | 'not_ready') {
    super(code)
  }
}

/**
 * Idempotently prepare one Room with the legacy conversation's exact ID.
 * The publisher is an operator, never a hidden third participant.
 * This function must run inside a transaction holding the direct row lock.
 */
export async function ensurePublishedAiRoom(
  tx: Prisma.TransactionClient,
  input: {
    directConversationId: string
    ownerUserId: string
    visitorUserId: string
    agentIdentityId: string
    publicationId: string
  },
) {
  const direct = await tx.agentDirectConversation.findUnique({
    where: { id: input.directConversationId },
    select: { id: true, roomId: true, ownerUserId: true, visitorUserId: true,
      agentIdentityId: true, publicationId: true },
  })
  if (!direct) throw new PublishedAiRoomMigrationError('not_found')
  if (direct.ownerUserId !== input.ownerUserId
    || direct.visitorUserId !== input.visitorUserId
    || direct.agentIdentityId !== input.agentIdentityId
    || direct.publicationId !== input.publicationId
    || (direct.roomId && direct.roomId !== direct.id)) {
    throw new PublishedAiRoomMigrationError('identity_conflict')
  }
  const [publication, visitor, owner, agent] = await Promise.all([
    tx.agentPublication.findUnique({ where: { id: direct.publicationId },
      select: { displayName: true, ownerUserId: true, agentIdentityId: true } }),
    tx.user.findUnique({ where: { id: direct.visitorUserId }, select: { name: true } }),
    tx.user.findUnique({ where: { id: direct.ownerUserId }, select: { name: true } }),
    tx.agentIdentity.findUnique({ where: { id: direct.agentIdentityId },
      select: { displayName: true, ownerUserId: true } }),
  ])
  if (!publication || !visitor?.name.trim() || !owner?.name.trim() || !agent
    || publication.ownerUserId !== direct.ownerUserId
    || publication.agentIdentityId !== direct.agentIdentityId
    || agent.ownerUserId !== direct.ownerUserId) {
    throw new PublishedAiRoomMigrationError('identity_conflict')
  }
  const room = await tx.room.findUnique({ where: { id: direct.id },
    select: { id: true, conversationKind: true, ownerUserId: true, createdByUserId: true } })
  if (room && (room.conversationKind !== 'published_ai'
    || room.ownerUserId !== direct.ownerUserId
    || room.createdByUserId !== direct.ownerUserId)) {
    throw new PublishedAiRoomMigrationError('identity_conflict')
  }
  if (!room) {
    await tx.room.create({ data: {
      id: direct.id,
      name: publication.displayName,
      conversationKind: 'published_ai',
      createdByUserId: direct.ownerUserId,
      ownerUserId: direct.ownerUserId,
      visibility: 'private',
      joinPolicy: 'closed',
    } })
  }
  const visitorKey = { roomId: direct.id, principalKey: `human:${direct.visitorUserId}` }
  const agentKey = { roomId: direct.id, principalKey: `agent:${direct.agentIdentityId}` }
  const visitorMembership = await tx.roomMembership.upsert({
    where: { roomId_principalKey: visitorKey },
    create: { ...visitorKey, principalType: 'human', userId: direct.visitorUserId,
      ownerUserId: direct.visitorUserId, displayAlias: visitor.name.trim(), role: 'member' },
    update: {},
    select: { id: true, principalType: true, userId: true, status: true },
  })
  const agentMembership = await tx.roomMembership.upsert({
    where: { roomId_principalKey: agentKey },
    create: { ...agentKey, principalType: 'agent', agentIdentityId: direct.agentIdentityId,
      ownerUserId: direct.ownerUserId, displayAlias: agent.displayName.trim(), role: 'member' },
    update: {},
    select: { id: true, principalType: true, agentIdentityId: true, status: true },
  })
  if (visitorMembership.principalType !== 'human'
    || visitorMembership.userId !== direct.visitorUserId
    || visitorMembership.status !== 'active'
    || agentMembership.principalType !== 'agent'
    || agentMembership.agentIdentityId !== direct.agentIdentityId
    || agentMembership.status !== 'active') {
    throw new PublishedAiRoomMigrationError('identity_conflict')
  }
  await tx.roomReadState.upsert({
    where: { membershipId: visitorMembership.id },
    create: { roomId: direct.id, membershipId: visitorMembership.id },
    update: {},
  })
  if (!direct.roomId) {
    await tx.agentDirectConversation.update({ where: { id: direct.id },
      data: { roomId: direct.id, canonicalState: 'backfilling' } })
  }
  return {
    roomId: direct.id,
    directConversationId: direct.id,
    visitorMembershipId: visitorMembership.id,
    agentMembershipId: agentMembership.id,
    visitorName: visitor.name.trim(),
    agentName: agent.displayName.trim(),
    ownerName: owner.name.trim(),
  }
}

/** Copy a bounded batch while legacy remains authoritative; no UI reads shadow rows. */
export async function copyPublishedAiRoomBatch(conversationId: string): Promise<{
  copied: number
  copiedThrough: string
  ready: boolean
}> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${conversationId} FOR UPDATE`
    const direct = await tx.agentDirectConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, roomId: true, canonicalState: true, canonicalCopiedSequence: true,
        nextSequence: true, ownerUserId: true, visitorUserId: true,
        agentIdentityId: true, publicationId: true },
    })
    if (!direct) throw new PublishedAiRoomMigrationError('not_found')
    if (direct.canonicalState === 'ready') {
      return { copied: 0, copiedThrough: direct.canonicalCopiedSequence.toString(), ready: true }
    }
    const room = await ensurePublishedAiRoom(tx, {
      directConversationId: direct.id, ownerUserId: direct.ownerUserId,
      visitorUserId: direct.visitorUserId, agentIdentityId: direct.agentIdentityId,
      publicationId: direct.publicationId,
    })
    const rows = await tx.agentDirectMessage.findMany({
      where: { conversationId, sequence: { gt: direct.canonicalCopiedSequence } },
      orderBy: { sequence: 'asc' }, take: COPY_BATCH,
      select: { id: true, sequence: true, authorRole: true, clientMessageId: true,
        text: true, status: true, createdAt: true, roomMessageId: true },
    })
    let copiedThrough = direct.canonicalCopiedSequence
    for (const message of rows) {
      if (message.roomMessageId && message.roomMessageId !== message.id) {
        throw new PublishedAiRoomMigrationError('identity_conflict')
      }
      if (!message.text || !['visitor', 'agent'].includes(message.authorRole)) {
        throw new PublishedAiRoomMigrationError('identity_conflict')
      }
      const byAgent = message.authorRole === 'agent'
      await tx.roomMessage.create({ data: {
        id: message.id,
        roomId: room.roomId,
        sequence: message.sequence,
        authorMembershipId: byAgent ? room.agentMembershipId : room.visitorMembershipId,
        authorPrincipalTypeSnapshot: byAgent ? 'agent' : 'human',
        ownerUserIdSnapshot: byAgent ? direct.ownerUserId : direct.visitorUserId,
        authorDisplayNameSnapshot: byAgent ? room.agentName : room.visitorName,
        ownerDisplayNameSnapshot: byAgent ? room.ownerName : room.visitorName,
        kind: 'text',
        source: byAgent ? 'managed_agent' : 'app',
        deliveryStatus: message.status,
        text: message.text,
        clientMessageId: message.clientMessageId,
        createdAt: message.createdAt,
      } })
      await tx.agentDirectMessage.update({ where: { id: message.id },
        data: { roomMessageId: message.id } })
      copiedThrough = message.sequence
    }
    if (rows.length > 0) {
      await tx.room.update({ where: { id: room.roomId },
        data: { nextSequence: copiedThrough } })
      await tx.agentDirectConversation.update({ where: { id: direct.id },
        data: { canonicalCopiedSequence: copiedThrough } })
    }
    return { copied: rows.length, copiedThrough: copiedThrough.toString(), ready: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}

/** Cut over only after all legacy writers are upgraded and in-flight turns drain. */
export async function finalizePublishedAiRoom(conversationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const control = await tx.conversationWriteControl.findUnique({
      where: { name: 'published_ai' }, select: { mode: true },
    })
    if (control?.mode !== 'paused') throw new PublishedAiRoomMigrationError('not_ready')
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${conversationId} FOR UPDATE`
    const direct = await tx.agentDirectConversation.findUnique({
      where: { id: conversationId },
      select: { roomId: true, canonicalState: true,
        canonicalCopiedSequence: true, nextSequence: true, visitorUserId: true },
    })
    if (!direct?.roomId || direct.roomId !== conversationId) {
      throw new PublishedAiRoomMigrationError('not_ready')
    }
    if (direct.canonicalState === 'ready') return
    if (direct.canonicalCopiedSequence !== direct.nextSequence) {
      throw new PublishedAiRoomMigrationError('not_ready')
    }
    const inFlight = await tx.agentDirectMessage.count({
      where: { conversationId, status: { in: ['pending', 'running'] } },
    })
    if (inFlight > 0) throw new PublishedAiRoomMigrationError('in_flight')
    const [sourceCount, targetCount] = await Promise.all([
      tx.agentDirectMessage.count({ where: { conversationId } }),
      tx.roomMessage.count({ where: { roomId: conversationId } }),
    ])
    if (sourceCount !== targetCount) throw new PublishedAiRoomMigrationError('not_ready')
    // A legacy worker may have completed or failed a turn after its shadow
    // message was copied. Reconcile delivery state only after all turns drain.
    await tx.$executeRaw`UPDATE RoomMessage r
      JOIN AgentDirectMessage m ON m.id = r.id AND m.conversationId = ${conversationId}
      SET r.deliveryStatus = m.status
      WHERE r.roomId = ${conversationId} AND NOT (r.deliveryStatus <=> m.status)`
    const visitorMembership = await tx.roomMembership.findUnique({
      where: { roomId_principalKey: { roomId: conversationId,
        principalKey: `human:${direct.visitorUserId}` } },
      select: { id: true },
    })
    if (!visitorMembership) throw new PublishedAiRoomMigrationError('identity_conflict')
    await tx.roomReadState.upsert({ where: { membershipId: visitorMembership.id },
      create: { roomId: conversationId, membershipId: visitorMembership.id,
        lastReadSequence: direct.nextSequence, lastDeliveredSequence: direct.nextSequence },
      update: { lastReadSequence: direct.nextSequence,
        lastDeliveredSequence: direct.nextSequence } })
    await tx.agentDirectConversation.update({ where: { id: conversationId },
      data: { canonicalState: 'ready' } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
