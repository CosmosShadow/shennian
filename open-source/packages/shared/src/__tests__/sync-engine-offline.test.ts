// @covers open-source/packages/shared/src/sync-engine.ts

import { describe, expect, it, vi } from 'vitest'
import type { Machine, NianProject, NianSession, AgentInfo } from '@shennian/wire'
import { SyncEngine, type ChangeNotifier } from '../sync-engine'
import { getSessionListSummary } from '../lib/session-list'
import type { ClientIndexStore } from '../storage'

function makeStore(session: NianSession): ClientIndexStore {
  return {
    getSessions: vi.fn(async () => [session]),
    getSession: vi.fn(async (id: string) => (id === session.id ? session : undefined)),
    putSession: vi.fn(),
    putSessions: vi.fn(),
    deleteSession: vi.fn(),
    getSessionDeletion: vi.fn(async () => undefined),
    getPendingSessionDeletions: vi.fn(async () => []),
    putSessionDeletion: vi.fn(),
    removeSessionDeletion: vi.fn(),
    getSessionSyncCursor: vi.fn(async () => 0),
    setSessionSyncCursor: vi.fn(),
    getSessionBackfillComplete: vi.fn(async () => true),
    setSessionBackfillComplete: vi.fn(),
    getSessionBackfillCursor: vi.fn(async () => 0),
    setSessionBackfillCursor: vi.fn(),
    getSyncCacheVersion: vi.fn(async () => null),
    setSyncCacheVersion: vi.fn(),
    getProjects: vi.fn(async () => [] as NianProject[]),
    putProjects: vi.fn(),
    getMachines: vi.fn(async () => [] as Machine[]),
    putMachines: vi.fn(),
    updateMachineStatus: vi.fn(),
    updateMachineAgents: vi.fn(),
    clearAll: vi.fn(),
  }
}

function makeSession(): NianSession {
  const now = new Date('2026-05-09T00:00:00.000Z').toISOString()
  return {
    id: 's-1',
    machineId: 'm-1',
    userId: 'u-1',
    agentType: 'claude',
    agentSessionId: null,
    sourceMode: null,
    modelId: null,
    title: 'Cached session',
    status: 'active',
    workDir: '/tmp/project',
    lastMessagePreview: 'cached',
    lastActivityAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    machineName: 'Mac',
    userState: null,
    activity: null,
  }
}

function makeNotifier() {
  const notifier: ChangeNotifier = {
    onSessionsChange: vi.fn(),
    onSessionUpdate: vi.fn(),
    onSessionDelete: vi.fn(),
    onMachinesChange: vi.fn(),
    onProjectsChange: vi.fn(),
    onMachineStatus: vi.fn(),
    onMachineAgentList: vi.fn(),
    onMachineAgents: vi.fn((_machineId: string, _agentList: string[], _agents: AgentInfo[]) => {}),
    onUpgradeEvent: vi.fn(),
    onSyncStart: vi.fn(),
    onSyncEnd: vi.fn(),
  }
  return notifier
}

describe('SyncEngine offline boot', () => {
  it('publishes SQLite bootstrap without making a network request in local-only mode', async () => {
    const session = makeSession()
    const store = makeStore(session)
    const notifier = makeNotifier()
    const api = vi.fn(async () => { throw new Error('network must not be called') })
    const engine = new SyncEngine({ store, api, onChange: notifier })

    await engine.boot({ localOnly: true })

    expect(notifier.onSessionsChange).toHaveBeenCalledWith([session])
    expect(notifier.onSyncEnd).toHaveBeenCalledOnce()
    expect(api).not.toHaveBeenCalled()
  })

  it('publishes cached sessions and ends syncing when remote session fetch fails', async () => {
    const session = makeSession()
    const store = makeStore(session)
    const notifier = makeNotifier()
    const engine = new SyncEngine({
      store,
      api: vi.fn(async () => {
        throw new Error('network down')
      }),
      onChange: notifier,
    })

    await engine.boot()

    expect(notifier.onSessionsChange).toHaveBeenCalledWith([session])
    expect(notifier.onSyncEnd).toHaveBeenCalled()
  })
})


describe('working state recovery after weak network', () => {
  it.each([false, true])('reconciles the authoritative snapshot (still running: %s)', async (stillRunning) => {
    const session = makeSession()
    session.activity = {
      sessionId: session.id, runId: 'run', runPhase: 'tool_running', toolCallCount: 63,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    let cached = [session]
    const store = makeStore(session)
    vi.mocked(store.getSessions).mockImplementation(async () => cached)
    vi.mocked(store.putSessions).mockImplementation(async (incoming) => {
      cached = cached.map((item) => incoming.find((next) => next.id === item.id) ?? item)
    })
    const notifier = makeNotifier()
    let snapshotAvailable = false
    const api = vi.fn(async (path: string) => {
      if (path === '/sessions/activities') {
        if (!snapshotAvailable) throw new Error('network interrupted')
        return { activities: stillRunning ? [{ ...session.activity, toolCallCount: 64 }] : [] }
      }
      if (path === '/machines') return { machines: [{ id: session.machineId, online: true }] }
      if (path === '/projects') return { projects: [] }
      if (path.startsWith('/sessions')) return { sessions: [] }
      throw new Error(`Unexpected endpoint: ${path}`)
    })
    const engine = new SyncEngine({ store, api: api as never, onChange: notifier })
    await engine.boot({ localOnly: true })
    await engine.onReconnect()
    expect(getSessionListSummary(cached[0]).useActiveColor).toBe(true)
    expect(cached[0].activity?.toolCallCount).toBe(63)

    snapshotAvailable = true
    await engine.onReconnect()
    expect(getSessionListSummary(cached[0]).useActiveColor).toBe(stillRunning)
    expect(cached[0].activity?.toolCallCount ?? null).toBe(stillRunning ? 64 : null)
    expect(notifier.onSessionsChange).toHaveBeenLastCalledWith(cached)
  })
})
