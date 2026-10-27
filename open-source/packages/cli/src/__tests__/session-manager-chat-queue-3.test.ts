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

describe('SessionManager chat-queue-3', () => {
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

  describe('chat queue', () => {
    it('merges session list projection even when chat.enqueue only queues', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)
      const sessionListProjection = [
        {
          id: 'app-visible-session',
          machineId: 'machine-1',
          userId: 'user-1',
          agentType: 'codex',
          agentSessionId: 'thread-1',
          modelId: null,
          title: '同项目会话',
          status: 'active',
          workDir: '/tmp',
          lastMessagePreview: 'from app projection',
          lastActivityAt: '2026-05-21T01:00:00.000Z',
          createdAt: '2026-05-21T00:00:00.000Z',
          updatedAt: '2026-05-21T01:00:00.000Z',
          deletedAt: null,
          machineName: 'Mac',
          activity: null,
          userState: null,
        },
      ]

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-q-projection',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      adapter.emit('agentEvent', { state: 'start', runId: 'run1', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-q-projection',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-2',
          sessionListProjection,
        },
      })

      expect(mockMergeProjectedSessions).toHaveBeenCalledWith(sessionListProjection)
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r2',
          ok: true,
          payload: expect.objectContaining({ queued: true }),
        }),
      )
    })

    it('edits and deletes only pending queued messages', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: { sessionId: 'sess-q2', text: 'first', agentType: 'claude', workDir: '/tmp' },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      adapter.emit('agentEvent', { state: 'start', runId: 'run1', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-q2',
          text: 'queued',
          agentType: 'claude',
          workDir: '/tmp',
          queueMessageId: 'queue-edit-me',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.queue.edit',
        params: { sessionId: 'sess-q2', queueMessageId: 'queue-edit-me', text: 'edited' },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r4',
        method: 'chat.queue.get',
        params: { sessionId: 'sess-q2' },
      })

      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r4',
          payload: {
            queue: expect.objectContaining({
              pending: [expect.objectContaining({ id: 'queue-edit-me', text: 'edited' })],
            }),
          },
        }),
      )

      await manager.handleReq({
        type: 'req',
        id: 'r5',
        method: 'chat.queue.delete',
        params: { sessionId: 'sess-q2', queueMessageId: 'queue-edit-me' },
      })

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(1)
    })

    it('rejects edit and cancel after a queued message has started executing', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)
      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-late-queue-action',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'run-late-action', seq: 0 })
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-late-queue-action',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-2',
          queueMessageId: 'user-2',
        },
      })
      adapter.emit('agentEvent', { state: 'final', runId: 'run-late-action', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))

      await manager.handleReq({
        type: 'req',
        id: 'edit-late',
        method: 'chat.queue.edit',
        params: {
          sessionId: 'sess-late-queue-action',
          queueMessageId: 'user-2',
          text: 'too late',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'edit-late',
        ok: false,
        error: 'Queued message not found',
      })
      await manager.handleReq({
        type: 'req',
        id: 'delete-late',
        method: 'chat.queue.delete',
        params: { sessionId: 'sess-late-queue-action', queueMessageId: 'user-2' },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'delete-late',
        ok: false,
        error: 'Queued message not found',
      })
    })
  })
})
