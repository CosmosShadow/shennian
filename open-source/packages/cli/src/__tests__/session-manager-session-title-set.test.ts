// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockClient,
  createTestSessionManager,
  deletionOrder,
  mockAdapter,
  mockCreateAgent,
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

describe('SessionManager session-title-set', () => {
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

  describe('session.title.set', () => {
    it('syncs Codex thread title through a temporary adapter', async () => {
      const adapter = {
        ...mockAdapter(),
        type: 'codex' as const,
        configure: vi.fn(),
        setTitle: vi.fn(async () => {}),
      }
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'title-1',
        method: 'session.title.set',
        params: {
          sessionId: 's1',
          agentType: 'codex',
          agentSessionId: 'thread-1',
          title: 'PDF预览崩溃修复',
          workDir: '/repo',
          titleSource: 'shennian_manual',
          titleRevision: 2,
          titleOriginEventId: 'shennian-manual:test-1',
        },
      })

      expect(adapter.configure).toHaveBeenCalled()
      expect(adapter.start).toHaveBeenCalledWith('s1', '/repo', 'thread-1')
      expect(adapter.setTitle).toHaveBeenCalledWith('thread-1', 'PDF预览崩溃修复', '/repo')
      expect(adapter.stop).toHaveBeenCalled()
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'title-1',
        ok: true,
        payload: { synced: true },
      })
    })
  })
})
