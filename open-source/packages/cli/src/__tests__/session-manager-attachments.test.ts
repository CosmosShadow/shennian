// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEST_ATTACHMENT_SHA256,
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

describe('SessionManager attachments', () => {
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

  describe('attachments', () => {
    it('无附件时直接传递原始文本', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-1', text: 'hello', agentType: 'claude', workDir: '/tmp' },
      })

      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledWith('hello', undefined))
    })

    it('有附件时在文本前注入 [附件] 路径行', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-2',
          text: '这是什么图？',
          agentType: 'claude',
          workDir: '/tmp',
          attachments: [
            {
              path: '/tmp/.uploads/shot.png',
              name: 'shot.png',
              mimeType: 'image/png',
              kind: 'image',
              byteSize: 100,
              sha256: TEST_ATTACHMENT_SHA256,
            },
          ],
        },
      })

      const sentText: string = adapter.send.mock.calls[0][0]
      expect(sentText).toBe('这是什么图？')
    })

    it('附件参数不再影响发送文本', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-3',
          text: '帮我看看',
          agentType: 'claude',
          workDir: '/tmp',
          attachments: [
            {
              path: '/tmp/a.png',
              name: 'a.png',
              mimeType: 'image/png',
              kind: 'image',
              byteSize: 100,
              sha256: TEST_ATTACHMENT_SHA256,
            },
            {
              path: '/tmp/b.json',
              name: 'b.json',
              mimeType: 'application/json',
              kind: 'file',
              byteSize: 100,
              sha256: 'b'.repeat(64),
            },
          ],
        },
      })

      const sentText: string = adapter.send.mock.calls[0][0]
      expect(sentText).toBe('帮我看看')
    })
  })
})
