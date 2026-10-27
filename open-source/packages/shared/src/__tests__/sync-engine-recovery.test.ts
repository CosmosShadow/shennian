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

  describe('handleRelayEvent — session backfill for unknown sessions', () => {
    it('inserts a complete account-level session projection without a page refresh', async () => {
      const newSession: NianSession = {
        id: 's-live-new',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: 'thread-live',
        title: '电脑端刚创建的计划',
        status: 'active',
        workDir: '/repo',
        lastMessagePreview: '第一条真实消息',
        lastMessagePreviewMessageId: 'message-live-1',
        lastMessagePreviewAt: '2026-09-02T06:20:00.000Z',
        lastActivityAt: '2026-09-02T06:21:00.000Z',
        createdAt: '2026-09-02T06:20:00.000Z',
        updatedAt: '2026-09-02T06:21:00.000Z',
        indexRevision: 1,
      }

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { machineId: 'm1', session: newSession },
      })

      await vi.waitFor(async () => {
        expect(await store.getSession('s-live-new')).toMatchObject({
          lastMessagePreview: '第一条真实消息',
          lastMessagePreviewMessageId: 'message-live-1',
          lastMessagePreviewAt: '2026-09-02T06:20:00.000Z',
        })
      })
      expect(notifier.onSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: 's-live-new',
      }))
      expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/sessions?limit=10'))
    })

    it('serializes each session independently when two rows update interleaved', async () => {
      const base = (id: string): NianSession => ({
        id, machineId: 'm1', userId: 'u1', agentType: 'codex', agentSessionId: id,
        title: id, status: 'active', workDir: '/repo', lastMessagePreview: null,
        lastMessagePreviewMessageId: null, lastMessagePreviewAt: null,
        lastActivityAt: '2026-09-02T06:00:00.000Z',
        createdAt: '2026-09-02T06:00:00.000Z', updatedAt: '2026-09-02T06:00:00.000Z',
        indexRevision: 1,
      })
      await store.putSessions([base('s-a'), base('s-b')])

      engine.handleRelayEvent({ type: 'event', event: 'session.update', payload: { session: {
        id: 's-a', status: 'completed', lastMessagePreview: 'A 完成',
        lastMessagePreviewMessageId: 'a-2', lastMessagePreviewAt: '2026-09-02T06:02:00.000Z',
        lastActivityAt: '2026-09-02T06:02:00.000Z', updatedAt: '2026-09-02T06:02:00.000Z',
        indexRevision: 2,
      } } })
      engine.handleRelayEvent({ type: 'event', event: 'session.update', payload: { session: {
        id: 's-b', status: 'active', lastMessagePreview: 'B 新消息',
        lastMessagePreviewMessageId: 'b-3', lastMessagePreviewAt: '2026-09-02T06:03:00.000Z',
        lastActivityAt: '2026-09-02T06:03:00.000Z', updatedAt: '2026-09-02T06:03:00.000Z',
        indexRevision: 2,
      } } })
      engine.handleRelayEvent({ type: 'event', event: 'session.update', payload: { session: {
        id: 's-a', status: 'active', lastMessagePreview: 'A 旧事件',
        lastMessagePreviewMessageId: 'a-old', lastMessagePreviewAt: '2026-09-02T06:01:00.000Z',
        lastActivityAt: '2026-09-02T06:01:00.000Z', updatedAt: '2026-09-02T06:01:00.000Z',
        indexRevision: 1,
      } } })

      await vi.waitFor(async () => {
        expect(await store.getSession('s-a')).toMatchObject({
          status: 'completed', lastMessagePreview: 'A 完成', indexRevision: 2,
        })
        expect(await store.getSession('s-b')).toMatchObject({
          status: 'active', lastMessagePreview: 'B 新消息', indexRevision: 2,
        })
      })
    })

    it('backfills from server when session.update references a session not in local store', async () => {
      const newSession: NianSession = {
        id: 's-new',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'New Session',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-14T01:00:00.000Z',
        createdAt: '2026-04-14T01:00:00.000Z',
        updatedAt: '2026-04-14T01:00:00.000Z',
      }
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?limit=10')) return { sessions: [newSession] }
        return {}
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { id: 's-new', title: 'New Session' } },
      })

      await vi.waitFor(() => {
        expect(api).toHaveBeenCalledWith(expect.stringContaining('/sessions?limit=10'))
      })
      expect(api).toHaveBeenCalledWith('/sessions/index/s-new')

      const stored = await store.getSession('s-new')
      expect(stored).toBeDefined()
      expect(stored?.title).toBe('New Session')
    })

    it('retains a failed exact repair target and retries automatically', async () => {
      vi.useFakeTimers()
      const repaired: NianSession = {
        id: 's-retry', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: 'thread-retry', title: 'Retry session', status: 'active', workDir: '/repo',
        lastMessagePreview: null, lastMessagePreviewMessageId: null, lastMessagePreviewAt: null,
        lastActivityAt: '2026-09-02T06:25:00.000Z',
        createdAt: '2026-09-02T06:25:00.000Z', updatedAt: '2026-09-02T06:25:00.000Z',
      }
      let exactAttempts = 0
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/sessions/index/s-retry') {
          exactAttempts += 1
          if (exactAttempts === 1) throw new Error('temporary outage')
          return { session: repaired }
        }
        if (path.startsWith('/sessions?limit=10')) return { sessions: [] }
        return {}
      })

      engine.handleRelayEvent({
        type: 'event', event: 'session.update', payload: { session: { id: 's-retry' } },
      })
      await vi.waitFor(() => expect(exactAttempts).toBe(1))
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(async () => expect(await store.getSession('s-retry')).toBeDefined())

      expect(exactAttempts).toBe(2)
      vi.useRealTimers()
    })

    it('repairs an incomplete revision gap by exact session id', async () => {
      const existing: NianSession = {
        id: 's-gap', machineId: 'm1', userId: 'u1', agentType: 'codex', agentSessionId: 'gap',
        title: 'Before', status: 'active', workDir: '/repo', lastMessagePreview: null,
        lastMessagePreviewMessageId: null, lastMessagePreviewAt: null,
        lastActivityAt: '2026-09-02T06:00:00.000Z',
        createdAt: '2026-09-02T06:00:00.000Z', updatedAt: '2026-09-02T06:00:00.000Z',
        indexRevision: 1,
      }
      const repaired: NianSession = {
        ...existing,
        title: 'After repair',
        lastMessagePreview: '同一 revision 的完整摘要',
        lastMessagePreviewMessageId: 'gap-message-3',
        lastMessagePreviewAt: '2026-09-02T06:03:00.000Z',
        lastActivityAt: '2026-09-02T06:03:00.000Z',
        updatedAt: '2026-09-02T06:03:00.000Z',
        indexRevision: 3,
      }
      await store.putSession(existing)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/sessions/index/s-gap') return { session: repaired }
        return {}
      })

      engine.handleRelayEvent({
        type: 'event', event: 'session.update',
        payload: { session: { id: 's-gap', title: 'partial', indexRevision: 3 } },
      })

      await vi.waitFor(async () => expect(await store.getSession('s-gap')).toMatchObject({
        title: 'After repair', lastMessagePreviewMessageId: 'gap-message-3', indexRevision: 3,
      }))
      expect(api).toHaveBeenCalledWith('/sessions/index/s-gap')
    })

    it('retains and updates an explicitly cached manager Worker for project lists', async () => {
      const worker: NianSession = {
        id: 'sess_worker_cached',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: 'worker-thread',
        title: 'Cached worker',
        status: 'active',
        workDir: '/tmp/demo',
        lastActivityAt: '2026-04-14T01:00:00.000Z',
        createdAt: '2026-04-14T01:00:00.000Z',
        updatedAt: '2026-04-14T01:00:00.000Z',
      }
      await store.putSession(worker)

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { id: 'sess_worker_cached', updatedAt: '2026-04-14T01:01:00.000Z' } },
      })

      await vi.waitFor(async () => {
        expect(await store.getSession('sess_worker_cached')).toMatchObject({
          updatedAt: '2026-04-14T01:01:00.000Z',
        })
      })
      expect(notifier.onSessionDelete).not.toHaveBeenCalledWith('sess_worker_cached')
      expect(notifier.onSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sess_worker_cached',
          updatedAt: '2026-04-14T01:01:00.000Z',
        }),
      )
      expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/sessions?limit=10'))
    })

    it('backfills from server when session.activity references a session not in local store', async () => {
      const newSession: NianSession = {
        id: 's-act',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Activity Session',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-14T01:00:00.000Z',
        createdAt: '2026-04-14T01:00:00.000Z',
        updatedAt: '2026-04-14T01:00:00.000Z',
      }
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?limit=10')) return { sessions: [newSession] }
        return {}
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.activity',
        payload: { sessionId: 's-act', activity: { runPhase: 'thinking', runId: 'r1' } },
      })

      await vi.waitFor(() => {
        expect(api).toHaveBeenCalledWith(expect.stringContaining('/sessions?limit=10'))
      })

      const stored = await store.getSession('s-act')
      expect(stored).toBeDefined()
      expect(stored?.activity).toEqual({ runPhase: 'thinking', runId: 'r1' })
    })

    it('debounces multiple rapid backfill requests into one when in-flight', async () => {
      let resolveBackfill: (() => void) | null = null
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?limit=10')) {
          await new Promise<void>((r) => {
            resolveBackfill = r
          })
          return { sessions: [] }
        }
        return {}
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.activity',
        payload: { sessionId: 's-x', activity: { runPhase: 'thinking', runId: 'r1' } },
      })

      await vi.waitFor(() => {
        expect(resolveBackfill).not.toBeNull()
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.activity',
        payload: { sessionId: 's-x', activity: { runPhase: 'streaming_text', runId: 'r1' } },
      })
      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { id: 's-x', title: 'X' } },
      })

      resolveBackfill!()
      await vi.waitFor(() => {
        expect(api).toHaveBeenCalledWith(expect.stringContaining('/sessions?limit=10'))
      })

      const backfillCalls = (api as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([path]: [string]) => typeof path === 'string' && path.startsWith('/sessions?limit=10'),
      )
      expect(backfillCalls.length).toBe(1)
    })

    it('checkpoints heartbeat freshness without writing or notifying React for every timestamp', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
      await store.putSession({
        id: 's-heartbeat',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Heartbeat',
        status: 'active',
        workDir: '/repo',
        lastMessagePreview: null,
        lastActivityAt: '2026-04-29T09:00:00.000Z',
        deletedAt: null,
        createdAt: '2026-04-29T09:00:00.000Z',
        updatedAt: '2026-04-29T09:00:00.000Z',
      })

      for (let index = 0; index < 20; index += 1) {
        engine.handleRelayEvent({
          type: 'event',
          event: 'session.activity',
          payload: {
            sessionId: 's-heartbeat',
            activity: {
              sessionId: 's-heartbeat',
              runId: 'r1',
              runPhase: 'thinking',
              startedAt: '2026-04-29T09:00:00.000Z',
              updatedAt: `2026-04-29T09:00:${String(index).padStart(2, '0')}.000Z`,
            },
          },
        })
      }

      await vi.waitFor(() => expect(notifier.onSessionUpdate).toHaveBeenCalledTimes(1))
      expect((store.putSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)

      now.mockReturnValue(1_061_000)
      await engine.flushPendingWork()
      const stored = await store.getSession('s-heartbeat')
      expect(stored?.activity?.updatedAt).toBe('2026-04-29T09:00:19.000Z')
      expect(notifier.onSessionUpdate).toHaveBeenCalledTimes(1)
      expect(store.putSessions).toHaveBeenCalledTimes(1)
      now.mockRestore()
    })
  })


  describe('clearLocalData', () => {
    it('clears store and resets booted state', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [], machines: [] })

      await engine.boot()
      await engine.clearLocalData()

      expect(store.clearAll).toHaveBeenCalled()

      // Can boot again after clear
      await engine.boot()
      expect(store.getSessions).toHaveBeenCalled()
    })
  })

  describe('deleteProject', () => {
    it('deletes the server project and its matching local conversations', async () => {
      const projects: NianProject[] = [
        {
          id: 'project-1',
          machineId: 'machine-1',
          machineName: 'Mac',
          machineOnline: true,
          workDir: '/code/one',
          displayName: 'one',
          lastActivityAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'project-2',
          machineId: 'machine-1',
          machineName: 'Mac',
          machineOnline: true,
          workDir: '/code/two',
          displayName: 'two',
          lastActivityAt: '2026-01-02T00:00:00.000Z',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ]
      await store.putProjects(projects)
      const baseSession = {
        userId: 'user-1',
        agentType: 'codex' as const,
        agentSessionId: null,
        title: 'Session',
        status: 'active',
        lastMessagePreview: null,
        lastActivityAt: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      }
      await store.putSessions([
        { ...baseSession, id: 'session-1', machineId: 'machine-1', workDir: '/code/one/' },
        // Simulate a managed session cached before Native persisted agentIdentityId.
        { ...baseSession, id: 'managed-session', machineId: 'machine-1', workDir: '/code/one' },
        { ...baseSession, id: 'session-2', machineId: 'machine-1', workDir: '/code/two' },
        { ...baseSession, id: 'session-3', machineId: 'machine-2', workDir: '/code/one' },
      ])
      vi.mocked(api).mockResolvedValueOnce({ deletedSessionIds: ['session-1'] })

      await engine.deleteProject('project-1')

      expect(api).toHaveBeenCalledWith('/projects/project-1', { method: 'DELETE' })
      expect(await store.getProjects()).toEqual([projects[1]])
      expect(notifier.onProjectsChange).toHaveBeenCalledWith([projects[1]])
      expect(await store.getSession('session-1')).toBeUndefined()
      expect(await store.getSession('managed-session')).toBeDefined()
      expect(await store.getSession('session-2')).toBeDefined()
      expect(await store.getSession('session-3')).toBeDefined()
      expect(notifier.onSessionDelete).toHaveBeenCalledWith('session-1')
      expect(notifier.onSessionDelete).not.toHaveBeenCalledWith('managed-session')
    })

    it('confirms server-selected batch deletions in the local session index', async () => {
      const session = {
        id: 'old-session',
        machineId: 'machine-1',
        userId: 'user-1',
        agentType: 'codex' as const,
        agentSessionId: null,
        title: 'Old',
        status: 'completed',
        workDir: '/code/one',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      await store.putSession(session)
      vi.mocked(api).mockResolvedValueOnce({
        deletedSessionIds: [session.id],
        protectedCount: 2,
      })

      await expect(engine.pruneOldestProjectSessions('project-1', 20)).resolves.toEqual({
        deletedSessionIds: [session.id],
        protectedCount: 2,
      })

      expect(api).toHaveBeenCalledWith('/projects/project-1/sessions/prune-oldest', {
        method: 'POST',
        body: JSON.stringify({ count: 20 }),
      })
      expect(await store.getSession(session.id)).toBeUndefined()
      expect(await store.getSessionDeletion(session.id)).toMatchObject({ state: 'confirmed' })
      expect(notifier.onSessionDelete).toHaveBeenCalledWith(session.id)
    })

    it('serializes realtime and API batch deletion cleanup on the local store', async () => {
      let activeDeletes = 0
      let maxActiveDeletes = 0
      vi.mocked(store.deleteSession).mockImplementation(async () => {
        activeDeletes += 1
        maxActiveDeletes = Math.max(maxActiveDeletes, activeDeletes)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeDeletes -= 1
      })
      vi.mocked(api).mockResolvedValueOnce({
        deletedSessionIds: ['old-1', 'old-2'],
        protectedCount: 0,
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.delete',
        payload: { sessionId: 'old-1', deletedAt: '2026-01-03T00:00:00.000Z' },
      })
      engine.handleRelayEvent({
        type: 'event',
        event: 'session.delete',
        payload: { sessionId: 'old-2', deletedAt: '2026-01-03T00:00:00.000Z' },
      })

      await expect(engine.pruneOldestProjectSessions('project-1', 20)).resolves.toEqual({
        deletedSessionIds: ['old-1', 'old-2'],
        protectedCount: 0,
      })

      expect(maxActiveDeletes).toBe(1)
      expect(store.deleteSession).toHaveBeenCalledTimes(4)
    })
  })
  it('withdraws a newly internal session from the list but keeps linked history cached', async () => {
    const session: NianSession = {
      id: 'became-internal', machineId: 'm1', userId: 'u1', agentType: 'codex', agentSessionId: 'thread',
      title: 'Internal', status: 'active', workDir: '/repo', lastMessagePreview: null,
      lastActivityAt: '2026-09-16T00:00:00Z', createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z',
    }
    await store.putSession(session)
    engine.handleRelayEvent({ type: 'event', event: 'session.update', payload: {
      session: { id: session.id, nativeSessionVisibility: 'internal' },
    } })
    await engine.flushPendingWork()
    expect(notifier.onSessionDelete).not.toHaveBeenCalled()
    expect(notifier.onSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: session.id, nativeSessionVisibility: 'internal' }))
    expect(await store.getSession(session.id)).toMatchObject({ nativeSessionVisibility: 'internal' })
    expect(store.putSessionDeletion).not.toHaveBeenCalled()
    engine.handleRelayEvent({ type: 'event', event: 'session.update', payload: {
      session: { id: session.id, nativeSessionVisibility: 'user', status: 'completed' },
    } })
    await engine.flushPendingWork()
    expect(await store.getSession(session.id)).toMatchObject({ nativeSessionVisibility: 'internal' })
    expect(notifier.onSessionUpdate).toHaveBeenCalledTimes(1)
  })

})
