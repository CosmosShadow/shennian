// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-message-retention.test.ts

import { prisma } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { addCalendarMonths } from './security-audit.js'

export function roomMessageRetentionCutoff(now = new Date()): Date {
  return addCalendarMonths(now, -6)
}

export async function expireRoomMessages(now = new Date(), batchSize = 1_000): Promise<number> {
  const cutoff = roomMessageRetentionCutoff(now)
  let total = 0
  while (true) {
    const ids = await prisma.roomMessage.findMany({
      where: { createdAt: { lt: cutoff }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { id: true },
    })
    if (ids.length === 0) return total
    const result = await prisma.roomMessage.updateMany({
      where: { id: { in: ids.map((item) => item.id) }, deletedAt: null },
      data: {
        text: null,
        ownerUserIdSnapshot: '',
        authorDisplayNameSnapshot: '已过期消息',
        ownerDisplayNameSnapshot: null,
        authorAvatarSnapshot: Prisma.JsonNull,
        mentionSnapshots: Prisma.JsonNull,
        activationCauseMessageId: null,
        activationRootCauseMessageId: null,
        activationHopCount: null,
        deletedAt: now,
      },
    })
    total += result.count
    if (ids.length < batchSize) return total
  }
}
