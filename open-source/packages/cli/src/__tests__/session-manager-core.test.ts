// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeSessionFixture,
  createMockClient,
  createTestSessionManager,
  deletionOrder,
  mockDeliveryStates,
  mockFiles,
  mockFindSourceTombstone,
  mockCollectLocalNativeSources,
  mockIsCodexThreadTailInterrupted,
  mockLookupClaudeTranscriptCwd,
  mockMergeProjectedSessions,
  mockNativeCleanupEnqueue,
  mockReadDeletionRevision,
  mockRecordDeletionSyncFailure,
  mockRecordSessionTombstone,
  mockRecordSourceTombstone,
  mockSessionMessages,
  mockSessionRecords,
  mockToolDetails,
  mockWriteDeletionRevision,
  originalPlatform,
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { upgradeRecoveryVisibleMessage } = importedTestDependencies

describe('SessionManager core', () => {
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
    mockCollectLocalNativeSources.mockReturnValue([])
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

  it('keeps upgrade interruption guidance concise and single-language', () => {
    const message = upgradeRecoveryVisibleMessage()
    expect(message).toBe(
      '神念升级中断了本次运行。已完成的回复或操作仍然有效，未完成部分可重试。原会话已保留。',
    )
    expect(message).not.toMatch(/provider_error|recovery_failed|[A-Za-z]{4}/)
  })

  it('propagates thrown synthetic request failures to the Manager inbox dispatcher', async () => {
    const error = new Error('synthetic enqueue failed')
    ;(manager as any).chatQueue.handleEnqueue = vi.fn().mockRejectedValue(error)

    await expect(
      manager.handleReq(
        {
          type: 'req',
          id: 'manager-inbox-dispatch',
          method: 'chat.enqueue',
          params: { sessionId: 'manager-1', text: 'worker finished' },
        },
        { propagateErrors: true },
      ),
    ).rejects.toBe(error)

    expect(client.sendRes).not.toHaveBeenCalled()
  })

  it('stops a running session, durably tombstones it, purges local projections, then ACKs', async () => {
    client.sendReq
      .mockResolvedValueOnce({
        type: 'res',
        id: 'sync',
        ok: true,
        payload: {
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-installation-1',
          baselineRevision: 0,
          latestRevision: 1,
          deletions: [
            {
              sessionId: 'deleted-session',
              deletionRevision: 1,
              deletedAt: '2026-09-02T01:00:00.000Z',
              nativeCleanupPolicy: 'auto',
              sources: [{ agentType: 'codex', sourceSessionKey: 'thread-1' }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'ack',
        ok: true,
        payload: { deletionRevision: 1, acknowledged: true },
      })
    const nativeFusion = {
      handleSessionDeleted: vi.fn(() => {
        deletionOrder.push('fusion')
      }),
    }
    manager = createTestSessionManager(client as never, nativeFusion as never)
    const active = activeSessionFixture('codex', 'thread-1')
    active.adapter.stop.mockImplementation(async () => {
      deletionOrder.push('stop')
    })
    ;(manager as unknown as { sessions: Map<string, unknown> }).sessions.set(
      'deleted-session',
      active,
    )

    await manager.synchronizeSessionDeletions()

    expect(deletionOrder).toEqual([
      'tombstone-session',
      'tombstone-source',
      'stop',
      'subscription',
      'fusion',
      'detail',
      'canonical',
      'index',
      'outbox',
      'revision',
    ])
    expect(mockNativeCleanupEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'deleted-session',
        nativeCleanupPolicy: 'auto',
      }),
      undefined,
    )
    expect(client.sendReq).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'session.deletions.ack',
        params: expect.objectContaining({ deletionRevision: 1 }),
      }),
    )
    expect(
      (manager as unknown as { sessions: Map<string, unknown> }).sessions.has('deleted-session'),
    ).toBe(false)
  })

  it('durably accepts an explicit pruned deletion baseline before discovery', async () => {
    client.sendReq
      .mockResolvedValueOnce({
        type: 'res',
        id: 'sync',
        ok: true,
        payload: {
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-installation-1',
          baselineRevision: 130,
          latestRevision: 130,
          deletions: [],
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'ack',
        ok: true,
        payload: { deletionRevision: 130, acknowledged: true },
      })

    await manager.synchronizeSessionDeletions()

    expect(mockWriteDeletionRevision).toHaveBeenCalledWith(130)
    expect(client.sendReq).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'session.deletions.ack',
        params: expect.objectContaining({ deletionRevision: 130 }),
      }),
    )
  })

  it('advances deletion sync when a legacy duplicate session shares a source tombstone', async () => {
    mockFindSourceTombstone.mockReturnValue({
      sessionId: 'previously-deleted-session',
      deletionRevision: 7,
    })
    client.sendReq
      .mockResolvedValueOnce({
        type: 'res',
        id: 'sync',
        ok: true,
        payload: {
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-installation-1',
          baselineRevision: 7,
          latestRevision: 8,
          deletions: [
            {
              sessionId: 'duplicate-session',
              deletionRevision: 8,
              deletedAt: '2026-09-09T01:00:00.000Z',
              nativeCleanupPolicy: 'auto',
              sources: [{ agentType: 'opencode', sourceSessionKey: 'ses_duplicate' }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'ack',
        ok: true,
        payload: { deletionRevision: 8, acknowledged: true },
      })

    await manager.synchronizeSessionDeletions()

    expect(mockRecordSessionTombstone).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'duplicate-session', deletionRevision: 8 }),
    )
    expect(mockRecordSourceTombstone).not.toHaveBeenCalled()
    expect(mockNativeCleanupEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'duplicate-session' }),
      undefined,
    )
    expect(mockWriteDeletionRevision).toHaveBeenCalledWith(8)
    expect(client.sendReq).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'session.deletions.ack',
        params: expect.objectContaining({ deletionRevision: 8 }),
      }),
    )
  })

  it('tombstones locally owned native sources the Server deletion did not list', async () => {
    mockCollectLocalNativeSources.mockReturnValue([
      { agentType: 'codex', sourceSessionKey: 'thread-server' },
      { agentType: 'codex', sourceSessionKey: 'thread-room-echo' },
    ])
    const deletion = {
      sessionId: 'room-session',
      deletionRevision: 3,
      deletedAt: '2026-09-18T01:00:00.000Z',
      nativeCleanupPolicy: 'auto',
      sources: [{ agentType: 'codex', sourceSessionKey: 'thread-server' }],
    }
    client.sendReq
      .mockResolvedValueOnce({
        type: 'res',
        id: 'sync',
        ok: true,
        payload: {
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: 'daemon-installation-1',
          baselineRevision: 2,
          latestRevision: 3,
          deletions: [deletion],
        },
      })
      .mockResolvedValueOnce({
        type: 'res',
        id: 'ack',
        ok: true,
        payload: { deletionRevision: 3, acknowledged: true },
      })

    await manager.synchronizeSessionDeletions()

    expect(mockCollectLocalNativeSources).toHaveBeenCalledWith('room-session', expect.anything())
    expect(mockRecordSourceTombstone).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'room-session', sourceSessionKey: 'thread-room-echo' }),
    )
    // Local evidence only blocks re-import; provider cleanup stays Server-scoped.
    expect(mockNativeCleanupEnqueue).toHaveBeenCalledWith(deletion, undefined)
  })

  it('retries an unstructured deletion response instead of permanently stopping discovery', async () => {
    const { DeletionSyncRetryWaitError } = await import('../session/deletion-sync-state.js')
    client.sendReq.mockResolvedValueOnce({
      type: 'res',
      id: 'sync',
      ok: false,
      error: 'temporary relay failure',
    })
    mockRecordDeletionSyncFailure.mockImplementationOnce(() => {
      throw new DeletionSyncRetryWaitError(1_000)
    })

    await expect(manager.synchronizeSessionDeletions()).rejects.toBeInstanceOf(
      DeletionSyncRetryWaitError,
    )
    expect(mockRecordDeletionSyncFailure).toHaveBeenCalledWith({
      code: 'unstructured_rejection',
      retryable: true,
    })
  })

  it('retries a malformed deletion payload instead of permanently stopping discovery', async () => {
    client.sendReq.mockResolvedValueOnce({
      type: 'res',
      id: 'sync',
      ok: true,
      payload: {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-installation-1',
        baselineRevision: 0,
        latestRevision: 1,
        deletions: [],
      },
    })

    await expect(manager.synchronizeSessionDeletions()).rejects.toThrow(
      'invalid deletion sync revision range',
    )
    expect(mockRecordDeletionSyncFailure).toHaveBeenCalledWith({
      code: 'invalid_deletion_sync_response',
      retryable: true,
    })
  })

  it('does not advance or ACK a deletion when the native outbox commit fails', async () => {
    mockNativeCleanupEnqueue.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    client.sendReq.mockResolvedValueOnce({
      type: 'res',
      id: 'sync',
      ok: true,
      payload: {
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-installation-1',
        baselineRevision: 0,
        latestRevision: 1,
        deletions: [
          {
            sessionId: 'deleted-session',
            deletionRevision: 1,
            deletedAt: '2026-09-02T01:00:00.000Z',
            nativeCleanupPolicy: 'auto',
            sources: [{ agentType: 'opencode', sourceSessionKey: 'ses_unit_00000000' }],
          },
        ],
      },
    })

    await expect(manager.synchronizeSessionDeletions()).rejects.toThrow('disk full')

    expect(mockRecordDeletionSyncFailure).toHaveBeenCalledWith({
      code: 'deletion_sync_failed',
      retryable: true,
    })
    expect(mockRecordSessionTombstone).toHaveBeenCalledTimes(1)
    expect(mockWriteDeletionRevision).not.toHaveBeenCalled()
    expect(client.sendReq).toHaveBeenCalledTimes(1)
  })

  it('binds a managed Room before any native Agent turn starts', async () => {
    const binder = {
      bind: vi.fn().mockResolvedValue({
        binding: { id: 'binding-1', status: 'active' },
        idempotent: false,
      }),
    }
    const internals = manager as unknown as {
      managedRoomBinder: typeof binder
      sessions: Map<string, ReturnType<typeof activeSessionFixture>>
    }
    internals.managedRoomBinder = binder
    internals.sessions.set(
      'session-managed-1',
      activeSessionFixture('codex', 'native-session-exact'),
    )

    await manager.handleReq({
      type: 'req',
      id: 'req-managed-bind',
      method: 'room.agent.bind-managed',
      params: {
        roomId: 'room-1',
        agentIdentityId: 'agent-1',
        nianSessionId: 'session-managed-1',
        assignmentIntentId: 'assignment-1',
        agentType: 'codex',
      },
    })

    expect(binder.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        nianSessionId: 'session-managed-1',
        sourceSessionKey: 'managed:session-managed-1',
        agentType: 'codex',
      }),
    )
    expect(client.sendRes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-managed-bind', ok: true }),
    )
  })
})
