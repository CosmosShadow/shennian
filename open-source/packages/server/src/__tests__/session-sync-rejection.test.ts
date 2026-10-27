// @covers src/services/session-sync-rejection.ts

import { describe, expect, it } from 'vitest'
import {
  normalizeSessionSyncRejection,
  SessionSyncRejectionError,
} from '../services/session-sync-rejection.js'

describe('personal sync structured rejection', () => {
  it('maps permanent authority conclusions to terminal client actions', () => {
    expect(new SessionSyncRejectionError('session_deleted').rejection).toEqual({
      code: 'session_deleted', retryable: false, requiredAction: 'purge_session',
    })
    expect(new SessionSyncRejectionError('room_authority_conflict').rejection).toEqual({
      code: 'room_authority_conflict', retryable: false, requiredAction: 'quarantine_record',
    })
    expect(new SessionSyncRejectionError('ownership_transferred').rejection).toEqual({
      code: 'ownership_transferred', retryable: false, requiredAction: 'refresh_machine_ownership',
    })
  })

  it('never turns an unknown Server failure into a destructive action', () => {
    expect(normalizeSessionSyncRejection(new Error('database unavailable'))).toEqual({
      code: 'temporary_unavailable', retryable: true, requiredAction: 'retry',
      authoritativeEpoch: 2,
    })
  })

  it('classifies impossible client revisions as terminal invalid payloads', () => {
    expect(normalizeSessionSyncRejection(new Error('future_deletion_revision'))).toMatchObject({
      code: 'invalid_payload', retryable: false, requiredAction: 'quarantine_record',
    })
  })
})
