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
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { fs } = importedTestDependencies

describe('SessionManager session-tool-detail', () => {
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

  describe('session.tool.detail', () => {
    it('returns redacted local command details with tool results', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => mockFiles.has(String(p)))
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'send-tool-detail',
        method: 'chat.send',
        params: {
          sessionId: 'sess-tool-detail',
          text: 'run command',
          agentType: 'codex',
          workDir: '/tmp',
        },
      })

      adapter.emit('agentEvent', {
        state: 'tool-call',
        runId: 'run-tool-detail',
        seq: 3,
        name: 'command_execution',
        args: {
          command: 'TOKEN=secret123 pnpm test:fast',
          cwd: '/repo',
          authorization: 'Bearer abc.def',
        },
      } satisfies AgentEvent)
      adapter.emit('agentEvent', {
        state: 'tool-result',
        runId: 'run-tool-detail',
        seq: 4,
        name: 'command_execution',
        result: 'SECRET OUTPUT',
      } satisfies AgentEvent)

      const canonicalToolPayloads = (mockSessionMessages.get('sess-tool-detail') ?? [])
        .filter((message) => message.id.startsWith('agent-run-tool-detail-'))
        .map((message) => message.payload)
      expect(canonicalToolPayloads).toHaveLength(2)
      expect(canonicalToolPayloads.join('\n')).not.toContain('secret123')
      expect(canonicalToolPayloads.join('\n')).not.toContain('SECRET OUTPUT')
      expect(canonicalToolPayloads.join('\n')).toContain('"detailAvailable":true')

      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-1',
        method: 'session.tool.detail',
        params: {
          sessionId: 'sess-tool-detail',
          toolCallId: 'agent-run-tool-detail-3',
          detailRevision: 3,
          maxBytes: 32 * 1024,
        },
      })

      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'tool-detail-1',
        ok: true,
        payload: expect.objectContaining({
          detailStatus: 'available',
          toolCallId: 'agent-run-tool-detail-3',
          detailRevision: 3,
          command: 'TOKEN=[REDACTED] pnpm test:fast',
          argsSummary: expect.objectContaining({
            command: 'TOKEN=[REDACTED] pnpm test:fast',
            cwd: '/repo',
            authorization: '[REDACTED]',
          }),
          resultOmitted: true,
          redacted: true,
          source: 'local-tool-index',
        }),
      })

      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-stale',
        method: 'session.tool.detail',
        params: {
          sessionId: 'sess-tool-detail',
          toolCallId: 'agent-run-tool-detail-3',
          detailRevision: 2,
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'tool-detail-stale',
        ok: true,
        payload: expect.objectContaining({
          toolCallId: 'agent-run-tool-detail-3',
          detailRevision: 2,
          detailStatus: 'unavailable',
          reason: 'revision_mismatch',
        }),
      })
    })

    it('redacts Codex environment context from local tool details', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => mockFiles.has(String(p)))
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'send-tool-detail-context',
        method: 'chat.send',
        params: {
          sessionId: 'sess-tool-detail-context',
          text: 'run command',
          agentType: 'codex',
          workDir: '/tmp',
        },
      })

      const environmentContext = [
        '<environment_context>',
        '<cwd>/repo</cwd>',
        '<shell>zsh</shell>',
        '<current_date>2026-06-20</current_date>',
        '<timezone>Asia/Shanghai</timezone>',
        '<filesystem><workspace_roots><root>/repo</root></workspace_roots>',
        '<permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
        '</environment_context>',
      ].join('\n')

      adapter.emit('agentEvent', {
        state: 'tool-call',
        runId: 'run-tool-context',
        seq: 3,
        name: 'command_execution',
        args: {
          command: environmentContext,
          nested: { prompt: environmentContext },
        },
      } satisfies AgentEvent)

      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-context',
        method: 'session.tool.detail',
        params: {
          sessionId: 'sess-tool-detail-context',
          toolCallId: 'agent-run-tool-context-3',
          detailRevision: 3,
        },
      })

      const response = JSON.stringify(client.sendRes.mock.calls.at(-1)?.[0])
      expect(response).toContain('[SYSTEM CONTEXT REDACTED]')
      expect(response).not.toContain('<environment_context>')
      expect(response).not.toContain('permission_profile')
    })

    it('returns not_found when local tool details are unavailable', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-missing',
        method: 'session.tool.detail',
        params: {
          sessionId: 'missing-session',
          toolCallId: 'agent-run-missing-1',
          detailRevision: 1,
        },
      })

      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'tool-detail-missing',
        ok: true,
        payload: expect.objectContaining({
          detailStatus: 'not_found',
          resultOmitted: true,
          source: 'unavailable',
        }),
      })
    })

    it('rejects legacy fuzzy requests and bounds the exact response bytes', async () => {
      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-legacy',
        method: 'session.tool.detail',
        params: { sessionId: 'session-limit', messageId: 'legacy-message' },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'tool-detail-legacy',
          ok: false,
          error: expect.stringContaining('upgrade_required'),
        }),
      )

      mockToolDetails.set('session-limit', [
        {
          schemaVersion: 1,
          sessionId: 'session-limit',
          toolCallId: 'tool-limit',
          detailRevision: 5,
          ts: Date.now(),
          name: 'command_execution',
          args: Object.fromEntries(
            Array.from({ length: 50 }, (_, index) => [`field_${index}`, 'x'.repeat(2_000)]),
          ),
          result: 'y'.repeat(20_000),
          status: 'completed',
          detailRef: { runId: 'run-limit', sourceSeq: 5 },
        },
      ])
      await manager.handleReq({
        type: 'req',
        id: 'tool-detail-limit',
        method: 'session.tool.detail',
        params: {
          sessionId: 'session-limit',
          toolCallId: 'tool-limit',
          detailRevision: 5,
          maxBytes: 4096,
        },
      })
      const response = client.sendRes.mock.calls.at(-1)?.[0] as {
        payload?: { byteSize?: number; reason?: string }
      }
      expect(response.payload?.byteSize).toBeLessThanOrEqual(4096)
      expect(response.payload?.reason).toBe('response_too_large')
    })
  })
})
