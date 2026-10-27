// @covers src/features/chat/services/personalSessionHistoryMetrics.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPersonalSessionHistoryMetrics,
  recordPersonalSessionHistoryError,
  recordPersonalSessionRevisionGap,
  resetPersonalSessionHistoryMetricsForTests,
} from '../features/chat/services/personalSessionHistoryMetrics'

describe('personal session history metrics', () => {
  beforeEach(resetPersonalSessionHistoryMetricsForTests)

  it('counts repair triggers without retaining conversation identity or content', () => {
    recordPersonalSessionRevisionGap()
    expect(getPersonalSessionHistoryMetrics()).toEqual({
      revisionGaps: 1,
      structuredErrors: {},
      privacy: {
        containsAccountIdentity: false,
        containsSessionIdentity: false,
        containsMessageBody: false,
      },
    })
  })

  it('counts structured failures only by stage and code', () => {
    recordPersonalSessionHistoryError('sqlite', 'snapshot_write_failed')
    recordPersonalSessionHistoryError('sqlite', 'snapshot_write_failed')
    expect(getPersonalSessionHistoryMetrics()).toMatchObject({
      structuredErrors: { 'sqlite:snapshot_write_failed': 2 },
      privacy: {
        containsAccountIdentity: false,
        containsSessionIdentity: false,
        containsMessageBody: false,
      },
    })
  })
})
