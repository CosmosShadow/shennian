// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-epoch-redis-cleanup.test.ts

import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

const BATCH_SIZE = 500

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, page] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
    cursor = next
    keys.push(...page)
  } while (cursor !== '0')
  return keys
}

function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&')
}

/**
 * Completes the SQL hard cut by deleting only Redis keys belonging to the
 * personal Session ids captured by the migration. Queue rows are retained on
 * any Redis failure so the next process start resumes safely.
 */
export async function purgeRetiredPersonalRedisState(): Promise<number> {
  let purged = 0
  for (;;) {
    const rows = await prisma.personalEpochPurgeQueue.findMany({
      take: BATCH_SIZE,
      orderBy: { sessionId: 'asc' },
    })
    if (rows.length === 0) return purged
    for (const row of rows) {
      const keys = [
        `sessionActivity:${row.sessionId}`,
        ...(await scanKeys(`sessionActivityClosedRun:${escapeRedisGlob(row.sessionId)}:*`)),
      ]
      if (keys.length > 0) await redis.del(...keys)
    }
    await prisma.personalEpochPurgeQueue.deleteMany({
      where: { sessionId: { in: rows.map((row) => row.sessionId) } },
    })
    purged += rows.length
  }
}
