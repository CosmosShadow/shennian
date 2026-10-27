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

describe('SessionManager session-eviction', () => {
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

  describe('session eviction', () => {
    it('evicts oldest idle session when exceeding MAX_SESSIONS', async () => {
      const adapters: ReturnType<typeof mockAdapter>[] = []
      mockCreateAgent.mockImplementation(() => {
        const a = mockAdapter()
        adapters.push(a)
        return a
      })

      for (let i = 0; i < 50; i++) {
        await manager.handleReq({
          type: 'req',
          id: `r-${i}`,
          method: 'chat.send',
          params: { sessionId: `sess-${i}`, text: 'hi', agentType: 'claude', workDir: '/tmp' },
        })
      }

      expect(adapters).toHaveLength(50)
      expect(adapters[0].stop).not.toHaveBeenCalled()

      await manager.handleReq({
        type: 'req',
        id: 'r-51',
        method: 'chat.send',
        params: { sessionId: 'sess-new', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      expect(adapters[0].stop).toHaveBeenCalled()
      expect(adapters).toHaveLength(51)
    })

    it('does not evict when reusing existing session', async () => {
      const adapters: ReturnType<typeof mockAdapter>[] = []
      mockCreateAgent.mockImplementation(() => {
        const a = mockAdapter()
        adapters.push(a)
        return a
      })

      for (let i = 0; i < 50; i++) {
        await manager.handleReq({
          type: 'req',
          id: `r-${i}`,
          method: 'chat.send',
          params: { sessionId: `sess-${i}`, text: 'hi', agentType: 'claude', workDir: '/tmp' },
        })
      }

      await manager.handleReq({
        type: 'req',
        id: 'r-reuse',
        method: 'chat.send',
        params: { sessionId: 'sess-0', text: 'second msg', agentType: 'claude', workDir: '/tmp' },
      })

      expect(adapters).toHaveLength(50)
      for (const a of adapters) {
        expect(a.stop).not.toHaveBeenCalled()
      }
    })
  })
})
