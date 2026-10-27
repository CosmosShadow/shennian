// @covers src/services/room-message-retention.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, updateMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: { roomMessage: { findMany, updateMany } },
}))

import {
  expireRoomMessages,
  roomMessageRetentionCutoff,
} from '../services/room-message-retention.js'

describe('Room message retention', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes a six-calendar-month cutoff', () => {
    expect(roomMessageRetentionCutoff(new Date('2026-09-07T08:30:00Z')).toISOString()).toBe(
      '2026-03-07T08:30:00.000Z',
    )
  })

  it('tombstones expired messages without deleting their sequence records', async () => {
    findMany.mockResolvedValueOnce([{ id: 'message-1' }]).mockResolvedValueOnce([])
    updateMany.mockResolvedValue({ count: 1 })
    const now = new Date('2026-09-07T08:30:00Z')

    await expect(expireRoomMessages(now, 10)).resolves.toBe(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date('2026-03-07T08:30:00.000Z') }, deletedAt: null },
        take: 10,
      }),
    )
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['message-1'] }, deletedAt: null },
        data: expect.objectContaining({
          text: null,
          ownerUserIdSnapshot: '',
          authorDisplayNameSnapshot: '已过期消息',
          deletedAt: now,
        }),
      }),
    )
  })
})
