// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/queue-retry.test.ts

/** One coalesced retry per pending Session, never a UI-triggered scheduler. */
export class QueueRetryScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly failures = new Map<string, number>()
  private stopped = false

  constructor(private readonly drain: (sessionId: string) => void) {}

  schedule(sessionId: string, failed = false, notBefore = 0): void {
    if (this.stopped || this.timers.has(sessionId)) return
    const attempts = failed ? (this.failures.get(sessionId) ?? 0) + 1 : 0
    this.failures.set(sessionId, Math.min(attempts, 6))
    const delay = Math.max(notBefore - Date.now(), failed ? Math.min(1_000 * 2 ** (attempts - 1), 30_000) : 1_000)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      this.drain(sessionId)
    }, delay)
    timer.unref?.()
    this.timers.set(sessionId, timer)
  }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer) clearTimeout(timer)
    this.timers.delete(sessionId)
    this.failures.delete(sessionId)
  }

  stop(): void {
    this.stopped = true
    for (const sessionId of this.timers.keys()) this.cancel(sessionId)
  }
}
