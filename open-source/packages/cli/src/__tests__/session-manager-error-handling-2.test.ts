// @covers src/session/manager.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedRoomExecutor,
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
  preparedManagedRoomTurn,
} from './session-manager-test-harness.js'

describe('SessionManager error-handling-2', () => {
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

  describe('error handling', () => {
    it('dispatches all compatible Room items present at the idle boundary as one turn', async () => {
      const adapter = mockAdapter('codex')
      mockCreateAgent.mockReturnValue(adapter)
      manager.setManagedRoomTurnPreparer(async () => preparedManagedRoomTurn('managed Room prompt'))
      const context = (messageId: string, sequence: string) => ({
        registryKey: 'a'.repeat(64),
        causeMessageId: messageId,
        rootCauseMessageId: messageId,
        sequence,
        hopCount: 0,
      })

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-batch',
            text: '[群消息] <User>\nfirst',
            agentType: 'codex',
            agentSessionId: 'thread-room-batch',
            workDir: '/tmp',
            clientMessageId: 'room-message-1',
          },
          context: context('message-1', '1'),
        },
        {
          params: {
            sessionId: 'sess-room-batch',
            text: '[群消息] <User>\nsecond',
            agentType: 'codex',
            agentSessionId: 'thread-room-batch',
            workDir: '/tmp',
            clientMessageId: 'room-message-2',
          },
          context: context('message-2', '2'),
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(1)
      expect(adapter.send).toHaveBeenCalledWith(
        '[群消息]\n<User>\nfirst\n\n<User>\nsecond',
        undefined,
        undefined,
        undefined,
        'managed Room prompt',
        { source: 'room_activation' },
      )
      expect(
        (mockSessionMessages.get('sess-room-batch') ?? [])
          .filter((item) => item.role === 'user')
          .map((item) => item.id),
      ).toEqual(['room-message-1', 'room-message-2'])
      expect(
        (
          manager as unknown as {
            chatQueue: {
              getSnapshot: (id: string) => {
                pending: unknown[]
              }
            }
          }
        ).chatQueue.getSnapshot('sess-room-batch').pending,
      ).toHaveLength(0)
    })

    it('refuses to edit or delete a queued managed Room activation', async () => {
      const adapter = mockAdapter('codex')
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'seed-managed-queue',
        method: 'chat.send',
        params: {
          sessionId: 'sess-managed-queue',
          text: 'busy',
          agentType: 'codex',
          workDir: '/tmp',
          waitForDispatch: true,
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'busy-run', seq: 0 })

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-managed-queue',
            text: '[群消息] <User>\noriginal',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'managed-queue-message',
            queueMessageId: 'managed-queue-message',
            roomMessageCreatedAt: '2026-09-17T02:03:04.000Z',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'managed-queue-message',
            rootCauseMessageId: 'managed-queue-message',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])

      await manager.handleReq({
        type: 'req',
        id: 'edit-managed-queue',
        method: 'chat.queue.edit',
        params: {
          sessionId: 'sess-managed-queue',
          queueMessageId: 'managed-queue-message',
          text: 'forged',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'edit-managed-queue',
        ok: false,
        error: 'managed_agent_queue_mutation_forbidden',
      })

      await manager.handleReq({
        type: 'req',
        id: 'delete-managed-queue',
        method: 'chat.queue.delete',
        params: {
          sessionId: 'sess-managed-queue',
          queueMessageId: 'managed-queue-message',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'delete-managed-queue',
        ok: false,
        error: 'managed_agent_queue_mutation_forbidden',
      })

      const snapshot = (
        manager as unknown as {
          chatQueue: {
            getSnapshot: (id: string) => { pending: Array<{ text: string; createdAt: string }> }
          }
        }
      ).chatQueue.getSnapshot('sess-managed-queue')
      expect(snapshot.pending).toEqual([
        expect.objectContaining({
          text: '[群消息] <User>\noriginal',
          createdAt: '2026-09-17T02:03:04.000Z',
        }),
      ])
    })

    it('keeps the managed Room capability after terminal events', async () => {
      const adapter = mockAdapter('codex')
      const revoke = vi.fn()
      const execute = vi.fn(async () => ({ ok: true })) as ManagedRoomExecutor
      manager = createTestSessionManager(client as never, undefined, revoke, execute)
      mockCreateAgent.mockReturnValue(adapter)
      manager.setManagedRoomTurnPreparer(async () => preparedManagedRoomTurn('managed Room prompt'))

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-token',
            text: '[群消息] <User>\nwork',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'room-token-message',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'message-token',
            rootCauseMessageId: 'message-token',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(revoke).not.toHaveBeenCalled()
      expect(adapter.configure).toHaveBeenLastCalledWith(
        expect.objectContaining({
          managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
          managedRoomExecutor: execute,
          env: expect.not.objectContaining({
            SHENNIAN_MANAGED_ROOM_CONTEXT: expect.anything(),
            SHENNIAN_MANAGED_ROOM_IPC_ROOT: expect.anything(),
          }),
        }),
      )

      adapter.emit('agentEvent', { state: 'start', runId: 'run-token', seq: 0 })
      adapter.emit('agentEvent', { state: 'final', runId: 'run-token', seq: 1 })

      // The grant outlives the Turn; only the next Turn, stop, or Session close revokes it.
      expect(revoke).not.toHaveBeenCalled()
    })

    it('tells the Owner when a Turn ended after only failed Room sends, and stays quiet otherwise', async () => {
      const adapter = mockAdapter('codex')
      manager = createTestSessionManager(client as never, undefined, vi.fn(), (async () => ({ ok: true })) as ManagedRoomExecutor)
      mockCreateAgent.mockReturnValue(adapter)
      manager.setManagedRoomTurnPreparer(async () => preparedManagedRoomTurn('managed Room prompt'))
      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-notice',
            text: '[群消息] <User>\nwork',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'room-notice-message',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'message-notice',
            rootCauseMessageId: 'message-notice',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      const token = `mrc_${'a'.repeat(43)}`
      manager.noteManagedRoomSendOutcome({ token, ok: false, errorCode: 'room_write_forbidden' })
      adapter.emit('agentEvent', { state: 'start', runId: 'run-notice', seq: 0 })
      adapter.emit('agentEvent', { state: 'final', runId: 'run-notice', seq: 1 })

      expect(mockSessionMessages.get('sess-room-notice')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'room-reply-notice-run-notice',
            payload: expect.stringContaining('本轮未能在群里回复'),
          }),
        ]),
      )
      expect(mockSessionRecords.get('sess-room-notice')).toMatchObject({ status: 'failed' })
    })

    it('ends dispatch and tells the Owner when a restricted Agent cannot chat in Rooms, without retrying', async () => {
      const adapter = mockAdapter('opencode')
      manager = createTestSessionManager(client as never, undefined, vi.fn(), (async () => ({ ok: true })) as ManagedRoomExecutor)
      mockCreateAgent.mockReturnValue(adapter)
      const prepare = vi.fn(async () => {
        throw new Error('managed_agent_restricted_room_unsupported')
      })
      manager.setManagedRoomTurnPreparer(prepare as never)
      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-restricted',
            text: '[群消息] <User>\nhi',
            agentType: 'opencode',
            workDir: '/tmp',
            clientMessageId: 'room-restricted-message',
          },
          context: {
            registryKey: 'b'.repeat(64),
            causeMessageId: 'message-restricted',
            rootCauseMessageId: 'message-restricted',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(prepare).toHaveBeenCalledTimes(1)
      expect(adapter.send).not.toHaveBeenCalled()
      expect(mockSessionMessages.get('sess-room-restricted')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ payload: expect.stringContaining('全部权限') }),
        ]),
      )
      const pending = (manager as unknown as {
        chatQueue: { getSnapshot: (id: string) => { pending: unknown[] } }
      }).chatQueue.getSnapshot('sess-room-restricted').pending
      expect(pending).toHaveLength(0)
    })

    it('configures managed Room tools before Codex prepares its app-server thread', async () => {
      const adapter = mockAdapter('codex')
      const execute = vi.fn(async () => ({ ok: true })) as ManagedRoomExecutor
      manager = createTestSessionManager(client as never, undefined, undefined, execute)
      mockCreateAgent.mockReturnValue(adapter)
      manager.setManagedRoomTurnPreparer(async () => preparedManagedRoomTurn('managed Room prompt'))
      adapter.prepareSend.mockImplementation(async () => {
        expect(adapter.configure).toHaveBeenLastCalledWith(
          expect.objectContaining({
            managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
            managedRoomExecutor: execute,
          }),
        )
      })

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-prepare-context',
            text: '[群消息] <User>\nhello',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'room-prepare-context-message',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'message-prepare-context',
            rootCauseMessageId: 'message-prepare-context',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledOnce())
    })

    it('revokes a freshly issued Room capability when an idempotent replay starts no turn', async () => {
      const adapter = mockAdapter('codex')
      const revoke = vi.fn()
      manager = createTestSessionManager(client as never, undefined, revoke)
      mockCreateAgent.mockReturnValue(adapter)
      manager.setManagedRoomTurnPreparer(async () => {
        mockDeliveryStates.set('sess-room-replay:room-replay-message', 'completed')
        return preparedManagedRoomTurn('managed Room prompt', 'b')
      })

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-replay',
            text: '[群消息] <User>\nreplay',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'room-replay-message',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'message-replay',
            rootCauseMessageId: 'message-replay',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).not.toHaveBeenCalled()
      expect(revoke).toHaveBeenCalledWith(`mrc_${'b'.repeat(43)}`)
    })

    it('keeps a managed Room item queued when its immutable permission snapshot mismatches', async () => {
      const adapter = mockAdapter('codex')
      mockCreateAgent.mockReturnValue(adapter)
      const prepared = preparedManagedRoomTurn('managed Room prompt')
      prepared.managedRoomPromptSnapshot.runtimePermissionPolicyHash = 'f'.repeat(64)
      manager.setManagedRoomTurnPreparer(async () => prepared)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await manager.enqueueManagedRoomBatch([
        {
          params: {
            sessionId: 'sess-room-snapshot-mismatch',
            text: '[群消息] <User>\ninspect policy',
            agentType: 'codex',
            workDir: '/tmp',
            clientMessageId: 'room-message-snapshot-mismatch',
          },
          context: {
            registryKey: 'a'.repeat(64),
            causeMessageId: 'message-snapshot-mismatch',
            rootCauseMessageId: 'message-snapshot-mismatch',
            sequence: '1',
            hopCount: 0,
          },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.start).not.toHaveBeenCalled()
      expect(
        (
          manager as unknown as {
            chatQueue: {
              getSnapshot: (id: string) => {
                pending: unknown[]
              }
            }
          }
        ).chatQueue.getSnapshot('sess-room-snapshot-mismatch').pending,
      ).toHaveLength(1)
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('managed_room_prompt_snapshot_mismatch'),
      )
      consoleError.mockRestore()
    })

    it('acknowledges chat.send after the daemon accepts it, before adapter.send resolves', async () => {
      const adapter = mockAdapter()
      let resolveSend: (() => void) | null = null
      adapter.send.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
      )
      mockCreateAgent.mockReturnValue(adapter)

      const sendPromise = manager.handleReq({
        type: 'req',
        id: 'r-wait',
        method: 'chat.send',
        params: { sessionId: 'sess-wait', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      await vi.waitFor(() => {
        expect(client.sendRes).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'res',
            id: 'r-wait',
            ok: true,
          }),
        )
      })

      expect(resolveSend).toBeTypeOf('function')
      resolveSend!()
      await sendPromise
      expect(client.sendRes).toHaveBeenCalledTimes(1)
    })

    it('sends error with sessionId when agent not found', async () => {
      mockCreateAgent.mockReturnValue(null)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-1', text: 'hi', agentType: 'unknown', workDir: '/tmp' },
      })

      expect(client.sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            state: 'error',
            sessionId: 'sess-1',
          }),
        }),
      )
      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: false,
          error: 'Unsupported agent: unknown',
        }),
      )
    })

    it('sends error with sessionId when adapter.start fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      adapter.start.mockRejectedValue(new Error('start failed'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-2', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[chat.send] start failed reqId=r1 sessionId=sess-2 agentType=claude workDir=/tmp',
        ),
      )
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('start failed'))
      expect(client.sendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            state: 'error',
            sessionId: 'sess-2',
            message: expect.stringContaining('start failed'),
          }),
        }),
      )
      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: false,
          error: expect.stringContaining('start failed'),
        }),
      )
    })

    it('cleans up session and emits agent error when adapter.send fails after acceptance', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      adapter.send.mockRejectedValue(new Error('send failed'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.send',
        params: { sessionId: 'sess-3', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      })

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: true,
        }),
      )
      expect(client.sendRes).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            '[chat.send] send failed reqId=r1 sessionId=sess-3 agentType=claude workDir=/tmp',
          ),
        )
      })
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('send failed'))
      await vi.waitFor(() => {
        expect(client.sendEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              state: 'error',
              sessionId: 'sess-3',
              message: expect.stringContaining('send failed'),
            }),
          }),
        )
      })
    })

    it('uses the generic retired-agent error path for historical Pi sessions', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter('pi')
      adapter.send.mockRejectedValue(new Error('HTTP 429 nian_quota_exceeded'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r-pi-quota',
        method: 'chat.send',
        params: { sessionId: 'sess-pi-quota', text: 'hi', agentType: 'pi', workDir: '/tmp' },
      })

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r-pi-quota',
          ok: true,
        }),
      )
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            '[chat.send] send failed reqId=r-pi-quota sessionId=sess-pi-quota agentType=pi workDir=/tmp',
          ),
        )
      })
      await vi.waitFor(() => {
        expect(mockSessionMessages.get('sess-pi-quota')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'agent',
              payload: 'Agent send failed: HTTP 429 nian_quota_exceeded',
            }),
          ]),
        )
      })
      expect(client.sendEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'session.message' }),
      )
    })

    it('dedupes the same req.id after the daemon has acknowledged acceptance', async () => {
      const firstAdapter = mockAdapter()
      firstAdapter.send.mockRejectedValueOnce(new Error('send failed'))
      mockCreateAgent.mockReturnValue(firstAdapter)

      const frame = {
        type: 'req' as const,
        id: 'req-retry',
        method: 'chat.send' as const,
        params: { sessionId: 'sess-retry', text: 'hi', agentType: 'claude', workDir: '/tmp' },
      }

      await manager.handleReq(frame)
      await vi.waitFor(() => {
        expect(firstAdapter.stop).toHaveBeenCalledTimes(1)
      })
      await manager.handleReq(frame)

      expect(mockCreateAgent).toHaveBeenCalledTimes(1)
      expect(firstAdapter.stop).toHaveBeenCalledTimes(1)
      expect(client.sendRes).toHaveBeenCalledTimes(2)
      expect(client.sendRes).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'res',
          id: 'req-retry',
          ok: true,
        }),
      )
    })
  })
})
