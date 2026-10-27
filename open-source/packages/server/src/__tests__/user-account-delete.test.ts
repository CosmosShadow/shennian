// @covers open-source/packages/server/src/services/user-account-delete.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockTx, mockPrisma, mockCleanupAvatars, mockCleanupAgentAvatars, mockPublishUserLogout } = vi.hoisted(() => {
  const tx = {
    interactiveWork: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    interactiveAsset: { updateMany: vi.fn(async () => ({ count: 0 })) },
    interactiveJob: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    interactiveActivity: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    interactiveVersion: { updateMany: vi.fn(async () => ({ count: 0 })) },
    interactiveHeadEvent: { updateMany: vi.fn(async () => ({ count: 0 })) },
    message: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    requestLog: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    sessionUserState: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    agentPublicationBrowserSession: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    agentDirectConversation: { findMany: vi.fn(() => Promise.resolve([])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    agentPublication: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    nianSession: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    machineGrant: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    machine: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    devicePushRegistration: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    device: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    qrSession: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    room: { findMany: vi.fn(() => Promise.resolve([])),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    roomMessage: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    roomMembership: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    roomBrowserApproval: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    accountDeletionOperation: { upsert: vi.fn(() => Promise.resolve({})) },
    user: {
      upsert: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  }
  const prisma = {
    device: { findMany: vi.fn() },
    machine: { findMany: vi.fn() },
    nianSession: { findMany: vi.fn() },
    agentIdentity: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    accountDeletionOperation: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx)
    }),
  }
  return {
    mockTx: tx,
    mockPrisma: prisma,
    mockCleanupAvatars: vi.fn(),
    mockCleanupAgentAvatars: vi.fn(),
    mockPublishUserLogout: vi.fn(),
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../relay/connection-control.js', () => ({ publishUserLogout: mockPublishUserLogout }))
vi.mock('../services/user-avatar.js', () => ({ cleanupUserAvatarObjects: mockCleanupAvatars }))
vi.mock('../services/agent-avatar.js', () => ({
  cleanupAgentAvatarObjects: mockCleanupAgentAvatars,
}))

import { deleteUserAccount, isAccountDeletionComplete } from '../services/user-account-delete.js'

describe('deleteUserAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.device.findMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
    mockPrisma.machine.findMany.mockResolvedValue([{ id: 'm1' }])
    mockPrisma.nianSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    mockPrisma.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1' }])
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    mockCleanupAvatars.mockResolvedValue(0)
    mockCleanupAgentAvatars.mockResolvedValue(0)
  })

  it('deletes data, then logs the user out on every Server', async () => {
    mockTx.agentDirectConversation.findMany.mockResolvedValue([{ roomId: 'direct-room-1' }])
    await deleteUserAccount('user-1', 'delete-operation-user-1-1234567890')

    expect(mockPublishUserLogout).toHaveBeenCalledWith('user-1')
    expect(mockPrisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockPublishUserLogout.mock.invocationCallOrder[0],
    )

    expect(mockTx.interactiveActivity.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockTx.interactiveAsset.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'user-1' }, data: { ownerId: expect.any(String) } })
    expect(mockTx.interactiveAsset.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'user-1', publishedAt: null }, data: { readToken: expect.any(String) } })
    expect(mockTx.message.deleteMany).not.toHaveBeenCalled()
    expect(mockTx.requestLog.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'user-1' },
          { sessionId: { in: ['s1', 's2'] } },
          { machineId: { in: ['m1'] } },
        ],
      },
    })
    expect(mockTx.sessionUserState.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockTx.agentPublicationBrowserSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
    expect(mockTx.agentDirectConversation.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ ownerUserId: 'user-1' }, { visitorUserId: 'user-1' }] },
    })
    expect(mockTx.agentPublication.deleteMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-1' },
    })
    expect(mockTx.agentDirectConversation.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.agentPublication.deleteMany.mock.invocationCallOrder[0],
    )
    expect(mockTx.roomMessage.deleteMany).toHaveBeenCalledWith({
      where: { roomId: { in: ['direct-room-1'] } },
    })
    expect(mockTx.room.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['direct-room-1'] }, conversationKind: 'published_ai' },
    })
    expect(mockTx.agentDirectConversation.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.roomMessage.deleteMany.mock.invocationCallOrder[0],
    )
    expect(mockTx.agentPublication.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockTx.user.deleteMany.mock.invocationCallOrder[0],
    )
    expect(mockTx.nianSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] } },
    })
    expect(mockTx.machineGrant.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ granterId: 'user-1' }, { granteeId: 'user-1' }, { machineId: { in: ['m1'] } }],
      },
    })
    expect(mockTx.machine.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockTx.devicePushRegistration.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
    expect(mockTx.device.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockTx.qrSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockTx.room.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ ownerUserId: 'user-1' }, { createdByUserId: 'user-1' }] },
        data: expect.objectContaining({ status: 'archived', joinPolicy: 'closed' }),
      }),
    )
    expect(mockTx.roomMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserIdSnapshot: 'user-1' },
        data: expect.objectContaining({ authorDisplayNameSnapshot: '已注销用户' }),
      }),
    )
    expect(mockTx.roomMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userId: 'user-1' }, { ownerUserId: 'user-1' }] },
        data: expect.objectContaining({ ownerUserId: 'system-deleted-account', status: 'removed' }),
      }),
    )
    expect(mockTx.user.deleteMany).toHaveBeenCalledWith({ where: { id: 'user-1' } })
    expect(mockTx.accountDeletionOperation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'completed' }),
      }),
    )
    expect(mockCleanupAvatars).toHaveBeenCalledWith('user-1')
    expect(mockCleanupAgentAvatars).toHaveBeenCalledWith(['agent-1'])
  })

  it('uses user-only session query when user owns no machines', async () => {
    mockPrisma.machine.findMany.mockResolvedValue([])
    mockPrisma.nianSession.findMany.mockResolvedValue([{ id: 'sx' }])

    await deleteUserAccount('user-2', 'delete-operation-user-2-1234567890')

    expect(mockPrisma.nianSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
      select: { id: true },
    })
    expect(mockTx.message.deleteMany).not.toHaveBeenCalled()
    expect(mockTx.requestLog.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: 'user-2' }, { sessionId: { in: ['sx'] } }] },
    })
    expect(mockTx.machineGrant.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ granterId: 'user-2' }, { granteeId: 'user-2' }] },
    })
  })

  it('removes private work Room copies when their account is deleted', async () => {
    mockTx.room.findMany.mockResolvedValue([{ id: 'work-room-1' }])
    await deleteUserAccount('user-1', 'delete-operation-work-room-1234567890')
    expect(mockTx.roomMessage.deleteMany).toHaveBeenCalledWith({
      where: { roomId: { in: ['work-room-1'] } },
    })
    expect(mockTx.room.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['work-room-1'] }, conversationKind: 'work' },
    })
  })

  it('is idempotent when the account was already deleted', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)

    await deleteUserAccount('user-gone', 'delete-operation-user-gone-123456')

    expect(mockPrisma.device.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('recovers a completed deletion through its opaque receipt', async () => {
    mockPrisma.accountDeletionOperation.findFirst.mockResolvedValue({ operationHash: 'hash' })

    await expect(isAccountDeletionComplete('delete-operation-receipt-1234567890')).resolves.toBe(
      true,
    )
    expect(mockPrisma.accountDeletionOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'completed',
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    )
  })
})
