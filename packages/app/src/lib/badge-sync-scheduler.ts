// @arch docs/architecture/app/mobile-push.md#客户端-badge-背压
// @test src/__tests__/badge-sync-scheduler.test.ts

type Timer = ReturnType<typeof setTimeout>

/**
 * Debounces badge work and guarantees at most one database scan at a time.
 * Calls arriving during a scan collapse into one trailing scan so the latest
 * unread state still wins without building an unbounded native-bridge queue.
 */
export function createBadgeSyncScheduler(run: () => Promise<number>) {
  let timer: Timer | null = null
  let inflight: Promise<number> | null = null
  let trailingRequested = false
  let trailingDelayMs: number | null = null

  const clearPendingTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  const start = (): Promise<number> => {
    clearPendingTimer()
    if (inflight) {
      trailingRequested = true
      return inflight
    }

    const current = run().finally(() => {
      if (inflight === current) inflight = null
      if (!trailingRequested) return
      const delay = trailingDelayMs ?? 0
      trailingRequested = false
      trailingDelayMs = null
      schedule(delay)
    })
    inflight = current
    return current
  }

  const schedule = (delayMs = 150): void => {
    const delay = Math.max(0, delayMs)
    if (inflight) {
      trailingRequested = true
      trailingDelayMs = trailingDelayMs === null ? delay : Math.min(trailingDelayMs, delay)
      return
    }
    clearPendingTimer()
    timer = setTimeout(() => {
      timer = null
      void start().catch(() => {})
    }, delay)
  }

  return {
    schedule,
    runNow: start,
  }
}
