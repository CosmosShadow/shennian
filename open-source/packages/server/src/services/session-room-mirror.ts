// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-room-mirror.test.ts

import crypto from 'node:crypto'
import type { SessionRoomImportMutation } from '@shennian/wire'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

const ZERO_HASH = '0'.repeat(64)
const SHA256 = /^[a-f0-9]{64}$/
const MAX_BATCH = 50

export class SessionRoomMirrorError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'identity_conflict'
    | 'revision_conflict' | 'message_conflict' | 'not_ready') { super(code) }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function sessionRoomMessageId(sessionId: string, messageId: string): string {
  return `work_${sha256(`${sessionId}\0${messageId}`).slice(0, 32)}`
}

export function nextSessionRoomAuditHash(previous: string, mutation: Pick<
  SessionRoomImportMutation, 'mutationId' | 'contentHash'>): string {
  return sha256(`${previous}\0${mutation.mutationId}\0${mutation.contentHash}`)
}

function validateMutation(input: SessionRoomImportMutation, sessionId: string,
  daemonInstallationId: string, revision: number): void {
  if (input.schemaVersion !== 1 || input.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION
    || input.dataEpoch !== SESSION_SYNC_DATA_EPOCH
    || input.daemonInstallationId !== daemonInstallationId
    || input.sessionId !== sessionId || input.revision !== revision
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || typeof input.messageId !== 'string' || !input.messageId
    || input.messageId.length > 191 || !SHA256.test(input.mutationId)
    || !SHA256.test(input.contentHash)
    || !['append', 'upsert', 'tombstone'].includes(input.mutation)
    || (input.deliveryState !== undefined
      && !['queued', 'committed', 'executing', 'completed', 'failed', 'cancelled']
        .includes(input.deliveryState))
    || !Number.isFinite(Date.parse(input.committedAt))) {
    throw new SessionRoomMirrorError('invalid')
  }
  if (input.mutation !== 'tombstone') {
    if (!input.message || input.message.id !== input.messageId
      || input.message.sessionId !== sessionId
      || !['user', 'agent'].includes(input.message.role)
      || !Number.isSafeInteger(input.message.ts)
      || typeof input.message.payload !== 'string'
      || Buffer.byteLength(input.message.payload, 'utf8') > 8_000_000) {
      throw new SessionRoomMirrorError('invalid')
    }
  }
  const expectedContentHash = sha256(JSON.stringify({ mutation: input.mutation,
    message: input.message ?? null, deliveryState: input.deliveryState ?? null }))
  if (input.contentHash !== expectedContentHash) throw new SessionRoomMirrorError('invalid')
}

/**
 * Pure Server candidate: no HTTP route calls this before the personal-body
 * privacy decision and coordinated release. Shadow rows are never readable.
 */
export async function importSessionRoomMutations(input: {
  sessionId: string
  machineId: string
  ownerUserId: string
  daemonInstallationId: string
  fromRevision: number
  mutations: SessionRoomImportMutation[]
}): Promise<{ roomId: string; copiedRevision: number; copiedSequence: string;
  rollingHash: string; idempotent: boolean }> {
  if (!input.sessionId || !input.machineId || !input.ownerUserId
    || !input.daemonInstallationId || !Number.isSafeInteger(input.fromRevision)
    || input.fromRevision < 0 || !Array.isArray(input.mutations)
    || input.mutations.length > MAX_BATCH
    || (input.mutations.length === 0 && input.fromRevision !== 0)) {
    throw new SessionRoomMirrorError('invalid')
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM NianSession WHERE id = ${input.sessionId} FOR UPDATE`
    const session = await tx.nianSession.findUnique({ where: { id: input.sessionId },
      select: { id: true, userId: true, machineId: true,
        daemonInstallationId: true, dataEpoch: true, deletedAt: true,
        bodyStorageMode: true, title: true, agentType: true,
        agentIdentityId: true, creationKey: true, conversationRoomId: true,
        roomBinding: { select: { id: true } },
        agentIdentity: { select: { id: true, displayName: true, ownerUserId: true } } },
    })
    if (!session) throw new SessionRoomMirrorError('not_found')
    if (session.userId !== input.ownerUserId || session.machineId !== input.machineId
      || session.daemonInstallationId !== input.daemonInstallationId
      || session.dataEpoch !== SESSION_SYNC_DATA_EPOCH || session.deletedAt
      || session.bodyStorageMode !== 'machine_local'
      || session.roomBinding || session.creationKey?.startsWith('published-agent:')
      || session.id.startsWith('sess_worker_')
      || (session.agentIdentity && session.agentIdentity.ownerUserId !== input.ownerUserId)) {
      throw new SessionRoomMirrorError('identity_conflict')
    }
    if (session.conversationRoomId && session.conversationRoomId !== session.id) {
      throw new SessionRoomMirrorError('identity_conflict')
    }
    const roomId = session.id
    const existingMigration = await tx.sessionRoomMigration.findUnique({
      where: { sessionId: session.id },
    })
    if (existingMigration && (existingMigration.roomId !== roomId
      || existingMigration.daemonInstallationId !== input.daemonInstallationId)) {
      throw new SessionRoomMirrorError('identity_conflict')
    }
    if (existingMigration?.state === 'canonical') throw new SessionRoomMirrorError('not_ready')
    const migration = existingMigration ?? await prepareRoom(tx, session, input.daemonInstallationId)
    if (input.mutations.length === 0 && existingMigration) {
      return { roomId, copiedRevision: migration.copiedRevision,
        copiedSequence: migration.copiedSequence.toString(),
        rollingHash: migration.rollingHash, idempotent: true }
    }
    if (input.fromRevision < migration.copiedRevision) {
      if (input.fromRevision + input.mutations.length > migration.copiedRevision) {
        throw new SessionRoomMirrorError('revision_conflict')
      }
      const receipts = await tx.sessionRoomMutationReceipt.findMany({
        where: { sessionId: session.id, revision: { gt: input.fromRevision,
          lte: input.fromRevision + input.mutations.length } },
        orderBy: { revision: 'asc' },
      })
      if (receipts.length !== input.mutations.length) {
        throw new SessionRoomMirrorError('revision_conflict')
      }
      for (let index = 0; index < input.mutations.length; index++) {
        const mutation = input.mutations[index]!
        validateMutation(mutation, session.id, input.daemonInstallationId,
          input.fromRevision + index + 1)
        if (receipts[index]!.mutationId !== mutation.mutationId
          || receipts[index]!.contentHash !== mutation.contentHash) {
          throw new SessionRoomMirrorError('revision_conflict')
        }
      }
      return { roomId, copiedRevision: migration.copiedRevision,
        copiedSequence: migration.copiedSequence.toString(),
        rollingHash: migration.rollingHash, idempotent: true }
    }
    if (input.fromRevision !== migration.copiedRevision) {
      throw new SessionRoomMirrorError('revision_conflict')
    }
    let copiedSequence = migration.copiedSequence
    let rollingHash = migration.rollingHash || ZERO_HASH
    for (let index = 0; index < input.mutations.length; index++) {
      const mutation = input.mutations[index]!
      validateMutation(mutation, session.id, input.daemonInstallationId,
        input.fromRevision + index + 1)
      const roomMessageId = sessionRoomMessageId(session.id, mutation.messageId)
      const previous = await tx.roomMessage.findUnique({ where: { id: roomMessageId },
        select: { id: true, roomId: true, sequence: true,
          sessionSourceId: true, sessionMessageId: true, sessionContentHash: true,
          authorPrincipalTypeSnapshot: true } })
      if (previous && (previous.roomId !== roomId
        || previous.sequence !== BigInt(mutation.sequence)
        || previous.sessionSourceId !== session.id
        || previous.sessionMessageId !== mutation.messageId)) {
        throw new SessionRoomMirrorError('message_conflict')
      }
      if (mutation.mutation === 'append' && previous) {
        throw new SessionRoomMirrorError('message_conflict')
      }
      const expectedMutationId = sha256(`${session.id}\0${mutation.messageId}\0${mutation.mutation}\0${previous?.sessionContentHash ?? 'none'}\0${mutation.contentHash}`)
      if (mutation.mutationId !== expectedMutationId) {
        throw new SessionRoomMirrorError('message_conflict')
      }
      const role = mutation.message?.role ?? 'user'
      if (previous && mutation.message
        && previous.authorPrincipalTypeSnapshot !== (role === 'agent' ? 'agent' : 'human')) {
        throw new SessionRoomMirrorError('message_conflict')
      }
      const human = await tx.roomMembership.findUnique({ where: {
        roomId_principalKey: { roomId, principalKey: `human:${session.userId}` },
      }, select: { id: true, displayAlias: true } })
      const agentKey = session.agentIdentityId
        ? `agent:${session.agentIdentityId}` : `execution:${session.id}`
      const agent = await tx.roomMembership.findUnique({ where: {
        roomId_principalKey: { roomId, principalKey: agentKey },
      }, select: { id: true, displayAlias: true } })
      if (!human || !agent) throw new SessionRoomMirrorError('identity_conflict')
      const author = role === 'agent' ? agent : human
      const authorType = role === 'agent' ? 'agent' : 'human'
      const createdAt = mutation.message
        ? new Date(mutation.message.ts) : new Date(mutation.committedAt)
      if (!Number.isFinite(createdAt.getTime())) throw new SessionRoomMirrorError('invalid')
      const values = { text: mutation.mutation === 'tombstone'
        ? null : mutation.message!.payload,
        deliveryStatus: mutation.deliveryState ?? null,
        deletedAt: mutation.mutation === 'tombstone'
          ? new Date(mutation.committedAt) : null,
        sessionRevision: mutation.revision,
        sessionContentHash: mutation.contentHash,
      }
      if (previous) {
        await tx.roomMessage.update({ where: { id: roomMessageId }, data: {
          ...values, editedAt: new Date(mutation.committedAt),
        } })
      } else {
        if (BigInt(mutation.sequence) <= copiedSequence) {
          throw new SessionRoomMirrorError('message_conflict')
        }
        await tx.roomMessage.create({ data: { id: roomMessageId,
          roomId, sequence: BigInt(mutation.sequence),
          authorMembershipId: author.id,
          authorPrincipalTypeSnapshot: authorType,
          ownerUserIdSnapshot: session.userId,
          authorDisplayNameSnapshot: author.displayAlias,
          ownerDisplayNameSnapshot: null,
          kind: 'text', source: role === 'agent' ? 'managed_agent' : 'cli',
          clientMessageId: roomMessageId, sessionSourceId: session.id,
          sessionMessageId: mutation.messageId, createdAt, ...values,
        } })
        copiedSequence = BigInt(mutation.sequence)
      }
      await tx.sessionRoomMutationReceipt.create({ data: {
        sessionId: session.id, revision: mutation.revision,
        mutationId: mutation.mutationId, contentHash: mutation.contentHash,
      } })
      rollingHash = nextSessionRoomAuditHash(rollingHash, mutation)
    }
    await tx.room.update({ where: { id: roomId }, data: { nextSequence: copiedSequence } })
    await tx.sessionRoomMigration.update({ where: { sessionId: session.id }, data: {
      copiedRevision: input.fromRevision + input.mutations.length,
      copiedSequence, rollingHash,
    } })
    return { roomId, copiedRevision: input.fromRevision + input.mutations.length,
      copiedSequence: copiedSequence.toString(), rollingHash, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}

async function prepareRoom(tx: Prisma.TransactionClient, session: {
  id: string; userId: string; title: string; agentType: string;
  agentIdentityId: string | null;
  agentIdentity: { displayName: string } | null;
}, daemonInstallationId: string) {
  const owner = await tx.user.findUnique({ where: { id: session.userId },
    select: { name: true } })
  if (!owner?.name.trim()) throw new SessionRoomMirrorError('identity_conflict')
  const existingRoom = await tx.room.findUnique({ where: { id: session.id },
    select: { id: true, conversationKind: true, ownerUserId: true } })
  if (existingRoom && (existingRoom.conversationKind !== 'work'
    || existingRoom.ownerUserId !== session.userId)) {
    throw new SessionRoomMirrorError('identity_conflict')
  }
  if (!existingRoom) await tx.room.create({ data: {
    id: session.id, name: session.title.trim() || '对话',
    conversationKind: 'work', createdByUserId: session.userId,
    ownerUserId: session.userId, visibility: 'private', joinPolicy: 'closed',
  } })
  const human = await tx.roomMembership.upsert({ where: {
    roomId_principalKey: { roomId: session.id, principalKey: `human:${session.userId}` },
  }, create: { roomId: session.id, principalKey: `human:${session.userId}`,
    principalType: 'human', userId: session.userId, ownerUserId: session.userId,
    displayAlias: owner.name.trim(), role: 'owner' }, update: {},
    select: { id: true, status: true } })
  const agentKey = session.agentIdentityId
    ? `agent:${session.agentIdentityId}` : `execution:${session.id}`
  const agent = await tx.roomMembership.upsert({ where: {
    roomId_principalKey: { roomId: session.id, principalKey: agentKey },
  }, create: { roomId: session.id, principalKey: agentKey,
    principalType: 'agent', agentIdentityId: session.agentIdentityId,
    ownerUserId: session.userId, parentHumanMembershipId: human.id,
    displayAlias: session.agentIdentity?.displayName.trim() || session.agentType,
    role: 'member' }, update: {}, select: { id: true, status: true } })
  if (human.status !== 'active' || agent.status !== 'active') {
    throw new SessionRoomMirrorError('identity_conflict')
  }
  await tx.roomReadState.upsert({ where: { membershipId: human.id },
    create: { roomId: session.id, membershipId: human.id }, update: {} })
  await tx.nianSession.update({ where: { id: session.id },
    data: { conversationRoomId: session.id } })
  return tx.sessionRoomMigration.create({ data: {
    sessionId: session.id, roomId: session.id, daemonInstallationId,
    rollingHash: ZERO_HASH,
  } })
}

/** Read-only cutover audit. A passing result does not change write authority. */
export async function auditSessionRoomMirror(input: {
  sessionId: string
  machineId: string
  ownerUserId: string
  daemonInstallationId: string
  expectedRevision: number
  expectedRollingHash: string
  expectedVisibleMessageCount: number
  expectedLastVisibleMessageId: string | null
}) {
  if (!input.sessionId || !input.machineId || !input.ownerUserId
    || !input.daemonInstallationId || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 0 || !SHA256.test(input.expectedRollingHash)
    || !Number.isSafeInteger(input.expectedVisibleMessageCount)
    || input.expectedVisibleMessageCount < 0
    || (input.expectedLastVisibleMessageId !== null
      && typeof input.expectedLastVisibleMessageId !== 'string')) {
    throw new SessionRoomMirrorError('invalid')
  }
  const session = await prisma.nianSession.findUnique({ where: { id: input.sessionId },
    select: { id: true, userId: true, machineId: true,
      daemonInstallationId: true, dataEpoch: true, bodyRevision: true,
      deletedAt: true, conversationRoomId: true, bodyStorageMode: true } })
  if (!session) throw new SessionRoomMirrorError('not_found')
  if (session.userId !== input.ownerUserId || session.machineId !== input.machineId
    || session.daemonInstallationId !== input.daemonInstallationId
    || session.dataEpoch !== SESSION_SYNC_DATA_EPOCH || session.deletedAt) {
    throw new SessionRoomMirrorError('identity_conflict')
  }
  const [migration, room, receiptCount, visibleCount, latestVisible] = await Promise.all([
    prisma.sessionRoomMigration.findUnique({ where: { sessionId: input.sessionId } }),
    prisma.room.findUnique({ where: { id: input.sessionId },
      select: { id: true, conversationKind: true, nextSequence: true } }),
    prisma.sessionRoomMutationReceipt.count({ where: { sessionId: input.sessionId } }),
    prisma.roomMessage.count({ where: { roomId: input.sessionId,
      sessionSourceId: input.sessionId, deletedAt: null } }),
    prisma.roomMessage.findFirst({ where: { roomId: input.sessionId,
      sessionSourceId: input.sessionId, deletedAt: null },
    orderBy: { sequence: 'desc' }, select: { sessionMessageId: true } }),
  ])
  const blockers: string[] = []
  if (!migration || migration.state !== 'shadow'
    || migration.roomId !== input.sessionId
    || migration.daemonInstallationId !== input.daemonInstallationId) {
    blockers.push('migration_state')
  }
  if (!room || room.conversationKind !== 'work'
    || session.conversationRoomId !== input.sessionId) blockers.push('room_identity')
  if (session.bodyStorageMode !== 'machine_local'
    || session.bodyRevision !== input.expectedRevision) blockers.push('source_index_revision')
  if (migration?.copiedRevision !== input.expectedRevision
    || receiptCount !== input.expectedRevision) blockers.push('revision_parity')
  if (migration?.rollingHash !== input.expectedRollingHash) blockers.push('hash_parity')
  if (migration?.copiedSequence !== room?.nextSequence) blockers.push('sequence_parity')
  if (visibleCount !== input.expectedVisibleMessageCount
    || (latestVisible?.sessionMessageId ?? null) !== input.expectedLastVisibleMessageId) {
    blockers.push('visible_message_parity')
  }
  return { ready: blockers.length === 0, blockers,
    copiedRevision: migration?.copiedRevision ?? null,
    copiedSequence: migration?.copiedSequence.toString() ?? null,
    rollingHash: migration?.rollingHash ?? null }
}

/** Keep legacy Session deletion semantics until work Rooms become the UI authority. */
export async function deleteSessionWorkRoomInTransaction(
  tx: Prisma.TransactionClient, sessionId: string, conversationRoomId: string | null,
): Promise<void> {
  if (!conversationRoomId || conversationRoomId !== sessionId) return
  const room = await tx.room.findUnique({ where: { id: conversationRoomId },
    select: { id: true, conversationKind: true } })
  if (!room || room.conversationKind !== 'work') return
  const otherExecutions = await tx.nianSession.count({ where: {
    conversationRoomId, id: { not: sessionId },
  } })
  if (otherExecutions > 0) return
  await tx.roomMessage.deleteMany({ where: { roomId: conversationRoomId } })
  await tx.room.delete({ where: { id: conversationRoomId } })
}
