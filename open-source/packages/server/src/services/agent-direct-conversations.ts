// @arch open-source/docs/server-runtime.md

import { readOwnerDirectUnread } from './agent-direct-unread.js'
import { prisma } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { ensurePublishedAiRoom } from './published-ai-room-migration.js'
import { broadcastRoomMessageRecord } from './room-events.js'

const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/

export class AgentDirectConversationError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'unavailable' | 'limit_reached') {
    super(code)
  }
}

/** Only the publisher can resume the one visitor conversation they own. */
export async function resumeVisitorAgentConversation(input: {
  conversationId: string; ownerUserId: string
}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)) {
    throw new AgentDirectConversationError('not_found')
  }
  const scope = { id: input.conversationId, ownerUserId: input.ownerUserId,
    agentIdentity: { ownerType: 'user' as const, ownerUserId: input.ownerUserId } }
  const changed = await prisma.agentDirectConversation.updateMany({
    where: { ...scope, status: 'paused' }, data: { status: 'active' },
  })
  if (changed.count === 1) return { conversationId: input.conversationId, status: 'active' }
  const existing = await prisma.agentDirectConversation.findFirst({
    where: scope, select: { status: true },
  })
  if (!existing) throw new AgentDirectConversationError('not_found')
  if (existing.status !== 'active') throw new AgentDirectConversationError('unavailable')
  return { conversationId: input.conversationId, status: 'active' }
}

function normalizeMessage(input: { text: unknown; clientMessageId: unknown; attachmentIds?: unknown }) {
  if (typeof input.text !== 'string') throw new AgentDirectConversationError('invalid')
  const text = input.text.trim()
  const attachmentIds = input.attachmentIds === undefined ? [] : input.attachmentIds
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 5
    || attachmentIds.some((id) => typeof id !== 'string' || !/^datt_[a-f0-9-]{36}$/.test(id))
    || new Set(attachmentIds).size !== attachmentIds.length
    || (!text && !attachmentIds.length) || text.length > 20_000) {
    throw new AgentDirectConversationError('invalid')
  }
  if (typeof input.clientMessageId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(input.clientMessageId)) {
    throw new AgentDirectConversationError('invalid')
  }
  return { text, clientMessageId: input.clientMessageId, attachmentIds: attachmentIds as string[] }
}

function isRetryable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'P2002' || error.code === 'P2034')
}

/** Persist only; the local runtime worker must claim and execute pending messages separately. */
export async function enqueueVisitorAgentMessage(input: {
  publicId: string
  visitorUserId: string
  text: unknown
  clientMessageId: unknown
  attachmentIds?: unknown
  now?: Date
}) {
  if (!PUBLIC_ID.test(input.publicId)) throw new AgentDirectConversationError('not_found')
  const { text, clientMessageId, attachmentIds } = normalizeMessage(input)
  const now = input.now ?? new Date()
  const quotaDay = now.toISOString().slice(0, 10)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // A shared row lock fences the release cutover against in-flight
        // legacy sends. The mode is changed only by the official gate.
        const controls = await tx.$queryRaw<Array<{ mode: string }>>
          `SELECT mode FROM ConversationWriteControl WHERE name = 'published_ai' LOCK IN SHARE MODE`
        const writeMode = controls[0]?.mode
        if (writeMode !== 'legacy' && writeMode !== 'canonical') {
          throw new AgentDirectConversationError('unavailable')
        }
        await tx.$queryRaw`SELECT id FROM AgentPublication WHERE publicId = ${input.publicId} FOR UPDATE`
        const publication = await tx.agentPublication.findUnique({
          where: { publicId: input.publicId },
          select: {
            id: true, agentIdentityId: true, ownerUserId: true,
            status: true, generation: true, dailyMessageLimit: true, policyVersion: true,
            allowNewContacts: true, requireContactApproval: true, allowAnonymousVisitors: true,
            agentIdentity: { select: { status: true, ownerUserId: true,
              configurationVersion: true } },
          },
        })
        if (!publication) throw new AgentDirectConversationError('not_found')
        if (publication.status !== 'active' || publication.agentIdentity.status !== 'active'
          || publication.agentIdentity.ownerUserId !== publication.ownerUserId) {
          throw new AgentDirectConversationError('unavailable')
        }
        const visitor = await tx.user.findUnique({
          where: { id: input.visitorUserId }, select: { id: true, name: true, accountTier: true },
        })
        if (!visitor || !visitor.name.trim()) throw new AgentDirectConversationError('unavailable')
        const anonymous = visitor.accountTier === 'anonymous_visitor'
        if (anonymous && (!publication.allowAnonymousVisitors || publication.requireContactApproval)) {
          throw new AgentDirectConversationError('unavailable')
        }

        // Turning off new additions never interrupts an existing visitor's conversation.
        if (!anonymous && visitor.id !== publication.ownerUserId
          && (publication.allowNewContacts === false || publication.requireContactApproval === true)) {
          const existingConversation = await tx.agentDirectConversation.findUnique({
            where: { agentIdentityId_visitorUserId: {
              agentIdentityId: publication.agentIdentityId, visitorUserId: visitor.id,
            } },
            select: { id: true },
          })
          if (!existingConversation) {
            const savedContact = await tx.userContact.findUnique({
              where: { ownerUserId_targetAgentIdentityId: {
                ownerUserId: visitor.id, targetAgentIdentityId: publication.agentIdentityId,
              } },
              select: { id: true },
            })
            if (!savedContact) throw new AgentDirectConversationError('unavailable')
          }
        }

        const conversation = await tx.agentDirectConversation.upsert({
          where: { agentIdentityId_visitorUserId: {
            agentIdentityId: publication.agentIdentityId, visitorUserId: visitor.id,
          } },
          create: {
            publicationId: publication.id,
            agentIdentityId: publication.agentIdentityId,
            ownerUserId: publication.ownerUserId,
            visitorUserId: visitor.id,
            status: 'active',
          },
          update: {},
          select: { id: true, status: true, roomId: true, canonicalState: true },
        })
        if (conversation.status !== 'active') throw new AgentDirectConversationError('unavailable')
        if (writeMode === 'canonical' && conversation.canonicalState !== 'ready') {
          if (conversation.roomId) throw new AgentDirectConversationError('unavailable')
          await ensurePublishedAiRoom(tx, {
            directConversationId: conversation.id,
            ownerUserId: publication.ownerUserId,
            visitorUserId: visitor.id,
            agentIdentityId: publication.agentIdentityId,
            publicationId: publication.id,
          })
          await tx.agentDirectConversation.update({ where: { id: conversation.id },
            data: { canonicalState: 'ready' } })
          conversation.roomId = conversation.id
          conversation.canonicalState = 'ready'
        }
        const existing = await tx.agentDirectMessage.findUnique({
          where: { conversationId_authorRole_clientMessageId: {
            conversationId: conversation.id, authorRole: 'visitor', clientMessageId,
          } },
          select: { id: true, sequence: true, text: true, status: true },
        })
        if (existing) {
          const canonicalText = writeMode === 'canonical'
            ? (await tx.roomMessage.findUnique({ where: { id: existing.id },
              select: { text: true, roomId: true } }))?.text
            : existing.text
          const previousAttachments = await tx.agentDirectAttachment.findMany({
            where: { messageId: existing.id }, select: { id: true },
          })
          if (canonicalText !== text || previousAttachments.length !== attachmentIds.length
            || previousAttachments.some((item) => !attachmentIds.includes(item.id))) {
            throw new AgentDirectConversationError('invalid')
          }
          return { conversationId: conversation.id, messageId: existing.id,
            sequence: existing.sequence.toString(), status: existing.status, idempotent: true }
        }
        // Charge the publication, not each visitor conversation. Updating one
        // row serializes concurrent first sends from different visitors.
        const quotaWhere = {
          id: publication.id,
          publicId: input.publicId,
          status: 'active',
          policyVersion: publication.policyVersion,
          agentIdentity: { status: 'active', ownerUserId: publication.ownerUserId },
        }
        await tx.agentPublication.updateMany({
          where: { ...quotaWhere, quotaDay: { not: quotaDay } },
          data: { quotaDay, quotaUsed: 0 },
        })
        const charged = await tx.agentPublication.updateMany({
          where: {
            ...quotaWhere, quotaDay,
            quotaUsed: { lt: publication.dailyMessageLimit },
          },
          data: { quotaUsed: { increment: 1 } },
        })
        if (charged.count !== 1) {
          const current = await tx.agentPublication.findUnique({
            where: { id: publication.id },
            select: { status: true, policyVersion: true, quotaDay: true, quotaUsed: true },
          })
          if (current?.status === 'active'
            && current.policyVersion === publication.policyVersion
            && current.quotaDay === quotaDay
            && current.quotaUsed >= publication.dailyMessageLimit) {
            throw new AgentDirectConversationError('limit_reached')
          }
          throw new AgentDirectConversationError('unavailable')
        }
        const canonical = writeMode === 'canonical'
        if (attachmentIds.length) {
          const attachments = await tx.agentDirectAttachment.findMany({ where: {
            id: { in: attachmentIds }, publicationId: publication.id,
            visitorUserId: visitor.id, status: 'ready', messageId: null,
            expiresAt: { gt: now },
          }, select: { id: true, byteSize: true } })
          if (attachments.length !== attachmentIds.length
            || attachments.reduce((sum, item) => sum + Number(item.byteSize), 0) > 100 * 1024 * 1024) {
            throw new AgentDirectConversationError('invalid')
          }
        }
        if (canonical && conversation.roomId !== conversation.id) {
          throw new AgentDirectConversationError('unavailable')
        }
        const advanced = canonical
          ? await tx.room.update({ where: { id: conversation.id },
            data: { nextSequence: { increment: 1 } }, select: { nextSequence: true } })
          : await tx.agentDirectConversation.update({
            where: { id: conversation.id },
            data: { nextSequence: { increment: 1 }, lastActivityAt: now },
            select: { nextSequence: true },
          })
        let roomMessageId: string | null = null
        if (canonical) {
          const visitorMembership = await tx.roomMembership.findUnique({
            where: { roomId_principalKey: {
              roomId: conversation.id, principalKey: `human:${visitor.id}`,
            } },
            select: { id: true, displayAlias: true, status: true },
          })
          if (!visitorMembership || !['active', 'left'].includes(visitorMembership.status)) {
            throw new AgentDirectConversationError('unavailable')
          }
          // Sending from the public link is an explicit rejoin. The new epoch
          // starts with this message; old history stays outside its read grant.
          if (visitorMembership.status === 'left') {
            await tx.roomMembership.update({ where: { id: visitorMembership.id }, data: {
              status: 'active', membershipEpoch: { increment: 1 },
              historyFromSequence: advanced.nextSequence, historyThroughSequence: null,
              joinedAt: now, removedAt: null,
            } })
          }
          const roomMessage = await tx.roomMessage.create({ data: {
            roomId: conversation.id, sequence: advanced.nextSequence,
            authorMembershipId: visitorMembership.id,
            authorPrincipalTypeSnapshot: 'human',
            ownerUserIdSnapshot: visitor.id,
            authorDisplayNameSnapshot: visitorMembership.displayAlias,
            ownerDisplayNameSnapshot: visitor.name.trim(),
            kind: 'text', source: 'app', text,
            clientMessageId, deliveryStatus: 'pending', createdAt: now,
          }, select: { id: true } })
          roomMessageId = roomMessage.id
          await tx.roomReadState.upsert({
            where: { membershipId: visitorMembership.id },
            create: { roomId: conversation.id, membershipId: visitorMembership.id,
              lastReadSequence: advanced.nextSequence,
              lastDeliveredSequence: advanced.nextSequence },
            update: { lastReadSequence: advanced.nextSequence,
              lastDeliveredSequence: advanced.nextSequence },
          })
          await tx.agentDirectConversation.update({ where: { id: conversation.id },
            data: { nextSequence: advanced.nextSequence,
              canonicalCopiedSequence: advanced.nextSequence, lastActivityAt: now } })
        }
        const message = await tx.agentDirectMessage.create({
          data: {
            ...(roomMessageId ? { id: roomMessageId, roomMessageId } : {}),
            conversationId: conversation.id,
            sequence: advanced.nextSequence,
            authorRole: 'visitor',
            clientMessageId,
            publicationGeneration: publication.generation,
            policyVersion: publication.policyVersion,
            agentConfigurationVersion: publication.agentIdentity.configurationVersion,
            text: canonical ? null : text,
            status: 'pending',
            createdAt: now,
          },
          select: { id: true },
        })
        if (attachmentIds.length) {
          const bound = await tx.agentDirectAttachment.updateMany({ where: {
            id: { in: attachmentIds }, publicationId: publication.id,
            visitorUserId: visitor.id, status: 'ready', messageId: null,
            expiresAt: { gt: now },
          }, data: { messageId: message.id } })
          if (bound.count !== attachmentIds.length) throw new AgentDirectConversationError('invalid')
        }
        return { conversationId: conversation.id, messageId: message.id,
          sequence: advanced.nextSequence.toString(), status: 'pending', idempotent: false,
          ...(canonical ? { canonicalRoomMessageId: message.id } : {}) }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      if ('canonicalRoomMessageId' in result && result.canonicalRoomMessageId) {
        const record = await prisma.roomMessage.findUnique({
          where: { id: result.canonicalRoomMessageId },
          include: { attachments: true, authorMembership: {
            select: { displayAlias: true, status: true },
          } },
        })
        if (record) await broadcastRoomMessageRecord(result.conversationId, record)
      }
      return { conversationId: result.conversationId, messageId: result.messageId,
        sequence: result.sequence, status: result.status, idempotent: result.idempotent }
    } catch (error) {
      if (!isRetryable(error) || attempt === 2) throw error
    }
  }
  throw new AgentDirectConversationError('unavailable')
}

function parseAfter(value: unknown): bigint {
  if (value === undefined || value === '') return 0n
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    throw new AgentDirectConversationError('invalid')
  }
  return BigInt(value)
}

/** The URL locates an Agent; the signed-in user ID supplies the read grant. */
export async function readVisitorAgentConversation(input: {
  publicId: string
  visitorUserId: string
  after?: unknown
  before?: unknown
}) {
  if (!PUBLIC_ID.test(input.publicId)) throw new AgentDirectConversationError('not_found')
  if (input.before !== undefined && input.after !== undefined) {
    throw new AgentDirectConversationError('invalid')
  }
  const after = input.before === undefined ? parseAfter(input.after) : null
  const before = input.before === undefined ? null : parseBefore(input.before)
  const publication = await prisma.agentPublication.findUnique({
    where: { publicId: input.publicId },
    select: {
      agentIdentityId: true, ownerUserId: true,
      status: true,
      agentIdentity: { select: { status: true, ownerUserId: true } },
    },
  })
  if (!publication || !['active', 'paused'].includes(publication.status)
    || publication.agentIdentity.status !== 'active'
    || publication.agentIdentity.ownerUserId !== publication.ownerUserId) {
    throw new AgentDirectConversationError('not_found')
  }
  const conversation = await prisma.agentDirectConversation.findUnique({
    where: { agentIdentityId_visitorUserId: {
      agentIdentityId: publication.agentIdentityId,
      visitorUserId: input.visitorUserId,
    } },
    select: { id: true, status: true, ownerLastViewedAt: true, canonicalState: true },
  })
  if (!conversation) return { conversation: null, messages: [], nextAfter: null }
  const canonical = await canonicalDirectReadsEnabled(conversation.canonicalState)
  const window = canonical
    ? await canonicalVisitorWindow(conversation.id, input.visitorUserId) : null
  if (canonical && !window) throw new AgentDirectConversationError('not_found')
  const page = before === null
    ? await readMessagePage(conversation.id, after!, canonical, window)
    : await readMessagePageBefore(conversation.id, before, canonical, window)
  return { conversation: { id: conversation.id, status: conversation.status,
    ownerLastViewedAt: conversation.ownerLastViewedAt?.toISOString() ?? null }, ...page }
}

/** A verified browser proof remains scoped to its Agent after URL revocation. */
export async function readVisitorAgentConversationByAgent(input: {
  agentIdentityId: string
  visitorUserId: string
  after?: unknown
  before?: unknown
}) {
  if (input.before !== undefined && input.after !== undefined) {
    throw new AgentDirectConversationError('invalid')
  }
  const after = input.before === undefined ? parseAfter(input.after) : null
  const before = input.before === undefined ? null : parseBefore(input.before)
  const conversation = await prisma.agentDirectConversation.findUnique({
    where: { agentIdentityId_visitorUserId: {
      agentIdentityId: input.agentIdentityId,
      visitorUserId: input.visitorUserId,
    } },
    select: { id: true, status: true, ownerLastViewedAt: true, canonicalState: true },
  })
  if (!conversation) return { conversation: null, messages: [], nextAfter: null }
  const canonical = await canonicalDirectReadsEnabled(conversation.canonicalState)
  const window = canonical
    ? await canonicalVisitorWindow(conversation.id, input.visitorUserId) : null
  if (canonical && !window) throw new AgentDirectConversationError('not_found')
  const page = before === null
    ? await readMessagePage(conversation.id, after!, canonical, window)
    : await readMessagePageBefore(conversation.id, before, canonical, window)
  return { conversation: { id: conversation.id, status: conversation.status,
    ownerLastViewedAt: conversation.ownerLastViewedAt?.toISOString() ?? null }, ...page }
}

/** Stable conversation ID keeps historical read access after URL rotation. */
export async function readAgentDirectConversationById(input: {
  conversationId: string
  userId: string
  after?: unknown
  before?: unknown
  now?: Date
  perspective?: 'owner'
}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.conversationId)) {
    throw new AgentDirectConversationError('not_found')
  }
  if (input.before !== undefined && input.after !== undefined) {
    throw new AgentDirectConversationError('invalid')
  }
  const after = input.before === undefined ? parseAfter(input.after) : null
  const before = input.before === undefined ? null : parseBefore(input.before)
  const conversation = await prisma.agentDirectConversation.findFirst({
    where: {
      id: input.conversationId,
      OR: [
        ...(input.perspective === 'owner' ? [] : [
        { visitorUserId: input.userId },
        ]),
        { ownerUserId: input.userId, agentIdentity: {
          ownerType: 'user', ownerUserId: input.userId,
        } },
      ],
    },
    select: {
      id: true, status: true, agentIdentityId: true, canonicalState: true,
      visitorUserId: true, ownerUserId: true, ownerLastViewedAt: true,
      visitorUser: { select: { name: true } },
      publication: { select: { displayName: true, description: true,
        status: true, publicId: true, ownerUserId: true } },
      agentIdentity: { select: { status: true, ownerUserId: true,
        machine: { select: { paired: true, online: true } } } },
    },
  })
  if (!conversation) throw new AgentDirectConversationError('not_found')
  const role = input.perspective !== 'owner' && conversation.visitorUserId === input.userId ? 'visitor' : 'owner'
  let ownerLastViewedAt = conversation.ownerLastViewedAt
  const viewedAt = input.now ?? new Date()

  const available = conversation.publication.ownerUserId === conversation.ownerUserId
    && conversation.agentIdentity.ownerUserId === conversation.ownerUserId
    && conversation.agentIdentity.status === 'active'
  const canonical = await canonicalDirectReadsEnabled(conversation.canonicalState)
  const window = canonical && role === 'visitor'
    ? await canonicalVisitorWindow(conversation.id, input.userId) : null
  if (canonical && role === 'visitor' && !window) {
    throw new AgentDirectConversationError('not_found')
  }
  const page = before === null
    ? await readMessagePage(conversation.id, after!, canonical, window)
    : await readMessagePageBefore(conversation.id, before, canonical, window)
  if (role === 'owner' && (input.before === 'latest'
    || (input.before === undefined && 'nextAfter' in page && !page.nextAfter))) {
    ownerLastViewedAt = ownerLastViewedAt && ownerLastViewedAt > viewedAt ? ownerLastViewedAt : viewedAt
    await prisma.agentDirectConversation.updateMany({
      where: { id: conversation.id, OR: [{ ownerLastViewedAt: null }, { ownerLastViewedAt: { lt: viewedAt } }] },
      data: { ownerLastViewedAt: viewedAt },
    })
  }
  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      agentIdentityId: conversation.agentIdentityId,
      role,
      canAttach: true,
      ...(role === 'owner' ? { visitorName: conversation.visitorUser?.name ?? '', canReplyAsAgent: true } : {}),
      displayName: conversation.publication.displayName,
      description: conversation.publication.description,
      publicationStatus: available ? conversation.publication.status : 'unavailable',
      machineOnline: available && conversation.agentIdentity.machine?.paired === true
        && conversation.agentIdentity.machine.online === true,
      ownerLastViewedAt: ownerLastViewedAt?.toISOString() ?? null,
      ...(available && ['active', 'paused'].includes(conversation.publication.status)
        ? { publicId: conversation.publication.publicId } : {}),
      ...(conversation.ownerUserId === input.userId ? { visitorUserId: conversation.visitorUserId } : {}),
    },
    ...page,
  }
}

function parseBefore(value: unknown): bigint | 'latest' {
  if (value === 'latest') return 'latest'
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)
    || BigInt(value) < 1n || BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new AgentDirectConversationError('invalid')
  }
  return BigInt(value)
}

async function canonicalDirectReadsEnabled(state: string | undefined): Promise<boolean> {
  if (state !== 'ready') return false
  const control = await prisma.conversationWriteControl.findUnique({
    where: { name: 'published_ai' }, select: { mode: true },
  })
  return control?.mode === 'canonical'
}

type CanonicalWindow = { from: bigint; through: bigint | null }

async function canonicalVisitorWindow(
  roomId: string, userId: string,
): Promise<CanonicalWindow | null> {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    select: { principalType: true, status: true,
      historyFromSequence: true, historyThroughSequence: true },
  })
  if (!membership || membership.principalType !== 'human'
    || !['active', 'left', 'removed'].includes(membership.status)) return null
  if (membership.status !== 'active' && membership.historyThroughSequence === null) return null
  return { from: membership.historyFromSequence,
    through: membership.status === 'active' ? null : membership.historyThroughSequence }
}

async function readMessagePage(
  conversationId: string, after: bigint, canonical = false, window: CanonicalWindow | null = null,
) {
  if (canonical) {
    const rows = await prisma.roomMessage.findMany({
      where: { roomId: conversationId, kind: 'text',
        source: { in: ['app', 'managed_agent'] }, sequence: { gt: after,
        ...(window ? { gte: window.from,
          ...(window.through === null ? {} : { lte: window.through }) } : {}) } },
      orderBy: { sequence: 'asc' }, take: 101,
      select: { id: true, sequence: true, text: true, createdAt: true,
        authorPrincipalTypeSnapshot: true, deliveryStatus: true,
        legacyDirectMessage: { select: { status: true, failureCode: true,
          attachments: { select: { id: true, name: true, mediaKind: true,
            mimeType: true, byteSize: true, status: true, expiresAt: true } } } } },
    })
    const page = rows.slice(0, 100)
    return { messages: page.map(shapeCanonicalDirectMessage),
      nextAfter: rows.length > 100 ? page[page.length - 1]!.sequence.toString() : null }
  }
  const rows = await prisma.agentDirectMessage.findMany({
    where: { conversationId, sequence: { gt: after } },
    orderBy: { sequence: 'asc' },
    take: 101,
    select: {
      id: true, sequence: true, authorRole: true, text: true,
      status: true, failureCode: true, createdAt: true,
      attachments: { select: { id: true, name: true, mediaKind: true,
        mimeType: true, byteSize: true, status: true, expiresAt: true } },
    },
  })
  const page = rows.slice(0, 100)
  return {
    messages: page.map((message) => ({
      ...message,
      sequence: message.sequence.toString(),
      createdAt: message.createdAt.toISOString(),
      attachments: (message.attachments ?? []).map(shapeDirectAttachment),
    })),
    nextAfter: rows.length > 100 ? page[page.length - 1]!.sequence.toString() : null,
  }
}

async function readMessagePageBefore(
  conversationId: string, before: bigint | 'latest', canonical = false,
  window: CanonicalWindow | null = null,
) {
  if (canonical) {
    const rows = await prisma.roomMessage.findMany({
      where: { roomId: conversationId, kind: 'text',
        source: { in: ['app', 'managed_agent'] },
        sequence: {
          ...(before === 'latest' ? {} : { lt: before }),
          ...(window ? { gte: window.from,
            ...(window.through === null ? {} : { lte: window.through }) } : {}),
        } },
      orderBy: { sequence: 'desc' }, take: 101,
      select: { id: true, sequence: true, text: true, createdAt: true,
        authorPrincipalTypeSnapshot: true, deliveryStatus: true,
        legacyDirectMessage: { select: { status: true, failureCode: true,
          attachments: { select: { id: true, name: true, mediaKind: true,
            mimeType: true, byteSize: true, status: true, expiresAt: true } } } } },
    })
    const page = rows.slice(0, 100).reverse()
    return { messages: page.map(shapeCanonicalDirectMessage),
      nextBefore: rows.length > 100 ? page[0]!.sequence.toString() : null }
  }
  const rows = await prisma.agentDirectMessage.findMany({
    where: { conversationId, ...(before === 'latest' ? {} : { sequence: { lt: before } }) },
    orderBy: { sequence: 'desc' },
    take: 101,
    select: {
      id: true, sequence: true, authorRole: true, text: true,
      status: true, failureCode: true, createdAt: true,
      attachments: { select: { id: true, name: true, mediaKind: true,
        mimeType: true, byteSize: true, status: true, expiresAt: true } },
    },
  })
  const page = rows.slice(0, 100).reverse()
  return {
    messages: page.map((message) => ({
      ...message,
      sequence: message.sequence.toString(),
      createdAt: message.createdAt.toISOString(),
      attachments: (message.attachments ?? []).map(shapeDirectAttachment),
    })),
    nextBefore: rows.length > 100 ? page[0]!.sequence.toString() : null,
  }
}

function shapeCanonicalDirectMessage(message: {
  id: string
  sequence: bigint
  text: string | null
  createdAt: Date
  authorPrincipalTypeSnapshot: string
  deliveryStatus: string | null
  legacyDirectMessage: { status: string; failureCode: string | null;
    attachments: Array<{ id: string; name: string; mediaKind: string;
      mimeType: string; byteSize: bigint; status: string; expiresAt: Date | null }> } | null
}) {
  return {
    id: message.id,
    sequence: message.sequence.toString(),
    authorRole: message.authorPrincipalTypeSnapshot === 'agent' ? 'agent' : 'visitor',
    text: message.text,
    status: message.legacyDirectMessage?.status ?? message.deliveryStatus ?? 'sent',
    failureCode: message.legacyDirectMessage?.failureCode ?? null,
    createdAt: message.createdAt.toISOString(),
    attachments: message.legacyDirectMessage?.attachments?.map(shapeDirectAttachment) ?? [],
  }
}

function shapeDirectAttachment(file: { id: string; name: string; mediaKind: string;
  mimeType: string; byteSize: bigint; status: string; expiresAt: Date | null }) {
  return { attachmentId: file.id, name: file.name, mediaKind: file.mediaKind,
    mimeType: file.mimeType, byteSize: file.byteSize.toString(),
    available: file.status === 'ready' && (!file.expiresAt || file.expiresAt > new Date()) }
}

/** A signed-in visitor can rediscover only their own existing conversations. */
export async function listVisitorAgentDirectConversations(input: {
  visitorUserId: string
  cursor?: unknown
}) {
  if (input.cursor !== undefined
    && (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.cursor))) {
    throw new AgentDirectConversationError('invalid')
  }
  const canonicalMode = (await prisma.conversationWriteControl.findUnique({
    where: { name: 'published_ai' }, select: { mode: true },
  }))?.mode === 'canonical'
  const visibleScope = canonicalMode ? { room: { memberships: { some: {
    userId: input.visitorUserId, principalType: 'human',
    status: { in: ['active', 'left', 'removed'] },
  } } } } : {}
  let before: { lastActivityAt: Date; id: string } | null = null
  if (input.cursor) {
    before = await prisma.agentDirectConversation.findFirst({
      where: { id: input.cursor, visitorUserId: input.visitorUserId, ...visibleScope },
      select: { id: true, lastActivityAt: true },
    })
    if (!before) throw new AgentDirectConversationError('invalid')
  }
  const rows = await prisma.agentDirectConversation.findMany({
    where: {
      visitorUserId: input.visitorUserId,
      ...visibleScope,
      ...(before ? { OR: [
        { lastActivityAt: { lt: before.lastActivityAt } },
        { lastActivityAt: before.lastActivityAt, id: { lt: before.id } },
      ] } : {}),
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: 51,
    select: {
      id: true, agentIdentityId: true, ownerUserId: true,
      status: true, lastActivityAt: true,
      visitorUser: { select: { name: true } },
      publication: { select: { displayName: true, description: true,
        status: true, publicId: true, ownerUserId: true } },
      agentIdentity: { select: { status: true, ownerUserId: true,
        machine: { select: { paired: true, online: true } } } },
    },
  })
  const page = rows.slice(0, 50)
  return {
    conversations: page.map((row) => {
      const available = row.publication.ownerUserId === row.ownerUserId
        && row.agentIdentity.ownerUserId === row.ownerUserId
        && row.agentIdentity.status === 'active'
      return {
        id: row.id, agentIdentityId: row.agentIdentityId,
        ...(row.ownerUserId === input.visitorUserId ? { role: 'owner' as const,
          visitorName: row.visitorUser?.name ?? '' } : {}),
        displayName: row.publication.displayName,
        description: row.publication.description,
        status: row.status,
        publicationStatus: available ? row.publication.status : 'unavailable',
        machineOnline: available && row.agentIdentity.machine?.paired === true
          && row.agentIdentity.machine.online === true,
        ...(available && ['active', 'paused'].includes(row.publication.status)
          ? { publicId: row.publication.publicId } : {}),
        lastActivityAt: row.lastActivityAt.toISOString(),
      }
    }),
    nextCursor: rows.length > 50 ? page[page.length - 1]!.id : null,
  }
}

/** Owner list is metadata-only and bounded; opening a row does a fresh ACL check. */
export async function listOwnedAgentDirectConversations(input: {
  ownerUserId: string
  agentIdentityId: string
  cursor?: unknown
}) {
  if (input.cursor !== undefined
    && (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.cursor))) {
    throw new AgentDirectConversationError('invalid')
  }
  const agent = await prisma.agentIdentity.findFirst({
    where: {
      id: input.agentIdentityId, ownerType: 'user',
      ownerUserId: input.ownerUserId,
    },
    select: { id: true },
  })
  if (!agent) throw new AgentDirectConversationError('not_found')
  let before: { lastActivityAt: Date; id: string } | null = null
  if (input.cursor) {
    before = await prisma.agentDirectConversation.findFirst({
      where: {
        id: input.cursor, ownerUserId: input.ownerUserId,
        agentIdentityId: input.agentIdentityId,
      },
      select: { id: true, lastActivityAt: true },
    })
    if (!before) throw new AgentDirectConversationError('invalid')
  }
  const scope = { ownerUserId: input.ownerUserId, agentIdentityId: input.agentIdentityId }
  const rows = await prisma.agentDirectConversation.findMany({
    where: {
      ...scope,
      ...(before ? {
        OR: [
          { lastActivityAt: { lt: before.lastActivityAt } },
          { lastActivityAt: before.lastActivityAt, id: { lt: before.id } },
        ],
      } : {}),
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: 51,
    select: {
      id: true, visitorUserId: true, status: true,
      lastActivityAt: true, createdAt: true,
      visitorUser: { select: { name: true, phone: true } },
    },
  })
  let summary: { conversationCount: number; pendingCount: number;
    runningCount: number; failedCount: number } | null = null
  if (!input.cursor) {
    const [conversationCount, pendingCount, runningCount, failedCount] = await Promise.all([
      prisma.agentDirectConversation.count({ where: scope }),
      ...(['pending', 'running', 'failed'] as const).map((status) =>
        prisma.agentDirectMessage.count({
          where: { authorRole: 'visitor', status, conversation: scope },
        })),
    ])
    summary = { conversationCount, pendingCount, runningCount, failedCount }
  }
  const page = rows.slice(0, 50)
  const unread = await readOwnerDirectUnread(input.ownerUserId, page.map((row) => row.id))
  return {
    summary,
    conversations: page.map((row) => ({
      id: row.id,
      unreadCount: unread[row.id] ?? 0,
      visitorUserId: row.visitorUserId,
      visitorName: row.visitorUser.name,
      // The publisher can identify a signed-in visitor without receiving the
      // complete phone number in a list response.
      visitorPhoneMasked: maskVisitorPhone(row.visitorUser.phone),
      status: row.status,
      lastActivityAt: row.lastActivityAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > 50 ? page[page.length - 1]!.id : null,
  }
}

function maskVisitorPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const mainland = digits.startsWith('86') && digits.length === 13
    ? digits.slice(2) : digits
  if (/^1\d{10}$/.test(mainland)) return `${mainland.slice(0, 3)}****${mainland.slice(-4)}`
  return digits.length >= 8 ? `****${digits.slice(-4)}` : null
}
