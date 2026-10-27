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

describe('SessionManager custom-agent-agentsessionid', () => {
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

  describe('custom agent agentSessionId', () => {
    it('persists custom agent session ID from final event', async () => {
      const adapter = mockAdapter()
      adapter.type = 'custom:my-agent' as any
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-custom',
          text: 'hello',
          agentType: 'custom:my-agent',
          workDir: '/tmp',
        },
      })

      adapter.emit('agentEvent', {
        state: 'final',
        runId: 'run1',
        seq: 1,
        agentSessionId: 'custom-session-456',
      })

      const updateCall = client.sendEvent.mock.calls.find((c: unknown[]) => {
        const event = c[0] as {
          event: string
          payload?: { session?: { agentSessionId?: string | null } }
        }
        return (
          event.event === 'session.update' &&
          event.payload?.session?.agentSessionId === 'custom-session-456'
        )
      })
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toEqual(
        expect.objectContaining({
          payload: {
            session: {
              id: 'sess-custom',
              agentType: 'custom:my-agent',
              agentSessionId: 'custom-session-456',
            },
          },
        }),
      )
    })
  })
})
