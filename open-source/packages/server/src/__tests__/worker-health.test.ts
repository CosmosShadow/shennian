// @covers open-source/packages/server/src/worker-health.ts

import { describe, expect, it, vi } from 'vitest'
import { startWorkerHealthServer, type WorkerHealthDependencies } from '../worker-health.js'

describe('worker health server', () => {
  it('reports liveness and database-backed backlog readiness', async () => {
    const dependencies: WorkerHealthDependencies = {
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      backlogCheck: vi.fn().mockResolvedValue({
        terminalNotifications: 2,
        completionCalls: 1,
        callIntents: 3,
        oldestPendingAgeMs: 3_000,
        queues: {
          terminalNotifications: { pending: 1, processing: 1, sent: 8, retry: 0, failed: 0, oldestPendingAgeMs: 3_000 },
          completionCalls: { pending: 0, processing: 1, sent: 4, retry: 0, failed: 0, oldestPendingAgeMs: null },
          callIntents: { pending: 2, processing: 0, sent: 6, retry: 1, failed: 0, oldestPendingAgeMs: 2_000 },
        },
      }),
    }
    const server = await startWorkerHealthServer({
      port: 0,
      host: '127.0.0.1',
      dependencies,
      jobNames: ['task-completion-push'],
    })

    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(health.status).toBe(200)
      await expect(health.json()).resolves.toMatchObject({
        status: 'ok',
        role: 'worker',
        jobs: ['task-completion-push'],
      })

      const ready = await fetch(`http://127.0.0.1:${server.port}/ready`)
      expect(ready.status).toBe(200)
      await expect(ready.json()).resolves.toMatchObject({
        status: 'ready',
        backlog: {
          terminalNotifications: 2,
          completionCalls: 1,
          callIntents: 3,
          queues: {
            completionCalls: { pending: 0, processing: 1, sent: 4, retry: 0, failed: 0 },
            callIntents: { pending: 2, processing: 0, sent: 6, retry: 1, failed: 0 },
          },
        },
      })
    } finally {
      await server.close()
    }
  })

  it('returns not ready without exposing a database failure', async () => {
    const dependencies: WorkerHealthDependencies = {
      databaseCheck: vi.fn().mockRejectedValue(new Error('private database detail')),
      backlogCheck: vi.fn(),
    }
    const result = await import('../worker-health.js').then(({ readWorkerReadiness }) => (
      readWorkerReadiness(dependencies)
    ))
    expect(result).toEqual({ ready: false })
    expect(JSON.stringify(result)).not.toContain('private database detail')
  })
})
