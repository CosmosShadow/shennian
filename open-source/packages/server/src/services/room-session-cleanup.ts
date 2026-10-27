// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-session-cleanup.test.ts

import type { Prisma } from '../generated/prisma/client.js'
import {
  commitSessionDeletionInTransaction,
  finalizeCommittedSessionDeletion,
  type CommittedSessionDeletion,
} from './sessions.js'

export type RoomSessionCleanupTarget = {
  sessionId: string
  userId: string
}

/**
 * RoomBinding.nianSessionId is unique in the schema. Callers collect targets while
 * changing that binding's lifecycle, so cleanup never guesses by title, workDir,
 * agent type, or recency.
 */
export async function commitExclusiveRoomSessionDeletions(
  tx: Prisma.TransactionClient,
  targets: readonly RoomSessionCleanupTarget[],
  deletedAt?: Date,
): Promise<CommittedSessionDeletion[]> {
  const uniqueTargets = new Map<string, RoomSessionCleanupTarget>()
  for (const target of targets) {
    const existing = uniqueTargets.get(target.sessionId)
    if (existing && existing.userId !== target.userId) {
      throw new Error('room_session_cleanup_identity_conflict')
    }
    uniqueTargets.set(target.sessionId, target)
  }

  const committed: CommittedSessionDeletion[] = []
  for (const target of uniqueTargets.values()) {
    committed.push(await commitSessionDeletionInTransaction(tx, target.sessionId, target.userId, {
      nativeCleanupPolicy: 'auto',
      deletedAt,
    }))
  }
  return committed
}

/** Run only after the surrounding Room transaction commits. */
export function finalizeExclusiveRoomSessionDeletions(
  deletions: readonly CommittedSessionDeletion[],
): string[] {
  for (const deletion of deletions) {
    if (!deletion.alreadyDeleted) finalizeCommittedSessionDeletion(deletion)
  }
  return deletions.map((deletion) => deletion.sessionId)
}
