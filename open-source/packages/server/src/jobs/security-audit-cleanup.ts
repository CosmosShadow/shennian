// @arch open-source/docs/server-runtime.md
// @test src/__tests__/security-audit.test.ts

import cron from 'node-cron'
import { prisma } from '../lib/prisma.js'
import { withDistributedLease } from '../services/distributed-lease.js'

const BATCH_SIZE = 10_000

export type SecurityAuditCleanupStatus =
  | { state: 'never' }
  | { state: 'running'; startedAt: string }
  | {
      state: 'ok'
      startedAt: string
      completedAt: string
      auditDeleted: number
      receiptsDeleted: number
    }
  | { state: 'failed'; startedAt: string; failedAt: string; errorCode: string }

let latestStatus: SecurityAuditCleanupStatus = { state: 'never' }
let activeRun: Promise<{ auditDeleted: number; receiptsDeleted: number }> | null = null
let task: ReturnType<typeof cron.schedule> | null = null
let scheduledRun: Promise<unknown> | null = null

export function getSecurityAuditCleanupStatus(): SecurityAuditCleanupStatus {
  return { ...latestStatus }
}

export async function cleanupExpiredSecurityAuditEvents(now = new Date()): Promise<number> {
  let total = 0
  while (true) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM SecurityAuditEvent WHERE expiresAt <= ${now} LIMIT ${BATCH_SIZE}`
    total += deleted
    if (deleted < BATCH_SIZE) return total
  }
}

export async function cleanupExpiredAccountDeletionOperations(now = new Date()): Promise<number> {
  return prisma.accountDeletionOperation
    .deleteMany({ where: { expiresAt: { lte: now } } })
    .then((result) => result.count)
}

export function runSecurityAuditCleanup(now = new Date()) {
  if (activeRun) return activeRun
  const startedAt = now.toISOString()
  latestStatus = { state: 'running', startedAt }
  activeRun = Promise.all([
    cleanupExpiredSecurityAuditEvents(now),
    cleanupExpiredAccountDeletionOperations(now),
  ])
    .then(([auditDeleted, receiptsDeleted]) => {
      latestStatus = {
        state: 'ok',
        startedAt,
        completedAt: new Date().toISOString(),
        auditDeleted,
        receiptsDeleted,
      }
      return { auditDeleted, receiptsDeleted }
    })
    .catch((error) => {
      latestStatus = {
        state: 'failed',
        startedAt,
        failedAt: new Date().toISOString(),
        errorCode: error instanceof Error ? error.name.slice(0, 120) : 'unknown',
      }
      throw error
    })
    .finally(() => {
      activeRun = null
    })
  return activeRun
}

export function startSecurityAuditCleanupJob(): void {
  if (task || (process.env.SERVER_REGION && process.env.SERVER_REGION !== 'cn')) return
  task = cron.schedule('20 3 * * *', () => {
    if (scheduledRun) return
    scheduledRun = withDistributedLease({
      name: 'security-audit-cleanup',
      ttlMs: 4 * 60 * 60_000,
      run: () => runSecurityAuditCleanup(),
    }).catch((error) => {
      console.error(
        '[security-audit-cleanup] failed',
        error instanceof Error ? error.name : 'unknown',
      )
    }).finally(() => {
      scheduledRun = null
    })
  })
}

export async function stopSecurityAuditCleanupJob(): Promise<void> {
  task?.stop()
  task?.destroy()
  task = null
  await scheduledRun
  await activeRun
}
