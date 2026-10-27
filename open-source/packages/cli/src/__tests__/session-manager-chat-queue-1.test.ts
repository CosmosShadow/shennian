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
  preparedManagedRoomTurn,
  importedTestDependencies,
} from './session-manager-test-harness.js'

const { CODEX_DESKTOP_SEND_UNAVAILABLE, fs } = importedTestDependencies

describe('SessionManager chat-queue-1', () => {
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
    it('disposes stale adapter state and drains after an external-owner terminal', async () => {
      let onExternalTerminal: ((sessionId: string) => void) | null = null
      const nativeFusion = {
        setExternalTerminalHandler: vi.fn((handler: ((sessionId: string) => void) | null) => {
          onExternalTerminal = handler
        }),
        registerManagedSend: vi.fn(),
        cancelManagedSend: vi.fn(),
        noteManagedSourceSession: vi.fn(),
      }
      manager = createTestSessionManager(client as never, nativeFusion as never)
      const staleAdapter = mockAdapter()
      const freshAdapter = mockAdapter()
      staleAdapter.send.mockResolvedValue({
        deliveryMode: 'external_owner_queue',
        queuedSubmissionId: 'native-queue-first',
      } as never)
      mockCreateAgent.mockReturnValueOnce(staleAdapter).mockReturnValueOnce(freshAdapter)

      await manager.handleReq({
        type: 'req',
        id: 'external-first',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-external-terminal',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-external-1',
        },
      })
      await vi.waitFor(() => expect(staleAdapter.send).toHaveBeenCalledOnce())
      await manager.handleReq({
        type: 'req',
        id: 'external-second',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-external-terminal',
          text: 'second',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-external-2',
        },
      })

      expect(freshAdapter.send).not.toHaveBeenCalled()
      expect(onExternalTerminal).not.toBeNull()
      const journal = (
        manager as unknown as {
          runJournal: { loadRecoverable(): { records: Array<Record<string, unknown>> } }
        }
      ).runJournal
      expect(journal.loadRecoverable().records[0]).toMatchObject({
        deliveryMode: 'external_owner_queue',
        externalRunId: 'codex-external-native-queue-first',
      })
      expect(manager.prepareForUpgrade('before-external-terminal').activeRunCount).toBe(1)
      manager.cancelUpgradePreparation()
      onExternalTerminal!('sess-external-terminal')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(staleAdapter.stop).toHaveBeenCalled()
      expect(freshAdapter.send).toHaveBeenCalledWith('second', undefined)
      expect(manager.prepareForUpgrade('after-external-terminal').activeRunCount).toBe(1)
    })

    it('durably ACKs before a new-session startup error and keeps the item retryable', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      adapter.start.mockRejectedValue(new Error('spawn failed'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-new',
          text: 'first message',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: true,
          payload: expect.objectContaining({ deliveryState: 'queued', queued: true }),
        }),
      )
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(/dispatch\.transient-failure.*transient_dispatch_failed/),
        )
      })
      const runtime = (
        manager as unknown as { getRuntime(): { sessions: Map<string, any> } }
      ).getRuntime()
      expect(runtime.sessions.get('sess-new')?.currentRunId ?? null).toBeNull()
    })

    it('durably queues a stopped Desktop thread before dispatch reports it unavailable', async () => {
      const adapter = mockAdapter('codex')
      adapter.prepareSend.mockRejectedValue(new Error(CODEX_DESKTOP_SEND_UNAVAILABLE))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'desktop-stopped',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-desktop-stopped',
          text: 'do not queue',
          agentType: 'codex',
          workDir: '/tmp',
          agentSessionId: 'thread-desktop-stopped',
          clientMessageId: 'user-stopped-1',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'desktop-stopped',
          ok: true,
          payload: expect.objectContaining({ deliveryState: 'queued', queued: true }),
        }),
      )
      expect(adapter.send).not.toHaveBeenCalled()
      expect(mockSessionMessages.get('sess-desktop-stopped')).toContainEqual(
        expect.objectContaining({ id: 'user-stopped-1' }),
      )
    })

    it('does not add another daemon queue item after an external Codex turn is stopped', async () => {
      const adapter = mockAdapter('codex')
      adapter.send.mockResolvedValue({
        deliveryMode: 'external_owner_queue',
        queuedSubmissionId: 'native-queue-1',
      } as never)
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'external-first',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-stopped-queue',
          text: 'first',
          agentType: 'codex',
          workDir: '/tmp',
          agentSessionId: 'thread-stopped-queue',
          clientMessageId: 'user-first',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      mockIsCodexThreadTailInterrupted.mockReturnValue(true)
      client.sendRes.mockClear()

      await manager.handleReq({
        type: 'req',
        id: 'external-second',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-stopped-queue',
          text: 'second',
          agentType: 'codex',
          workDir: '/tmp',
          agentSessionId: 'thread-stopped-queue',
          clientMessageId: 'user-second',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'external-second',
        ok: false,
        error: CODEX_DESKTOP_SEND_UNAVAILABLE,
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      expect(mockSessionMessages.get('sess-stopped-queue')).not.toContainEqual(
        expect.objectContaining({ id: 'user-second' }),
      )
    })

    it('ACKs the durable queue before a dispatch failure is committed', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      adapter.send.mockRejectedValue(new Error('send failed'))
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-new-send-fail',
          text: 'first message',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: true,
          payload: expect.objectContaining({
            clientMessageId: 'user-1',
            messageId: 'user-1',
            deliveryState: 'queued',
            bodyRevision: expect.any(Number),
          }),
        }),
      )
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[chat\.send\] send failed reqId=queue-send-user-1-.+ sessionId=sess-new-send-fail agentType=claude/,
          ),
        )
      })
      expect(mockDeliveryStates.get('sess-new-send-fail:user-1')).toBe('failed')
      expect(client.sendRes).toHaveBeenCalledTimes(1)
      expect(client.sendEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'session.message',
          payload: expect.objectContaining({ sessionId: 'sess-new-send-fail' }),
        }),
      )
    })

    it('drops a terminally failed queued turn so later messages are not blocked', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'queue-terminal-first',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-terminal',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'queue-terminal-user-1',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      adapter.emit('agentEvent', { state: 'start', runId: 'queue-terminal-run-1', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'queue-terminal-second',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-terminal',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'queue-terminal-user-2',
        },
      })
      adapter.send.mockRejectedValueOnce(new Error('queued send failed'))
      adapter.emit('agentEvent', { state: 'final', runId: 'queue-terminal-run-1', seq: 1 })

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /dispatch\.terminal-failure.*"failureClass":"terminal_dispatch_failed"/,
          ),
        )
      })
      const chatQueue = (
        manager as unknown as {
          chatQueue: { getSnapshot: (id: string) => { pending: unknown[] } }
        }
      ).chatQueue
      expect(chatQueue.getSnapshot('sess-queue-terminal').pending).toHaveLength(0)
      expect(mockDeliveryStates.get('sess-queue-terminal:queue-terminal-user-2')).toBe('failed')

      adapter.send.mockResolvedValue(undefined)
      await manager.handleReq({
        type: 'req',
        id: 'queue-terminal-third',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-terminal',
          text: 'third',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'queue-terminal-user-3',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenLastCalledWith('third', undefined))
    })

    it('prunes stale terminal queue records before dispatching the next queued turn', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'queue-prune-first',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-prune',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'queue-prune-user-1',
        },
      })
      adapter.emit('agentEvent', { state: 'start', runId: 'queue-prune-run-1', seq: 0 })
      for (const [id, text] of [
        ['queue-prune-user-2', 'stale failed'],
        ['queue-prune-user-3', 'fresh queued'],
      ]) {
        await manager.handleReq({
          type: 'req',
          id: `enqueue-${id}`,
          method: 'chat.enqueue',
          params: {
            sessionId: 'sess-queue-prune',
            text,
            agentType: 'claude',
            workDir: '/tmp',
            clientMessageId: id,
          },
        })
      }
      mockDeliveryStates.set('sess-queue-prune:queue-prune-user-2', 'failed')

      adapter.emit('agentEvent', { state: 'final', runId: 'queue-prune-run-1', seq: 1 })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(2))

      expect(adapter.send).toHaveBeenLastCalledWith('fresh queued', undefined)
      expect(adapter.send.mock.calls[1]?.[0] as string).not.toContain('stale failed')
    })

    it('keeps a timed trigger private and deduplicates it through the existing durable queue', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)
      const prepared = { ...preparedManagedRoomTurn('scheduled work'), effectiveModelId: 'provider/deepseek-flash' }
      const prepareDirect = vi.fn(async () => prepared)
      manager.setManagedAgentDirectTurnPreparer(prepareDirect)
      const queue = manager.getScheduleQueue()
      queue.validateScheduledTarget = vi.fn(async () => 'ready')
      const request = {
        type: 'req' as const,
        id: 'schedule-request',
        method: 'chat.enqueue' as const,
        params: {
          sessionId: 'timed-session',
          text: 'Report yesterday',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'schedule:task:1:100',
          scheduledTask: { id: 'task', bindingId: 'binding', roomId: 'room' },
        },
      }
      await expect(queue.handleEnqueue(request)).rejects.toThrow('schedule_source_untrusted')
      await queue.enqueueScheduled(request)
      await queue.enqueueScheduled(request)
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      // Two preflights (the duplicate enqueue is idempotent), then a fresh
      // permission grant at dispatch time.
      expect(prepareDirect).toHaveBeenCalledTimes(3)
      expect(prepareDirect).toHaveBeenCalledWith('timed-session', {
        allowedRoomActions: ['send'],
        propagateWorkerRoomOrigin: false,
        scheduledTask: true,
      })
      expect(queue.validateScheduledTarget).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'timed-session', bindingId: 'binding' }),
      )
      expect(adapter.send).toHaveBeenCalledWith(
        'Report yesterday',
        'provider/deepseek-flash',
        undefined,
        undefined,
        'scheduled work',
        { source: 'room_activation' },
      )
      expect(adapter.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          managedRoomContextToken: prepared.managedRoomContextToken,
        }),
      )
      expect(mockSessionMessages.get('timed-session')).toContainEqual(
        expect.objectContaining({ id: 'schedule:task:1:100', role: 'agent', payload: '' }),
      )
    })

    it('acknowledges idle chat.enqueue after durable commit without waiting for Provider send', async () => {
      const adapter = mockAdapter()
      let resolveSend: (() => void) | null = null
      adapter.send.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSend = resolve
        }),
      )
      mockCreateAgent.mockReturnValue(adapter)

      const enqueuePromise = manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-new-wait',
          text: 'first message',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'r1',
          ok: true,
          payload: expect.objectContaining({ deliveryState: 'queued', queued: true }),
        }),
      )

      expect(resolveSend).toBeTypeOf('function')
      resolveSend!()
      await enqueuePromise

      expect(client.sendRes).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'res',
          id: 'r1',
          ok: true,
        }),
      )
    })

    it('queues messages while a session is running and drains after final', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-q',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })

      await vi.waitFor(() => {
        expect(adapter.send).toHaveBeenCalledTimes(1)
      })
      expect(adapter.send).toHaveBeenCalledWith('first', undefined)

      adapter.emit('agentEvent', { state: 'start', runId: 'run1', seq: 0 })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-q',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-2',
          modelId: 'sonnet',
          reasoningEffort: 'high',
        },
      })

      expect(client.sendRes).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'r2',
          ok: true,
          payload: expect.objectContaining({ queued: true, queueMessageId: 'user-2' }),
        }),
      )

      adapter.emit('agentEvent', { state: 'final', runId: 'run1', seq: 1 })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(adapter.send).toHaveBeenCalledTimes(2)
      expect(adapter.send).toHaveBeenNthCalledWith(2, 'second', 'sonnet', 'high')
      expect(
        (mockSessionMessages.get('sess-q') ?? []).filter((message) => message.id === 'user-2'),
      ).toHaveLength(1)
      expect(mockDeliveryStates.get('sess-q:user-2')).toBe('executing')
    })

    it('does not ACK or create canonical state when the durable queue write fails', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)
      await manager.handleReq({
        type: 'req',
        id: 'r1',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-disk-failure',
          text: 'first',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-1',
        },
      })
      await vi.waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1))
      adapter.emit('agentEvent', { state: 'start', runId: 'run-disk-failure', seq: 0 })
      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
        throw new Error('queue disk full')
      })

      await manager.handleReq({
        type: 'req',
        id: 'r2',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-queue-disk-failure',
          text: 'second',
          agentType: 'claude',
          workDir: '/tmp',
          clientMessageId: 'user-disk-failure',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'r2',
        ok: false,
        error: 'queue disk full',
      })

      await manager.handleReq({
        type: 'req',
        id: 'status-disk-failure',
        method: 'session.message.status',
        params: {
          sessionId: 'sess-queue-disk-failure',
          clientMessageId: 'user-disk-failure',
        },
      })
      expect(client.sendRes).toHaveBeenLastCalledWith({
        type: 'res',
        id: 'status-disk-failure',
        ok: true,
        payload: {
          state: 'not_found',
          sessionId: 'sess-queue-disk-failure',
          clientMessageId: 'user-disk-failure',
        },
      })
      expect(
        (
          manager as unknown as {
            chatQueue: {
              getSnapshot: (id: string) => {
                pending: unknown[]
              }
            }
          }
        ).chatQueue.getSnapshot('sess-queue-disk-failure').pending,
      ).toHaveLength(0)
    })

    it('ignores retired external-channel metadata when enqueue starts a session', async () => {
      const adapter = mockAdapter()
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r-external-reply-target',
        method: 'chat.enqueue',
        params: {
          sessionId: 'sess-external-reply-target',
          text: 'external message',
          agentType: 'codex',
          workDir: '/tmp',
          replyTarget: 'rt_from_enqueue',
          externalChannel: {
            configured: true,
            connected: true,
            type: 'wechat-rpa',
            name: '个人微信',
          },
        },
      })

      expect(adapter.configure).toHaveBeenCalledWith({
        sessionId: 'sess-external-reply-target',
        externalChannel: null,
        env: {},
        managedRoomContextToken: null,
        managedRoomExecutor: null,
      })
    })

    it('does not inject the daemon Room executor into a private Codex session', async () => {
      const adapter = mockAdapter()
      const execute = vi.fn(async () => ({}))
      manager = createTestSessionManager(client as never, undefined, undefined, execute)
      mockCreateAgent.mockReturnValue(adapter)

      await manager.handleReq({
        type: 'req',
        id: 'r-private-codex',
        method: 'chat.send',
        params: {
          sessionId: 'sess-private-codex',
          text: 'private worker task',
          agentType: 'codex',
          workDir: '/tmp',
          waitForDispatch: true,
        },
      })

      expect(adapter.configure).toHaveBeenCalledWith(
        expect.objectContaining({
          managedRoomContextToken: null,
          managedRoomExecutor: null,
        }),
      )
    })
  })
})
