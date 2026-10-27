// @covers open-source/packages/server/src/services/voice-body-cache.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  invalidateVoiceBodyCacheForCall,
  invalidateVoiceBodyCacheForSession,
  readVoiceBodyCache,
  resetVoiceBodyCache,
  writeVoiceBodyCache,
} from '../services/voice-body-cache.js'

describe('Voice personal body cache', () => {
  beforeEach(() => resetVoiceBodyCache())

  it('is process-local and keyed by call, session and revision', () => {
    writeVoiceBodyCache({
      callId: 'call-1', sessionId: 'session-1', bodyRevision: 3,
      expiresAt: Date.now() + 10_000,
      messages: [{ id: 'm1', role: 'user', text: 'hello', ts: 1 }],
    })
    expect(readVoiceBodyCache('call-1', 'session-1', 3)).toHaveLength(1)
    expect(readVoiceBodyCache('call-2', 'session-1', 3)).toBeNull()
    expect(readVoiceBodyCache('call-1', 'session-1', 4)).toBeNull()
  })

  it('invalidates old revisions, deleted sessions and completed calls immediately', () => {
    writeVoiceBodyCache({
      callId: 'call-1', sessionId: 'session-1', bodyRevision: 3,
      expiresAt: Date.now() + 10_000, messages: [],
    })
    writeVoiceBodyCache({
      callId: 'call-1', sessionId: 'session-1', bodyRevision: 4,
      expiresAt: Date.now() + 10_000, messages: [],
    })
    expect(readVoiceBodyCache('call-1', 'session-1', 3)).toBeNull()
    invalidateVoiceBodyCacheForSession('session-1')
    expect(readVoiceBodyCache('call-1', 'session-1', 4)).toBeNull()

    writeVoiceBodyCache({
      callId: 'call-2', sessionId: 'session-2', bodyRevision: 1,
      expiresAt: Date.now() + 10_000, messages: [],
    })
    invalidateVoiceBodyCacheForCall('call-2')
    expect(readVoiceBodyCache('call-2', 'session-2', 1)).toBeNull()
  })
})
