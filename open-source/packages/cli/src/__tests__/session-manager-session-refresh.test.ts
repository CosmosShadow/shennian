// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockClient,
  createTestSessionManager,
  deletionOrder,
  mockDeliveryStates,
  mockFiles,
  mockFindSourceTombstone,
  mockIsCodexThreadTailInterrupted,
  mockLookupClaudeTranscriptCwd,
  mockMergeProjectedSessions,
  mockReadDeletionRevision,
  mockSessionMessages,
  mockSessionRecords,
  mockToolDetails,
  originalPlatform,
} from './session-manager-test-harness.js'

describe('SessionManager session-refresh', () => {
  let client: ReturnType<typeof createMockClient>
  let manager: ReturnType<typeof createTestSessionManager>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFiles.clear()
    mockSessionMessages.clear()
    mockDeliveryStates.clear()
    mockToolDetails.clear()
    mockSessionRecords.clear()
    deletionOrder.length = 0
    mockReadDeletionRevision.mockReturnValue(0)
    mockFindSourceTombstone.mockReturnValue(null)
    mockLookupClaudeTranscriptCwd.mockReturnValue(null)
    mockIsCodexThreadTailInterrupted.mockReturnValue(false)
    mockMergeProjectedSessions.mockClear()
    client = createMockClient()
    manager = createTestSessionManager(client as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  describe('session.refresh', () => {
    it('runs native fusion scan before acknowledging refresh', async () => {
      const scanNow = vi.fn(async () => {})
      manager = createTestSessionManager(client as never, { scanNow } as never)

      await manager.handleReq({
        type: 'req',
        id: 'refresh-1',
        method: 'session.refresh',
        params: { sessionId: 's1', agentType: 'codex', agentSessionId: 'thread-1' },
      })

      expect(scanNow).toHaveBeenCalledTimes(1)
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'refresh-1',
        ok: true,
        payload: {
          scanned: true,
          sessionId: 's1',
          agentType: 'codex',
          agentSessionId: 'thread-1',
        },
      })
    })
  })
})
