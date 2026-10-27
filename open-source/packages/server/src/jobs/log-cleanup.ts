import cron from 'node-cron'
import { prisma } from '../lib/prisma.js'
import { withDistributedLease } from '../services/distributed-lease.js'

const BATCH_SIZE = 50_000
const RETENTION_DAYS = 7
let task: ReturnType<typeof cron.schedule> | null = null
let activeRun: Promise<void> | null = null

async function cleanupOldLogs(): Promise<void> {
  let totalDeleted = 0
  let deleted: number

  do {
    deleted = await prisma.$executeRaw`
      DELETE FROM RequestLog
      WHERE createdAt < UTC_TIMESTAMP() - INTERVAL ${RETENTION_DAYS} DAY
      LIMIT ${BATCH_SIZE}`
    totalDeleted += deleted
  } while (deleted > 0)

  if (totalDeleted > 0) {
    console.log(`[log-cleanup] Deleted ${totalDeleted} logs older than ${RETENTION_DAYS} days`)
  }
}

function run(): void {
  if (activeRun) return
  activeRun = withDistributedLease({
    name: 'log-cleanup',
    ttlMs: 4 * 60 * 60_000,
    run: cleanupOldLogs,
  }).then(() => undefined)
    .catch((error) => console.error('[log-cleanup] failed', error))
    .finally(() => {
      activeRun = null
    })
}

export function startLogCleanupJob(): void {
  // Only run on CN node to avoid duplicate cleanup
  if (task || process.env.SERVER_REGION !== 'cn') return

  task = cron.schedule('0 3 * * *', run)

  console.log('[log-cleanup] Scheduled daily cleanup at 03:00 (cn node only)')
}

export async function stopLogCleanupJob(): Promise<void> {
  task?.stop()
  task?.destroy()
  task = null
  await activeRun
}
