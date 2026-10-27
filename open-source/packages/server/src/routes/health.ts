import type { FastifyInstance } from "fastify";
import { prisma } from '../lib/prisma.js'
import { pubsub } from '../relay/pubsub.js'

export type ReadinessDependencies = {
  databaseCheck: () => Promise<unknown>
  redisRequired: boolean
  redisReady: () => boolean
}

const defaultReadinessDependencies: ReadinessDependencies = {
  databaseCheck: () => prisma.$queryRaw`SELECT 1`,
  redisRequired: Boolean(process.env.REDIS_URL),
  redisReady: () => pubsub.isActive,
}

export async function checkServerReadiness(
  dependencies: ReadinessDependencies = defaultReadinessDependencies,
): Promise<{ ready: boolean; database: boolean; redis: boolean }> {
  let database = false
  try {
    await dependencies.databaseCheck()
    database = true
  } catch {
    database = false
  }
  const redis = !dependencies.redisRequired || dependencies.redisReady()
  return { ready: database && redis, database, redis }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok" as const,
    timestamp: Date.now(),
  }));

  app.get('/ready', async (_request, reply) => {
    const status = await checkServerReadiness()
    if (!status.ready) reply.code(503)
    return { status: status.ready ? 'ready' as const : 'not_ready' as const, ...status }
  })
}
