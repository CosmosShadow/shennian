// @covers open-source/packages/shared/src/runtime-metrics.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getRuntimeMetricSnapshot,
  incrementRuntimeMetric,
  recordRuntimeDuration,
  resetRuntimeMetrics,
  setRuntimeGauge,
  setRuntimeMetricsEnabled,
} from '../runtime-metrics'

describe('runtime metrics', () => {
  beforeEach(() => {
    setRuntimeMetricsEnabled(false)
    resetRuntimeMetrics()
  })

  it('has zero collection overhead state while disabled', () => {
    incrementRuntimeMetric('relay.event')
    recordRuntimeDuration('markdown', 10)
    setRuntimeGauge('relay.open', 1)
    expect(getRuntimeMetricSnapshot()).toMatchObject({
      enabled: false,
      counters: {},
      gauges: {},
      durationsMs: {},
    })
  })

  it('collects only aggregate values when explicitly enabled', () => {
    setRuntimeMetricsEnabled(true)
    incrementRuntimeMetric('relay.event', 2)
    setRuntimeGauge('relay.open', 1)
    recordRuntimeDuration('markdown', 4)
    recordRuntimeDuration('markdown', 8)
    expect(getRuntimeMetricSnapshot()).toMatchObject({
      counters: { 'relay.event': 2 },
      gauges: { 'relay.open': 1 },
      durationsMs: { markdown: { count: 2, total: 12, max: 8 } },
    })
  })
})
