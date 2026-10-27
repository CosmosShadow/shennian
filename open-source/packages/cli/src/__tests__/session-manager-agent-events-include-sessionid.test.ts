// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentEvent,
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

describe('SessionManager agent-events-include-sessionid', () => {
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

  describe('agent events include sessionId', () => {
    it('includes sessionId in agentEvent payloads', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-abc', text: 'hello', agentType: 'claude', workDir: '/tmp' },
      })

      // Simulate adapter emitting text and then ending the run.
      const agentEvent: AgentEvent = { state: 'delta', runId: 'run1', seq: 0, text: 'Hi' }
      adapter.emit('agentEvent', agentEvent)
      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })

      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'agent',
          id: 'agent-evt-run1-0',
          payload: expect.objectContaining({
            state: 'delta',
            sessionId: 'sess-abc',
            text: 'Hi',
          }),
        }),
      )
    })

    it('publishes one terminal and suppresses duplicate or late events at the shared Adapter boundary', async () => {
      const adapter = mockAdapter('cursor')
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'terminal-gate-send',
        method: 'chat.send',
        params: {
          sessionId: 'sess-terminal-gate',
          text: 'hello',
          agentType: 'cursor',
          workDir: '/tmp',
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'run-gated', seq: 0 })
      adapter.emit('agentEvent', { state: 'delta', runId: 'run-gated', seq: 1, text: 'complete' })
      adapter.emit('agentEvent', { state: 'final', runId: 'run-gated', seq: 2 })
      adapter.emit('agentEvent', {
        state: 'error',
        runId: 'run-gated',
        seq: 3,
        message: 'late error',
      })
      adapter.emit('agentEvent', { state: 'delta', runId: 'run-gated', seq: 4, text: 'late text' })

      const visible = client.sendAgentEvent.mock.calls
        .map(([frame]) => frame.payload as AgentEvent & { sessionId: string })
        .filter((event) => event.runId === 'run-gated')
      expect(visible.map((event) => event.state)).toEqual(['start', 'delta', 'final'])
      expect(mockSessionMessages.get('sess-terminal-gate')).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ payload: expect.stringContaining('late') }),
        ]),
      )
    })

    it('keeps live run activity fresh with heartbeat events during silent work', async () => {
      vi.useFakeTimers()
      try {
        const adapter = mockAdapter()
        const getStatus = vi.fn(async () => ({
          active: true,
          runId: 'run-heartbeat',
          runPhase: 'tool_running' as const,
          canStop: true,
        }))
        Object.assign(adapter, { getStatus })
        mockCreateAgent.mockReturnValue(adapter)

        await manager.handleReq({
          type: 'req',
          id: 'r-heartbeat',
          method: 'chat.send',
          params: {
            sessionId: 'sess-heartbeat',
            text: 'long task',
            agentType: 'codex',
            workDir: '/tmp',
          },
        })

        adapter.emit('agentEvent', {
          state: 'tool-call',
          runId: 'run-heartbeat',
          seq: 0,
          name: 'command_execution',
          args: { command: 'sleep 600' },
        } satisfies AgentEvent)
        client.sendAgentEvent.mockClear()
        getStatus.mockClear()

        vi.advanceTimersByTime(30_000)

        expect(getStatus).not.toHaveBeenCalled()

        expect(client.sendAgentEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'event',
            event: 'agent',
            id: expect.stringMatching(/^agent-heartbeat-run-heartbeat-0-/),
            payload: expect.objectContaining({
              state: 'heartbeat',
              sessionId: 'sess-heartbeat',
              runId: 'run-heartbeat',
              seq: 0,
              runPhase: 'tool_running',
            }),
          }),
        )

        adapter.emit('agentEvent', {
          state: 'final',
          runId: 'run-heartbeat',
          seq: 1,
        } satisfies AgentEvent)
        client.sendAgentEvent.mockClear()
        vi.advanceTimersByTime(30_000)
        expect(client.sendAgentEvent).not.toHaveBeenCalled()
      } finally {
        await manager.cleanup()
        vi.useRealTimers()
      }
    })

    it('commits the user message locally and broadcasts metadata without a personal body event', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-worker',
          text: 'analyze services',
          agentType: 'codex',
          workDir: '/tmp/project',
          modelId: 'gpt-5.2',
        },
      })

      expect(client.sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'session.update',
          payload: {
            session: expect.objectContaining({
              id: 'sess-worker',
              agentType: 'codex',
              workDir: expect.stringContaining('/tmp/project'),
              modelId: 'gpt-5.2',
              status: 'active',
            }),
          },
        }),
      )
      expect(client.sendEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session.message' }),
      )
      expect(mockSessionMessages.get('sess-worker')).toEqual([
        expect.objectContaining({
          id: 'user-r1',
          sessionId: 'sess-worker',
          role: 'user',
          payload: 'analyze services',
        }),
      ])
    })

    it('aggregates consecutive text deltas before sending them to the server', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-abc', text: 'hello', agentType: 'claude', workDir: '/tmp' },
      })

      adapter.emit('agentEvent', { state: 'delta', runId: 'run1', seq: 0, text: 'Hello' })
      adapter.emit('agentEvent', { state: 'delta', runId: 'run1', seq: 1, text: ' world' })

      expect(client.sendAgentEvent).not.toHaveBeenCalled()

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 2 })

      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'agent',
          id: 'agent-evt-run1-1',
          payload: expect.objectContaining({
            state: 'delta',
            sessionId: 'sess-abc',
            text: 'Hello world',
          }),
        }),
      )
      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-evt-run1-2',
          payload: expect.objectContaining({
            state: 'final',
            sessionId: 'sess-abc',
          }),
        }),
      )
    })

    it('keeps Agent thinking deltas local and never relays them as messages', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r-thinking-filter',
        method: 'chat.send',
        params: {
          sessionId: 'sess-thinking-filter',
          text: 'hello',
          agentType: 'codex',
          workDir: '/tmp',
        },
      })
      client.sendAgentEvent.mockClear()

      adapter.emit('agentEvent', {
        state: 'delta',
        runId: 'run-thinking-filter',
        seq: 0,
        text: 'Codex API temporarily unavailable, retrying 2/5...',
        thinking: true,
      })

      expect(client.sendAgentEvent).not.toHaveBeenCalled()

      adapter.emit('agentEvent', {
        state: 'delta',
        runId: 'run-thinking-filter',
        seq: 1,
        text: 'Visible answer',
      })
      adapter.emit('agentEvent', {
        state: 'final',
        runId: 'run-thinking-filter',
        seq: 2,
      })

      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-evt-run-thinking-filter-1',
          payload: expect.objectContaining({
            state: 'delta',
            sessionId: 'sess-thinking-filter',
            text: 'Visible answer',
          }),
        }),
      )
      expect(client.sendAgentEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ thinking: true }),
        }),
      )
    })

    it('flushes aggregated text before forwarding a tool call', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-tool', text: 'hello', agentType: 'claude', workDir: '/tmp' },
      })

      adapter.emit('agentEvent', { state: 'delta', runId: 'run1', seq: 0, text: 'Before ' })
      adapter.emit('agentEvent', { state: 'delta', runId: 'run1', seq: 1, text: 'tool' })
      adapter.emit('agentEvent', {
        state: 'tool-call',
        runId: 'run1',
        seq: 2,
        name: 'bash',
        args: { command: 'ls' },
        durationMs: 1_250,
      })

      expect(client.sendAgentEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: 'agent-evt-run1-1',
          payload: expect.objectContaining({
            state: 'delta',
            sessionId: 'sess-tool',
            text: 'Before tool',
          }),
        }),
      )
      expect(client.sendAgentEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: 'agent-evt-run1-2',
          payload: expect.objectContaining({
            state: 'tool-call',
            sessionId: 'sess-tool',
            name: 'bash',
            status: 'running',
            durationMs: 1_250,
            detailAvailable: true,
          }),
        }),
      )
      expect(client.sendAgentEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          payload: expect.not.objectContaining({
            args: expect.anything(),
          }),
        }),
      )
      expect(client.sendAgentEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          payload: expect.not.objectContaining({
            argsSummary: expect.anything(),
          }),
        }),
      )
    })

    it('omits raw tool result when forwarding tool-result events', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-tool-result',
          text: 'hello',
          agentType: 'claude',
          workDir: '/tmp',
        },
      })

      adapter.emit('agentEvent', {
        state: 'tool-result',
        runId: 'run1',
        seq: 0,
        name: 'bash',
        result: 'very large command output',
      })

      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            state: 'tool-result',
            sessionId: 'sess-tool-result',
            name: 'bash',
          }),
        }),
      )
      expect(client.sendAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.not.objectContaining({
            result: expect.anything(),
          }),
        }),
      )
    })

    it('includes sessionId in error events', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-xyz', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      adapter.emit('error', new Error('CLI crashed'))

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[chat.send] adapter error sessionId=sess-xyz agentType=claude: CLI crashed',
        ),
      )

      expect(client.sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            state: 'error',
            sessionId: 'sess-xyz',
            message: 'CLI crashed',
          }),
        }),
      )
    })

    it('events from different sessions have correct sessionId', async () => {
      const adapterA = mockAdapter()
      const adapterB = mockAdapter()
      mockCreateAgent.mockReturnValueOnce(adapterA).mockReturnValueOnce(adapterB)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-A', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.send',
        params: { sessionId: 'sess-B', text: 'yo', agentType: 'codex', workDir: '/tmp' },
      })

      adapterA.emit('agentEvent', { state: 'delta', runId: 'rA', seq: 0, text: 'from A' })
      adapterB.emit('agentEvent', { state: 'delta', runId: 'rB', seq: 0, text: 'from B' })
      adapterA.emit('agentEvent', { state: 'final', runId: 'rA', seq: 1 })
      adapterB.emit('agentEvent', { state: 'final', runId: 'rB', seq: 1 })

      const calls = client.sendAgentEvent.mock.calls.map(
        (c: unknown[]) => (c[0] as { payload: Record<string, unknown> }).payload,
      )
      const aEvent = calls.find((p: Record<string, unknown>) => p.text === 'from A')
      const bEvent = calls.find((p: Record<string, unknown>) => p.text === 'from B')

      expect(aEvent?.sessionId).toBe('sess-A')
      expect(bEvent?.sessionId).toBe('sess-B')
    })
  })
})
