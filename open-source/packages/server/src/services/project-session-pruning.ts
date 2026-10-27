// @arch open-source/docs/server-runtime.md
// @test src/__tests__/project-session-pruning.test.ts

import { deleteSessionForUser, listProjectSessions } from './sessions.js'

const MAX_PROJECT_SESSION_SCAN = 10_000

export async function pruneOldestProjectSessions(params: {
  machineId: string
  workDir: string
  userId: string
  count: number
}): Promise<{ deletedSessionIds: string[]; protectedCount: number }> {
  const sessions = await listProjectSessions({
    machineId: params.machineId,
    workDir: params.workDir,
    userId: params.userId,
    limit: MAX_PROJECT_SESSION_SCAN,
    order: 'asc',
  })
  const protectedCount = sessions.filter(
    (session) =>
      session.userId !== params.userId ||
      Boolean(session.userState?.pinnedAt) ||
      Boolean(session.activity?.runPhase),
  ).length
  const candidates = sessions
    .filter(
      (session) =>
        session.userId === params.userId &&
        !session.userState?.pinnedAt &&
        !session.activity?.runPhase,
    )
    .slice(0, params.count)

  const deletedSessionIds: string[] = []
  for (const session of candidates) {
    await deleteSessionForUser(session.id, params.userId, { nativeCleanupPolicy: 'none' })
    deletedSessionIds.push(session.id)
  }
  return { deletedSessionIds, protectedCount }
}
