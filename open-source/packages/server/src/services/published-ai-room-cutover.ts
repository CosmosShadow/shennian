// @arch open-source/docs/server-runtime.md
// @test src/__tests__/published-ai-room-cutover.test.ts

import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

export type PublishedAiWriteMode = 'legacy' | 'paused' | 'canonical'

export class PublishedAiCutoverError extends Error {
  constructor(readonly code: 'invalid_transition' | 'migration_incomplete') { super(code) }
}

/** Release-only transition. No HTTP route exposes this control to clients. */
export async function setPublishedAiWriteMode(target: PublishedAiWriteMode) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      mode: string
      everCanonical: number | boolean
    }>>`SELECT mode, everCanonical FROM ConversationWriteControl
         WHERE name = 'published_ai' FOR UPDATE`
    const current = rows[0]
    if (!current) throw new PublishedAiCutoverError('migration_incomplete')
    if (current.mode === target) return { mode: target, idempotent: true }
    const allowed = (current.mode === 'legacy' && target === 'paused')
      || (current.mode === 'canonical' && target === 'paused')
      || (current.mode === 'paused' && target === 'canonical')
      || (current.mode === 'paused' && target === 'legacy' && !current.everCanonical)
    if (!allowed) throw new PublishedAiCutoverError('invalid_transition')
    if (target === 'canonical' && !current.everCanonical) {
      const [badConversations, missingMessages, extraMessages, inFlight] = await Promise.all([
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM AgentDirectConversation d
          LEFT JOIN Room r ON r.id = d.roomId
          WHERE d.roomId IS NULL OR d.roomId <> d.id
            OR d.canonicalState <> 'ready'
            OR d.canonicalCopiedSequence <> d.nextSequence
            OR r.id IS NULL OR r.conversationKind <> 'published_ai'
            OR r.nextSequence <> d.nextSequence`,
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM AgentDirectMessage m
          LEFT JOIN RoomMessage r ON r.id = m.id AND r.roomId = m.conversationId
          WHERE r.id IS NULL OR m.roomMessageId <> m.id
            OR r.sequence <> m.sequence OR NOT (r.text <=> m.text)`,
        tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count FROM RoomMessage r
          JOIN Room room ON room.id = r.roomId AND room.conversationKind = 'published_ai'
          LEFT JOIN AgentDirectMessage m ON m.id = r.id AND m.conversationId = r.roomId
          WHERE m.id IS NULL`,
        tx.agentDirectMessage.count({ where: { status: { in: ['pending', 'running'] } } }),
      ])
      if (badConversations[0]?.count || missingMessages[0]?.count
        || extraMessages[0]?.count || inFlight > 0) {
        throw new PublishedAiCutoverError('migration_incomplete')
      }
    }
    if (target === 'legacy') {
      // A preactivation abort may be followed by more legacy messages. Mark
      // previously finalized Rooms resumable for the next copy pass.
      await tx.agentDirectConversation.updateMany({
        where: { canonicalState: 'ready' }, data: { canonicalState: 'backfilling' },
      })
    }
    await tx.conversationWriteControl.update({ where: { name: 'published_ai' },
      data: { mode: target, everCanonical: Boolean(current.everCanonical) || target === 'canonical' } })
    return { mode: target, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 })
}
