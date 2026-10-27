// @arch open-source/docs/shared-runtime.md
// @covers open-source/packages/shared/src/sync-engine.ts

import type { Machine, NianProject, NianSession } from '@shennian/wire'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientIndexStore, LocalSessionDeletion } from '../storage'
import { SyncEngine } from '../sync-engine'

function createMockStore(): ClientIndexStore {
  const sessions = new Map<string, NianSession>()
  const deletions = new Map<string, LocalSessionDeletion>()
  let machines: Machine[] = []
  let projects: NianProject[] = []
  let syncCacheVersion: string | null = null
  let sessionBackfillComplete = false
  let sessionBackfillCursor = 0

  return {
    getSessions: vi.fn(async () =>
      [...sessions.values()].filter((session) => !deletions.has(session.id)),
    ),
    getSession: vi.fn(async (id: string) => sessions.get(id)),
    putSession: vi.fn(async (s: NianSession) => {
      sessions.set(s.id, s)
    }),
    putSessions: vi.fn(async (ss: NianSession[]) => {
      for (const s of ss) sessions.set(s.id, s)
    }),
    deleteSession: vi.fn(async (sessionId: string) => {
      sessions.delete(sessionId)
    }),
    getSessionDeletion: vi.fn(async (sessionId: string) => deletions.get(sessionId)),
    getPendingSessionDeletions: vi.fn(async () =>
      [...deletions.values()].filter((deletion) => deletion.state === 'pending'),
    ),
    putSessionDeletion: vi.fn(async (deletion: LocalSessionDeletion) => {
      deletions.set(deletion.sessionId, deletion)
    }),
    removeSessionDeletion: vi.fn(async (sessionId: string) => {
      deletions.delete(sessionId)
    }),
    getSessionSyncCursor: vi.fn(async () => 0),
    setSessionSyncCursor: vi.fn(async () => {}),
    getSessionBackfillComplete: vi.fn(async () => sessionBackfillComplete),
    setSessionBackfillComplete: vi.fn(async (complete: boolean) => {
      sessionBackfillComplete = complete
    }),
    getSessionBackfillCursor: vi.fn(async () => sessionBackfillCursor),
    setSessionBackfillCursor: vi.fn(async (cursor: number) => {
      sessionBackfillCursor = cursor
    }),
    getSyncCacheVersion: vi.fn(async () => syncCacheVersion),
    setSyncCacheVersion: vi.fn(async (version: string) => {
      syncCacheVersion = version
    }),
    resetPersonalData: vi.fn(async () => {
      sessions.clear()
      deletions.clear()
      projects = []
      syncCacheVersion = null
      sessionBackfillComplete = false
      sessionBackfillCursor = 0
    }),
    getProjects: vi.fn(async () => projects),
    putProjects: vi.fn(async (incoming: NianProject[]) => {
      projects = incoming
    }),
    getMachines: vi.fn(async () => machines),
    putMachines: vi.fn(async (incoming: Machine[]) => {
      machines = incoming
    }),
    updateMachineStatus: vi.fn(async () => {}),
    updateMachineAgents: vi.fn(async () => {}),
    clearAll: vi.fn(async () => {
      sessions.clear()
      deletions.clear()
      syncCacheVersion = null
      sessionBackfillComplete = false
      sessionBackfillCursor = 0
    }),
  }
}

function createMockApi() {
  return vi.fn(async () => ({})) as unknown as <T>(path: string, opts?: RequestInit) => Promise<T>
}

function createMockNotifier() {
  return {
    onSessionsChange: vi.fn(),
    onSessionUpdate: vi.fn(),
    onSessionIndexTargetChange: vi.fn(),
    onSessionDelete: vi.fn(),
    onMachinesChange: vi.fn(),
    onMachinesRemoteResolved: vi.fn(),
    onMachineRemoved: vi.fn(),
    onProjectsChange: vi.fn(),
    onMachineStatus: vi.fn(),
    onMachineAgentList: vi.fn(),
    onMachineAgents: vi.fn(),
    onUpgradeEvent: vi.fn(),
    onSyncStart: vi.fn(),
    onSyncEnd: vi.fn(),
  }
}

describe('SyncEngine', () => {
  let store: ClientIndexStore
  let api: ReturnType<typeof createMockApi>
  let notifier: ReturnType<typeof createMockNotifier>
  let engine: SyncEngine

  beforeEach(() => {
    store = createMockStore()
    api = createMockApi()
    notifier = createMockNotifier()
    engine = new SyncEngine({ store, api, onChange: notifier })
  })

  describe('personal body hard cut', () => {
    it('uses batch projection reads and one durable write for a remote page', async () => {
      const now = '2026-09-09T00:00:00.000Z'
      const incoming: NianSession[] = Array.from({ length: 100 }, (_, index) => ({
        id: `batch-${index}`, machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, sourceMode: null, modelId: null, title: `Session ${index}`,
        status: 'active', workDir: '/repo', lastMessagePreview: null,
        lastActivityAt: now, deletedAt: null, createdAt: now, updatedAt: now,
      }))
      store.getSessionSyncTargets = vi.fn(async () => [])
      store.getSessionDeletionBatch = vi.fn(async () => [])
      vi.mocked(api).mockResolvedValue({ sessions: incoming })

      await engine.loadMoreSessions({ limit: 100 })

      // One lookup computes the page cursor and one bulk lookup merges the page;
      // the count stays constant instead of growing with 100 rows.
      expect(store.getSessionSyncTargets).toHaveBeenCalledTimes(2)
      expect(store.getSessionDeletionBatch).toHaveBeenCalledWith(incoming.map((session) => session.id))
      expect(store.getSessionDeletion).not.toHaveBeenCalled()
      expect(store.getSessionSyncTarget).toBeUndefined()
      expect(store.putSession).not.toHaveBeenCalled()
      expect(store.putSessions).toHaveBeenCalledOnce()
      const persisted = vi.mocked(store.putSessions).mock.calls[0]?.[0] ?? []
      expect(persisted).toHaveLength(100)
      expect(persisted.map((session) => session.id)).toEqual(incoming.map((session) => session.id))
      expect(notifier.onSessionIndexTargetChange).toHaveBeenCalledOnce()
    })

    it('does not expose legacy body sync methods and ignores session.message events', async () => {
      expect(engine).not.toHaveProperty('persistMessage')
      expect(engine).not.toHaveProperty('pushToServer')
      expect(engine).not.toHaveProperty('fetchHistory')
      expect(engine).not.toHaveProperty('fetchOlderHistory')

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.message',
        payload: {
          sessionId: 's1',
          message: { id: 'legacy', sessionId: 's1', role: 'agent', ts: 1, payload: 'legacy' },
        },
      })
      await engine.flushPendingWork()

      expect(store).not.toHaveProperty('saveMessage')
      expect(store).not.toHaveProperty('saveMessages')
      expect(store).not.toHaveProperty('getMessages')
    })

    it('never requests legacy body endpoints during boot or reconnect', async () => {
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        if (path.startsWith('/sessions')) return { sessions: [] }
        if (path.startsWith('/projects')) return { projects: [] }
        return {}
      })

      await engine.boot()
      await engine.onReconnect()
      await engine.flushPendingWork()

      const requestedPaths = vi.mocked(api).mock.calls.map(([path]) => path)
      expect(requestedPaths.some((path) => path.startsWith('/messages/since'))).toBe(false)
      expect(requestedPaths.some((path) => /\/sessions\/[^/]+\/messages/.test(path))).toBe(false)
      expect(requestedPaths.some((path) => /\/sessions\/[^/]+\/history/.test(path))).toBe(false)
    })

    it('coalesces reconnect recovery with an in-flight boot sync', async () => {
      let releaseMachines: ((value: { machines: Machine[] }) => void) | undefined
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/machines') {
          return new Promise<{ machines: Machine[] }>((resolve) => {
            releaseMachines = resolve
          })
        }
        return {}
      })

      const boot = engine.boot()
      await vi.waitFor(() => {
        expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/machines')).toHaveLength(1)
      })
      const reconnect = engine.onReconnect()
      await Promise.resolve()

      expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/machines')).toHaveLength(1)
      releaseMachines?.({ machines: [] })
      await Promise.all([boot, reconnect])
    })

    it('coalesces a reconnect storm into one complete recovery round', async () => {
      let releaseMachines: ((value: { machines: Machine[] }) => void) | undefined
      vi.mocked(store.getSessionSyncCursor).mockResolvedValue(1)
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/machines') {
          return new Promise<{ machines: Machine[] }>((resolve) => {
            releaseMachines = resolve
          })
        }
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path.startsWith('/sessions?limit=')) return { sessions: [] }
        if (path === '/sessions/activities') return { activities: [] }
        if (path === '/projects') return { projects: [] }
        return {}
      })

      const reconnects = Array.from({ length: 25 }, () => engine.onReconnect())
      await vi.waitFor(() => {
        expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/machines')).toHaveLength(1)
      })
      releaseMachines?.({ machines: [] })
      await Promise.all(reconnects)

      expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/machines')).toHaveLength(1)
      expect(vi.mocked(api).mock.calls.filter(([path]) => path.startsWith('/sessions?updatedAfter=')))
        .toHaveLength(1)
      expect(notifier.onSyncStart).toHaveBeenCalledOnce()
      expect(notifier.onSyncEnd).toHaveBeenCalledOnce()
    })
  })


  describe('persistSession', () => {
    it('persists a failed read acknowledgement and retries it idempotently after reconnect', async () => {
      const existing: NianSession = {
        id: 's-read-pending', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, title: 'Pending read', status: 'completed', workDir: '',
        bodyRevision: 4, visibleMessageCount: 3, lastVisibleMessageId: 'm3',
        attentionCount: 2, lastAttentionId: 'a2',
        lastActivityAt: '2026-09-02T10:00:00.000Z',
        createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
      }
      await store.putSession(existing)
      vi.mocked(api).mockRejectedValueOnce(new Error('network unavailable'))

      await expect(engine.markSessionRead('s-read-pending', '2026-09-02T10:01:00.000Z', {
        bodyRevision: 4,
        visibleMessageCount: 3,
        lastVisibleMessageId: 'm3',
        attentionCount: 2,
        lastAttentionId: 'a2',
      })).rejects.toThrow('network unavailable')
      expect((await store.getSession('s-read-pending'))?.userState).toMatchObject({
        manualUnread: false,
        readSyncPending: true,
        lastReadAttentionCount: 2,
      })

      vi.mocked(api).mockResolvedValue({})
      await engine.retryPendingReadStates()

      expect((await store.getSession('s-read-pending'))?.userState?.readSyncPending).toBe(false)
      expect(vi.mocked(api)).toHaveBeenLastCalledWith(
        '/sessions/s-read-pending/user-state',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    it('does not clear a newer pending watermark when an older acknowledgement arrives late', async () => {
      const existing: NianSession = {
        id: 's-read-race', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, title: 'Read race', status: 'completed', workDir: '',
        bodyRevision: 5, visibleMessageCount: 5, lastVisibleMessageId: 'm5',
        lastActivityAt: '2026-09-02T10:00:00.000Z',
        createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
      }
      await store.putSession(existing)

      let acknowledgeOlder: (() => void) | undefined
      vi.mocked(api)
        .mockImplementationOnce(() => new Promise((resolve) => {
          acknowledgeOlder = () => resolve({})
        }) as never)
        .mockRejectedValueOnce(new Error('newer acknowledgement failed'))

      const older = engine.markSessionRead('s-read-race', '2026-09-02T10:01:00.000Z', {
        bodyRevision: 4,
        visibleMessageCount: 4,
        lastVisibleMessageId: 'm4',
      })
      await vi.waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(1))
      const newer = engine.markSessionRead('s-read-race', '2026-09-02T10:02:00.000Z', {
        bodyRevision: 5,
        visibleMessageCount: 5,
        lastVisibleMessageId: 'm5',
      })
      await expect(newer).rejects.toThrow('newer acknowledgement failed')
      acknowledgeOlder?.()
      await older

      expect((await store.getSession('s-read-race'))?.userState).toMatchObject({
        lastReadAt: '2026-09-02T10:02:00.000Z',
        lastReadBodyRevision: 5,
        readSyncPending: true,
      })
    })

    it('sends the painted read watermark without regressing a newer local device watermark', async () => {
      const existing: NianSession = {
        id: 's-read', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, title: 'Read watermark', status: 'completed', workDir: '',
        lastActivityAt: '2026-09-02T10:00:00.000Z',
        createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
        userState: {
          userId: 'u1', sessionId: 's-read', lastReadAt: '2026-09-02T10:00:00.000Z',
          lastReadBodyRevision: 10, lastReadVisibleMessageCount: 9,
          lastReadVisibleMessageId: 'm9', lastReadAttentionCount: 2,
          lastReadAttentionId: 'a2', manualUnread: false,
          updatedAt: '2026-09-02T10:00:00.000Z',
        },
      }
      await store.putSession(existing)

      await engine.markSessionRead('s-read', '2026-09-02T09:59:00.000Z', {
        bodyRevision: 8,
        visibleMessageCount: 7,
        lastVisibleMessageId: 'm7',
        attentionCount: 1,
        lastAttentionId: 'a1',
      })

      expect((await store.getSession('s-read'))?.userState).toMatchObject({
        lastReadBodyRevision: 10,
        lastReadVisibleMessageCount: 9,
        lastReadVisibleMessageId: 'm9',
        lastReadAttentionCount: 2,
        lastReadAttentionId: 'a2',
      })
      const [, request] = vi.mocked(api).mock.calls.at(-1)!
      expect(JSON.parse(String(request?.body))).toMatchObject({
        lastReadAt: '2026-09-02T09:59:00.000Z',
        readWatermark: {
          bodyRevision: 8,
          visibleMessageCount: 7,
          lastVisibleMessageId: 'm7',
          attentionCount: 1,
          lastAttentionId: 'a1',
        },
      })
    })

    it('preserves a newer read watermark when persisting an older session snapshot', async () => {
      const existing: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Test',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T02:14:00.000Z',
        createdAt: '2026-04-07T02:00:00.000Z',
        updatedAt: '2026-04-07T02:14:00.000Z',
        userState: {
          userId: 'u1',
          sessionId: 's1',
          pinnedAt: null,
          lastReadAt: '2026-04-07T02:20:00.000Z',
          manualUnread: false,
          updatedAt: '2026-04-07T02:20:00.000Z',
        },
      }
      await store.putSession(existing)

      await engine.persistSession({
        ...existing,
        userState: {
          ...existing.userState!,
          lastReadAt: '2026-04-07T02:18:00.000Z',
          updatedAt: '2026-04-07T02:18:00.000Z',
        },
      })

      const stored = await store.getSession('s1')
      expect(stored?.userState?.lastReadAt).toBe('2026-04-07T02:20:00.000Z')
    })

    it('preserves live activity when persisting a local projection update', async () => {
      const existing: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Test',
        status: 'active',
        workDir: '',
        lastMessagePreview: '旧摘要',
        lastMessagePreviewMessageId: 'message-old',
        lastMessagePreviewAt: '2026-04-07T02:14:00.000Z',
        lastActivityAt: '2026-04-07T02:14:00.000Z',
        createdAt: '2026-04-07T02:00:00.000Z',
        updatedAt: '2026-04-07T02:14:00.000Z',
        userState: null,
        activity: {
          sessionId: 's1',
          runId: 'run-1',
          runPhase: 'tool_running',
          startedAt: '2026-04-07T02:13:00.000Z',
          updatedAt: '2026-04-07T02:14:30.000Z',
        },
      }
      await store.putSession(existing)

      await engine.persistSession({
        ...existing,
        lastMessagePreview: '新摘要',
        lastMessagePreviewMessageId: 'message-new',
        lastMessagePreviewAt: '2026-04-07T02:15:00.000Z',
        lastActivityAt: '2026-04-07T02:15:00.000Z',
        activity: null,
      })

      const stored = await store.getSession('s1')
      expect(stored?.lastMessagePreview).toBe('新摘要')
      expect(stored?.activity).toEqual(existing.activity)
    })
  })


  describe('handleRelayEvent', () => {
    it('handles session.update event', async () => {
      const session: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Test',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T02:14:00.000Z',
        createdAt: '',
        updatedAt: '',
      }
      await store.putSession(session)

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { id: 's1', title: 'Renamed' } },
      })

      await vi.waitFor(() => {
        expect(store.putSession).toHaveBeenCalledTimes(2)
      })

      expect(store.putSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ...session,
          title: 'Renamed',
          deletedAt: null,
          userState: null,
          activity: null,
        }),
      )
      expect(notifier.onSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ...session,
          title: 'Renamed',
          deletedAt: null,
          userState: null,
          activity: null,
        }),
      )
    })

    it('ignores a replayed identical session update after the first durable write', async () => {
      const session: NianSession = {
        id: 's-replay', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, title: 'Before', status: 'active', workDir: '/repo',
        lastActivityAt: '2026-09-09T00:00:00.000Z',
        createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
        indexRevision: 1,
      }
      await store.putSession(session)
      vi.mocked(store.putSession).mockClear()
      const event = {
        type: 'event' as const,
        event: 'session.update' as const,
        payload: { session: { id: session.id, title: 'After', indexRevision: 2 } },
      }

      engine.handleRelayEvent(event)
      engine.handleRelayEvent(event)
      await vi.waitFor(() => expect(notifier.onSessionUpdate).toHaveBeenCalledOnce())
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect(store.putSession).toHaveBeenCalledOnce()
      expect(notifier.onSessionIndexTargetChange).toHaveBeenCalledOnce()
      expect(notifier.onSessionIndexTargetChange).toHaveBeenCalledWith(session.id)
      expect(await store.getSession(session.id)).toMatchObject({ title: 'After', indexRevision: 2 })
    })

    it('does not let an older index revision overwrite a newer local projection', async () => {
      const existing: NianSession = {
        id: 's-index-order',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: 'native-1',
        title: 'Newest native title',
        status: 'completed',
        workDir: '/new',
        lastMessagePreview: 'new preview',
        lastActivityAt: '2026-09-02T08:00:00.000Z',
        createdAt: '2026-09-02T07:00:00.000Z',
        updatedAt: '2026-09-02T08:00:00.000Z',
        indexRevision: 5,
        userState: {
          userId: 'u1', sessionId: 's-index-order', lastReadAt: null,
          updatedAt: '2026-09-02T08:00:00.000Z',
        },
      }
      await store.putSession(existing)

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: {
          session: {
            ...existing,
            title: 'Delayed old title',
            status: 'active',
            workDir: '/old',
            lastMessagePreview: 'old preview',
            indexRevision: 4,
            userState: {
              ...existing.userState!,
              lastReadAt: '2026-09-02T08:01:00.000Z',
              updatedAt: '2026-09-02T08:01:00.000Z',
            },
          },
        },
      })

      await vi.waitFor(async () => {
        expect((await store.getSession(existing.id))?.userState?.lastReadAt)
          .toBe('2026-09-02T08:01:00.000Z')
      })
      expect(await store.getSession(existing.id)).toMatchObject({
        title: 'Newest native title',
        status: 'completed',
        workDir: '/new',
        lastMessagePreview: 'new preview',
        indexRevision: 5,
      })
    })


    it('handles machine.status event', () => {
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true },
      })

      expect(store.updateMachineStatus).toHaveBeenCalledWith('m1', true, {
        autoUpgrade: undefined,
        cliVersion: undefined,
        daemonInstallationId: undefined,
        region: undefined,
        sessionSyncCapabilities: undefined,
        sessionSyncProtocolVersion: undefined,
      })
      expect(notifier.onMachineStatus).toHaveBeenCalledWith(
        'm1',
        true,
        undefined,
        undefined,
        undefined,
        {
          daemonInstallationId: undefined,
          sessionSyncCapabilities: undefined,
          sessionSyncProtocolVersion: undefined,
        },
      )
    })

    it('refreshes the authoritative inventory when a machine is removed', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/machines') return { machines: [] }
        throw new Error(`unexpected path ${path}`)
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.removed',
        payload: { machineId: 'm1' },
      })

      await vi.waitFor(() => expect(notifier.onMachinesChange).toHaveBeenCalledWith([]))
      expect(store.updateMachineStatus).toHaveBeenCalledWith('m1', false)
      expect(notifier.onMachineStatus).toHaveBeenCalledWith('m1', false)
      expect(notifier.onMachineRemoved).toHaveBeenCalledWith('m1')
      expect(store.putMachines).toHaveBeenCalledWith([])
    })

    it('projects a cached machine removal when boot reconciliation missed the relay event', async () => {
      vi.mocked(store.getMachines).mockResolvedValue([{
        id: 'm1', name: 'Cached Mac', os: 'darwin', agentList: [], paired: true,
        online: true, lastSeen: '2026-09-03T00:00:00.000Z',
      }])
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/machines') return { machines: [] } as never
        if (path === '/projects') return { projects: [] } as never
        if (path === '/sessions/activities') return { activities: [] } as never
        if (path.startsWith('/sessions')) return { sessions: [] } as never
        return {} as never
      })

      await engine.boot()

      expect(notifier.onMachineRemoved).toHaveBeenCalledWith('m1')
      expect(notifier.onMachinesChange).toHaveBeenLastCalledWith([])
    })

    it('ignores a delayed online status after machine removal', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockResolvedValue({ machines: [] })

      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.removed',
        payload: { machineId: 'm1' },
      })
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true, lastSeen: 10 },
      })

      await vi.waitFor(() => expect(notifier.onMachinesChange).toHaveBeenCalledWith([]))
      expect(notifier.onMachineStatus.mock.calls).toEqual([['m1', false]])
      expect(vi.mocked(store.updateMachineStatus).mock.calls).toEqual([['m1', false]])
    })

    it('rejects an older machine.status frame', () => {
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: false, lastSeen: 20 },
      })
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true, lastSeen: 10 },
      })

      expect(store.updateMachineStatus).toHaveBeenCalledTimes(1)
      expect(notifier.onMachineStatus).toHaveBeenCalledTimes(1)
      expect(notifier.onMachineStatus).toHaveBeenCalledWith(
        'm1', false, undefined, undefined, undefined,
        {
          daemonInstallationId: undefined,
          sessionSyncCapabilities: undefined,
          sessionSyncProtocolVersion: undefined,
        },
      )
    })

    it('accepts status again after the authoritative inventory contains a re-paired machine', async () => {
      vi.mocked(api).mockResolvedValue({ machines: [] } as never)
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.removed',
        payload: { machineId: 'm1' },
      })
      await vi.waitFor(() => expect(notifier.onMachinesChange).toHaveBeenCalledWith([]))

      vi.mocked(api).mockResolvedValue({
        machines: [{
          id: 'm1', name: 'Macbook', os: 'darwin', agentList: [], paired: true,
          online: false, lastSeen: '1970-01-01T00:00:00.020Z',
        }],
      } as never)
      await engine.refreshMachines()
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true, lastSeen: 30 },
      })

      expect(notifier.onMachineStatus).toHaveBeenLastCalledWith(
        'm1', true, undefined, undefined, undefined,
        {
          daemonInstallationId: undefined,
          sessionSyncCapabilities: undefined,
          sessionSyncProtocolVersion: undefined,
        },
      )
    })

    it('handles machine.status event with cliVersion', () => {
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true, cliVersion: '0.1.12', region: 'cn' },
      })

      expect(store.updateMachineStatus).toHaveBeenCalledWith('m1', true, {
        cliVersion: '0.1.12',
        region: 'cn',
        autoUpgrade: undefined,
        daemonInstallationId: undefined,
        sessionSyncCapabilities: undefined,
        sessionSyncProtocolVersion: undefined,
      })
      expect(notifier.onMachineStatus).toHaveBeenCalledWith(
        'm1', true, 'cn', '0.1.12', undefined,
        {
          daemonInstallationId: undefined,
          sessionSyncCapabilities: undefined,
          sessionSyncProtocolVersion: undefined,
        },
      )
    })

    it('handles the daemon-reported auto-upgrade policy', () => {
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: { machineId: 'm1', online: true, autoUpgrade: 'none' },
      })
      expect(notifier.onMachineStatus).toHaveBeenCalledWith(
        'm1',
        true,
        undefined,
        undefined,
        'none',
        {
          daemonInstallationId: undefined,
          sessionSyncCapabilities: undefined,
          sessionSyncProtocolVersion: undefined,
        },
      )
    })

    it('handles the daemon session-sync projection', () => {
      engine.handleRelayEvent({
        type: 'event',
        event: 'machine.status',
        payload: {
          machineId: 'm1', online: true,
          sessionSyncProtocolVersion: 1,
          sessionSyncCapabilities: ['session_index_v1'],
          daemonInstallationId: 'install-1',
        },
      })
      expect(store.updateMachineStatus).toHaveBeenCalledWith('m1', true, expect.objectContaining({
        sessionSyncProtocolVersion: 1,
        sessionSyncCapabilities: ['session_index_v1'],
        daemonInstallationId: 'install-1',
      }))
    })





  })


  describe('boot message sync', () => {
    it('does not request all account messages when the local message cursor is empty', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/sessions?limit=50') return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        throw new Error(`unexpected path ${path}`)
      })

      await engine.boot()

      expect(api).toHaveBeenCalledWith('/sessions?limit=50')
      expect(api).toHaveBeenCalledWith('/machines')
      expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/messages/since?after=0'))
    })
  })
})
