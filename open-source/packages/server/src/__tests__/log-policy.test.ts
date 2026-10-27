// @covers open-source/packages/server/src/services/log-policy.ts

import { describe, expect, it } from 'vitest'
import { isDiagnosticUserId, shouldRecordLog } from '../services/log-policy.js'

describe('server log policy', () => {
  it('requires explicit configuration for diagnostic accounts', () => {
    expect(isDiagnosticUserId('unit-diagnostic-user-1', '')).toBe(false)
    expect(isDiagnosticUserId('unit-diagnostic-user-2', '')).toBe(false)
    expect(isDiagnosticUserId('extra-user', 'extra-user')).toBe(true)
    expect(isDiagnosticUserId('ordinary-user')).toBe(false)
  })

  it('keeps entry and failure logs for every account', () => {
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'http', level: 'info', userId: 'ordinary' })).toBe(true)
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'internal', level: 'error', userId: 'ordinary' })).toBe(true)
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'ws', level: 'info', wsEvent: 'machine.connect', userId: 'ordinary' })).toBe(true)
    expect(shouldRecordLog({ traceId: 't', source: 'cli', type: 'internal', level: 'info', wsEvent: 'upgrade.recovery.outcome', userId: 'ordinary' })).toBe(true)
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'internal', level: 'info', path: 'push.send', userId: 'ordinary' })).toBe(true)
  })

  it('drops ordinary account detail while retaining diagnostic account detail', () => {
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'ws', level: 'info', wsEvent: 'session.activity', userId: 'ordinary' })).toBe(false)
    expect(shouldRecordLog({ traceId: 't', source: 'server', type: 'ws', level: 'debug', wsEvent: 'session.activity', userId: 'extra-user' }, 'extra-user')).toBe(true)
  })
})
