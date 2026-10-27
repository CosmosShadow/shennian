// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/runtime-metrics.test.ts

export type RuntimeMetricSnapshot = {
  enabled: boolean
  startedAt: number
  counters: Record<string, number>
  gauges: Record<string, number>
  durationsMs: Record<string, { count: number; total: number; max: number }>
}

let enabled = false
let startedAt = Date.now()
let counters: Record<string, number> = {}
let gauges: Record<string, number> = {}
let durationsMs: RuntimeMetricSnapshot['durationsMs'] = {}

export function setRuntimeMetricsEnabled(next: boolean): void {
  enabled = next
}

export function incrementRuntimeMetric(name: string, amount = 1): void {
  if (!enabled) return
  counters[name] = (counters[name] ?? 0) + amount
}

export function setRuntimeGauge(name: string, value: number): void {
  if (!enabled) return
  gauges[name] = value
}

export function recordRuntimeDuration(name: string, durationMs: number): void {
  if (!enabled || !Number.isFinite(durationMs) || durationMs < 0) return
  const current = durationsMs[name] ?? { count: 0, total: 0, max: 0 }
  durationsMs[name] = {
    count: current.count + 1,
    total: current.total + durationMs,
    max: Math.max(current.max, durationMs),
  }
}

export function getRuntimeMetricSnapshot(): RuntimeMetricSnapshot {
  return {
    enabled,
    startedAt,
    counters: { ...counters },
    gauges: { ...gauges },
    durationsMs: Object.fromEntries(
      Object.entries(durationsMs).map(([name, value]) => [name, { ...value }]),
    ),
  }
}

export function resetRuntimeMetrics(): void {
  startedAt = Date.now()
  counters = {}
  gauges = {}
  durationsMs = {}
}
