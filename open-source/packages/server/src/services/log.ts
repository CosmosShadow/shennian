// @arch open-source/docs/server-runtime.md
// @test src/__tests__/log-policy.test.ts

import { prisma } from '../lib/prisma.js'
import { shouldRecordLog } from './log-policy.js'
import { sanitizePersistedLog } from '../security/log-redaction.js'

export type LogSource = 'app' | 'server' | 'cli'
export type LogType = 'http' | 'ws' | 'internal'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  traceId: string
  userId?: string | null
  machineId?: string | null
  sessionId?: string | null
  source: LogSource
  type: LogType
  level: LogLevel
  method?: string | null
  path?: string | null
  statusCode?: number | null
  wsEvent?: string | null
  wsDirection?: 'in' | 'out' | null
  payload?: unknown
  errorMessage?: string | null
  errorStack?: string | null
  durationMs?: number | null
  metadata?: unknown
}

const CIRCUIT_BREAKER_THRESHOLD = 100_000
const COUNT_REFRESH_INTERVAL = 5 * 60 * 1000

let cachedRowCount = 0
let lastCountRefreshAt = 0
let countRefreshPromise: Promise<void> | null = null

export function isDbLogEnabled(): boolean {
  return process.env.SERVER_DB_LOG_ENABLED === '1' || process.env.SERVER_DB_LOG_ENABLED === 'true'
}

async function refreshRowCount(): Promise<void> {
  if (!isDbLogEnabled()) return

  try {
    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM RequestLog`
    cachedRowCount = Number(result[0].count)
  } catch {
    // If count query fails, keep previous value
  } finally {
    lastCountRefreshAt = Date.now()
  }
}

async function refreshRowCountIfDue(): Promise<void> {
  if (!isDbLogEnabled() || Date.now() - lastCountRefreshAt < COUNT_REFRESH_INTERVAL) return
  countRefreshPromise ??= refreshRowCount().finally(() => {
    countRefreshPromise = null
  })
  await countRefreshPromise
}

export async function writeLog(log: LogEntry): Promise<void> {
  if (!isDbLogEnabled()) return
  if (!shouldRecordLog(log)) return
  await refreshRowCountIfDue()
  if (cachedRowCount > CIRCUIT_BREAKER_THRESHOLD && log.level !== 'error') return

  const safeLog = sanitizePersistedLog(log)

  try {
    await prisma.requestLog.create({
      data: {
        traceId: safeLog.traceId,
        userId: safeLog.userId ?? null,
        machineId: safeLog.machineId ?? null,
        sessionId: safeLog.sessionId ?? null,
        source: safeLog.source,
        type: safeLog.type,
        level: safeLog.level,
        method: safeLog.method ?? null,
        path: safeLog.path ?? null,
        statusCode: safeLog.statusCode ?? null,
        wsEvent: safeLog.wsEvent ?? null,
        wsDirection: safeLog.wsDirection ?? null,
        payload: safeLog.payload !== undefined ? (safeLog.payload as object) : undefined,
        errorMessage: safeLog.errorMessage ?? null,
        errorStack: safeLog.errorStack ?? null,
        durationMs: safeLog.durationMs ?? null,
        metadata: safeLog.metadata !== undefined ? (safeLog.metadata as object) : undefined,
      },
    })
  } catch {
    // Fire-and-forget: log write failure must not break business logic
  }
}

export async function queryLogsByTraceId(traceId: string) {
  return prisma.requestLog.findMany({
    where: { traceId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function queryLogsByUserId(userId: string, since?: Date) {
  return prisma.requestLog.findMany({
    where: {
      userId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 1000,
  })
}
