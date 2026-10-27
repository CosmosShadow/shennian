// @arch open-source/docs/server-runtime.md
// @test src/__tests__/worker-runtime.test.ts

import './env.js'
import { hostname } from 'node:os'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { pubsub } from './relay/pubsub.js'
import { initServerRequestRouting, destroyServerRequestRouting } from './relay/server-requests.js'
import { startWorkerHealthServer } from './worker-health.js'
import { startWorkerRuntime, type WorkerRuntimeDependencies } from './worker-runtime.js'

export async function startWorker(extraJobs: WorkerRuntimeDependencies['jobs'] = []): Promise<void> {
  const instanceId = process.env.INSTANCE_ID?.trim() || hostname()
  const release = process.env.SHENNIAN_RELEASE?.trim() || 'development'
  // Worker owns no daemon sockets; route private requests through the existing Redis relay.
  await pubsub.init()
  await initServerRequestRouting()
  const runtime = await startWorkerRuntime(undefined, extraJobs)
  const health = await startWorkerHealthServer({
    port: Number(process.env.WORKER_HEALTH_PORT) || 3001,
    jobNames: runtime.jobNames,
  })

  console.info('[worker] ready', {
    role: 'worker',
    instanceId,
    release,
    jobs: runtime.jobNames,
    healthPort: health.port,
  })

  let stopping = false
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (stopping) return
    stopping = true
    console.info('[worker] stopping', { role: 'worker', instanceId, signal })
    await health.close()
    await runtime.stop()
    destroyServerRequestRouting()
    await pubsub.destroy()
    await prisma.$disconnect()
    redis.disconnect()
    console.info('[worker] stopped', { role: 'worker', instanceId, signal })
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => process.exit(0))
        .catch((error) => {
          console.error('[worker] shutdown failed', { role: 'worker', instanceId, signal, error })
          process.exit(1)
        })
    })
  }

}
