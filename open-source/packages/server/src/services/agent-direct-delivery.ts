// @arch open-source/docs/server-runtime.md

import crypto from 'node:crypto'
import { normalizeProjectMatchPath, SESSION_SYNC_DATA_EPOCH } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { assessPublicAgentRuntime } from './public-agent-runtime-proof.js'
import { resolveStoredManagedAgentPermissionPolicy } from './managed-agent-permission-policy.js'
import { broadcastRoomMessageRecord } from './room-events.js'
import { syncCancelledPublishedAiRoomMessages } from './published-ai-room-status.js'
import {
  commitSessionDeletionInTransaction,
  finalizeCommittedSessionDeletion,
  type CommittedSessionDeletion,
} from './sessions.js'

const LEASE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 3
const OWNER_CONCURRENT_TURNS = 2
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export class AgentDirectDeliveryError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'stale' | 'unavailable') {
    super(code)
  }
}

function hash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function retryable(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'P2034' || error.code === 'P2002')
}

/** Claim at most one visitor turn per conversation; a machine never receives another owner's work. */
export async function claimAgentDirectMessage(input: {
  ownerUserId: string; machineId: string; supportsAttachments?: boolean; now?: Date
}) {
  const now = input.now ?? new Date()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Rotating a binding to a new epoch orphans its previous hidden
        // Session unless we tombstone it through the same controlled deletion
        // state machine ordinary user-visible Sessions use.
        const sessionDeletions: CommittedSessionDeletion[] = []
        // Serialize claims across every machine owned by this publisher. A
        // machine-local count alone cannot bound the owner's total model cost.
        const owner = await tx.$queryRaw<Array<{ id: string }>>
          `SELECT id FROM \`User\` WHERE id = ${input.ownerUserId} FOR UPDATE`
        if (owner.length !== 1) return { claim: null, sessionDeletions }
        const ownerRunning = await tx.agentDirectMessage.count({
          where: { status: 'running', leaseExpiresAt: { gt: now },
            conversation: { ownerUserId: input.ownerUserId } },
        })
        if (ownerRunning >= OWNER_CONCURRENT_TURNS) return { claim: null, sessionDeletions }
        // The current daemon executes one public turn at a time. Enforce the
        // same limit at the Server when two daemon processes share a machine.
        const machineRunning = await tx.agentDirectMessage.count({
          where: { status: 'running', leaseExpiresAt: { gt: now }, conversation: {
            ownerUserId: input.ownerUserId,
            agentIdentity: { machineId: input.machineId },
          } },
        })
        if (machineRunning > 0) return { claim: null, sessionDeletions }
        const machine = await tx.machine.findUnique({ where: { id: input.machineId },
          select: { agents: true } })
        if (!machine) return { claim: null, sessionDeletions }
        const candidates = await tx.agentDirectMessage.findMany({
          where: {
            authorRole: 'visitor',
            ...(input.supportsAttachments ? {} : { attachments: { none: {} } }),
            OR: [{ status: 'pending' }, { status: 'running', leaseExpiresAt: { lt: now } }],
            conversation: {
              ownerUserId: input.ownerUserId,
              agentIdentity: { machineId: input.machineId },
              // Exclude a conversation with an active lease before the
              // bounded candidate page, so its backlog cannot hide others.
              messages: { none: { status: 'running', leaseExpiresAt: { gt: now } } },
            },
          },
          // Rotate conversations after each claim. A single visitor's backlog
          // must not fill the bounded candidate page on every poll.
          orderBy: [{ conversation: { lastActivityAt: 'asc' } },
            { createdAt: 'asc' }, { id: 'asc' }],
          take: 25,
          select: { id: true, conversationId: true },
        })
        for (const candidate of candidates) {
          const conversation = await tx.agentDirectConversation.findUnique({
            where: { id: candidate.conversationId },
            include: {
              publication: true,
              agentIdentity: true,
              binding: true,
            },
          })
          if (!conversation || conversation.ownerUserId !== input.ownerUserId
            || conversation.agentIdentity.machineId !== input.machineId) continue
          // Publication first, then conversation: same lock order as the send path.
          await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${conversation.publicationId} FOR UPDATE`
          await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${conversation.agentIdentityId} FOR UPDATE`
          await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${conversation.id} FOR UPDATE`
          const message = await tx.agentDirectMessage.findUnique({ where: { id: candidate.id } })
          if (!message || !['pending', 'running'].includes(message.status)
            || (message.status === 'running' && (!message.leaseExpiresAt || message.leaseExpiresAt >= now))) continue
          const attachments = await tx.agentDirectAttachment.findMany({
            where: { messageId: message.id },
            select: { id: true, name: true, mimeType: true, mediaKind: true,
              byteSize: true, sha256: true, status: true, expiresAt: true },
            orderBy: { createdAt: 'asc' },
          })
          // Older daemons must never silently process only the text of a file turn.
          if (attachments.length && !input.supportsAttachments) continue
          const publication = await tx.agentPublication.findUnique({
            where: { id: conversation.publicationId },
            select: { status: true, generation: true, policyVersion: true,
              ownerUserId: true, agentIdentityId: true },
          })
          const agent = await tx.agentIdentity.findUnique({
            where: { id: conversation.agentIdentityId },
            select: { status: true, ownerUserId: true, machineId: true,
              runtimeAdapter: true, sessionMode: true, configurationVersion: true,
              permissionPolicy: true, permissionPolicyVersion: true, permissionConfirmation: true },
          })
          const runtimeAdapter = agent?.runtimeAdapter
          const executableFingerprint = agent && typeof runtimeAdapter === 'string'
            ? assessPublicAgentRuntime(machine.agents, runtimeAdapter,
              resolveStoredManagedAgentPermissionPolicy(agent),
              agent.permissionConfirmation).executableFingerprint : null
          const current = publication?.status === 'active'
            && publication.ownerUserId === input.ownerUserId
            && publication.agentIdentityId === conversation.agentIdentityId
            && publication.generation === message.publicationGeneration
            && publication.policyVersion === message.policyVersion
            && conversation.status === 'active'
            && agent?.status === 'active'
            && agent.sessionMode === 'standard'
            && agent.ownerUserId === input.ownerUserId
            && agent.configurationVersion === message.agentConfigurationVersion
            && agent.machineId === input.machineId
            && typeof runtimeAdapter === 'string'
            && executableFingerprint !== null
          if (!current || message.attempts >= MAX_ATTEMPTS) {
            await tx.agentDirectMessage.updateMany({
              where: { id: message.id, status: message.status },
              data: { status: current ? 'failed' : 'cancelled',
                failureCode: current ? 'retry_exhausted' : null,
                claimTokenHash: null, leaseExpiresAt: null },
            })
            if (conversation.canonicalState === 'ready') {
              await tx.roomMessage.updateMany({
                where: { id: message.id, roomId: conversation.id },
                data: { deliveryStatus: current ? 'failed' : 'cancelled' },
              })
            }
            continue
          }
          const anotherRunning = await tx.agentDirectMessage.count({
            where: { conversationId: conversation.id, id: { not: message.id },
              status: 'running', leaseExpiresAt: { gt: now } },
          })
          if (anotherRunning) continue
          const staleNianSessionId = conversation.binding
            && (conversation.binding.appliedPolicyVersion !== publication!.policyVersion
              || conversation.binding.machineId !== input.machineId
              || conversation.binding.runtimeAdapter !== runtimeAdapter)
            ? conversation.binding.nianSessionId
            : null
          if (staleNianSessionId) {
            // The old epoch's hidden Session loses its only reference below;
            // tombstone it now so the daemon that owns it still cleans up its
            // native files instead of the row lingering forever.
            sessionDeletions.push(await commitSessionDeletionInTransaction(
              tx, staleNianSessionId, input.ownerUserId, { nativeCleanupPolicy: 'auto', deletedAt: now },
            ))
          }
          const binding = conversation.binding
            ? conversation.binding.appliedPolicyVersion === publication!.policyVersion
              && conversation.binding.machineId === input.machineId
              && conversation.binding.runtimeAdapter === runtimeAdapter
              ? conversation.binding
              : await tx.agentDirectBinding.update({
                  where: { id: conversation.binding.id },
                  data: { nianSessionId: null, machineId: input.machineId,
                    runtimeAdapter: runtimeAdapter!,
                    appliedPolicyVersion: publication!.policyVersion,
                    bindingEpoch: { increment: 1 }, status: 'pending',
                    lastDeliveredSequence: 0n },
                })
            : await tx.agentDirectBinding.create({
                data: { conversationId: conversation.id, machineId: input.machineId,
                  runtimeAdapter: runtimeAdapter!,
                  appliedPolicyVersion: publication!.policyVersion, status: 'pending' },
              })
          const token = crypto.randomBytes(32).toString('base64url')
          const leaseExpiresAt = new Date(now.getTime() + LEASE_MS)
          const claimed = await tx.agentDirectMessage.updateMany({
            where: { id: message.id, status: message.status,
              ...(message.status === 'running' ? { leaseExpiresAt: { lt: now } } : {}) },
            data: { status: 'running', attempts: { increment: 1 },
              claimTokenHash: hash(token), leaseExpiresAt },
          })
          if (claimed.count !== 1) continue
          const canonicalMessage = conversation.canonicalState === 'ready'
            ? await tx.roomMessage.findUnique({ where: { id: message.id },
              select: { roomId: true, text: true } }) : null
          const claimText = canonicalMessage?.text ?? message.text
          if (claimText === null || (canonicalMessage && canonicalMessage.roomId !== conversation.id)) {
            throw new AgentDirectDeliveryError('unavailable')
          }
          if (attachments.some((file) => file.status !== 'ready'
            || (file.expiresAt && file.expiresAt <= now))) {
            throw new AgentDirectDeliveryError('unavailable')
          }
          if (conversation.canonicalState === 'ready') {
            await tx.roomMessage.update({ where: { id: message.id },
              data: { deliveryStatus: 'running' } })
          }
          await tx.agentDirectConversation.update({
            where: { id: conversation.id }, data: { lastActivityAt: now },
          })
          return { claim: {
            messageId: message.id, conversationId: conversation.id,
            agentIdentityId: conversation.agentIdentityId,
            runtimeAdapter: runtimeAdapter!,
            executableFingerprint: executableFingerprint!,
            bindingId: binding.id, bindingEpoch: binding.bindingEpoch,
            sequence: message.sequence.toString(), text: claimText,
            ...(attachments.length ? { attachments: attachments.map((file) => ({ attachmentId: file.id, name: file.name,
              mimeType: file.mimeType, mediaKind: file.mediaKind,
              byteSize: file.byteSize.toString(), sha256: file.sha256 })) } : {}),
            leaseToken: token, leaseExpiresAt: leaseExpiresAt.toISOString(),
          }, sessionDeletions }
        }
        return { claim: null, sessionDeletions }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      for (const deletion of result.sessionDeletions) finalizeCommittedSessionDeletion(deletion)
      return { claim: result.claim }
    } catch (error) {
      if (!retryable(error) || attempt === 2) throw error
    }
  }
  return { claim: null }
}

/** Only the paired host holding this turn's short lease may submit its reply. */
export async function completeAgentDirectMessage(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; replyText: unknown; pauseConversation?: unknown; now?: Date
}) {
  if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.messageId)
    || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)
    || !Number.isSafeInteger(input.bindingEpoch) || Number(input.bindingEpoch) < 1
    || typeof input.leaseToken !== 'string' || !TOKEN.test(input.leaseToken)
    || (input.pauseConversation !== undefined && typeof input.pauseConversation !== 'boolean')
    || typeof input.replyText !== 'string' || !input.replyText.trim()
    || input.replyText.length > 20_000) throw new AgentDirectDeliveryError('invalid')
  const replyText = input.replyText.trim()
  const now = input.now ?? new Date()
  const result = await prisma.$transaction(async (tx) => {
    const initial = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      select: { publicationId: true, agentIdentityId: true },
    })
    if (!initial) throw new AgentDirectDeliveryError('not_found')
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${initial.publicationId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${initial.agentIdentityId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${input.conversationId as string} FOR UPDATE`
    const conversation = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      include: { publication: true, agentIdentity: true, binding: true },
    })
    const message = await tx.agentDirectMessage.findUnique({ where: { id: input.messageId as string } })
    if (!conversation || !message || message.conversationId !== conversation.id
      || message.authorRole !== 'visitor' || !['running', 'answered'].includes(message.status)
      || message.claimTokenHash !== hash(input.leaseToken as string)
      || !message.leaseExpiresAt || message.leaseExpiresAt <= now
      || conversation.ownerUserId !== input.ownerUserId
      || conversation.agentIdentity.machineId !== input.machineId
      || !conversation.binding || conversation.binding.bindingEpoch !== input.bindingEpoch
      || !conversation.binding.nianSessionId) {
      throw new AgentDirectDeliveryError('stale')
    }
    if (message.status === 'answered') {
      const reply = conversation.canonicalState === 'ready'
        ? await tx.roomMessage.findFirst({
          where: { roomId: conversation.id, clientMessageId: `reply:${message.id}`,
            authorPrincipalTypeSnapshot: 'agent' },
          select: { id: true, sequence: true, text: true },
        })
        : await tx.agentDirectMessage.findUnique({
          where: { conversationId_authorRole_clientMessageId: {
            conversationId: conversation.id, authorRole: 'agent',
            clientMessageId: `reply:${message.id}`,
          } },
          select: { id: true, sequence: true, text: true },
        })
      if (!reply || reply.text !== replyText) throw new AgentDirectDeliveryError('stale')
      return { replyMessageId: reply.id, sequence: reply.sequence.toString(), idempotent: true }
    }
    const pauseThisVisitor = async () => {
      if (input.pauseConversation !== true) return
      // This is deliberately conversation-scoped: one visitor cannot pause the
      // publication or another visitor's independent queue.
      await tx.agentDirectConversation.update({ where: { id: conversation.id },
        data: { status: 'paused', lastActivityAt: now } })
      await tx.agentDirectMessage.updateMany({
        where: { conversationId: conversation.id, authorRole: 'visitor',
          status: { in: ['pending', 'running'] } },
        data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, { id: conversation.id })
    }
    const nativeSession = await tx.nianSession.findFirst({
      where: { id: conversation.binding.nianSessionId!,
        creationKey: `published-agent:${conversation.id}:${conversation.binding.bindingEpoch}`,
        userId: input.ownerUserId, machineId: input.machineId,
        agentIdentityId: conversation.agentIdentityId,
        nativeSessionVisibility: 'internal', status: 'active', roomBinding: null },
      select: { id: true, agentSessionId: true },
    })
    if (conversation.status !== 'active' || conversation.publication.status !== 'active'
      || conversation.publication.generation !== message.publicationGeneration
      || conversation.publication.policyVersion !== message.policyVersion
      || conversation.agentIdentity.configurationVersion !== message.agentConfigurationVersion
      || conversation.agentIdentity.status !== 'active'
      || !conversation.agentIdentity.runtimeAdapter
      || !nativeSession?.agentSessionId
      || conversation.agentIdentity.ownerUserId !== input.ownerUserId) {
      await tx.agentDirectMessage.update({ where: { id: message.id },
        data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null } })
      if (conversation.canonicalState === 'ready') {
        await tx.roomMessage.updateMany({
          where: { id: message.id, roomId: conversation.id },
          data: { deliveryStatus: 'cancelled' },
        })
      }
      return null
    }
    if (conversation.canonicalState === 'ready') {
      if (conversation.roomId !== conversation.id) throw new AgentDirectDeliveryError('stale')
      const agentMembership = await tx.roomMembership.findUnique({
        where: { roomId_principalKey: {
          roomId: conversation.id, principalKey: `agent:${conversation.agentIdentityId}`,
        } },
        select: { id: true, displayAlias: true, status: true },
      })
      const owner = await tx.user.findUnique({ where: { id: input.ownerUserId },
        select: { name: true } })
      if (!agentMembership || agentMembership.status !== 'active' || !owner) {
        throw new AgentDirectDeliveryError('stale')
      }
      const advanced = await tx.room.update({ where: { id: conversation.id },
        data: { nextSequence: { increment: 1 } }, select: { nextSequence: true } })
      const reply = await tx.roomMessage.create({ data: {
        roomId: conversation.id, sequence: advanced.nextSequence,
        authorMembershipId: agentMembership.id,
        authorPrincipalTypeSnapshot: 'agent',
        ownerUserIdSnapshot: input.ownerUserId,
        authorDisplayNameSnapshot: agentMembership.displayAlias,
        ownerDisplayNameSnapshot: owner.name.trim(),
        kind: 'text', source: 'managed_agent', text: replyText,
        clientMessageId: `reply:${message.id}`, deliveryStatus: 'sent', createdAt: now,
      }, select: { id: true } })
      await tx.agentDirectMessage.update({ where: { id: message.id },
        data: { status: 'answered', leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } })
      await tx.roomMessage.update({ where: { id: message.id },
        data: { deliveryStatus: 'answered' } })
      await tx.agentDirectConversation.update({ where: { id: conversation.id },
        data: { nextSequence: advanced.nextSequence,
          canonicalCopiedSequence: advanced.nextSequence, lastActivityAt: now } })
      await tx.agentDirectBinding.update({ where: { id: conversation.binding.id },
        data: { lastDeliveredSequence: message.sequence, status: 'active' } })
      await pauseThisVisitor()
      return { replyMessageId: reply.id, sequence: advanced.nextSequence.toString(),
        idempotent: false, canonicalRoomId: conversation.id }
    }
    const advanced = await tx.agentDirectConversation.update({
      where: { id: conversation.id },
      data: { nextSequence: { increment: 1 }, lastActivityAt: now },
      select: { nextSequence: true },
    })
    const reply = await tx.agentDirectMessage.create({
      data: { conversationId: conversation.id, sequence: advanced.nextSequence,
        authorRole: 'agent', clientMessageId: `reply:${message.id}`,
        publicationGeneration: message.publicationGeneration,
        policyVersion: message.policyVersion,
        text: replyText, status: 'sent', createdAt: now },
      select: { id: true },
    })
    await tx.agentDirectMessage.update({ where: { id: message.id },
      data: { status: 'answered', leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } })
    await tx.agentDirectBinding.update({ where: { id: conversation.binding.id },
      data: { lastDeliveredSequence: message.sequence, status: 'active' } })
    await pauseThisVisitor()
    return { replyMessageId: reply.id, sequence: advanced.nextSequence.toString(), idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (!result) throw new AgentDirectDeliveryError('stale')
  if ('canonicalRoomId' in result && result.canonicalRoomId) {
    const record = await prisma.roomMessage.findUnique({
      where: { id: result.replyMessageId },
      include: { attachments: true, authorMembership: {
        select: { displayAlias: true, status: true },
      } },
    })
    if (record) await broadcastRoomMessageRecord(result.canonicalRoomId, record)
  }
  return { replyMessageId: result.replyMessageId, sequence: result.sequence,
    idempotent: result.idempotent }
}

/** Let the paired host stop a running adapter promptly when its publication is revoked. */
export async function checkAgentDirectLease(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; now?: Date
}) {
  if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.messageId)
    || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)
    || !Number.isSafeInteger(input.bindingEpoch) || Number(input.bindingEpoch) < 1
    || typeof input.leaseToken !== 'string' || !TOKEN.test(input.leaseToken)) {
    throw new AgentDirectDeliveryError('invalid')
  }
  const now = input.now ?? new Date()
  const message = await prisma.agentDirectMessage.findUnique({
    where: { id: input.messageId },
    include: { conversation: { include: {
      publication: true, agentIdentity: true, binding: true,
    } } },
  })
  const conversation = message?.conversation
  if (!message || !conversation || message.conversationId !== input.conversationId
    || message.authorRole !== 'visitor' || message.status !== 'running'
    || message.claimTokenHash !== hash(input.leaseToken)
    || !message.leaseExpiresAt || message.leaseExpiresAt <= now
    || conversation.ownerUserId !== input.ownerUserId
    || conversation.publication.ownerUserId !== input.ownerUserId
    || conversation.publication.agentIdentityId !== conversation.agentIdentityId
    || conversation.agentIdentity.machineId !== input.machineId
    || conversation.agentIdentity.ownerUserId !== input.ownerUserId
    || conversation.agentIdentity.status !== 'active'
    || !conversation.agentIdentity.runtimeAdapter
    || conversation.status !== 'active'
    || conversation.publication.status !== 'active'
    || conversation.publication.generation !== message.publicationGeneration
    || conversation.publication.policyVersion !== message.policyVersion
    || conversation.agentIdentity.configurationVersion !== message.agentConfigurationVersion
    || conversation.binding?.machineId !== input.machineId
    || conversation.binding.bindingEpoch !== input.bindingEpoch
    || conversation.binding.runtimeAdapter !== conversation.agentIdentity.runtimeAdapter
    || conversation.binding.appliedPolicyVersion !== message.policyVersion) {
    throw new AgentDirectDeliveryError('stale')
  }
  return { valid: true, leaseExpiresAt: message.leaseExpiresAt.toISOString() }
}

/** Mark a provider turn failed so visitors do not wait for the lease to expire. */
export async function failAgentDirectMessage(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; failureCode: unknown; now?: Date
}) {
  const allowed = new Set(['runtime_unavailable', 'execution_failed', 'timeout', 'empty_reply',
    'provider_limit', 'unauthorized_tool_attempt'])
  if (typeof input.failureCode !== 'string' || !allowed.has(input.failureCode)) {
    throw new AgentDirectDeliveryError('invalid')
  }
  // Reject stale publication or machine ownership before changing message state.
  await checkAgentDirectLease(input)
  await prisma.$transaction(async (tx) => {
    const changed = await tx.agentDirectMessage.updateMany({
      where: { id: input.messageId as string, conversationId: input.conversationId as string,
        status: 'running', claimTokenHash: hash(input.leaseToken as string),
        leaseExpiresAt: { gt: input.now ?? new Date() } },
      data: { status: 'failed', failureCode: input.failureCode as string,
        claimTokenHash: null, leaseExpiresAt: null },
    })
    if (changed.count !== 1) throw new AgentDirectDeliveryError('stale')
    await tx.roomMessage.updateMany({
      where: { id: input.messageId as string, roomId: input.conversationId as string },
      data: { deliveryStatus: 'failed' },
    })
  })
  return { failed: true }
}

/** A claimed visitor turn must bind to one private native Session, never a Room or another visitor. */
export async function bindAgentDirectSession(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; nianSessionId: unknown; now?: Date
}) {
  if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.messageId)
    || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)
    || !Number.isSafeInteger(input.bindingEpoch) || Number(input.bindingEpoch) < 1
    || typeof input.leaseToken !== 'string' || !TOKEN.test(input.leaseToken)
    || typeof input.nianSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(input.nianSessionId)) {
    throw new AgentDirectDeliveryError('invalid')
  }
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const initial = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      select: { publicationId: true, agentIdentityId: true },
    })
    if (!initial) throw new AgentDirectDeliveryError('not_found')
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${initial.publicationId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${initial.agentIdentityId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${input.conversationId as string} FOR UPDATE`
    const conversation = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      include: { publication: true, agentIdentity: true, binding: true },
    })
    const message = await tx.agentDirectMessage.findUnique({ where: { id: input.messageId as string } })
    if (!conversation || !conversation.binding || !message
      || message.conversationId !== conversation.id || message.authorRole !== 'visitor'
      || message.status !== 'running' || message.claimTokenHash !== hash(input.leaseToken as string)
      || !message.leaseExpiresAt || message.leaseExpiresAt <= now
      || conversation.ownerUserId !== input.ownerUserId
      || conversation.agentIdentity.machineId !== input.machineId
      || conversation.binding.machineId !== input.machineId
      || conversation.binding.bindingEpoch !== input.bindingEpoch
      || conversation.status !== 'active' || conversation.publication.status !== 'active'
      || conversation.publication.generation !== message.publicationGeneration
      || conversation.publication.policyVersion !== message.policyVersion
      || conversation.agentIdentity.configurationVersion !== message.agentConfigurationVersion
      || conversation.agentIdentity.status !== 'active'
      || !conversation.agentIdentity.runtimeAdapter
      || conversation.agentIdentity.ownerUserId !== input.ownerUserId) {
      throw new AgentDirectDeliveryError('stale')
    }
    if (conversation.binding.nianSessionId
      && conversation.binding.nianSessionId !== input.nianSessionId) {
      throw new AgentDirectDeliveryError('stale')
    }
    const session = await tx.nianSession.findFirst({
      where: { id: input.nianSessionId as string, userId: input.ownerUserId,
        machineId: input.machineId, agentIdentityId: conversation.agentIdentityId,
        agentType: conversation.agentIdentity.runtimeAdapter!,
        creationKey: `published-agent:${conversation.id}:${conversation.binding.bindingEpoch}`,
        nativeSessionVisibility: 'internal', status: 'active',
        roomBinding: null },
      select: { id: true },
    })
    if (!session) throw new AgentDirectDeliveryError('unavailable')
    const bound = await tx.agentDirectBinding.updateMany({
      where: { id: conversation.binding.id, bindingEpoch: input.bindingEpoch as number,
        machineId: input.machineId,
        OR: [{ nianSessionId: null }, { nianSessionId: input.nianSessionId as string }] },
      data: { nianSessionId: input.nianSessionId as string, status: 'active' },
    })
    if (bound.count !== 1) throw new AgentDirectDeliveryError('stale')
    return { bindingId: conversation.binding.id,
      bindingEpoch: conversation.binding.bindingEpoch,
      nianSessionId: input.nianSessionId as string }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

function publicWorkDir(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || value.includes('\0')) {
    throw new AgentDirectDeliveryError('invalid')
  }
  const normalized = normalizeProjectMatchPath(value)
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value.trim())
  const segments = normalized.split('/')
  if (!absolute || segments.includes('..') || segments.includes('.')) {
    throw new AgentDirectDeliveryError('invalid')
  }
  return value.trim()
}

function allowedPublicWorkDir(workDir: string, agentWorkDir: string, conversationId: string): boolean {
  const normalized = normalizeProjectMatchPath(workDir)
  // Keep released daemons and rollback compatible; new daemons use the saved
  // Agent directory instead of manufacturing a directory for each visitor.
  return normalized === normalizeProjectMatchPath(agentWorkDir)
    || normalized.endsWith(`/published-agents/${conversationId}`)
}

/** Create a hidden, conversation-specific Shennian Session before the host starts its adapter. */
export async function prepareAgentDirectSession(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; workDir: unknown; now?: Date
}) {
  if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.messageId)
    || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)
    || !Number.isSafeInteger(input.bindingEpoch) || Number(input.bindingEpoch) < 1
    || typeof input.leaseToken !== 'string' || !TOKEN.test(input.leaseToken)) {
    throw new AgentDirectDeliveryError('invalid')
  }
  const workDir = publicWorkDir(input.workDir)
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const initial = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      select: { publicationId: true, agentIdentityId: true },
    })
    if (!initial) throw new AgentDirectDeliveryError('not_found')
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${initial.publicationId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${initial.agentIdentityId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${input.conversationId as string} FOR UPDATE`
    const conversation = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      include: { publication: true, agentIdentity: true, binding: true },
    })
    const message = await tx.agentDirectMessage.findUnique({ where: { id: input.messageId as string } })
    if (!conversation || !conversation.binding || !message
      || message.conversationId !== conversation.id || message.authorRole !== 'visitor'
      || message.status !== 'running' || message.claimTokenHash !== hash(input.leaseToken as string)
      || !message.leaseExpiresAt || message.leaseExpiresAt <= now
      || conversation.ownerUserId !== input.ownerUserId
      || conversation.agentIdentity.machineId !== input.machineId
      || conversation.binding.machineId !== input.machineId
      || conversation.binding.bindingEpoch !== input.bindingEpoch
      || conversation.status !== 'active' || conversation.publication.status !== 'active'
      || conversation.publication.generation !== message.publicationGeneration
      || conversation.publication.policyVersion !== message.policyVersion
      || conversation.agentIdentity.configurationVersion !== message.agentConfigurationVersion
      || conversation.agentIdentity.status !== 'active'
      || !conversation.agentIdentity.runtimeAdapter
      || conversation.agentIdentity.ownerUserId !== input.ownerUserId) {
      throw new AgentDirectDeliveryError('stale')
    }
    if (!allowedPublicWorkDir(workDir, conversation.agentIdentity.workDir, conversation.id)) {
      throw new AgentDirectDeliveryError('invalid')
    }
    const machine = await tx.machine.findFirst({
      where: { id: input.machineId, userId: input.ownerUserId, paired: true, online: true },
      select: { daemonInstallationId: true },
    })
    if (!machine?.daemonInstallationId) throw new AgentDirectDeliveryError('unavailable')
    const creationKey = `published-agent:${conversation.id}:${conversation.binding.bindingEpoch}`
    let session = await tx.nianSession.findUnique({ where: { creationKey },
      select: { id: true, userId: true, machineId: true, agentIdentityId: true,
        agentType: true, agentSessionId: true, workDir: true, nativeSessionVisibility: true,
        status: true, roomBinding: { select: { id: true } } } })
    if (session) {
      if (session.userId !== input.ownerUserId || session.machineId !== input.machineId
        || session.agentIdentityId !== conversation.agentIdentityId
        || session.agentType !== conversation.agentIdentity.runtimeAdapter
        || session.nativeSessionVisibility !== 'internal'
        || session.status !== 'active' || session.roomBinding) {
        throw new AgentDirectDeliveryError('stale')
      }
      if (session.workDir !== workDir) {
        if (!allowedPublicWorkDir(publicWorkDir(session.workDir),
          conversation.agentIdentity.workDir, conversation.id)) {
          throw new AgentDirectDeliveryError('stale')
        }
        // Move only this exact internal Session's working directory. Keep its
        // native context and binding; never move/delete old files or projects.
        await tx.nianSession.update({ where: { id: session.id }, data: { workDir } })
      }
    } else {
      session = await tx.nianSession.create({
        data: { creationKey, userId: input.ownerUserId, machineId: input.machineId,
          daemonInstallationId: machine.daemonInstallationId,
          dataEpoch: SESSION_SYNC_DATA_EPOCH,
          agentIdentityId: conversation.agentIdentityId,
          agentType: conversation.agentIdentity.runtimeAdapter!,
          sessionMode: conversation.agentIdentity.sessionMode,
          managerConfig: conversation.agentIdentity.managerConfig ?? undefined,
          modelId: conversation.agentIdentity.modelId,
          modelSource: 'agent', workDir, status: 'active',
          nativeSessionVisibility: 'internal', bodyStorageMode: 'machine_local',
          userStates: { create: { userId: input.ownerUserId } } },
        select: { id: true, userId: true, machineId: true, agentIdentityId: true,
          agentType: true, agentSessionId: true, workDir: true, nativeSessionVisibility: true,
          status: true, roomBinding: { select: { id: true } } },
      })
    }
    const bound = await tx.agentDirectBinding.updateMany({
      where: { id: conversation.binding.id, machineId: input.machineId,
        bindingEpoch: input.bindingEpoch as number,
        OR: [{ nianSessionId: null }, { nianSessionId: session.id }] },
      data: { nianSessionId: session.id, status: 'active' },
    })
    if (bound.count !== 1) throw new AgentDirectDeliveryError('stale')
    return { nianSessionId: session.id, nativeSessionId: session.agentSessionId,
      bindingId: conversation.binding.id,
      bindingEpoch: conversation.binding.bindingEpoch, workDir }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/** Persist the provider's private Session ID before acknowledging a visitor reply. */
export async function saveAgentDirectNativeSession(input: {
  ownerUserId: string; machineId: string
  messageId: unknown; conversationId: unknown; bindingEpoch: unknown
  leaseToken: unknown; nianSessionId: unknown; nativeSessionId: unknown; now?: Date
}) {
  if (typeof input.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.messageId)
    || typeof input.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)
    || !Number.isSafeInteger(input.bindingEpoch) || Number(input.bindingEpoch) < 1
    || typeof input.leaseToken !== 'string' || !TOKEN.test(input.leaseToken)
    || typeof input.nianSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(input.nianSessionId)
    || typeof input.nativeSessionId !== 'string' || !input.nativeSessionId.trim()
    || input.nativeSessionId.length > 512 || input.nativeSessionId.includes('\0')) {
    throw new AgentDirectDeliveryError('invalid')
  }
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const initial = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      select: { publicationId: true, agentIdentityId: true },
    })
    if (!initial) throw new AgentDirectDeliveryError('not_found')
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${initial.publicationId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${initial.agentIdentityId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${input.conversationId as string} FOR UPDATE`
    const conversation = await tx.agentDirectConversation.findUnique({
      where: { id: input.conversationId as string },
      include: { publication: true, agentIdentity: true, binding: true },
    })
    const message = await tx.agentDirectMessage.findUnique({ where: { id: input.messageId as string } })
    if (!conversation || !message || message.conversationId !== conversation.id
      || message.authorRole !== 'visitor' || message.status !== 'running'
      || message.claimTokenHash !== hash(input.leaseToken as string)
      || !message.leaseExpiresAt || message.leaseExpiresAt <= now
      || conversation.ownerUserId !== input.ownerUserId
      || conversation.publication.ownerUserId !== input.ownerUserId
      || conversation.publication.agentIdentityId !== conversation.agentIdentityId
      || conversation.agentIdentity.machineId !== input.machineId
      || conversation.agentIdentity.ownerUserId !== input.ownerUserId
      || conversation.agentIdentity.status !== 'active'
      || !conversation.agentIdentity.runtimeAdapter
      || conversation.status !== 'active' || conversation.publication.status !== 'active'
      || conversation.publication.generation !== message.publicationGeneration
      || conversation.publication.policyVersion !== message.policyVersion
      || conversation.agentIdentity.configurationVersion !== message.agentConfigurationVersion
      || conversation.binding?.machineId !== input.machineId
      || conversation.binding.bindingEpoch !== input.bindingEpoch
      || conversation.binding.nianSessionId !== input.nianSessionId) {
      throw new AgentDirectDeliveryError('stale')
    }
    const nativeSession = await tx.nianSession.findFirst({
      where: { id: input.nianSessionId as string,
        creationKey: `published-agent:${conversation.id}:${conversation.binding.bindingEpoch}`,
        userId: input.ownerUserId, machineId: input.machineId,
        agentIdentityId: conversation.agentIdentityId,
        agentType: conversation.agentIdentity.runtimeAdapter!,
        nativeSessionVisibility: 'internal', status: 'active', roomBinding: null },
      select: { id: true, agentSessionId: true },
    })
    if (!nativeSession || (nativeSession.agentSessionId
      && nativeSession.agentSessionId !== input.nativeSessionId)) {
      throw new AgentDirectDeliveryError('stale')
    }
    const alreadyOwned = await tx.nianSession.findFirst({
      where: { id: { not: nativeSession.id }, machineId: input.machineId,
        agentType: conversation.agentIdentity.runtimeAdapter!,
        agentSessionId: input.nativeSessionId as string, status: 'active' },
      select: { id: true },
    })
    if (alreadyOwned) throw new AgentDirectDeliveryError('stale')
    if (!nativeSession.agentSessionId) {
      await tx.nianSession.update({ where: { id: nativeSession.id },
        data: { agentSessionId: input.nativeSessionId as string } })
    }
    return { nianSessionId: nativeSession.id, nativeSessionId: input.nativeSessionId as string }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
