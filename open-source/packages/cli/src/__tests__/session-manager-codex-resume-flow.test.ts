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
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { recoverJournaledRun } = importedTestDependencies

describe('SessionManager codex-resume-flow', () => {
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

  describe('codex resume flow', () => {
    it('passively restores a Desktop-owned turn instead of sending Continue after restart', async () => {
      const restoreExternalObservation = vi.fn(() => true)
      manager = createTestSessionManager(
        client as never,
        {
          setExternalTerminalHandler: vi.fn(),
          restoreExternalObservation,
        } as never,
      )
      const adapter = mockAdapter('codex')
      mockCreateAgent.mockReturnValue(adapter)
      const runtime = (
        manager as unknown as {
          getRuntime(): Parameters<typeof recoverJournaledRun>[0]
        }
      ).getRuntime()

      const result = await recoverJournaledRun(runtime, {
        schemaVersion: 1,
        daemonInstallationId: 'daemon-installation-1',
        sessionId: 'sess-desktop-recovery',
        runId: 'run-desktop-recovery',
        clientMessageId: 'user-desktop-recovery',
        agentType: 'codex',
        sessionMode: 'standard',
        workDir: '/tmp',
        agentSessionId: 'thread-desktop-recovery',
        modelId: null,
        reasoningEffort: null,
        nativeSessionVisibility: 'user',
        providerRunId: null,
        lastObservedEventSeq: -1,
        phase: 'running',
        source: 'personal',
        parentSessionId: null,
        roomContextRegistryKey: null,
        activationCauseMessageId: null,
        rootCauseMessageId: null,
        activationSequence: null,
        activationHopCount: null,
        managedPolicyVersion: null,
        managedRuntimePolicyHash: null,
        upgradeJobId: null,
        interruptionReason: 'os_restart',
        continueDispatchState: 'none',
        deliveryMode: 'external_owner_queue',
        externalRunId: 'codex-external-submit-1',
        recoveryAttempts: 0,
        recoveryReason: null,
        createdAt: '2026-09-09T06:29:00.000Z',
        updatedAt: '2026-09-09T06:29:00.000Z',
      })

      expect(result).toEqual({ result: 'reattached' })
      expect(restoreExternalObservation).toHaveBeenCalledWith({
        sessionId: 'sess-desktop-recovery',
        sourceSessionKey: 'thread-desktop-recovery',
        runId: 'codex-external-submit-1',
        canonicalMessageId: 'user-desktop-recovery',
        createdAt: Date.parse('2026-09-09T06:29:00.000Z'),
      })
      expect(adapter.recoverInterruptedRun).not.toHaveBeenCalled()
      expect(adapter.send).not.toHaveBeenCalled()
    })

    it('passes agentSessionId to codex adapter via start()', async () => {
      const adapter = mockAdapter()
      adapter.type = 'codex' as any
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: {
          sessionId: 'sess-codex',
          text: 'fix bug',
          agentType: 'codex',
          workDir: '/tmp',
          agentSessionId: 'thread-abc-123',
        },
      })

      expect(adapter.start).toHaveBeenCalledWith('sess-codex', expect.any(String), 'thread-abc-123')
    })

    it('persists codex agentSessionId from final event', async () => {
      const adapter = mockAdapter()
      adapter.type = 'codex' as any
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-codex-new', text: 'hello', agentType: 'codex', workDir: '/tmp' },
      })

      adapter.emit('agentEvent', {
        state: 'final',
        runId: 'run1',
        seq: 1,
        agentSessionId: 'thread-xyz-789',
      })

      const updateCall = client.sendEvent.mock.calls.find((c: unknown[]) => {
        const event = c[0] as {
          event: string
          payload?: { session?: { agentSessionId?: string | null } }
        }
        return (
          event.event === 'session.update' &&
          event.payload?.session?.agentSessionId === 'thread-xyz-789'
        )
      })
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toEqual(
        expect.objectContaining({
          payload: {
            session: {
              id: 'sess-codex-new',
              agentType: 'codex',
              agentSessionId: 'thread-xyz-789',
            },
          },
        }),
      )
    })
  })
})
