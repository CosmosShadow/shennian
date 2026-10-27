// @arch open-source/docs/server-runtime.md
// @test src/__tests__/worker-health.test.ts

import { createServer, type Server } from 'node:http'
import { prisma } from './lib/prisma.js'

export type WorkerBacklog = {
  terminalNotifications: number
  completionCalls: number
  callIntents: number
  oldestPendingAgeMs: number | null
  queues: Record<'terminalNotifications' | 'completionCalls' | 'callIntents', WorkerQueueMetrics>
}

export type WorkerQueueMetrics = {
  pending: number
  processing: number
  sent: number
  retry: number
  failed: number
  oldestPendingAgeMs: number | null
}

export type WorkerHealthDependencies = {
  databaseCheck: () => Promise<unknown>
  backlogCheck: () => Promise<WorkerBacklog>
}

async function readDefaultBacklog(): Promise<WorkerBacklog> {
  const readQueue = async (queries: {
    pending: () => Promise<number>
    processing: () => Promise<number>
    sent: () => Promise<number>
    retry: () => Promise<number>
    failed: () => Promise<number>
    oldest: () => Promise<{ availableAt: Date } | null>
  }): Promise<WorkerQueueMetrics> => {
    const [pending, processing, sent, retry, failed, oldest] = await Promise.all([
      queries.pending(), queries.processing(), queries.sent(), queries.retry(), queries.failed(), queries.oldest(),
    ])
    return {
      pending,
      processing,
      sent,
      retry,
      failed,
      oldestPendingAgeMs: oldest ? Math.max(0, Date.now() - oldest.availableAt.getTime()) : null,
    }
  }
  const queueQueries = <T extends {
    count: (...args: never[]) => Promise<number>
    findFirst: (...args: never[]) => Promise<{ availableAt: Date } | null>
  }>(delegate: T) => ({
    pending: () => delegate.count({ where: { status: 'pending', attempts: 0 } } as never),
    processing: () => delegate.count({ where: { status: 'processing' } } as never),
    sent: () => delegate.count({ where: { status: 'sent' } } as never),
    retry: () => delegate.count({ where: { status: 'pending', attempts: { gt: 0 } } } as never),
    failed: () => delegate.count({
      where: { status: { notIn: ['pending', 'processing', 'sent', 'superseded'] } },
    } as never),
    oldest: () => delegate.findFirst({
      where: { status: 'pending' },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    } as never),
  })
  const [terminalQueue, completionQueue, callIntentQueue] = await Promise.all([
    readQueue(queueQueries(prisma.sessionTerminalNotification)),
    readQueue(queueQueries(prisma.voiceTaskCompletionNotify)),
    readQueue(queueQueries(prisma.voiceIncomingCallIntent)),
  ])
  const ages = [terminalQueue, completionQueue, callIntentQueue]
    .map((queue) => queue.oldestPendingAgeMs)
    .filter((age): age is number => age !== null)
  return {
    terminalNotifications: terminalQueue.pending + terminalQueue.retry + terminalQueue.processing,
    completionCalls: completionQueue.pending + completionQueue.retry + completionQueue.processing,
    callIntents: callIntentQueue.pending + callIntentQueue.retry + callIntentQueue.processing,
    oldestPendingAgeMs: ages.length ? Math.max(...ages) : null,
    queues: {
      terminalNotifications: terminalQueue,
      completionCalls: completionQueue,
      callIntents: callIntentQueue,
    },
  }
}

const defaultDependencies: WorkerHealthDependencies = {
  databaseCheck: () => prisma.$queryRaw`SELECT 1`,
  backlogCheck: readDefaultBacklog,
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

export async function readWorkerReadiness(
  dependencies: WorkerHealthDependencies = defaultDependencies,
): Promise<{ ready: boolean; backlog?: WorkerBacklog }> {
  try {
    await dependencies.databaseCheck()
    return { ready: true, backlog: await dependencies.backlogCheck() }
  } catch {
    return { ready: false }
  }
}

export async function startWorkerHealthServer(input: {
  port: number
  host?: string
  dependencies?: WorkerHealthDependencies
  jobNames: string[]
}): Promise<{ port: number; close: () => Promise<void> }> {
  const dependencies = input.dependencies ?? defaultDependencies
  const server: Server = createServer((request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { status: 'method_not_allowed' })
      return
    }
    if (request.url === '/health') {
      sendJson(response, 200, { status: 'ok', role: 'worker', jobs: input.jobNames })
      return
    }
    if (request.url === '/ready') {
      void readWorkerReadiness(dependencies).then((result) => {
        sendJson(response, result.ready ? 200 : 503, {
          status: result.ready ? 'ready' : 'not_ready',
          role: 'worker',
          ...result,
        })
      })
      return
    }
    sendJson(response, 404, { status: 'not_found' })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host ?? '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}
