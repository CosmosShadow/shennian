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

const { sessionStore } = importedTestDependencies

describe('SessionManager chat-queue-2', () => {
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
    it('keeps synchronous adapter start state so later enqueue drains instead of bypassing queue', async () => {
      const adapter = mockAdapter()
      adapter.send.mockImplementationOnce(async () => {
        adapter.emit('agentEvent', {
          state: 'start',
          runId: 'run-sync',
          seq: 0,
        } satisfies AgentEvent)
      })
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-sync-start',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-sync-start',
          text: 'second',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r2',
          ok: true,
          payload: expect.objectContaining({ queued: true, queueMessageId: 'user-2' }),
        }),
      )

      const dispatchAfter = Date.now() + 60_000
      const dispatchClock = vi.spyOn(Date, 'now').mockReturnValue(dispatchAfter)
      let observedDispatchTs: number | undefined
      adapter.send.mockImplementationOnce(async () => {
        observedDispatchTs = mockSessionMessages
          .get('sess-sync-start')
          ?.find((message) => message.id === 'user-2')?.ts
      })
      adapter.emit('agentEvent', { state: 'final', runId: 'run-sync', seq: 1 } satisfies AgentEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
      await vi.waitFor(() =>
        expect(
          mockSessionMessages.get('sess-sync-start')?.find((message) => message.id === 'user-2')
            ?.ts,
        ).toBeGreaterThanOrEqual(dispatchAfter),
      )
      expect(observedDispatchTs).toBeGreaterThanOrEqual(dispatchAfter)
      dispatchClock.mockRestore()
    })

    it('queues behind the provisional dispatch marker before adapter status synchronizes', async () => {
      const adapter = mockAdapter('pi')
      let adapterActive = true
      const getStatus = vi.fn(async () => ({
        active: adapterActive,
        runId: adapterActive ? 'run-status-active' : null,
        runPhase: null,
        canStop: adapterActive,
      }))
      Object.assign(adapter, { getStatus })
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-status-busy',
          text: 'first',
          agentType: 'pi',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-status-busy',
          text: 'second',
          agentType: 'pi',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })

      expect(getStatus).not.toHaveBeenCalled()
      expect(adapter.send).toHaveBeenCalledTimes(1)
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r2',
          ok: true,
          payload: expect.objectContaining({ queued: true, queueMessageId: 'user-2' }),
        }),
      )

      adapterActive = false
      adapter.emit('agentEvent', {
        state: 'start',
        runId: 'run-status-active',
        seq: 0,
      } satisfies AgentEvent)
      adapter.emit('agentEvent', {
        state: 'final',
        runId: 'run-status-active',
        seq: 1,
      } satisfies AgentEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
    })

    it('drains an existing idle queue when another message is enqueued', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-idle-queue',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      adapter.emit('agentEvent', {
        state: 'start',
        runId: 'run-idle-stale',
        seq: 0,
      } satisfies AgentEvent)

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-idle-queue',
          text: 'stale queued',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })
      expect(adapter.send).toHaveBeenCalledTimes(1)

      // Simulate a stale daemon state: no active run remains, but queue file
      // still has pending work (e.g. after an adapter crash/restart).
      adapter.emit('agentEvent', {
        state: 'error',
        runId: 'run-idle-stale',
        seq: 1,
        message: 'failed',
      } satisfies AgentEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(adapter.send).toHaveBeenCalledTimes(2)
      adapter.emit('agentEvent', {
        state: 'start',
        runId: 'run-drained-stale',
        seq: 2,
      } satisfies AgentEvent)

      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-idle-queue',
          text: 'new queued',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-3',
        },
      })
      adapter.emit('agentEvent', {
        state: 'error',
        runId: 'run-drained-stale',
        seq: 3,
        message: 'failed again',
      } satisfies AgentEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(3)
      expect(adapter.send).toHaveBeenNthCalledWith(3, 'new queued', undefined)
    })

    it('drains queued messages after a synthetic abort', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-abort-drain',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      adapter.emit('agentEvent', {
        state: 'start',
        runId: 'run-abort',
        seq: 0,
      } satisfies AgentEvent)
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-abort-drain',
          text: 'second',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })

      await manager.handleReq({
        type: 'req',
        id: 'abort-1',
        method: 'chat.abort',
        params: { sessionId: 'sess-abort-drain' },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.stop).toHaveBeenCalled()
      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
    })

    it('recovers persisted owner messages as separate turns after daemon restart', async () => {
      const adapterBeforeRestart = mockAdapter()
      mockCreateAgent.mockReturnValueOnce(adapterBeforeRestart)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-restart-drain',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      adapterBeforeRestart.emit('agentEvent', {
        state: 'start',
        runId: 'run-before-restart',
        seq: 0,
      } satisfies AgentEvent)
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-restart-drain',
          text: 'persisted queued',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-restart-drain',
          text: 'persisted queued second',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-3',
        },
      })
      expect(adapterBeforeRestart.send).toHaveBeenCalledTimes(1)

      await manager.handleReq({
        type: 'req',
        id: 'status-before-restart',
        method: 'session.message.status',
        params: {
          sessionId: 'sess-restart-drain',
          clientMessageId: 'user-2',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'status-before-restart',
          ok: true,
          payload: expect.objectContaining({
            state: 'queued',
            clientMessageId: 'user-2',
          }),
        }),
      )

      // Simulate a lost enqueue ACK: replaying the same stable identity must
      // resolve the durable row and must not append another queue/canonical item.
      await manager.handleReq({
        type: 'req',
        id: 'r2-replayed-after-lost-ack',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-restart-drain',
          text: 'persisted queued',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-2',
        },
      })
      expect(
        (mockSessionMessages.get('sess-restart-drain') ?? []).filter(
          (message) => message.id === 'user-2',
        ),
      ).toHaveLength(1)
      expect(
        (
          manager as unknown as {
            chatQueue: {
              getSnapshot: (id: string) => {
                pending: Array<{ clientMessageId?: string | null }>
              }
            }
          }
        ).chatQueue
          .getSnapshot('sess-restart-drain')
          .pending.map((message) => message.clientMessageId),
      ).toEqual(['user-2', 'user-3'])

      const adapterAfterRestart = mockAdapter()
      mockCreateAgent.mockReturnValueOnce(adapterAfterRestart)
      const restarted = createTestSessionManager(client as never)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(restarted).toBeTruthy()
      expect(adapterAfterRestart.send).toHaveBeenCalledTimes(1)
      expect(adapterAfterRestart.send).toHaveBeenCalledWith('persisted queued', undefined)

      adapterAfterRestart.emit('agentEvent', {
        state: 'start',
        runId: 'run-after-restart-first',
        seq: 0,
      } satisfies AgentEvent)
      adapterAfterRestart.emit('agentEvent', {
        state: 'final',
        runId: 'run-after-restart-first',
        seq: 1,
      } satisfies AgentEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapterAfterRestart.send).toHaveBeenCalledTimes(2)
      expect(adapterAfterRestart.send).toHaveBeenNthCalledWith(
        2,
        'persisted queued second',
        undefined,
      )
      expect(
        (mockSessionMessages.get('sess-restart-drain') ?? []).filter(
          (message) => message.id === 'user-2',
        ),
      ).toHaveLength(1)
      expect(
        (mockSessionMessages.get('sess-restart-drain') ?? []).filter(
          (message) => message.id === 'user-3',
        ),
      ).toHaveLength(1)
    })

    it('batches compatible retired external-origin entries while preserving durable messages', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: { sessionId: 'sess-ext-q', text: 'first', agentType: 'claude', workDir: '/tmp' },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'run1', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-ext-q',
          text: '外部消息 / A\n第一条',
          agentType: 'claude',
          workDir: '/tmp',
          origin: 'external',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-ext-q',
          text: '外部消息 / B\n第二条',
          agentType: 'claude',
          workDir: '/tmp',
          origin: 'external',
        },
      })

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(
        2,
        '[连续用户消息]\n<消息 1>\n外部消息 / A\n第一条\n\n<消息 2>\n外部消息 / B\n第二条',
        undefined,
      )
      expect(
        (mockSessionMessages.get('sess-ext-q') ?? []).filter((message) => message.role === 'user'),
      ).toHaveLength(3)
    })

    it('keeps incompatible model configurations in separate queue turns', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-model-boundary',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'run1', seq: 0 })
      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-model-boundary',
          text: 'use model A',
          agentType: 'codex',
          workDir: '/tmp',
          modelId: 'model-a',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-model-boundary',
          text: 'use model B',
          agentType: 'codex',
          workDir: '/tmp',
          modelId: 'model-b',
        },
      })

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'use model A', 'model-a')

      adapter.emit('agentEvent', { state: 'start', runId: 'run2', seq: 0 })
      adapter.emit('agentEvent', { state: 'final', runId: 'run2', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(adapter.send).toHaveBeenCalledTimes(3)
      expect(adapter.send).toHaveBeenNthCalledWith(3, 'use model B', 'model-b')
    })

    it('deduplicates queued external messages by stable message id before draining', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-ext-dedupe',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'run-ext-dedupe', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-ext-dedupe',
          text: '外部对话: ABC\n李辰: 现在是几点了？',
          agentType: 'claude',
          workDir: '/tmp',
          origin: 'external',
          queueMessageId: 'wechat-message:duplicate-time',
          clientMessageId: 'wechat-message:duplicate-time',
        },
      })
      await manager.handleReq({
        type: 'req',
        id: 'r3',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-ext-dedupe',
          text: '外部对话: ABC\n李辰: 现在是几点了？',
          agentType: 'claude',
          workDir: '/tmp',
          origin: 'external',
          queueMessageId: 'wechat-message:duplicate-time',
          clientMessageId: 'wechat-message:duplicate-time',
        },
      })

      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r3',
          ok: true,
          payload: expect.objectContaining({
            queued: true,
            queueMessageId: 'wechat-message:duplicate-time',
          }),
        }),
      )

      adapter.emit('agentEvent', { state: 'final', runId: 'run-ext-dedupe', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(
        2,
        '外部对话: ABC\n李辰: 现在是几点了？',
        undefined,
      )
    })

    it('heals a queue-first partial commit when the same client ID is retried', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-partial-commit',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      adapter.emit('agentEvent', { state: 'start', runId: 'run-partial', seq: 0 })

      vi.mocked(sessionStore.appendMessage).mockImplementationOnce(() => {
        throw new Error('canonical disk full')
      })
      const retryFrame = {
        type: 'req' as const,
        method: 'chat.enqueue' as const,
        params: {
          sessionId: 'sess-partial-commit',
          text: 'second',
          agentType: 'claude' as const,
          workDir: '/tmp',
          clientMessageId: 'user-stable',
          queueMessageId: 'user-stable',
        },
      }
      await manager.handleReq({ ...retryFrame, id: 'r2' })
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r2',
          ok: false,
          error: 'canonical disk full',
        }),
      )

      await manager.handleReq({ ...retryFrame, id: 'r3' })
      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r3',
          ok: true,
          payload: expect.objectContaining({
            clientMessageId: 'user-stable',
            deliveryState: 'queued',
            queueMessageId: 'user-stable',
            queue: expect.objectContaining({
              pending: expect.arrayContaining([
                expect.objectContaining({ clientMessageId: 'user-stable' }),
              ]),
            }),
          }),
        }),
      )

      adapter.emit('agentEvent', { state: 'final', runId: 'run-partial', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', undefined)
    })
  })
})
