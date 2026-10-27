// @covers open-source/packages/server/src/services/published-ai-room-migration.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ $transaction: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))

import {
  copyPublishedAiRoomBatch,
  ensurePublishedAiRoom,
  finalizePublishedAiRoom,
} from '../services/published-ai-room-migration.js'

const ids = { directConversationId: 'direct-1', ownerUserId: 'owner-1',
  visitorUserId: 'visitor-1', agentIdentityId: 'agent-1', publicationId: 'publication-1' }
const direct = { id: 'direct-1', roomId: null, canonicalState: 'legacy',
  canonicalCopiedSequence: 0n, nextSequence: 1n, ...ids }

function transaction() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'direct-1' }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    agentDirectConversation: { findUnique: vi.fn().mockResolvedValue(direct),
      update: vi.fn().mockResolvedValue({}) },
    agentPublication: { findUnique: vi.fn().mockResolvedValue({
      displayName: 'AI', ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
    }) },
    user: { findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ name: where.id === 'owner-1' ? 'Owner' : 'Visitor' })) },
    agentIdentity: { findUnique: vi.fn().mockResolvedValue({
      displayName: 'AI', ownerUserId: 'owner-1',
    }) },
    room: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}) },
    roomMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'visitor-membership' }),
      upsert: vi.fn().mockImplementation(({ create }: {
      create: { principalType: string }
    }) => Promise.resolve(create.principalType === 'human'
      ? { id: 'visitor-membership', principalType: 'human', userId: 'visitor-1', status: 'active' }
      : { id: 'agent-membership', principalType: 'agent', agentIdentityId: 'agent-1',
        status: 'active' })) },
    roomReadState: { upsert: vi.fn().mockResolvedValue({}) },
    agentDirectMessage: { findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
    roomMessage: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
    conversationWriteControl: { findUnique: vi.fn().mockResolvedValue({ mode: 'paused' }) },
  }
  return tx
}

describe('published AI canonical Room migration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the legacy direct ID and creates only visitor plus AI memberships', async () => {
    const tx = transaction()
    const result = await ensurePublishedAiRoom(tx as never, ids)
    expect(result).toMatchObject({ roomId: 'direct-1',
      visitorMembershipId: 'visitor-membership', agentMembershipId: 'agent-membership' })
    expect(tx.room.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'direct-1', conversationKind: 'published_ai', ownerUserId: 'owner-1',
      visibility: 'private', joinPolicy: 'closed',
    }) })
    const memberships = tx.roomMembership.upsert.mock.calls.map(([arg]) => arg.create)
    expect(memberships).toHaveLength(2)
    expect(memberships.map((item) => item.principalKey)).toEqual([
      'human:visitor-1', 'agent:agent-1',
    ])
    expect(memberships).not.toContainEqual(expect.objectContaining({ userId: 'owner-1' }))
  })

  it('copies exact message ID and sequence before advancing the shadow cursor', async () => {
    const tx = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    tx.agentDirectMessage.findMany.mockResolvedValue([{
      id: 'message-1', sequence: 1n, authorRole: 'visitor', clientMessageId: 'client-1',
      text: 'hello', status: 'answered', createdAt: new Date('2026-09-26T00:00:00Z'),
      roomMessageId: null,
    }])
    const result = await copyPublishedAiRoomBatch('direct-1')
    expect(result).toEqual({ copied: 1, copiedThrough: '1', ready: false })
    expect(tx.roomMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'message-1', roomId: 'direct-1', sequence: 1n,
      authorMembershipId: 'visitor-membership', text: 'hello',
    }) })
    expect(tx.agentDirectMessage.update).toHaveBeenCalledWith({
      where: { id: 'message-1' }, data: { roomMessageId: 'message-1' },
    })
    expect(tx.agentDirectConversation.update).toHaveBeenLastCalledWith({
      where: { id: 'direct-1' }, data: { canonicalCopiedSequence: 1n },
    })
  })

  it('refuses cutover while a legacy provider turn remains in flight', async () => {
    const tx = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    tx.agentDirectConversation.findUnique.mockResolvedValue({ ...direct,
      roomId: 'direct-1', canonicalState: 'backfilling', canonicalCopiedSequence: 1n })
    tx.agentDirectMessage.count.mockResolvedValue(1)
    await expect(finalizePublishedAiRoom('direct-1'))
      .rejects.toMatchObject({ code: 'in_flight' })
    expect(tx.agentDirectConversation.update).not.toHaveBeenCalled()
  })

  it('reconciles copied delivery states after legacy turns drain', async () => {
    const tx = transaction()
    db.$transaction.mockImplementation((fn) => fn(tx))
    tx.agentDirectConversation.findUnique.mockResolvedValue({ ...direct,
      roomId: 'direct-1', canonicalState: 'backfilling', canonicalCopiedSequence: 1n })
    tx.agentDirectMessage.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    await finalizePublishedAiRoom('direct-1')
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.agentDirectConversation.update).toHaveBeenCalledWith({
      where: { id: 'direct-1' }, data: { canonicalState: 'ready' },
    })
  })
})
