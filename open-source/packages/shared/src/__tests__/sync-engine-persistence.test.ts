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

  it('restores a project-fetched Worker from the durable cache on boot', async () => {
    const worker: NianSession = {
      id: 'sess_worker_cached',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'worker-thread',
      agentIdentityId: null,
      title: 'Cached project Worker',
      status: 'completed',
      workDir: '/code/project',
      nativeSessionVisibility: 'internal',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const substrate: NianSession = {
      ...worker,
      id: 'native-session-internal',
      title: 'Internal substrate',
    }
    await store.putSessions([worker, substrate])

    await engine.boot({ localOnly: true })

    expect(notifier.onSessionsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: worker.id, title: worker.title }),
    ])
  })

  describe('durable session deletion', () => {
    const session: NianSession = {
      id: 'session-race',
      machineId: 'machine-1',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: 'native-race',
      title: 'Old conversation',
      status: 'completed',
      workDir: '/code/project',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    it('blocks an in-flight stale project page from resurrecting a confirmed deletion', async () => {
      await store.putSession(session)
      let resolveProjectPage!: (value: { sessions: NianSession[]; hasMore: boolean }) => void
      const projectPage = new Promise<{ sessions: NianSession[]; hasMore: boolean }>((resolve) => {
        resolveProjectPage = resolve
      })
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path.startsWith('/projects/')) return projectPage
        if (path === `/sessions/${session.id}`) {
          return { ok: true, deletedAt: '2026-08-29T07:42:00.155Z' }
        }
        return {}
      })

      const staleLoad = engine.loadProjectSessions('project-1')
      await expect(engine.requestSessionDeletion(session.id, 'auto')).resolves.toBe('confirmed')
      resolveProjectPage({ sessions: [session], hasMore: false })
      await staleLoad

      expect(await store.getSession(session.id)).toBeUndefined()
      expect(await store.getSessions()).toEqual([])
      expect(await store.getSessionDeletion(session.id)).toMatchObject({ state: 'confirmed' })
      expect(api).toHaveBeenCalledWith(`/sessions/${session.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ nativeCleanupPolicy: 'auto' }),
      })
      expect(
        vi.mocked(api).mock.calls.filter(([path, options]) =>
          path === `/sessions/${session.id}` && options?.method === 'DELETE'),
      ).toHaveLength(1)
    })

    it('blocks a stale realtime patch arriving immediately after session.delete', async () => {
      await store.putSession(session)

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.delete',
        payload: { sessionId: session.id, deletedAt: '2026-08-29T07:42:00.155Z' },
      })
      engine.handleRelayEvent({
        type: 'event',
        event: 'session.update',
        payload: { session: { ...session, title: 'Stale resurrection' } },
      })

      await vi.waitFor(async () => {
        expect(await store.getSessionDeletion(session.id)).toMatchObject({ state: 'confirmed' })
      })
      expect(await store.getSession(session.id)).toBeUndefined()
      expect(notifier.onSessionUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Stale resurrection' }),
      )
    })

    it('rolls back an ambiguous delete response without a background retry', async () => {
      await store.putSession(session)
      vi.mocked(api).mockRejectedValueOnce(new Error('Network request failed'))

      await expect(engine.requestSessionDeletion(session.id, 'auto')).rejects.toThrow(
        'Network request failed',
      )
      expect(await store.getSession(session.id)).toEqual(session)
      expect(await store.getPendingSessionDeletions()).toEqual([])
      expect(notifier.onSessionUpdate).toHaveBeenCalledWith(session)
      expect(
        vi.mocked(api).mock.calls.filter(([path, options]) =>
          path === `/sessions/${session.id}` && options?.method === 'DELETE'),
      ).toHaveLength(1)
    })

    it('rolls back legacy pending deletions on boot and reconnect without sending DELETE', async () => {
      const configureSyncApi = () => {
        vi.mocked(api).mockImplementation(async (path: string) => {
          if (path === '/machines') return { machines: [] }
          if (path === '/sessions/activities') return { activities: [] }
          if (path.startsWith('/sessions')) return { sessions: [] }
          if (path.startsWith('/projects')) return { projects: [] }
          return {}
        })
      }
      const assertNoDelete = () => {
        expect(
          vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'DELETE'),
        ).toEqual([])
      }

      await store.putSession(session)
      await store.putSessionDeletion({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:42:00.155Z',
        state: 'pending',
        nativeCleanupPolicy: 'auto',
      })
      configureSyncApi()

      await engine.boot()

      assertNoDelete()
      expect(await store.getSessionDeletion(session.id)).toBeUndefined()
      expect(await store.getSessions()).toEqual([session])

      await store.putSessionDeletion({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:43:00.155Z',
        state: 'pending',
        nativeCleanupPolicy: 'auto',
      })
      vi.mocked(api).mockClear()
      configureSyncApi()

      await engine.onReconnect()

      assertNoDelete()
      expect(await store.getSessionDeletion(session.id)).toBeUndefined()
      expect(await store.getSessions()).toEqual([session])

      await store.putSessionDeletion({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:44:00.155Z',
        state: 'pending',
        nativeCleanupPolicy: 'auto',
      })
      vi.mocked(api).mockClear()
      const localOnlyEngine = new SyncEngine({ store, api, onChange: notifier })

      await localOnlyEngine.boot({ localOnly: true })

      assertNoDelete()
      expect(await store.getSessionDeletion(session.id)).toBeUndefined()
      expect(await store.getSessions()).toEqual([session])
    })

    it('keeps an authoritative tombstone confirmed while cleaning a legacy pending deletion', async () => {
      await store.putSession(session)
      await store.putSessionDeletion({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:42:00.155Z',
        state: 'pending',
        nativeCleanupPolicy: 'auto',
      })
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === '/sessions/activities') return { activities: [] }
        if (path.startsWith('/sessions')) {
          return {
            sessions: [{
              ...session,
              deletedAt: '2026-08-29T07:43:00.155Z',
              deletionRevision: 42,
            }],
          }
        }
        return {}
      })

      await engine.boot()

      expect(
        vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'DELETE'),
      ).toEqual([])
      expect(await store.getSession(session.id)).toBeUndefined()
      expect(await store.getSessionDeletion(session.id)).toMatchObject({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:43:00.155Z',
        state: 'confirmed',
      })
    })

    it('does not roll back an authoritative realtime tombstone racing legacy cleanup', async () => {
      await store.putSession(session)
      await store.putSessionDeletion({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:42:00.155Z',
        state: 'pending',
        nativeCleanupPolicy: 'auto',
      })

      engine.handleRelayEvent({
        type: 'event',
        event: 'session.delete',
        payload: {
          sessionId: session.id,
          deletedAt: '2026-08-29T07:43:00.155Z',
          deletionRevision: 42,
        },
      })
      await engine.rollbackPendingSessionDeletions()

      expect(api).not.toHaveBeenCalled()
      expect(await store.getSession(session.id)).toBeUndefined()
      expect(await store.getSessionDeletion(session.id)).toMatchObject({
        sessionId: session.id,
        deletedAt: '2026-08-29T07:43:00.155Z',
        state: 'confirmed',
      })
    })

    it('rolls back an optimistic hide after a definite authorization failure', async () => {
      await store.putSession(session)
      vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))

      await expect(engine.requestSessionDeletion(session.id, 'auto')).rejects.toThrow('Forbidden')

      expect(await store.getSessionDeletion(session.id)).toBeUndefined()
      expect(notifier.onSessionUpdate).toHaveBeenCalledWith(session)
      expect(await store.getSessions()).toEqual([session])
    })

  })

  describe('project session metadata', () => {
    it('clears the cached project projection after an authoritative access rejection', async () => {
      const project: NianProject = {
        id: 'project-revoked',
        machineId: 'machine-1',
        machineName: 'Mac',
        machineOnline: true,
        workDir: '/code/project',
        displayName: 'Project',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const session: NianSession = {
        id: 'revoked-session',
        machineId: 'machine-1',
        userId: 'user-1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Cached conversation',
        status: 'active',
        workDir: '/code/project',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      await store.putProjects([project])
      await store.putSession(session)
      vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))

      await expect(engine.loadProjectSessions(project.id)).rejects.toThrow('Forbidden')

      expect(await store.getProjects()).toEqual([])
      expect(await store.getSessions()).toEqual([])
      expect(notifier.onSessionDelete).toHaveBeenCalledWith(session.id)
      expect(notifier.onProjectsChange).toHaveBeenCalledWith([])
    })

    it('ignores an older project page that resolves after a newer request', async () => {
      let resolveOlder!: (value: { sessions: NianSession[]; hasMore: boolean }) => void
      const olderResponse = new Promise<{ sessions: NianSession[]; hasMore: boolean }>((resolve) => {
        resolveOlder = resolve
      })
      const template: NianSession = {
        id: 'newer-session', machineId: 'machine-1', userId: 'user-1', agentType: 'codex',
        agentSessionId: null, title: 'Newer', status: 'active', workDir: '/code/project',
        lastActivityAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      }
      vi.mocked(api)
        .mockImplementationOnce(async () => olderResponse)
        .mockResolvedValueOnce({ sessions: [template], hasMore: false })

      const olderLoad = engine.loadProjectSessions('project-1')
      await engine.loadProjectSessions('project-1', { before: 1 })
      resolveOlder({ sessions: [{ ...template, id: 'stale-session', title: 'Stale' }], hasMore: false })
      await olderLoad

      expect(await store.getSessions()).toEqual([expect.objectContaining({ id: 'newer-session' })])
    })

    it('loads a project page into the durable session projection without fetching messages', async () => {
      const session: NianSession = {
        id: 'project-session-1',
        machineId: 'machine-1',
        userId: 'user-1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Older project conversation',
        status: 'active',
        workDir: '/code/project',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      vi.mocked(api).mockResolvedValueOnce({ sessions: [session], hasMore: false })

      await expect(
        engine.loadProjectSessions('project-1', { limit: 100 }),
      ).resolves.toMatchObject({ loaded: 1, hasMore: false })

      expect(api).toHaveBeenCalledWith('/projects/project-1/sessions?limit=100')
      expect(await store.getSession(session.id)).toMatchObject(session)
      expect(store).not.toHaveProperty('getMessages')
    })

    it('publishes a project-fetched Worker without publishing unrelated internal sessions', async () => {
      const worker: NianSession = {
        id: 'sess_worker_project',
        machineId: 'machine-1',
        userId: 'user-1',
        agentType: 'codex',
        agentSessionId: 'worker-thread',
        agentIdentityId: null,
        title: 'Project Worker',
        status: 'completed',
        workDir: '/code/project',
        nativeSessionVisibility: 'internal',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const substrate: NianSession = {
        ...worker,
        id: 'native-session-internal',
        title: 'Internal substrate',
      }
      await store.putSession(substrate)
      vi.mocked(api).mockResolvedValueOnce({ sessions: [worker], hasMore: false })

      await engine.loadProjectSessions('project-1', { limit: 100 })

      expect(notifier.onSessionsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'sess_worker_project', title: 'Project Worker' }),
      ])
    })

    it('completes the lightweight session index in the background', async () => {
      const recent = {
        id: 'recent',
        machineId: 'machine-1',
        userId: 'user-1',
        agentType: 'codex' as const,
        agentSessionId: null,
        title: 'Recent',
        status: 'active',
        workDir: '/code/recent',
        lastActivityAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      }
      const older = {
        ...recent,
        id: 'older',
        title: 'Older',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      await store.putSession(recent)
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path === '/sessions?limit=50') return { sessions: [recent] }
        if (path === '/sessions?limit=100') return { sessions: [recent, older] }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'machine-1',
                name: 'Mac',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-02-01T00:00:00.000Z',
              },
            ],
          }
        }
        if (path === '/projects') return { projects: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return { sessions: [] }
      })

      await engine.boot()

      await vi.waitFor(async () => {
        expect(await store.getSession('older')).toMatchObject({ title: 'Older' })
        expect(await store.getSessionBackfillComplete()).toBe(true)
      })
      expect(api).toHaveBeenCalledWith('/sessions?limit=100')
    })
  })
})
