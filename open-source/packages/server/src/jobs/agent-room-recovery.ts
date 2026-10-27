// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-room-recovery.test.ts

import { runPendingAgentRoomRecoveries } from '../services/agent-room-recovery.js'
import { withDistributedLease } from '../services/distributed-lease.js'

const INTERVAL_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let activeRun: Promise<unknown> | null = null

export function startAgentRoomRecoveryJob(): void {
  if (timer || (process.env.SERVER_REGION && process.env.SERVER_REGION !== 'cn')) return
  const run = () => {
    if (activeRun) return
    activeRun = withDistributedLease({
      name: 'agent-room-recovery',
      ttlMs: 5 * 60_000,
      run: runPendingAgentRoomRecoveries,
    }).then((lease) => {
      if (!lease.acquired) return
      const report = lease.result
        if (report.attempted > 0 || report.failed > 0) {
          console.info(
            `[agent-room-recovery] attempted=${report.attempted} recovered=${report.recovered} failed=${report.failed} waiting=${report.waiting}`,
          )
        }
      })
      .catch((error) => console.error('[agent-room-recovery] failed', error))
      .finally(() => {
        activeRun = null
      })
  }
  timer = setInterval(run, INTERVAL_MS)
  timer.unref?.()
  initialTimer = setTimeout(run, 10_000)
  initialTimer.unref?.()
}

export async function stopAgentRoomRecoveryJob(): Promise<void> {
  if (timer) clearInterval(timer)
  if (initialTimer) clearTimeout(initialTimer)
  timer = null
  initialTimer = null
  await activeRun
}
