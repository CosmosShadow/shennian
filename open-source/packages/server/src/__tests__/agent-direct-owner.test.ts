// @covers open-source/packages/server/src/services/agent-direct-owner.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), $transaction: vi.fn(), agentDirectConversation: { findFirst: vi.fn(), findMany: vi.fn() },
    roomMessage: { findUnique: vi.fn() } }, broadcast: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomMessageRecord: mocks.broadcast }))
import { listOwnerAgentDirectConversations, sendOwnerAgentDirectMessage } from '../services/agent-direct-owner'

function fixture(mode = 'legacy') {
  const conversation = { id: 'conversation-1', ownerUserId: 'owner-1', visitorUserId: 'visitor-1',
    agentIdentityId: 'agent-1', publicationId: 'pub-1', status: 'active', roomId: 'conversation-1',
    canonicalState: 'ready', publication: { id: 'pub-1', agentIdentityId: 'agent-1',
      ownerUserId: 'owner-1', status: 'active', generation: 2, policyVersion: 3 },
    agentIdentity: { status: 'active', configurationVersion: 4 } }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ mode }]),
    agentDirectConversation: { findFirst: vi.fn().mockResolvedValue(conversation),
      update: vi.fn().mockResolvedValue({ nextSequence: 8n }) },
    agentDirectAttachment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    agentDirectMessage: { findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'message-8' }) },
    room: { update: vi.fn().mockResolvedValue({ nextSequence: 8n }) },
    roomMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'membership-agent',
      displayAlias: 'Support AI', status: 'active' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Publisher' }) },
    roomMessage: { create: vi.fn().mockResolvedValue({ id: 'message-8' }), findUnique: vi.fn() },
  }
  mocks.prisma.$transaction.mockImplementation(async (fn) => fn(tx))
  return { tx, conversation }
}
const input = { ownerUserId: 'owner-1', conversationId: 'conversation-1', text: '  Hello visitor  ', clientMessageId: 'request-1' }

describe('publisher reply identity and write boundaries', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('writes an agent reply with the authenticated operator retained and no visitor task', async () => {
    const { tx } = fixture()
    await expect(sendOwnerAgentDirectMessage(input)).resolves.toEqual({
      conversationId: 'conversation-1', messageId: 'message-8', sequence: '8', status: 'sent', idempotent: false,
    })
    expect(tx.agentDirectConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'conversation-1', ownerUserId: 'owner-1', agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' },
    } }))
    expect(tx.agentDirectMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      authorRole: 'agent', status: 'sent', clientMessageId: 'owner:owner-1:request-1', text: 'Hello visitor',
      publicationGeneration: 2, policyVersion: 3, agentConfigurationVersion: 4,
    }) }))
    expect(tx.roomMessage.create).not.toHaveBeenCalled()
  })
  it.each(['legacy', 'canonical'])('binds publisher attachments to an agent reply in %s mode without enqueueing a task', async (mode) => {
    const { tx } = fixture(mode)
    const id = 'datt_00000000-0000-0000-0000-000000000001'
    tx.agentDirectAttachment.findMany.mockResolvedValue([{ id, byteSize: 12n }] as never)
    await expect(sendOwnerAgentDirectMessage({ ...input, text: '', attachmentIds: [id] }))
      .resolves.toMatchObject({ status: 'sent', idempotent: false })
    expect(tx.agentDirectAttachment.findMany).toHaveBeenCalledWith({ where: {
      id: { in: [id] }, publicationId: 'pub-1', visitorUserId: 'owner-1',
      status: 'ready', messageId: null, expiresAt: { gt: expect.any(Date) },
    }, select: { id: true, byteSize: true } })
    expect(tx.agentDirectAttachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { messageId: 'message-8' } }))
    expect(tx.agentDirectMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorRole: 'agent', status: 'sent' }) }))
  })
  it('rejects missing/foreign/expired attachments before allocating a message', async () => {
    const { tx } = fixture()
    await expect(sendOwnerAgentDirectMessage({ ...input, attachmentIds: ['datt_00000000-0000-0000-0000-000000000001'] }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })
  it('rejects attachment rebinding races and aggregate size overflow', async () => {
    const { tx } = fixture()
    const id = 'datt_00000000-0000-0000-0000-000000000001'
    tx.agentDirectAttachment.findMany.mockResolvedValue([{ id, byteSize: 100n * 1024n * 1024n + 1n }] as never)
    await expect(sendOwnerAgentDirectMessage({ ...input, attachmentIds: [id] })).rejects.toMatchObject({ code: 'invalid' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
    tx.agentDirectAttachment.findMany.mockResolvedValue([{ id, byteSize: 12n }] as never)
    tx.agentDirectAttachment.updateMany.mockResolvedValue({ count: 0 })
    await expect(sendOwnerAgentDirectMessage({ ...input, attachmentIds: [id] })).rejects.toMatchObject({ code: 'invalid' })
  })
  it('requires retries to retain the original exact attachment set', async () => {
    const { tx } = fixture()
    const id = 'datt_00000000-0000-0000-0000-000000000001'
    tx.agentDirectMessage.findUnique.mockResolvedValue({ id: 'message-8', sequence: 8n, text: 'Hello visitor' } as never)
    tx.agentDirectAttachment.findMany.mockResolvedValue([{ id, byteSize: 12n }] as never)
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'invalid' })
    await expect(sendOwnerAgentDirectMessage({ ...input, attachmentIds: [id] })).resolves.toMatchObject({ idempotent: true })
    expect(tx.agentDirectAttachment.updateMany).not.toHaveBeenCalled()
  })
  it('rejects a visitor or different publisher without touching messages', async () => {
    const { tx } = fixture()
    tx.agentDirectConversation.findFirst.mockResolvedValue(null as never)
    await expect(sendOwnerAgentDirectMessage({ ...input, ownerUserId: 'visitor-1' })).rejects.toMatchObject({ code: 'not_found' })
    expect(tx.agentDirectMessage.findUnique).not.toHaveBeenCalled()
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })
  it.each(['', ' '.repeat(3), 'x'.repeat(20_001)])('rejects empty/oversized input before opening a transaction', async (text) => {
    await expect(sendOwnerAgentDirectMessage({ ...input, text })).rejects.toMatchObject({ code: 'invalid' })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each(['../other', '', 'x'.repeat(129)])('rejects malformed idempotency IDs', async (clientMessageId) => {
    await expect(sendOwnerAgentDirectMessage({ ...input, clientMessageId })).rejects.toMatchObject({ code: 'invalid' })
  })
  it.each(['paused', 'revoked', 'draft'])('does not send through a %s publication', async (status) => {
    const { tx, conversation } = fixture()
    conversation.publication.status = status
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })
  it('does not send to a paused conversation or disabled agent', async () => {
    const { tx, conversation } = fixture()
    conversation.status = 'paused'
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    conversation.status = 'active'; conversation.agentIdentity.status = 'deleted'
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
  })
  it('retries the same text without advancing the sequence, even if subsequently paused', async () => {
    const { tx, conversation } = fixture()
    tx.agentDirectMessage.findUnique.mockResolvedValue({ id: 'message-8', sequence: 8n, text: 'Hello visitor' } as never)
    conversation.status = 'paused'
    await expect(sendOwnerAgentDirectMessage(input)).resolves.toMatchObject({ idempotent: true, sequence: '8' })
    expect(tx.agentDirectConversation.update).not.toHaveBeenCalled()
    expect(tx.agentDirectMessage.create).not.toHaveBeenCalled()
    await expect(sendOwnerAgentDirectMessage({ ...input, text: 'Changed' })).rejects.toMatchObject({ code: 'invalid' })
  })
  it('writes through canonical Room authority without adding the publisher as a member', async () => {
    const { tx } = fixture('canonical')
    mocks.prisma.roomMessage.findUnique.mockResolvedValue({ id: 'message-8' })
    await sendOwnerAgentDirectMessage(input)
    expect(tx.roomMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      authorMembershipId: 'membership-agent', authorPrincipalTypeSnapshot: 'agent',
      ownerUserIdSnapshot: 'owner-1', authorDisplayNameSnapshot: 'Support AI', text: 'Hello visitor',
      source: 'managed_agent', sequence: 8n,
    }) }))
    expect(tx.agentDirectMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      id: 'message-8', roomMessageId: 'message-8', text: null, authorRole: 'agent',
    }) }))
    expect(mocks.broadcast).toHaveBeenCalledWith('conversation-1', { id: 'message-8' })
  })
  it('rejects sends after the canonical visitor left', async () => {
    const { tx } = fixture('canonical')
    tx.roomMembership.findUnique.mockResolvedValueOnce({ id: 'member', displayAlias: 'AI', status: 'active' })
      .mockResolvedValueOnce({ status: 'left' } as never)
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.roomMessage.create).not.toHaveBeenCalled()
  })
  it.each(['paused', 'missing'])('does not bypass a %s write gate', async (mode) => {
    const { tx } = fixture(mode)
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.agentDirectConversation.findFirst).not.toHaveBeenCalled()
  })
  it('does not guess an unready canonical Room', async () => {
    const { tx, conversation } = fixture('canonical')
    conversation.canonicalState = 'backfilling'
    await expect(sendOwnerAgentDirectMessage(input)).rejects.toMatchObject({ code: 'unavailable' })
    expect(tx.roomMessage.create).not.toHaveBeenCalled()
  })
  it('retries serializable conflicts but does not retry permission failures', async () => {
    const { tx } = fixture()
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' })
    await sendOwnerAgentDirectMessage(input)
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(tx.agentDirectMessage.create).toHaveBeenCalledTimes(1)
  })
})
describe('publisher inventory', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('lists only owned metadata, with bounded pagination and no phone or body', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ key: 'chat-0', count: 1n }])
    mocks.prisma.agentDirectConversation.findMany.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({
      id: `chat-${i}`, agentIdentityId: 'agent-1', status: 'active', lastActivityAt: new Date('2026-10-10'),
      visitorUser: { name: 'Visitor' }, publication: { displayName: 'AI', status: 'active' },
    })))
    const page = await listOwnerAgentDirectConversations({ ownerUserId: 'owner-1' })
    expect(page.conversations).toHaveLength(50)
    expect(page.nextCursor).toBe('chat-49')
    expect(page.conversations[0]).toMatchObject({ role: 'owner', visitorName: 'Visitor', unreadCount: 1 })
    expect(mocks.prisma.agentDirectConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 51, where: { ownerUserId: 'owner-1', agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' } },
    }))
    expect(JSON.stringify(page)).not.toContain('phone')
  })
  it('rejects a cursor outside the authenticated owner scope', async () => {
    mocks.prisma.agentDirectConversation.findFirst.mockResolvedValue(null)
    await expect(listOwnerAgentDirectConversations({ ownerUserId: 'owner-1', cursor: 'other-chat' })).rejects.toMatchObject({ code: 'invalid' })
    expect(mocks.prisma.agentDirectConversation.findMany).not.toHaveBeenCalled()
  })
})
