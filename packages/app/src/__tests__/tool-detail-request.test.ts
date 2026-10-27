// @covers src/features/chat/utils/toolDetail.ts

import { describe, expect, it } from 'vitest'
import { buildToolDetailRequest } from '../features/chat/utils/toolDetail'

describe('buildToolDetailRequest', () => {
  it('uses only the exact tool identity and byte limit', () => {
    expect(buildToolDetailRequest('session-1', 'daemon-1', {
      name: 'command_execution',
      toolCallId: 'tool-call-7',
      detailRevision: 9,
      detailRef: { runId: 'legacy', sourceSeq: 1 },
    })).toEqual({
      protocolVersion: 2,
      dataEpoch: 2,
      daemonInstallationId: 'daemon-1',
      sessionId: 'session-1',
      toolCallId: 'tool-call-7',
      detailRevision: 9,
      maxBytes: 32 * 1024,
    })
  })

  it('rejects old skeletons without a stable revisioned identity', () => {
    expect(buildToolDetailRequest('session-1', 'daemon-1', {
      name: 'command_execution', detailRef: { runId: 'legacy', sourceSeq: 1 },
    })).toBeNull()
    expect(buildToolDetailRequest('session-1', 'daemon-1', {
      name: 'command_execution', toolCallId: 'tool-call-7', detailRevision: -1,
    })).toBeNull()
    expect(buildToolDetailRequest('session-1', null, {
      name: 'command_execution', toolCallId: 'tool-call-7', detailRevision: 1,
    })).toBeNull()
  })
})
