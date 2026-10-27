// @covers src/services/personal-sync-operations.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPersonalSyncOperationsSnapshot,
  recordPersonalSyncClientCapability,
  recordPersonalSyncOperation,
  recordPersonalSyncRejection,
  resetPersonalSyncOperationsForTests,
  setPersonalSyncActiveSubscriptions,
} from '../services/personal-sync-operations.js'

describe('personal sync privacy-safe operations snapshot', () => {
  beforeEach(resetPersonalSyncOperationsForTests)

  it('contains only aggregate counters and explicit privacy boundaries', () => {
    recordPersonalSyncOperation('historyOpens')
    recordPersonalSyncOperation('historyBytes', 2048)
    recordPersonalSyncOperation('indexApplied', 2)
    setPersonalSyncActiveSubscriptions(3)

    const snapshot = getPersonalSyncOperationsSnapshot(new Date('2026-09-02T00:00:00.000Z'))
    expect(snapshot).toMatchObject({
      status: 'ok',
      generatedAt: '2026-09-02T00:00:00.000Z',
      activeSubscriptions: 3,
      counters: { historyOpens: 1, historyBytes: 2048, indexApplied: 2 },
      privacy: {
        containsSessionIdentity: false,
        containsMessageBody: false,
        containsToolPayload: false,
        containsAttachmentBytes: false,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('sessionId')
  })

  it('raises aggregate alerts without recording rejected content or identity', () => {
    recordPersonalSyncOperation('legacyFramesRejected')
    recordPersonalSyncOperation('indexRejected')
    recordPersonalSyncOperation('slowConsumerDisconnects')
    recordPersonalSyncRejection({
      code: 'room_authority_conflict', retryable: false, requiredAction: 'quarantine_record',
    })

    expect(getPersonalSyncOperationsSnapshot()).toMatchObject({
      status: 'attention',
      alerts: [
        'legacy_personal_frames_rejected',
        'personal_index_updates_rejected',
        'personal_history_slow_consumers',
      ],
      rejections: {
        room_authority_conflict: {
          count: 1, retryable: false, requiredAction: 'quarantine_record',
        },
      },
    })
  })

  it('reports capability adoption without exposing installation identities', () => {
    recordPersonalSyncClientCapability('installation-legacy', 'session_scoped')
    recordPersonalSyncClientCapability('installation-upgraded', 'session_scoped')
    recordPersonalSyncClientCapability('installation-upgraded', 'machine_stream')
    recordPersonalSyncClientCapability('installation-stream-only', 'machine_stream')

    const snapshot = getPersonalSyncOperationsSnapshot()
    expect(snapshot.clientCapabilityAdoption).toEqual({
      observedInstallations: 3,
      machineStreamInstallations: 2,
      sessionScopedOnlyInstallations: 1,
      machineStreamPercent: 66.67,
    })
    expect(JSON.stringify(snapshot)).not.toContain('installation-legacy')
    expect(JSON.stringify(snapshot)).not.toContain('installation-upgraded')
    expect(JSON.stringify(snapshot)).not.toContain('installation-stream-only')
  })
})
