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

describe('SessionManager agentsessionid-persistence', () => {
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

  describe('agentSessionId persistence', () => {
    it('passes agentSessionId from chat.send params to adapter.start', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-resume',
          text: 'hello',
          agentType: 'claude',
          workDir: '/tmp',
          agentSessionId: 'claude-sid-123',
        },
      })

      expect(adapter.start).toHaveBeenCalledWith(
        'sess-resume',
        expect.any(String),
        'claude-sid-123',
      )
    })

    it('emits session.update when agent reports agentSessionId on final', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-new', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      const finalEvent: AgentEvent = {
        state: 'final',
        runId: 'run1',
        seq: 1,
        agentSessionId: 'claude-sid-456',
      }
      adapter.emit('agentEvent', finalEvent)

      const sessionUpdateCall = client.sendEvent.mock.calls.find((c: unknown[]) => {
        const event = c[0] as {
          event: string
          payload?: { session?: { agentSessionId?: string | null } }
        }
        return (
          event.event === 'session.update' &&
          event.payload?.session?.agentSessionId === 'claude-sid-456'
        )
      })
      expect(sessionUpdateCall).toBeDefined()
      expect(sessionUpdateCall![0]).toEqual(
        expect.objectContaining({
          type: 'event',
          event: 'session.update',
          payload: {
            session: {
              id: 'sess-new',
              agentType: 'claude',
              agentSessionId: 'claude-sid-456',
            },
          },
        }),
      )
    })

    it('does not emit session.update when final has no agentSessionId', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-no-sid', text: 'hi', agentType: 'codex', workDir: '/tmp' },
      })

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })

      const sessionUpdateCall = client.sendEvent.mock.calls.find((c: unknown[]) => {
        const event = c[0] as {
          event: string
          payload?: { session?: { agentSessionId?: string | null } }
        }
        return event.event === 'session.update' && event.payload?.session?.agentSessionId !== null
      })
      expect(sessionUpdateCall).toBeUndefined()
    })

    it('reuses existing adapter (with agentSessionId) for same session', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-reuse', text: 'first', agentType: 'claude', workDir: '/tmp' },
      })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.send',
        params: { sessionId: 'sess-reuse', text: 'second', agentType: 'claude', workDir: '/tmp' },
      })

      expect(mockCreateAgent).toHaveBeenCalledTimes(1)
      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(1, 'first', undefined)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
    })

    it('resumes an existing adapter when a newer agentSessionId arrives', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-resume-existing',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          agentSessionId: 'sid-1',
        },
      })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.send',
        params: {
          sessionId: 'sess-resume-existing',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          agentSessionId: 'sid-2',
        },
      })

      expect(adapter.resume).toHaveBeenCalledWith('sid-2')
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
    })

    it('rebuilds the cached adapter when the incoming session metadata drifts', async () => {
      const firstAdapter = mockAdapter()
      const secondAdapter = mockAdapter()
      secondAdapter.type = 'codex' as any
      mockCreateAgent.mockReturnValueOnce(firstAdapter).mockReturnValueOnce(secondAdapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-drift',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp/original',
        },
      })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.send',
        params: {
          sessionId: 'sess-drift',
          text: 'second',
          agentType: 'codex',
          workDir: '/tmp/next',
          agentSessionId: 'thread-2',
        },
      })

      expect(firstAdapter.stop).toHaveBeenCalledTimes(1)
      expect(secondAdapter.start).toHaveBeenCalledWith('sess-drift', '/tmp/next', 'thread-2')
      expect(secondAdapter.send).toHaveBeenCalledWith('second', undefined)
    })

    it('passes modelId to adapter.send when provided', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-model',
          text: 'hello',
          agentType: 'claude',
          workDir: '/tmp',
          modelId: 'sonnet',
        },
      })

      expect(adapter.send).toHaveBeenCalledWith('hello', 'sonnet')
    })

    it('passes the queued Agent prompt as a per-run snapshot', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r-agent-policy',
        method: 'chat.send',
        params: {
          sessionId: 'sess-agent-policy',
          text: 'hello',
          agentType: 'claude',
          workDir: '/tmp',
          modelId: 'sonnet',
          systemPrompt: '只处理客户问题。',
        },
      })

      expect(adapter.send).toHaveBeenCalledWith(
        'hello',
        'sonnet',
        undefined,
        undefined,
        '只处理客户问题。',
      )
    })

    it('keeps an ordinary OpenCode greeting free of schedule instructions and grants', async () => {
      const adapter = mockAdapter('opencode')
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'private-opencode-greeting',
        method: 'chat.send',
        params: {
          sessionId: 'sess-private-opencode-greeting',
          text: '你好',
          agentType: 'opencode',
          workDir: '/tmp',
        },
      })

      expect(adapter.send).toHaveBeenCalledWith('你好', undefined)
      expect(adapter.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-private-opencode-greeting',
          env: {},
        }),
      )
    })

    it('passes latest GPT-5.6 Codex modelIds through to adapter.send without fallback', async () => {
      for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
        const adapter = mockAdapter('codex')
        mockCreateAgent.mockReturnValueOnce(adapter)

        await manager.handleReq({
          type: 'req',
          id: `req-${modelId}`,
          method: 'chat.send',
          params: {
            sessionId: `sess-${modelId}`,
            text: 'hello',
            agentType: 'codex',
            workDir: '/tmp',
            modelId,
          },
        })

        expect(adapter.send).toHaveBeenCalledWith('hello', modelId)
      }
    })

    it('passes reasoningEffort to supported native and dynamic ACP adapters', async () => {
      const claudeAdapter = mockAdapter()
      const geminiAdapter = mockAdapter()
      const acpAdapter = mockAdapter()
      geminiAdapter.type = 'gemini' as any
      acpAdapter.type = 'acp:fixture' as any
      mockCreateAgent
        .mockReturnValueOnce(claudeAdapter)
        .mockReturnValueOnce(acpAdapter)
        .mockReturnValueOnce(geminiAdapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-reasoning-claude',
          text: 'hello',
          agentType: 'claude',
          workDir: '/tmp',
          modelId: 'sonnet',
          reasoningEffort: 'high',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.send',
        params: {
          sessionId: 'sess-reasoning-acp',
          text: 'hello',
          agentType: 'acp:fixture',
          workDir: '/tmp',
          modelId: 'fast',
          reasoningEffort: 'code',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.send',
        params: {
          sessionId: 'sess-reasoning-gemini',
          text: 'hello',
          agentType: 'gemini',
          workDir: '/tmp',
          modelId: 'gemini-2.5-pro',
          reasoningEffort: 'high',
        },
      })

      expect(claudeAdapter.send).toHaveBeenCalledWith('hello', 'sonnet', 'high')
      expect(geminiAdapter.send).toHaveBeenCalledWith('hello', 'gemini-2.5-pro')
      expect(acpAdapter.send).toHaveBeenCalledWith('hello', 'fast', 'code')
    })

    it('repairs claude imported workDir from transcript cwd before starting the adapter', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)
      mockLookupClaudeTranscriptCwd.mockReturnValue(
        '/Users/example/Documents/code/projects/shennian',
      )

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-imported',
          text: 'continue',
          agentType: 'claude',
          workDir: '-Users-lichen-Documents-code-projects-shennian',
          agentSessionId: 'claude-sid-imported',
        },
      })

      expect(adapter.start).toHaveBeenCalledWith(
        'sess-imported',
        '/Users/example/Documents/code/projects/shennian',
        'claude-sid-imported',
      )
      expect(adapter.send).toHaveBeenCalledWith('continue', undefined)
    })
  })
})
