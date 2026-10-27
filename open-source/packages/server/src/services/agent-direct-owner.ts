// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-direct-owner.test.ts

import { readOwnerDirectUnread } from './agent-direct-unread.js'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { AgentDirectConversationError } from './agent-direct-conversations.js'
import { broadcastRoomMessageRecord } from './room-events.js'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const ownerScope = (ownerUserId: string) => ({ ownerUserId,
  agentIdentity: { ownerType: 'user' as const, ownerUserId } })

/** Metadata only: publishers are operators, not additional Room members. */
export async function listOwnerAgentDirectConversations(input: {
  ownerUserId: string; cursor?: unknown
}) {
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !ID.test(input.cursor))) {
    throw new AgentDirectConversationError('invalid')
  }
  const scope = ownerScope(input.ownerUserId)
  const before = input.cursor ? await prisma.agentDirectConversation.findFirst({
    where: { ...scope, id: input.cursor }, select: { id: true, lastActivityAt: true },
  }) : null
  if (input.cursor && !before) throw new AgentDirectConversationError('invalid')
  const rows = await prisma.agentDirectConversation.findMany({
    where: { ...scope, ...(before ? { OR: [
      { lastActivityAt: { lt: before.lastActivityAt } },
      { lastActivityAt: before.lastActivityAt, id: { lt: before.id } },
    ] } : {}) }, orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }], take: 51,
    select: { id: true, agentIdentityId: true, status: true, lastActivityAt: true,
      visitorUser: { select: { name: true } },
      publication: { select: { displayName: true, status: true } },
    },
  })
  const page = rows.slice(0, 50)
  const unread = await readOwnerDirectUnread(input.ownerUserId, page.map((row) => row.id))
  return { conversations: page.map((row) => ({
    id: row.id, unreadCount: unread[row.id] ?? 0, agentIdentityId: row.agentIdentityId, role: 'owner' as const,
    displayName: row.publication.displayName, visitorName: row.visitorUser.name,
    description: '', status: row.status, publicationStatus: row.publication.status,
    lastActivityAt: row.lastActivityAt.toISOString(),
  })), nextCursor: rows.length > 50 ? page[page.length - 1]!.id : null }
}

/** Explicit owner action on one owned conversation; never enqueue a visitor turn. */
export async function sendOwnerAgentDirectMessage(input: {
  ownerUserId: string; conversationId: string; text: unknown; clientMessageId: unknown; attachmentIds?: unknown
}) {
  if (!ID.test(input.conversationId)) throw new AgentDirectConversationError('not_found')
  const attachmentIds = input.attachmentIds ?? []
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 5
    || attachmentIds.some((id) => typeof id !== 'string' || !/^datt_[a-f0-9-]{36}$/.test(id))
    || new Set(attachmentIds).size !== attachmentIds.length) throw new AgentDirectConversationError('invalid')
  if (typeof input.text !== 'string' || (!input.text.trim() && !attachmentIds.length) || input.text.trim().length > 20_000
    || typeof input.clientMessageId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(input.clientMessageId)) {
    throw new AgentDirectConversationError('invalid')
  }
  const text = input.text.trim()
  // Retains the authenticated operator without changing published message roles.
  const clientMessageId = `owner:${input.ownerUserId}:${input.clientMessageId}`
  if (clientMessageId.length > 191) throw new AgentDirectConversationError('invalid')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const controls = await tx.$queryRaw<Array<{ mode: string }>>
          `SELECT mode FROM ConversationWriteControl WHERE name = 'published_ai' LOCK IN SHARE MODE`
        const mode = controls[0]?.mode
        if (mode !== 'legacy' && mode !== 'canonical') throw new AgentDirectConversationError('unavailable')
        const initial = await tx.agentDirectConversation.findFirst({
          where: { ...ownerScope(input.ownerUserId), id: input.conversationId },
          select: { publicationId: true, agentIdentityId: true },
        })
        if (!initial) throw new AgentDirectConversationError('not_found')
        // Same lock order as visitor sends/delivery and publication mutations.
        await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${initial.publicationId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${initial.agentIdentityId} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM AgentDirectConversation WHERE id = ${input.conversationId} FOR UPDATE`
        const conversation = await tx.agentDirectConversation.findFirst({
          where: { ...ownerScope(input.ownerUserId), id: input.conversationId },
          include: { publication: true, agentIdentity: true },
        })
        if (!conversation) throw new AgentDirectConversationError('not_found')
        const canonical = mode === 'canonical'
        if (canonical && (conversation.canonicalState !== 'ready' || conversation.roomId !== conversation.id)) {
          throw new AgentDirectConversationError('unavailable')
        }
        const previous = await tx.agentDirectMessage.findUnique({ where: {
          conversationId_authorRole_clientMessageId: {
            conversationId: conversation.id, authorRole: 'agent', clientMessageId,
          },
        }, select: { id: true, sequence: true, text: true, roomMessageId: true } })
        if (previous) {
          const previousText = canonical ? (await tx.roomMessage.findUnique({
            where: { id: previous.roomMessageId ?? previous.id }, select: { text: true },
          }))?.text : previous.text
          const files = await tx.agentDirectAttachment.findMany({ where: { messageId: previous.id }, select: { id: true } })
          if (files.length !== attachmentIds.length || files.some((file) => !attachmentIds.includes(file.id))) {
            throw new AgentDirectConversationError('invalid')
          }
          if (previousText !== text) throw new AgentDirectConversationError('invalid')
          return { conversationId: conversation.id, messageId: previous.id,
            sequence: previous.sequence.toString(), status: 'sent', idempotent: true, canonical }
        }
        if (conversation.status !== 'active' || conversation.publication.status !== 'active'
          || conversation.publication.ownerUserId !== input.ownerUserId
          || conversation.publication.agentIdentityId !== conversation.agentIdentityId
          || conversation.agentIdentity.status !== 'active') {
          throw new AgentDirectConversationError('unavailable')
        }
        const now = new Date()
        if (attachmentIds.length) {
          const files = await tx.agentDirectAttachment.findMany({ where: {
            id: { in: attachmentIds }, publicationId: conversation.publicationId,
            visitorUserId: input.ownerUserId, status: 'ready', messageId: null, expiresAt: { gt: now },
          }, select: { id: true, byteSize: true } })
          if (files.length !== attachmentIds.length
            || files.reduce((sum, file) => sum + Number(file.byteSize), 0) > 100 * 1024 * 1024) {
            throw new AgentDirectConversationError('invalid')
          }
        }
        let roomMessageId: string | null = null
        const advanced = canonical
          ? await tx.room.update({ where: { id: conversation.id },
            data: { nextSequence: { increment: 1 } }, select: { nextSequence: true } })
          : await tx.agentDirectConversation.update({ where: { id: conversation.id },
            data: { nextSequence: { increment: 1 }, lastActivityAt: now }, select: { nextSequence: true } })
        if (canonical) {
          const membership = await tx.roomMembership.findUnique({ where: { roomId_principalKey: {
            roomId: conversation.id, principalKey: `agent:${conversation.agentIdentityId}`,
          } }, select: { id: true, displayAlias: true, status: true } })
          const owner = await tx.user.findUnique({ where: { id: input.ownerUserId }, select: { name: true } })
          const visitor = await tx.roomMembership.findUnique({ where: { roomId_principalKey: {
            roomId: conversation.id, principalKey: `human:${conversation.visitorUserId}`,
          } }, select: { status: true } })
          if (!membership || membership.status !== 'active' || visitor?.status !== 'active' || !owner) {
            throw new AgentDirectConversationError('unavailable')
          }
          const record = await tx.roomMessage.create({ data: {
            roomId: conversation.id, sequence: advanced.nextSequence,
            authorMembershipId: membership.id, authorPrincipalTypeSnapshot: 'agent',
            ownerUserIdSnapshot: input.ownerUserId, ownerDisplayNameSnapshot: owner.name.trim(),
            authorDisplayNameSnapshot: membership.displayAlias, kind: 'text', source: 'managed_agent',
            deliveryStatus: 'sent', text, clientMessageId, createdAt: now,
          }, select: { id: true } })
          roomMessageId = record.id
        }
        const record = await tx.agentDirectMessage.create({ data: {
          ...(roomMessageId ? { id: roomMessageId } : {}), roomMessageId,
          conversationId: conversation.id, sequence: advanced.nextSequence,
          authorRole: 'agent', clientMessageId, text: canonical ? null : text, status: 'sent',
          publicationGeneration: conversation.publication.generation,
          policyVersion: conversation.publication.policyVersion,
          agentConfigurationVersion: conversation.agentIdentity.configurationVersion, createdAt: now,
        }, select: { id: true } })
        if (attachmentIds.length) {
          const bound = await tx.agentDirectAttachment.updateMany({ where: {
            id: { in: attachmentIds }, publicationId: conversation.publicationId,
            visitorUserId: input.ownerUserId, status: 'ready', messageId: null, expiresAt: { gt: now },
          }, data: { messageId: record.id } })
          if (bound.count !== attachmentIds.length) throw new AgentDirectConversationError('invalid')
        }
        if (canonical) await tx.agentDirectConversation.update({ where: { id: conversation.id }, data: {
          nextSequence: advanced.nextSequence, canonicalCopiedSequence: advanced.nextSequence, lastActivityAt: now,
        } })
        return { conversationId: conversation.id, messageId: record.id,
          sequence: advanced.nextSequence.toString(), status: 'sent', idempotent: false, canonical }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      if (result.canonical && !result.idempotent) {
        const record = await prisma.roomMessage.findUnique({ where: { id: result.messageId },
          include: { attachments: true, authorMembership: { select: { displayAlias: true, status: true } } } })
        if (record) await broadcastRoomMessageRecord(result.conversationId, record)
      }
      return { conversationId: result.conversationId, messageId: result.messageId,
        sequence: result.sequence, status: result.status, idempotent: result.idempotent }
    } catch (error) {
      const retryable = typeof error === 'object' && error !== null && 'code' in error
        && (error.code === 'P2002' || error.code === 'P2034')
      if (!retryable || attempt === 2) throw error
    }
  }
  throw new AgentDirectConversationError('unavailable')
}
