// @arch docs/features/desktop-local-first-client.md
// @test ../../__tests__/desktop-sync-metrics.test.ts

import { incrementRuntimeMetric, recordRuntimeDuration } from '@shennian/shared'

let firstContentStartedAt: number | null = null
let firstContentRecorded = false

export function beginDesktopFirstContent(now = performance.now()): void {
  if (firstContentStartedAt === null && !firstContentRecorded) firstContentStartedAt = now
}

export function finishDesktopFirstContent(now = performance.now()): void {
  if (firstContentStartedAt === null || firstContentRecorded) return
  recordRuntimeDuration('desktop.first_content_ms', Math.max(0, now - firstContentStartedAt))
  firstContentRecorded = true
  firstContentStartedAt = null
}

export function recordDesktopReconnect(): void {
  incrementRuntimeMetric('desktop.sync.reconnects')
}

export function resetDesktopFirstContentMetricForTests(): void {
  firstContentStartedAt = null
  firstContentRecorded = false
}
