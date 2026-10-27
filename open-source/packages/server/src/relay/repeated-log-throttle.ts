// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/repeated-log-throttle.test.ts

export type RepeatedLogDecision = {
  shouldLog: boolean
  suppressed: number
}

type RepeatedLogBucket = {
  lastLogAt: number
  lastSeenAt: number
  suppressed: number
}

export class RepeatedLogThrottle {
  private readonly buckets = new Map<string, RepeatedLogBucket>()
  private lastSweepAt = 0

  constructor(
    private readonly intervalMs = 5 * 60_000,
    private readonly ttlMs = 30 * 60_000,
  ) {}

  take(key: string, now = Date.now()): RepeatedLogDecision {
    this.sweep(now)
    const bucket = this.buckets.get(key)
    if (!bucket) {
      this.buckets.set(key, { lastLogAt: now, lastSeenAt: now, suppressed: 0 })
      return { shouldLog: true, suppressed: 0 }
    }

    bucket.lastSeenAt = now
    if (now - bucket.lastLogAt < this.intervalMs) {
      bucket.suppressed += 1
      return { shouldLog: false, suppressed: bucket.suppressed }
    }

    const suppressed = bucket.suppressed
    bucket.lastLogAt = now
    bucket.suppressed = 0
    return { shouldLog: true, suppressed }
  }

  reset(): void {
    this.buckets.clear()
    this.lastSweepAt = 0
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.intervalMs) return
    this.lastSweepAt = now
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeenAt > this.ttlMs) this.buckets.delete(key)
    }
  }
}
