// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-message-retention.test.ts

import cron from 'node-cron'
import { expireRoomMessages } from '../services/room-message-retention.js'
import { withDistributedLease } from '../services/distributed-lease.js'

export type RoomMessageRetentionStatus =
  | { state: 'never' }
  | { state: 'running'; startedAt: string }
  | { state: 'ok'; startedAt: string; completedAt: string; expired: number }
  | { state: 'failed'; startedAt: string; failedAt: string; errorCode: string }

let latestStatus: RoomMessageRetentionStatus = { state: 'never' }
let activeRun: Promise<number> | null = null
let task: ReturnType<typeof cron.schedule> | null = null
let scheduledRun: Promise<unknown> | null = null

export function getRoomMessageRetentionStatus(): RoomMessageRetentionStatus {
  return { ...latestStatus }
}

export function runRoomMessageRetention(now = new Date()): Promise<number> {
  if (activeRun) return activeRun
  const startedAt = now.toISOString()
  latestStatus = { state: 'running', startedAt }
  activeRun = expireRoomMessages(now)
    .then((expired) => {
      latestStatus = { state: 'ok', startedAt, completedAt: new Date().toISOString(), expired }
      return expired
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

export function startRoomMessageRetentionJob(): void {
  if (task || (process.env.SERVER_REGION && process.env.SERVER_REGION !== 'cn')) return
  task = cron.schedule('40 3 * * *', () => {
    if (scheduledRun) return
    scheduledRun = withDistributedLease({
      name: 'room-message-retention',
      ttlMs: 4 * 60 * 60_000,
      run: () => runRoomMessageRetention(),
    }).catch((error) => {
      console.error(
        '[room-message-retention] failed',
        error instanceof Error ? error.name : 'unknown',
      )
    }).finally(() => {
      scheduledRun = null
    })
  })
}

export async function stopRoomMessageRetentionJob(): Promise<void> {
  task?.stop()
  task?.destroy()
  task = null
  await scheduledRun
  await activeRun
}
