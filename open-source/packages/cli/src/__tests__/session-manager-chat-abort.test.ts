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

describe('SessionManager chat-abort', () => {
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

  describe('chat.abort', () => {
    it('revokes the managed Room capability before waiting for Agent stop', async () => {
      const adapter = mockAdapter('codex')
      const revoke = vi.fn()
      manager = createTestSessionManager(client as never, undefined, revoke)
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'send-managed-abort',
        method: 'chat.send',
        params: {
          sessionId: 'sess-managed-abort',
          text: 'working',
          agentType: 'codex',
          workDir: '/tmp',
        },
      })
      const token = `mrc_${'z'.repeat(43)}`
      const session = (
        manager as unknown as {
          sessions: Map<string, { managedRoomContextToken?: string | null }>
        }
      ).sessions.get('sess-managed-abort')!
      session.managedRoomContextToken = token
      adapter.stop.mockImplementationOnce(async () => {
        expect(revoke).toHaveBeenCalledWith(token)
        expect(session.managedRoomContextToken).toBeNull()
      })

      await manager.handleReq({
        type: 'req',
        id: 'abort-managed',
        method: 'chat.abort',
        params: { sessionId: 'sess-managed-abort' },
      })

      expect(adapter.stop).toHaveBeenCalledOnce()
      expect(revoke).toHaveBeenCalledOnce()
    })

    it('emits a synthetic aborted event for the active run after stop succeeds', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'send-1',
        method: 'chat.send',
        params: { sessionId: 'sess-abort', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })
      await vi.waitFor(() => {
        expect(adapter.send).toHaveBeenCalledWith('hi', undefined)
      })

      adapter.emit('agentEvent', { state: 'delta', runId: 'run-abort', seq: 0, text: 'working' })

      await manager.handleReq({
        type: 'req',
        id: 'abort-1',
        method: 'chat.abort',
        params: { sessionId: 'sess-abort' },
      })

      expect(adapter.stop).toHaveBeenCalledTimes(1)
      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'agent',
          id: 'agent-evt-run-abort-1',
          seq: 1,
          payload: expect.objectContaining({
            state: 'aborted',
            sessionId: 'sess-abort',
            runId: 'run-abort',
            seq: 1,
          }),
        }),
      )
      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'res', id: 'abort-1', ok: true }),
      )
    })

    it('fails closed when the native Agent cannot be stopped', async () => {
      const adapter = mockAdapter()
      adapter.stop.mockRejectedValueOnce(new Error('native process still running'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'send-stop-failure',
        method: 'chat.send',
        params: {
          sessionId: 'sess-stop-failure',
          text: 'hi',
          agentType: 'claude',
          workDir: '/tmp',
        },
      })
      await vi.waitFor(() => {
        expect(adapter.send).toHaveBeenCalledWith('hi', undefined)
      })

      adapter.emit('agentEvent', {
        state: 'delta',
        runId: 'run-stop-failure',
        seq: 0,
        text: 'working',
      })

      await manager.handleReq({
        type: 'req',
        id: 'abort-stop-failure',
        method: 'chat.abort',
        params: { sessionId: 'sess-stop-failure' },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'abort-stop-failure',
        ok: false,
        error: 'agent_stop_failed',
      })
      expect(client.sendAgentEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ state: 'aborted', runId: 'run-stop-failure' }),
        }),
      )
    })
  })
})
