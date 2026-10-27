// @covers open-source/packages/server/src/services/agent-direct-conversations.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn().mockResolvedValue([]),
  agentPublication: { findUnique: vi.fn() },
  agentIdentity: { findFirst: vi.fn() },
  agentDirectConversation: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    count: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  agentDirectMessage: { findMany: vi.fn(), count: vi.fn() },
  roomMessage: { findUnique: vi.fn(), findMany: vi.fn() },
  roomMembership: { findUnique: vi.fn() },
  conversationWriteControl: { findUnique: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomMessageRecord: vi.fn() }))

import {
  enqueueVisitorAgentMessage,
  listOwnedAgentDirectConversations,
  listVisitorAgentDirectConversations,
  readAgentDirectConversationById,
  readVisitorAgentConversation,
  readVisitorAgentConversationByAgent,
  resumeVisitorAgentConversation,
} from '../services/agent-direct-conversations.js'

const publicId = 'a'.repeat(32)

describe('published Agent visitor read boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resumes only a paused conversation belonging to the publisher', async () => {
    prismaMock.agentDirectConversation.updateMany.mockResolvedValue({ count: 1 })
    await expect(resumeVisitorAgentConversation({ conversationId: 'conversation-1',
      ownerUserId: 'owner-1' })).resolves.toEqual({
      conversationId: 'conversation-1', status: 'active',
    })
    expect(prismaMock.agentDirectConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conversation-1', ownerUserId: 'owner-1', status: 'paused',
        agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' } },
      data: { status: 'active' },
    })
    prismaMock.agentDirectConversation.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(null)
    await expect(resumeVisitorAgentConversation({ conversationId: 'conversation-1',
      ownerUserId: 'other-owner' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('does not query a conversation for an invalid or unpublished link', async () => {
    await expect(readVisitorAgentConversation({ publicId: 'bad', visitorUserId: 'visitor-1' }))
      .rejects.toMatchObject({ code: 'not_found' })
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      status: 'draft', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    await expect(readVisitorAgentConversation({ publicId, visitorUserId: 'visitor-1' }))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentDirectConversation.findUnique).not.toHaveBeenCalled()
  })

  it('opens without creating an empty conversation', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      status: 'active', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    prismaMock.agentDirectConversation.findUnique.mockResolvedValue(null)
    const result = await readVisitorAgentConversation({ publicId, visitorUserId: 'visitor-1' })
    expect(result).toEqual({ conversation: null, messages: [], nextAfter: null })
    expect(prismaMock.agentDirectConversation.findUnique).toHaveBeenCalledWith({
      where: { agentIdentityId_visitorUserId: {
        agentIdentityId: 'agent-1', visitorUserId: 'visitor-1',
      } },
      select: { id: true, status: true, ownerLastViewedAt: true, canonicalState: true },
    })
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('reads only the signed-in visitor conversation with a bounded cursor', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      status: 'paused', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    prismaMock.agentDirectConversation.findUnique.mockResolvedValue({ id: 'conversation-1', status: 'active' })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([{
      id: 'message-1', sequence: 3n, authorRole: 'agent', text: '你好',
      status: 'sent', createdAt: new Date('2026-09-26T00:00:00Z'),
    }])
    const result = await readVisitorAgentConversation({ publicId, visitorUserId: 'visitor-1', after: '2' })
    expect(result.messages[0]).toMatchObject({ sequence: '3', text: '你好' })
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1', sequence: { gt: 2n } },
      take: 101,
      select: expect.objectContaining({ failureCode: true }),
    }))
  })

  it('reads canonical Room history only inside the visitor membership window', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      status: 'active', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    prismaMock.agentDirectConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', status: 'active', canonicalState: 'ready',
    })
    prismaMock.conversationWriteControl.findUnique.mockResolvedValue({ mode: 'canonical' })
    prismaMock.roomMembership.findUnique.mockResolvedValue({
      principalType: 'human', status: 'left', historyFromSequence: 5n,
      historyThroughSequence: 9n,
    })
    prismaMock.roomMessage.findMany.mockResolvedValue([{
      id: 'message-6', sequence: 6n, text: 'Room reply',
      createdAt: new Date('2026-09-26T00:00:00Z'),
      authorPrincipalTypeSnapshot: 'agent', deliveryStatus: 'sent',
      legacyDirectMessage: null,
    }])
    const page = await readVisitorAgentConversation({
      publicId, visitorUserId: 'visitor-1', after: '0',
    })
    expect(page.messages).toMatchObject([{ id: 'message-6', sequence: '6',
      text: 'Room reply', authorRole: 'agent' }])
    expect(prismaMock.roomMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ roomId: 'conversation-1',
        sequence: { gt: 0n, gte: 5n, lte: 9n } }),
    }))
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('opens the latest public URL history page and rejects mixed cursors', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      status: 'active', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    prismaMock.agentDirectConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', status: 'active',
    })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([])
    await readVisitorAgentConversation({ publicId, visitorUserId: 'visitor-1', before: 'latest' })
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1' }, orderBy: { sequence: 'desc' }, take: 101,
    }))
    await expect(readVisitorAgentConversation({
      publicId, visitorUserId: 'visitor-1', before: 'latest', after: '1',
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('opens the latest page for a scoped browser visitor and pages backward', async () => {
    prismaMock.agentDirectConversation.findUnique.mockResolvedValue({
      id: 'conversation-1', status: 'active',
    })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `message-${200 - index}`, sequence: BigInt(200 - index),
        authorRole: 'agent', text: 'reply', status: 'sent', failureCode: null,
        createdAt: new Date('2026-09-26T00:00:00Z'),
      })),
    )
    const latest = await readVisitorAgentConversationByAgent({
      agentIdentityId: 'agent-1', visitorUserId: 'visitor-1', before: 'latest',
    })
    expect(latest.messages).toHaveLength(100)
    expect(latest.messages[0].sequence).toBe('101')
    expect(latest.messages[99].sequence).toBe('200')
    expect(latest.nextBefore).toBe('101')
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1' }, orderBy: { sequence: 'desc' }, take: 101,
    }))
    await readVisitorAgentConversationByAgent({
      agentIdentityId: 'agent-1', visitorUserId: 'visitor-1', before: '101',
    })
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1', sequence: { lt: 101n } },
    }))
    await expect(readVisitorAgentConversationByAgent({
      agentIdentityId: 'agent-1', visitorUserId: 'visitor-1',
      after: '100', before: 'latest',
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('rejects malformed cursors before database access', async () => {
    await expect(readVisitorAgentConversation({ publicId, visitorUserId: 'visitor-1', after: '-1' }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(prismaMock.agentPublication.findUnique).not.toHaveBeenCalled()
  })

  it('reads historical messages by ID only for the visitor or current owner', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      id: 'conversation-1', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'visitor-1', ownerUserId: 'owner-1',
      publication: { displayName: 'Agent', description: '介绍',
        status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1',
        machine: { paired: true, online: false } },
    })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([])
    const result = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'owner-1',
    })
    expect(result.conversation).toMatchObject({ role: 'owner', visitorUserId: 'visitor-1',
      machineOnline: false })
    expect(prismaMock.agentDirectConversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        OR: [
          { visitorUserId: 'owner-1' },
          { ownerUserId: 'owner-1', agentIdentity: {
            ownerType: 'user', ownerUserId: 'owner-1',
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
  })

  it('records the owner viewing a conversation without touching the visitor read', async () => {
    const record = {
      id: 'conversation-1', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'visitor-1', ownerUserId: 'owner-1', ownerLastViewedAt: null,
      publication: { displayName: 'Agent', description: '介绍',
        status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1',
        machine: { paired: true, online: true } },
    }
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(record)
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([])
    prismaMock.agentDirectMessage.findMany.mockRejectedValueOnce(new Error('read_failed'))
    await expect(readAgentDirectConversationById({ conversationId: 'conversation-1', userId: 'owner-1', before: 'latest' }))
      .rejects.toThrow('read_failed')
    expect(prismaMock.agentDirectConversation.updateMany).not.toHaveBeenCalled()
    await readAgentDirectConversationById({ conversationId: 'conversation-1', userId: 'owner-1', before: '10' })
    expect(prismaMock.agentDirectConversation.updateMany).not.toHaveBeenCalled()
    const now = new Date('2026-09-26T12:00:00Z')
    const owned = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'owner-1', now,
    })
    expect(owned.conversation).toMatchObject({ role: 'owner', ownerLastViewedAt: now.toISOString() })
    expect(prismaMock.agentDirectConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conversation-1', OR: [{ ownerLastViewedAt: null }, { ownerLastViewedAt: { lt: now } }] },
      data: { ownerLastViewedAt: now },
    })

    prismaMock.agentDirectConversation.updateMany.mockClear()
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      ...record, ownerLastViewedAt: now,
    })
    const visited = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'visitor-1',
    })
    expect(visited.conversation).toMatchObject({ role: 'visitor', ownerLastViewedAt: now.toISOString() })
    expect(prismaMock.agentDirectConversation.updateMany).not.toHaveBeenCalled()
  })
  it('uses the agent side for an explicit publisher view even when testing their own link', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      id: 'conversation-1', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'owner-1', ownerUserId: 'owner-1', visitorUser: { name: 'Test visitor' },
      publication: { displayName: 'Support AI', description: '', status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', machine: { paired: true, online: false } },
    })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([])
    const result = await readAgentDirectConversationById({ conversationId: 'conversation-1', userId: 'owner-1', perspective: 'owner' })
    expect(result.conversation).toMatchObject({ role: 'owner', visitorName: 'Test visitor', canReplyAsAgent: true })
    expect(prismaMock.agentDirectConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'conversation-1', OR: [{ ownerUserId: 'owner-1', agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' } }],
    } }))
  })
  it('does not grant publisher access merely because a visitor requests owner perspective', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(null)
    await expect(readAgentDirectConversationById({ conversationId: 'conversation-1', userId: 'visitor-1', perspective: 'owner' }))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentDirectConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'conversation-1', OR: [{ ownerUserId: 'visitor-1', agentIdentity: { ownerType: 'user', ownerUserId: 'visitor-1' } }],
    } }))
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('returns no history when the user has no conversation grant', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(null)
    await expect(readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'stranger-1',
    })).rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('returns an active link only with the authorized conversation metadata', async () => {
    const record = {
      id: 'conversation-1', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'visitor-1', ownerUserId: 'owner-1',
      publication: { displayName: 'Agent', description: '介绍',
        status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    }
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(record)
    prismaMock.agentDirectMessage.findMany.mockResolvedValue([])
    const active = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'visitor-1', before: 'latest',
    })
    expect(active.conversation).toMatchObject({ displayName: 'Agent', publicId,
      publicationStatus: 'active' })
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      ...record, publication: { ...record.publication, status: 'revoked' },
    })
    const revoked = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'visitor-1', before: 'latest',
    })
    expect(revoked.conversation.publicationStatus).toBe('revoked')
    expect(revoked.conversation).not.toHaveProperty('publicId')
  })

  it('opens the latest 100 messages and pages backward under the same ACL', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      id: 'conversation-1', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'visitor-1', ownerUserId: 'owner-1',
      publication: { displayName: 'Agent', description: '介绍',
        status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    prismaMock.agentDirectMessage.findMany.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `message-${200 - index}`, sequence: BigInt(200 - index),
        authorRole: 'agent', text: 'reply', status: 'sent', failureCode: null,
        createdAt: new Date('2026-09-26T00:00:00Z'),
      })),
    )
    const result = await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'visitor-1', before: 'latest',
    })
    expect(result.messages).toHaveLength(100)
    expect(result.messages[0].sequence).toBe('101')
    expect(result.messages[99].sequence).toBe('200')
    expect(result.nextBefore).toBe('101')
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1' },
      orderBy: { sequence: 'desc' }, take: 101,
    }))
    await readAgentDirectConversationById({
      conversationId: 'conversation-1', userId: 'visitor-1', before: '101',
    })
    expect(prismaMock.agentDirectMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1', sequence: { lt: 101n } },
    }))
  })

  it('walks 500 messages forward and backward without gaps or duplicates', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      id: 'conversation-500', status: 'active', agentIdentityId: 'agent-1',
      visitorUserId: 'visitor-1', ownerUserId: 'owner-1',
      publication: { displayName: 'Agent', description: '介绍',
        status: 'active', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    const allRows = Array.from({ length: 500 }, (_, index) => ({
      id: `message-${index + 1}`, sequence: BigInt(index + 1),
      authorRole: index % 2 === 0 ? 'visitor' : 'agent', text: `text-${index + 1}`,
      status: 'sent', failureCode: null, createdAt: new Date('2026-09-26T00:00:00Z'),
    }))
    prismaMock.agentDirectMessage.findMany.mockImplementation(
      async ({ where, orderBy, take }: {
        where: { sequence?: { gt?: bigint, lt?: bigint } }
        orderBy: { sequence: 'asc' | 'desc' }
        take: number
      }) => {
        let rows = allRows
        if (where.sequence?.gt !== undefined) {
          rows = rows.filter((row) => row.sequence > where.sequence!.gt!)
        }
        if (where.sequence?.lt !== undefined) {
          rows = rows.filter((row) => row.sequence < where.sequence!.lt!)
        }
        rows = [...rows].sort((a, b) => orderBy.sequence === 'asc'
          ? Number(a.sequence - b.sequence) : Number(b.sequence - a.sequence))
        return rows.slice(0, take)
      },
    )
    const expectedSequences = Array.from({ length: 500 }, (_, index) => String(index + 1))

    const forward: string[] = []
    let after: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await readAgentDirectConversationById({
        conversationId: 'conversation-500', userId: 'visitor-1', after,
      })
      forward.push(...page.messages.map((message) => message.sequence))
      if (!page.nextAfter) break
      after = page.nextAfter
    }
    expect(forward).toEqual(expectedSequences)

    const backward: string[] = []
    let before: string | undefined = 'latest'
    for (let guard = 0; guard < 10; guard++) {
      const page = await readAgentDirectConversationById({
        conversationId: 'conversation-500', userId: 'visitor-1', before,
      })
      backward.unshift(...page.messages.map((message) => message.sequence))
      if (!page.nextBefore) break
      before = page.nextBefore
    }
    expect(backward).toEqual(expectedSequences)
  })

  it('rejects mixed and invalid paging modes before reading message bodies', async () => {
    for (const args of [
      { before: 'latest', after: '10' }, { before: '0' }, { before: '-1' },
    ]) {
      await expect(readAgentDirectConversationById({
        conversationId: 'conversation-1', userId: 'visitor-1', ...args,
      })).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })
})

describe('published Agent visitor message persistence', () => {
  const tx = {
    $queryRaw: vi.fn(),
    agentPublication: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    userContact: { findUnique: vi.fn() },
    agentDirectConversation: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    agentDirectMessage: { findUnique: vi.fn(), create: vi.fn() },
    agentDirectAttachment: { findMany: vi.fn(), updateMany: vi.fn() },
    room: { update: vi.fn() },
    roomMembership: { findUnique: vi.fn(), update: vi.fn() },
    roomMessage: { create: vi.fn(), findUnique: vi.fn() },
    roomReadState: { upsert: vi.fn() },
  }
  beforeEach(() => {
    vi.clearAllMocks()
    tx.$queryRaw.mockResolvedValue([{ mode: 'legacy' }])
    tx.agentDirectAttachment.findMany.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation((operation: (arg: typeof tx) => unknown) => operation(tx))
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    tx.user.findUnique.mockResolvedValue({ id: 'visitor-1', name: '访客' })
    tx.room.update.mockResolvedValue({ nextSequence: 1n })
    tx.roomMembership.findUnique.mockResolvedValue({ id: 'visitor-membership',
      displayAlias: '访客', status: 'active' })
    tx.roomMessage.create.mockResolvedValue({ id: 'message-1' })
    tx.agentDirectConversation.upsert.mockResolvedValue({ id: 'conversation-1', status: 'active' })
    tx.agentDirectMessage.findUnique.mockResolvedValue(null)
    tx.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    tx.agentDirectConversation.update.mockResolvedValue({ nextSequence: 1n })
    tx.agentDirectMessage.create.mockResolvedValue({ id: 'message-1' })
  })

  const input = {
    publicId, visitorUserId: 'visitor-1', text: ' 你好 ', clientMessageId: 'request-1',
    now: new Date('2026-09-26T00:00:00Z'),
  }

  it('creates the first conversation and pending message in one serializable transaction', async () => {
    const result = await enqueueVisitorAgentMessage(input)
    expect(result).toEqual({
      conversationId: 'conversation-1', messageId: 'message-1',
      sequence: '1', status: 'pending', idempotent: false,
    })
    expect(tx.agentDirectConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentIdentityId_visitorUserId: {
        agentIdentityId: 'agent-1', visitorUserId: 'visitor-1',
      } },
    }))
    expect(tx.agentDirectMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conversation-1', sequence: 1n,
        authorRole: 'visitor', text: '你好', status: 'pending',
        agentConfigurationVersion: 4,
      }),
    }))
    expect(tx.agentPublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'publication-1', publicId, status: 'active', policyVersion: 1,
        quotaDay: '2026-09-26', quotaUsed: { lt: 100 },
      }),
      data: { quotaUsed: { increment: 1 } },
    })
  })

  it('binds a verified attachment to the new turn in the same transaction', async () => {
    const attachmentId = `datt_${'a'.repeat(36)}`
    tx.agentDirectAttachment.findMany.mockResolvedValueOnce([
      { id: attachmentId, byteSize: 10n },
    ])
    tx.agentDirectAttachment.updateMany.mockResolvedValue({ count: 1 })
    await expect(enqueueVisitorAgentMessage({ ...input, text: '',
      attachmentIds: [attachmentId] })).resolves.toMatchObject({ messageId: 'message-1' })
    expect(tx.agentDirectAttachment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { in: [attachmentId] },
        publicationId: 'publication-1', visitorUserId: 'visitor-1', messageId: null,
        status: 'ready' }),
      data: { messageId: 'message-1' },
    })
  })

  it('blocks a new visitor when adding is off but preserves an existing conversation', async () => {
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', allowNewContacts: false, dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    tx.agentDirectConversation.findUnique.mockResolvedValueOnce(null)
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectConversation.upsert).not.toHaveBeenCalled()
    tx.agentDirectConversation.findUnique.mockResolvedValueOnce({ id: 'conversation-1' })
    await expect(enqueueVisitorAgentMessage(input)).resolves.toMatchObject({ conversationId: 'conversation-1' })
    tx.agentDirectConversation.findUnique.mockResolvedValueOnce(null)
    tx.userContact.findUnique.mockResolvedValueOnce({ id: 'saved-contact-1' })
    await expect(enqueueVisitorAgentMessage(input)).resolves.toMatchObject({ conversationId: 'conversation-1' })
  })

  it('blocks direct messages from an unapproved new visitor even when adding is on', async () => {
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', allowNewContacts: true, requireContactApproval: true,
      dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    tx.agentDirectConversation.findUnique.mockResolvedValueOnce(null)
    tx.userContact.findUnique.mockResolvedValueOnce(null)
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectConversation.upsert).not.toHaveBeenCalled()
  })

  it('lets the publisher message their own AI without adding themselves as a contact', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'owner-1', name: '发布者', accountTier: 'standard' })
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', allowNewContacts: false, requireContactApproval: true,
      dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    await expect(enqueueVisitorAgentMessage({ ...input, visitorUserId: 'owner-1' }))
      .resolves.toMatchObject({ conversationId: 'conversation-1' })
    expect(tx.userContact.findUnique).not.toHaveBeenCalled()
  })

  it('allows an opted-in browser guest but fences sends when guest access is turned off', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'guest-1', name: '匿名访客',
      accountTier: 'anonymous_visitor' })
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', allowNewContacts: false, allowAnonymousVisitors: true,
      requireContactApproval: false, dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    await expect(enqueueVisitorAgentMessage({ ...input, visitorUserId: 'guest-1' }))
      .resolves.toMatchObject({ conversationId: 'conversation-1' })
    expect(tx.userContact.findUnique).not.toHaveBeenCalled()
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', allowNewContacts: false, allowAnonymousVisitors: false,
      requireContactApproval: false, dailyMessageLimit: 100, policyVersion: 2,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1', configurationVersion: 4 },
    })
    await expect(enqueueVisitorAgentMessage({ ...input, visitorUserId: 'guest-1' }))
      .rejects.toMatchObject({ code: 'unavailable' })
  })

  it('writes one canonical RoomMessage and a bodyless execution job after cutover', async () => {
    tx.$queryRaw.mockResolvedValue([{ mode: 'canonical' }])
    tx.agentDirectConversation.upsert.mockResolvedValue({
      id: 'conversation-1', status: 'active', roomId: 'conversation-1',
      canonicalState: 'ready',
    })
    prismaMock.roomMessage.findUnique.mockResolvedValue(null)
    const result = await enqueueVisitorAgentMessage(input)
    expect(result).toEqual({ conversationId: 'conversation-1', messageId: 'message-1',
      sequence: '1', status: 'pending', idempotent: false })
    expect(tx.roomMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roomId: 'conversation-1', sequence: 1n,
        authorMembershipId: 'visitor-membership', text: '你好', deliveryStatus: 'pending' }),
    }))
    expect(tx.agentDirectMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'message-1', roomMessageId: 'message-1',
        text: null, status: 'pending' }),
    }))
    expect(tx.agentDirectConversation.update).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { nextSequence: 1n, canonicalCopiedSequence: 1n, lastActivityAt: input.now },
    })
  })

  it('rejoins a left visitor at the next message without restoring old history', async () => {
    tx.$queryRaw.mockResolvedValue([{ mode: 'canonical' }])
    tx.agentDirectConversation.upsert.mockResolvedValue({
      id: 'conversation-1', status: 'active', roomId: 'conversation-1',
      canonicalState: 'ready',
    })
    tx.roomMembership.findUnique.mockResolvedValue({ id: 'visitor-membership',
      displayAlias: '访客', status: 'left' })
    await enqueueVisitorAgentMessage(input)
    expect(tx.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'visitor-membership' }, data: {
        status: 'active', membershipEpoch: { increment: 1 },
        historyFromSequence: 1n, historyThroughSequence: null,
        joinedAt: input.now, removedAt: null,
      },
    })
  })

  it('returns an identical retry without advancing the sequence', async () => {
    tx.agentDirectMessage.findUnique.mockResolvedValue({
      id: 'message-1', sequence: 1n, text: '你好', status: 'pending',
    })
    const result = await enqueueVisitorAgentMessage(input)
    expect(result.idempotent).toBe(true)
    expect(tx.agentDirectConversation.update).not.toHaveBeenCalled()
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
    expect(tx.agentPublication.updateMany).not.toHaveBeenCalled()
  })

  it('retries a concurrent uniqueness conflict and finds the committed message', async () => {
    prismaMock.$transaction
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce((operation: (arg: typeof tx) => unknown) => operation(tx))
    tx.agentDirectMessage.findUnique.mockResolvedValue({
      id: 'message-1', sequence: 1n, text: '你好', status: 'pending',
    })
    const result = await enqueueVisitorAgentMessage(input)
    expect(result.idempotent).toBe(true)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2)
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })

  it('rejects a paused publication before visitor or conversation access', async () => {
    tx.agentPublication.findUnique.mockResolvedValue({
      status: 'paused', agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.user.findUnique).not.toHaveBeenCalled()
    expect(tx.agentDirectConversation.upsert).not.toHaveBeenCalled()
  })

  it('rejects an active publication whose Agent moved to a different owner', async () => {
    tx.agentPublication.findUnique.mockResolvedValue({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', dailyMessageLimit: 100, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'new-owner' },
    })
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectConversation.upsert).not.toHaveBeenCalled()
  })

  it('enforces the daily limit before writing a message', async () => {
    tx.agentPublication.findUnique.mockResolvedValueOnce({
      id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', dailyMessageLimit: 1, policyVersion: 1,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    }).mockResolvedValueOnce({
      status: 'active', policyVersion: 1, quotaDay: '2026-09-26', quotaUsed: 1,
    })
    tx.agentPublication.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'limit_reached' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })

  it('charges different visitors against the same publication quota row', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'visitor-2', name: '另一位访客' })
    await enqueueVisitorAgentMessage({ ...input, visitorUserId: 'visitor-2' })
    expect(tx.agentPublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'publication-1', quotaUsed: { lt: 100 }, policyVersion: 1,
      }),
      data: { quotaUsed: { increment: 1 } },
    })
    expect(tx.agentDirectMessage.create).toHaveBeenCalledTimes(1)
  })

  it('does not charge or persist when the publication policy changes mid-send', async () => {
    tx.agentPublication.findUnique
      .mockResolvedValueOnce({
        id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
        status: 'active', dailyMessageLimit: 100, policyVersion: 1,
        agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
      })
      .mockResolvedValueOnce({
        status: 'active', policyVersion: 2, quotaDay: '2026-09-26', quotaUsed: 0,
      })
    tx.agentPublication.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    await expect(enqueueVisitorAgentMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })
})

describe('published Agent visitor list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.conversationWriteControl.findUnique.mockResolvedValue(null)
  })

  it('lists only the signed-in visitor metadata with a bounded page', async () => {
    prismaMock.agentDirectConversation.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({
        id: `conversation-${index}`, agentIdentityId: `agent-${index}`,
        ownerUserId: 'owner-1', status: 'active',
        lastActivityAt: new Date('2026-09-26T00:00:00Z'),
        publication: { displayName: `Agent ${index}`, description: '介绍',
          status: 'active', publicId, ownerUserId: 'owner-1' },
        agentIdentity: { status: 'active', ownerUserId: 'owner-1',
          machine: { paired: true, online: index !== 0 } },
      })),
    )
    const result = await listVisitorAgentDirectConversations({ visitorUserId: 'visitor-1' })
    expect(result.conversations).toHaveLength(50)
    expect(result.conversations[0]).toMatchObject({ displayName: 'Agent 0', publicId,
      machineOnline: false })
    expect(result.conversations[1]).toMatchObject({ machineOnline: true })
    expect(result.nextCursor).toBe('conversation-49')
    expect(prismaMock.agentDirectConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { visitorUserId: 'visitor-1' }, take: 51,
      select: expect.not.objectContaining({ messages: expect.anything() }),
    }))
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('rejects a cursor belonging to another visitor before listing', async () => {
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue(null)
    await expect(listVisitorAgentDirectConversations({
      visitorUserId: 'visitor-1', cursor: 'other-conversation',
    })).rejects.toMatchObject({ code: 'invalid' })
    expect(prismaMock.agentDirectConversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-conversation', visitorUserId: 'visitor-1' },
      select: { id: true, lastActivityAt: true },
    })
    expect(prismaMock.agentDirectConversation.findMany).not.toHaveBeenCalled()
  })

  it('keeps revoked history discoverable without exposing an inactive link', async () => {
    prismaMock.agentDirectConversation.findMany.mockResolvedValue([{
      id: 'conversation-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      status: 'active', lastActivityAt: new Date('2026-09-26T00:00:00Z'),
      publication: { displayName: 'Past Agent', description: '介绍',
        status: 'revoked', publicId, ownerUserId: 'owner-1' },
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    }])
    const result = await listVisitorAgentDirectConversations({ visitorUserId: 'visitor-1' })
    expect(result.conversations[0]).toMatchObject({
      id: 'conversation-1', publicationStatus: 'revoked',
    })
    expect(result.conversations[0]).not.toHaveProperty('publicId')
  })
})

describe('published Agent owner list', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an exact Owner summary on the first page without reading message bodies', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentDirectConversation.findMany.mockResolvedValue([])
    prismaMock.agentDirectConversation.count.mockResolvedValue(500)
    prismaMock.agentDirectMessage.count
      .mockResolvedValueOnce(12).mockResolvedValueOnce(2).mockResolvedValueOnce(4)
    const result = await listOwnedAgentDirectConversations({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
    })
    expect(result.summary).toEqual({ conversationCount: 500, pendingCount: 12,
      runningCount: 2, failedCount: 4 })
    expect(prismaMock.agentDirectMessage.count).toHaveBeenNthCalledWith(1, {
      where: { authorRole: 'visitor', status: 'pending', conversation: {
        ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      } },
    })
    expect(prismaMock.agentDirectMessage.findMany).not.toHaveBeenCalled()
  })

  it('checks Agent ownership before listing visitor metadata', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(null)
    await expect(listOwnedAgentDirectConversations({
      ownerUserId: 'stranger-1', agentIdentityId: 'agent-1',
    })).rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentDirectConversation.findMany).not.toHaveBeenCalled()
  })

  it('uses an owner-scoped cursor and returns at most 50 rows', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentDirectConversation.findFirst.mockResolvedValue({
      id: 'cursor-1', lastActivityAt: new Date('2026-09-26T00:00:00Z'),
    })
    prismaMock.agentDirectConversation.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({
        id: `conversation-${index}`, visitorUserId: `visitor-${index}`,
        visitorUser: { name: `访客 ${index}`, phone: index === 0 ? '+8619900000001' : null },
        status: 'active',
        lastActivityAt: new Date('2026-09-25T00:00:00Z'),
        createdAt: new Date('2026-09-24T00:00:00Z'),
      })),
    )
    const result = await listOwnedAgentDirectConversations({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1', cursor: 'cursor-1',
    })
    expect(result.conversations).toHaveLength(50)
    expect(result.conversations[0]).toMatchObject({
      visitorName: '访客 0', visitorPhoneMasked: '199****0001',
    })
    expect(JSON.stringify(result.conversations[0])).not.toContain('19900000001')
    expect(result.conversations[1]).toMatchObject({ visitorPhoneMasked: null })
    expect(result.nextCursor).toBe('conversation-49')
    expect(result.summary).toBeNull()
    expect(prismaMock.agentDirectConversation.count).not.toHaveBeenCalled()
    expect(prismaMock.agentDirectConversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'cursor-1', ownerUserId: 'owner-1', agentIdentityId: 'agent-1' },
      select: { id: true, lastActivityAt: true },
    })
    expect(prismaMock.agentDirectConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1' }),
      take: 51,
    }))
  })
})
