// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-attachment-maintenance.test.ts

import {
  processRoomAttachmentDeletionJobs,
  reclaimOrphanRoomAttachments,
  tombstoneExpiredRoomAttachments,
} from '../services/room-attachments.js'
import { withDistributedLease } from '../services/distributed-lease.js'
import { cleanupDirectAttachments } from '../services/agent-direct-attachments.js'

const INTERVAL_MS = 15 * 60 * 1000
let timer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let activeRun: Promise<RoomAttachmentMaintenanceReport> | null = null
let scheduledRun: Promise<unknown> | null = null
let latestStatus: RoomAttachmentMaintenanceStatus = { state: 'never' }

export type RoomAttachmentMaintenanceReport = {
  startedAt: string
  completedAt: string
  expiredTombstoned: number
  orphansReclaimed: number
  deletionJobsProcessed: number
  deletionJobsFailed: number
}

export type RoomAttachmentMaintenanceStatus =
  | { state: 'never' }
  | { state: 'running'; startedAt: string }
  | ({ state: 'ok' } & RoomAttachmentMaintenanceReport)
  | { state: 'failed'; startedAt: string; failedAt: string; errorCode: string }

export function getRoomAttachmentMaintenanceStatus(): RoomAttachmentMaintenanceStatus {
  return { ...latestStatus }
}

export function runRoomAttachmentMaintenance(): Promise<RoomAttachmentMaintenanceReport> {
  if (activeRun) return activeRun
  const startedAt = new Date().toISOString()
  latestStatus = { state: 'running', startedAt }
  activeRun = (async () => {
    try {
      const expiredTombstoned = await tombstoneExpiredRoomAttachments()
      const orphansReclaimed = await reclaimOrphanRoomAttachments()
      const deletion = await processRoomAttachmentDeletionJobs()
      await cleanupDirectAttachments()
      const report: RoomAttachmentMaintenanceReport = {
        startedAt,
        completedAt: new Date().toISOString(),
        expiredTombstoned,
        orphansReclaimed,
        deletionJobsProcessed: deletion.processed,
        deletionJobsFailed: deletion.failed,
      }
      latestStatus = { state: 'ok', ...report }
      return report
    } catch (error) {
      latestStatus = {
        state: 'failed',
        startedAt,
        failedAt: new Date().toISOString(),
        errorCode: error instanceof Error ? error.name.slice(0, 120) : 'maintenance_failed',
      }
      throw error
    } finally {
      activeRun = null
    }
  })()
  return activeRun
}

export function startRoomAttachmentMaintenanceJob(): void {
  if (timer || (process.env.SERVER_REGION && process.env.SERVER_REGION !== 'cn')) return
  const run = () => {
    if (scheduledRun) return
    scheduledRun = withDistributedLease({
      name: 'room-attachment-maintenance',
      ttlMs: 30 * 60_000,
      run: runRoomAttachmentMaintenance,
    }).catch((error) => {
      console.error('[room-attachment-maintenance] failed', error)
    }).finally(() => {
      scheduledRun = null
    })
  }
  timer = setInterval(run, INTERVAL_MS)
  timer.unref?.()
  initialTimer = setTimeout(run, 30_000)
  initialTimer.unref?.()
}

export async function stopRoomAttachmentMaintenanceJob(): Promise<void> {
  if (timer) clearInterval(timer)
  if (initialTimer) clearTimeout(initialTimer)
  timer = null
  initialTimer = null
  await scheduledRun
  await activeRun
}
