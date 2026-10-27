// @covers src/personal-sync/metrics.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPersonalSyncLocalMetrics,
  recordPersonalSyncLocalMetric,
  resetPersonalSyncLocalMetricsForTests,
  setPersonalSyncLocalSubscriptions,
} from '../personal-sync/metrics.js'

describe('personal sync local metrics', () => {
  beforeEach(resetPersonalSyncLocalMetricsForTests)

  it('reports only aggregate local counters through daemon IPC-safe JSON', () => {
    recordPersonalSyncLocalMetric('canonicalCommits', 2)
    recordPersonalSyncLocalMetric('sourceCursorAdvanced')
    recordPersonalSyncLocalMetric('historyBytesServed', 4096)
    recordPersonalSyncLocalMetric('relayFramesReceived', 3)
    recordPersonalSyncLocalMetric('structuredRejections')
    setPersonalSyncLocalSubscriptions(2)

    const snapshot = getPersonalSyncLocalMetrics(new Date('2026-09-02T00:00:00.000Z'))
    expect(snapshot).toMatchObject({
      generatedAt: '2026-09-02T00:00:00.000Z',
      activeSubscriptions: 2,
      counters: {
        canonicalCommits: 2, sourceCursorAdvanced: 1, historyBytesServed: 4096,
        relayFramesReceived: 3, structuredRejections: 1,
      },
      health: { relayFramesPerMinute: expect.any(Number), cpuUtilizationRatio: expect.any(Number) },
      privacy: { containsSessionIdentity: false, containsMessageBody: false },
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/sessionId|accountId|payload/)
  })
})
