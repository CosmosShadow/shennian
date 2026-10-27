// @arch open-source/docs/shared-runtime.md
// @covers open-source/packages/shared/src/sync-engine.ts

import type { Machine, NianProject, NianSession } from '@shennian/wire'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientIndexStore, LocalSessionDeletion } from '../storage'
import { DEFAULT_SESSIONS_PAGE_SIZE, SyncEngine } from '../sync-engine'

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


  describe('onReconnect', () => {
    it('reconciles a visible machine that comes online after the account Relay', async () => {
      vi.useFakeTimers()
      try {
        const session: NianSession = {
          id: 's1', machineId: 'm1', userId: 'u1', agentType: 'codex', agentSessionId: null,
          title: 'Reconnect', status: 'active', workDir: '',
          lastActivityAt: '2026-09-08T16:00:00.000Z',
          createdAt: '2026-09-08T16:00:00.000Z',
          updatedAt: '2026-09-08T16:00:00.000Z',
        }
        const offlineMachine: Machine = {
          id: 'm1', name: 'Mac', os: 'darwin', agentList: ['codex'], paired: true,
          online: false, lastSeen: '2026-09-08T16:00:00.000Z',
        }
        const onlineMachine: Machine = {
          ...offlineMachine, online: true, lastSeen: '2026-09-08T16:00:05.000Z',
        }
        await store.putSession(session)
        await store.putMachines([offlineMachine])
        let machineReads = 0
        ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
          if (path === '/machines') {
            machineReads += 1
            return { machines: machineReads === 1 ? [offlineMachine] : [onlineMachine] }
          }
          if (path === '/projects') return { projects: [] }
          if (path === '/sessions/activities') return { activities: [] }
          return { sessions: [] }
        })

        await engine.onReconnect({ currentSessionId: session.id })
        expect(machineReads).toBe(1)
        expect(notifier.onMachinesChange).toHaveBeenLastCalledWith([offlineMachine])

        await vi.advanceTimersByTimeAsync(5_000)

        expect(machineReads).toBe(2)
        expect(notifier.onMachinesChange).toHaveBeenLastCalledWith([onlineMachine])
        await vi.advanceTimersByTimeAsync(30_000)
        expect(machineReads).toBe(2)
      } finally {
        engine.cancelMachineRecoveryReconciliation()
        vi.useRealTimers()
      }
    })

    it('does not bulk sync message bodies on reconnect', async () => {
      const session: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: '',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T02:14:00.000Z',
        createdAt: '',
        updatedAt: '',
      }
      await store.putSession(session)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/sessions') return { sessions: [session] }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'm1',
                name: 'Macbook',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-04-07T10:00:00.000Z',
              },
            ],
          }
        }
        return { messages: [] }
      })

      await engine.onReconnect()

      expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/messages/since'))
    })

    it('does not advance the session cursor when the local projection write fails', async () => {
      const existingUpdatedAt = '2026-04-07T02:14:00.000Z'
      const incomingUpdatedAt = '2026-04-07T02:20:00.000Z'
      const existing: NianSession = {
        id: 's1', machineId: 'm1', userId: 'u1', agentType: 'claude', agentSessionId: null,
        title: 'local', status: 'active', workDir: '', lastActivityAt: existingUpdatedAt,
        createdAt: existingUpdatedAt, updatedAt: existingUpdatedAt,
      }
      await store.putSession(existing)
      vi.mocked(store.getSessionSyncCursor).mockResolvedValue(new Date(existingUpdatedAt).getTime())
      vi.mocked(store.putSessions).mockRejectedValue(new Error('database is locked'))
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) {
          return { sessions: [{ ...existing, title: 'remote', updatedAt: incomingUpdatedAt }] }
        }
        if (path === '/machines') {
          return {
            machines: [{
              id: 'm1', name: 'Macbook', os: 'darwin', agentList: [], paired: true,
              online: true, lastSeen: incomingUpdatedAt,
            }],
          }
        }
        if (path === '/projects') return { projects: [] }
        return {}
      })

      await engine.onReconnect()

      expect(store.setSessionSyncCursor).not.toHaveBeenCalledWith(
        new Date(incomingUpdatedAt).getTime(),
      )
      expect(await store.getSession('s1')).toEqual(existing)
    })

    it('removes locally cached sessions when delta sync returns a deleted tombstone', async () => {
      const existing: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Local session',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T02:14:00.000Z',
        createdAt: '2026-04-07T02:00:00.000Z',
        updatedAt: '2026-04-07T02:14:00.000Z',
      }
      await store.putSession(existing)
      await store.setSessionSyncCursor(new Date('2026-04-07T02:14:00.000Z').getTime())
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) {
          return {
            sessions: [
              {
                ...existing,
                updatedAt: '2026-04-07T02:20:00.000Z',
                deletedAt: '2026-04-07T02:20:00.000Z',
              },
            ],
          }
        }
        if (path === '/sessions?limit=50') return { sessions: [] }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'm1',
                name: 'Macbook',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-04-07T10:00:00.000Z',
              },
            ],
          }
        }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.onReconnect()

      expect(await store.getSession('s1')).toBeUndefined()
      expect(store.deleteSession).toHaveBeenCalledWith('s1')
      expect(store.setSessionSyncCursor).toHaveBeenCalledWith(
        new Date('2026-04-07T02:20:00.000Z').getTime(),
      )
    })
  })

  describe('boot', () => {
    it('reads local cache first, then syncs incrementally when local data exists', async () => {
      // Pre-populate local store with a session
      const session: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Cached',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T00:00:00.000Z',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z',
      }
      await store.putSession(session)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'm1',
                name: 'Macbook',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-04-07T10:00:00.000Z',
              },
            ],
          }
        }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      // Should NOT clear local data
      expect(store.clearAll).not.toHaveBeenCalled()
      // Should push local cache to UI immediately
      expect(notifier.onSessionsChange).toHaveBeenCalled()
      expect(notifier.onMachinesChange).toHaveBeenCalled()
      // First call should be the local cache push
      expect(notifier.onSessionsChange.mock.calls[0][0]).toEqual([session])
      // Should use incremental sync (updatedAfter) not full fetch
      expect(api).toHaveBeenCalledWith(expect.stringContaining('/sessions?updatedAfter='))
    })

    it('persists the final cursor only after every incremental page is durable', async () => {
      const initialCursor = Date.parse('2026-09-09T00:00:00.000Z')
      let persistedCursor = initialCursor
      const firstPage = Array.from({ length: DEFAULT_SESSIONS_PAGE_SIZE }, (_, index) => {
        const updatedAt = new Date(initialCursor + index + 1).toISOString()
        return {
          id: `cursor-${index}`, machineId: 'm1', userId: 'u1', agentType: 'codex',
          agentSessionId: null, title: `Cursor ${index}`, status: 'active', workDir: '/repo',
          lastActivityAt: updatedAt, createdAt: updatedAt, updatedAt,
        } satisfies NianSession
      })
      const finalUpdatedAt = new Date(initialCursor + DEFAULT_SESSIONS_PAGE_SIZE + 1).toISOString()
      const finalSession: NianSession = {
        id: 'cursor-final', machineId: 'm1', userId: 'u1', agentType: 'codex',
        agentSessionId: null, title: 'Final cursor', status: 'active', workDir: '/repo',
        lastActivityAt: finalUpdatedAt, createdAt: finalUpdatedAt, updatedAt: finalUpdatedAt,
      }
      vi.mocked(store.getSessions).mockResolvedValueOnce([firstPage[0]!])
      vi.mocked(store.getSessionSyncCursor).mockImplementation(async () => persistedCursor)
      vi.mocked(store.setSessionSyncCursor).mockImplementation(async (cursor) => {
        persistedCursor = cursor
      })
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path === `/sessions?updatedAfter=${initialCursor}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) {
          return { sessions: firstPage }
        }
        if (path === `/sessions?updatedAfter=${initialCursor + DEFAULT_SESSIONS_PAGE_SIZE}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) {
          return { sessions: [finalSession] }
        }
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) return { sessions: [] }
        if (path === '/machines') return { machines: [{
          id: 'm1', name: 'Mac', os: 'darwin', agentList: [], paired: true, online: true,
          lastSeen: finalUpdatedAt,
        }] }
        if (path === '/sessions/activities') return { activities: [] }
        if (path === '/projects') return { projects: [] }
        return {}
      })

      await engine.boot()

      expect(store.setSessionSyncCursor).toHaveBeenLastCalledWith(
        initialCursor + DEFAULT_SESSIONS_PAGE_SIZE + 1,
      )
      expect(persistedCursor).toBe(initialCursor + DEFAULT_SESSIONS_PAGE_SIZE + 1)
      expect(await store.getSession(finalSession.id)).toMatchObject({ id: finalSession.id })
      const deltaPaths = vi.mocked(api).mock.calls
        .map(([path]) => path)
        .filter((path) => path.startsWith('/sessions?updatedAfter='))
      expect(deltaPaths).toEqual([
        `/sessions?updatedAfter=${initialCursor}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`,
        `/sessions?updatedAfter=${initialCursor + DEFAULT_SESSIONS_PAGE_SIZE}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`,
      ])

      const restartedApi = vi.fn(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path.startsWith('/sessions?limit=')) return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        if (path === '/projects') return { projects: [] }
        return {}
      })
      const restartedEngine = new SyncEngine({
        store,
        api: restartedApi as unknown as typeof api,
        onChange: createMockNotifier(),
      })
      await restartedEngine.onReconnect()
      expect(restartedApi).toHaveBeenCalledWith(
        `/sessions?updatedAfter=${persistedCursor}&limit=${DEFAULT_SESSIONS_PAGE_SIZE}`,
      )
    })

    it('hard-resets unversioned personal data before recording the first epoch marker', async () => {
      const versionedEngine = new SyncEngine({
        store,
        api,
        onChange: notifier,
        cacheVersion: 'delivery:0.2.44',
      })

      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await versionedEngine.boot()

      expect(store.resetPersonalData).toHaveBeenCalledOnce()
      expect(store.clearAll).not.toHaveBeenCalled()
      expect(store.setSyncCacheVersion).toHaveBeenCalledWith('delivery:0.2.44')
    })

    it('does not commit the epoch marker when an App-owned cache reset fails', async () => {
      const onPersonalDataReset = vi.fn().mockRejectedValue(new Error('async storage unavailable'))
      const versionedEngine = new SyncEngine({
        store,
        api,
        onChange: notifier,
        cacheVersion: 'personal-data-epoch:2',
        onPersonalDataReset,
      })

      await versionedEngine.boot()

      expect(store.resetPersonalData).toHaveBeenCalledOnce()
      expect(onPersonalDataReset).toHaveBeenCalledOnce()
      expect(store.setSyncCacheVersion).not.toHaveBeenCalled()
      expect(notifier.onSessionsChange).toHaveBeenCalledWith([])
    })

    it('rebuilds existing unversioned local cache after upgrading to version-aware sync', async () => {
      await store.putSession({
        id: 'legacy',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Legacy local',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T00:00:00.000Z',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z',
      })

      const versionedEngine = new SyncEngine({
        store,
        api,
        onChange: notifier,
        cacheVersion: 'delivery:0.2.44',
      })

      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await versionedEngine.boot()

      expect(store.resetPersonalData).toHaveBeenCalledTimes(1)
      expect(store.clearAll).not.toHaveBeenCalled()
      expect(store.setSyncCacheVersion).toHaveBeenLastCalledWith('delivery:0.2.44')
      expect(notifier.onSessionsChange.mock.calls[0][0]).toEqual([])
      expect(api).toHaveBeenCalledWith(`/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`)
    })

    it('rebuilds the local sync cache when the OTA cache version changes', async () => {
      const staleSession: NianSession = {
        id: 'stale',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Stale local',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T00:00:00.000Z',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z',
      }
      await store.putSession(staleSession)
      await store.setSyncCacheVersion('delivery:0.2.43')

      const versionedEngine = new SyncEngine({
        store,
        api,
        onChange: notifier,
        cacheVersion: 'delivery:0.2.44',
      })

      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await versionedEngine.boot()

      expect(store.resetPersonalData).toHaveBeenCalledTimes(1)
      expect(store.clearAll).not.toHaveBeenCalled()
      expect(store.setSyncCacheVersion).toHaveBeenLastCalledWith('delivery:0.2.44')
      expect(notifier.onSessionsChange.mock.calls[0][0]).toEqual([])
      expect(api).toHaveBeenCalledWith(`/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`)
      expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/sessions?updatedAfter='))
    })

    it('initializes the session sync cursor from local cache for migrated users', async () => {
      const session: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Cached',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T00:00:00.000Z',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:05:00.000Z',
      }
      await store.putSession(session)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path === '/sessions?limit=50') return { sessions: [] }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'm1',
                name: 'Macbook',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-04-07T10:00:00.000Z',
              },
            ],
          }
        }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      expect(store.setSessionSyncCursor).toHaveBeenCalledWith(
        new Date('2026-04-07T00:05:00.000Z').getTime(),
      )
    })

    it('backfills the recent session window when local cache exists so other-device sessions are not missed', async () => {
      const cached: NianSession = {
        id: 's1',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Cached',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T10:00:00.000Z',
        createdAt: '2026-04-07T10:00:00.000Z',
        updatedAt: '2026-04-07T10:00:00.000Z',
      }
      const remoteOnly: NianSession = {
        id: 's2',
        machineId: 'm1',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Remote only',
        status: 'active',
        workDir: '',
        lastActivityAt: '2026-04-07T09:00:00.000Z',
        createdAt: '2026-04-07T09:00:00.000Z',
        updatedAt: '2026-04-07T09:00:00.000Z',
      }
      await store.putSession(cached)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) {
          return { sessions: [cached, remoteOnly] }
        }
        if (path === '/machines') {
          return {
            machines: [
              {
                id: 'm1',
                name: 'Macbook',
                os: 'darwin',
                agentList: [],
                paired: true,
                online: true,
                lastSeen: '2026-04-07T10:00:00.000Z',
              },
            ],
          }
        }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      const stored = await store.getSessions()
      expect(stored.map((session) => session.id)).toEqual(expect.arrayContaining(['s1', 's2']))
      expect(api).toHaveBeenCalledWith(`/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`)
      expect(notifier.onSessionsChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 's1' }),
          expect.objectContaining({ id: 's2' }),
        ]),
      )
    })

    it('prunes cached sessions for machines that are no longer accessible', async () => {
      const kept: NianSession = {
        id: 's-kept',
        machineId: 'm-kept',
        userId: 'u1',
        agentType: 'claude',
        agentSessionId: null,
        title: 'Kept',
        status: 'active',
        workDir: '/repo',
        lastActivityAt: '2026-04-07T10:00:00.000Z',
        createdAt: '2026-04-07T10:00:00.000Z',
        updatedAt: '2026-04-07T10:00:00.000Z',
      }
      const stale: NianSession = {
        id: 's-stale',
        machineId: 'm-stale',
        userId: 'u1',
        agentType: 'codex',
        agentSessionId: null,
        title: 'Stale',
        status: 'active',
        workDir: '/old',
        lastActivityAt: '2026-04-07T09:00:00.000Z',
        createdAt: '2026-04-07T09:00:00.000Z',
        updatedAt: '2026-04-07T09:00:00.000Z',
      }
      const machine: Machine = {
        id: 'm-kept',
        name: 'Macbook',
        os: 'darwin',
        agentList: [],
        paired: true,
        online: true,
        lastSeen: '2026-04-07T10:00:00.000Z',
      }

      await store.putSession(kept)
      await store.putSession(stale)
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?updatedAfter=')) return { sessions: [] }
        if (path === `/sessions?limit=${DEFAULT_SESSIONS_PAGE_SIZE}`) {
          return { sessions: [kept, stale] }
        }
        if (path === '/machines') return { machines: [machine] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      expect(store.deleteSession).toHaveBeenCalledWith('s-stale')
      const stored = await store.getSessions()
      expect(stored.map((session) => session.id)).toEqual(['s-kept'])
      expect(notifier.onSessionsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 's-kept' }),
      ])
    })


    it('falls back to full fetch on cold start (no local data)', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path.startsWith('/sessions?limit=')) return { sessions: [] }
        if (path === '/machines') return { machines: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      expect(store.clearAll).not.toHaveBeenCalled()
      // Should push empty arrays from local cache
      expect(notifier.onSessionsChange.mock.calls[0][0]).toEqual([])
      expect(notifier.onMachinesChange.mock.calls[0][0]).toEqual([])
      expect(notifier.onMachinesRemoteResolved).toHaveBeenCalledTimes(1)
      // Should use full fetch (no updatedAfter)
      expect(api).toHaveBeenCalledWith(expect.stringContaining('/sessions?limit='))
    })

    it('does not resolve remote machines when the authoritative request fails', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === '/machines') throw new Error('network down')
        if (path.startsWith('/sessions?limit=')) return { sessions: [] }
        if (path === '/sessions/activities') return { activities: [] }
        return {}
      })

      await engine.boot()

      expect(notifier.onMachinesRemoteResolved).not.toHaveBeenCalled()
    })

    it('only boots once', async () => {
      ;(api as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [], machines: [] })

      await engine.boot()
      const callCount = (store.getSessions as ReturnType<typeof vi.fn>).mock.calls.length
      await engine.boot()

      expect((store.getSessions as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount)
    })
  })
})
