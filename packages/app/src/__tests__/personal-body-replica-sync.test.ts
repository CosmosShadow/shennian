// @covers src/features/chat/services/personalBodyReplicaSync.ts

import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_SYNC_ADVERTISED_CAPABILITIES,
  type Machine,
  type NianSession,
  type SessionActivitySnapshot,
  type SessionBodyDeltaEvent,
  type SessionHistorySyncParams,
  type SessionHistorySyncPage,
} from '@shennian/wire'
import {
  buildPersonalBodyReplicaMachineSignal,
  buildPersonalBodyReplicaSessionSignal,
  nextPersonalBodyReplicaGeneration,
  PersonalBodyReplicaSyncCoordinator,
  type PersonalBodyReplicaCoordinatorOptions,
} from '../features/chat/services/personalBodyReplicaCoordinator'
import {
  reportPersonalBodyReplicaFailure,
  shouldRecoverVisibleBodyAfterRun,
} from '../features/chat/services/visibleBodyRecovery'
import type {
  PersonalSessionBodyState,
  PersonalSessionBodyStore,
} from '../storage/personal-session-body-store.native'

function session(index: number, bodyRevision = 1): NianSession {
  const now = new Date(index).toISOString()
  return {
    id: `session-${index}`,
    machineId: 'machine-1',
    userId: 'account-1',
    agentType: 'codex',
    agentSessionId: `agent-${index}`,
    title: `Session ${index}`,
    status: 'active',
    workDir: '/project',
    bodyStorageMode: 'machine_local',
    localReady: true,
    bodyRevision,
    indexRevision: bodyRevision,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

const machine: Machine = {
  id: 'machine-1', name: 'Mac', os: 'darwin', agentList: ['codex'],
  paired: true, online: true, lastSeen: new Date().toISOString(),
  daemonInstallationId: 'daemon-1', sessionSyncProtocolVersion: 2,
  sessionSyncDataEpoch: 2,
  sessionSyncCapabilities: [...SESSION_SYNC_ADVERTISED_CAPABILITIES],
}

function state(sessionId: string, revision = 0): PersonalSessionBodyState {
  return {
    accountId: 'account-1', sessionId, cachedBodyRevision: revision,
    firstCachedSeq: revision > 0 ? 1 : null,
    lastCachedSeq: revision > 0 ? 1 : null,
    hasOlder: false, lastSyncedAt: null,
    lastAccessedAt: new Date(0).toISOString(), deletionRevision: 0, deleted: false,
  }
}

function fixture(
  sessions: NianSession[],
  currentSessionId: string | null = null,
  authoritativeRevision?: (session: NianSession) => number,
  overrides: Partial<PersonalBodyReplicaCoordinatorOptions> = {},
) {
  const states = new Map(sessions.map((item) => [item.id, state(item.id)]))
  let active = 0
  let maxActive = 0
  const sendWhenReady = vi.fn(async (_machineId: string, frame: {
    method: string
    params: Record<string, unknown>
  }) => {
    expect(frame.method).toBe('session.history.sync')
    active += 1
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    const sessionId = String(frame.params.sessionId)
    const syncId = String(frame.params.syncId)
    const afterRevision = Number(frame.params.afterRevision)
    const targetSession = sessions.find((item) => item.id === sessionId)
    const targetRevision = targetSession
      ? authoritativeRevision?.(targetSession) ?? targetSession.bodyRevision ?? 0
      : 0
    active -= 1
    return {
      type: 'res' as const, id: 'response', ok: true,
      payload: {
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
        sessionId, syncId, fromRevision: afterRevision,
        toRevision: targetRevision, targetRevision, hasMore: false,
        mutations: Array.from(
          { length: Math.max(0, targetRevision - afterRevision) },
          (_, index) => {
            const revision = afterRevision + index + 1
            return {
              protocolVersion: 2 as const,
              dataEpoch: 2 as const,
              daemonInstallationId: 'daemon-1',
              sessionId,
              subscriptionId: syncId,
              revision,
              mutation: 'append' as const,
              messageId: `message-${sessionId}-${revision}`,
              sequence: revision,
              message: {
                id: `message-${sessionId}-${revision}`,
                sessionId,
                role: 'agent' as const,
                ts: revision,
                payload: 'visible body',
              },
            }
          },
        ),
      },
    }
  })
  const store: PersonalSessionBodyStore = {
    getState: vi.fn(async (_accountId, sessionId) => states.get(sessionId) ?? null),
    getStates: vi.fn(async () => [...states.values()]),
    getMessages: vi.fn(async () => []),
    getMessagesByUserTurns: vi.fn(async () => []),
    applySnapshot: vi.fn(),
    applyPage: vi.fn(),
    applyDelta: vi.fn(async (_accountId, delta: SessionBodyDeltaEvent) => {
      const next = state(delta.sessionId, delta.toRevision)
      states.set(delta.sessionId, next)
      return next
    }),
    restoreSession: vi.fn(async (_accountId, sessionId, deletionRevision) => {
      states.set(sessionId, { ...state(sessionId), deletionRevision })
    }),
    markDeleted: vi.fn(async () => undefined),
    removeAccount: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
  }
  let current = currentSessionId
  const coordinator = new PersonalBodyReplicaSyncCoordinator({
    accountId: 'account-1', appInstallationId: 'app-install-1', store,
    getRelayManager: () => ({
      sendWhenReady,
      acquire: vi.fn(() => ({ getState: () => 'disconnected' })),
      release: vi.fn(),
      onStateChange: vi.fn(() => () => {}),
    } as never),
    getSessions: () => sessions,
    getMachines: () => [machine],
    getCurrentSessionId: () => current,
    ...overrides,
  })
  return {
    coordinator, store, states, sendWhenReady,
    getMaxActive: () => maxActive,
    setCurrent: (value: string | null) => { current = value },
  }
}

describe('personal body full local replica coordinator', () => {
  it('repairs only a focused visible session when its active run reaches terminal', () => {
    const active: SessionActivitySnapshot = {
      sessionId: 'session-1', runPhase: 'thinking', runId: 'run-1', canStop: true,
      startedAt: new Date(0).toISOString(), updatedAt: new Date(1).toISOString(),
    }
    expect(shouldRecoverVisibleBodyAfterRun(active, null, true)).toBe(true)
    expect(shouldRecoverVisibleBodyAfterRun(active, null, false)).toBe(false)
    expect(shouldRecoverVisibleBodyAfterRun(null, null, true)).toBe(false)
    expect(shouldRecoverVisibleBodyAfterRun(active, { ...active, runPhase: 'tool_running' }, true))
      .toBe(false)
  })

  it('logs replica failures without exposing error messages or transcript content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportPersonalBodyReplicaFailure('visible_sync', {
      sessionId: 'session-1', machineId: 'machine-1',
      error: new Error('secret transcript and bearer token'),
    })
    expect(warn).toHaveBeenCalledWith('[PersonalBodyReplica] operation failed', {
      stage: 'visible_sync', sessionId: 'session-1', machineId: 'machine-1', errorType: 'Error',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret transcript')
    warn.mockRestore()
  })

  it('allocates stream generations monotonically across coordinator remounts', () => {
    const first = nextPersonalBodyReplicaGeneration(0)
    const second = nextPersonalBodyReplicaGeneration(0)
    expect(second).toBeGreaterThan(first)
    expect(nextPersonalBodyReplicaGeneration(second + 10)).toBeGreaterThan(second + 10)
  })
  it('revives an explicitly cached Worker body before targeted sync', async () => {
    const worker = { ...session(9), id: 'sess_worker_linked' }
    const h = fixture([worker], worker.id)
    h.states.set(worker.id, {
      ...state(worker.id, 4),
      firstCachedSeq: null,
      lastCachedSeq: null,
      deleted: true,
    })

    await h.coordinator.syncVisibleSession(worker.id)

    expect(h.store.restoreSession).toHaveBeenCalledWith('account-1', worker.id, 0)
    expect(h.sendWhenReady).toHaveBeenCalledOnce()
    expect(h.states.get(worker.id)).toMatchObject({ cachedBodyRevision: 1, deleted: false })
  })

  it('keeps one independent stream per machine while concurrent sessions advance', async () => {
    const secondMachine: Machine = {
      ...machine,
      id: 'machine-2',
      name: 'Mac 2',
      daemonInstallationId: 'daemon-2',
    }
    const sessions = [
      session(1),
      session(2),
      { ...session(3), machineId: secondMachine.id },
      { ...session(4), machineId: secondMachine.id },
    ]
    const states = new Map(sessions.map((item) => [item.id, state(item.id, 1)]))
    const handlers = new Map<string, (event: { event: string; payload?: unknown }) => void>()
    const sends = new Map<string, ReturnType<typeof vi.fn>>()
    const committed: string[] = []
    const store: PersonalSessionBodyStore = {
      getState: vi.fn(async (_accountId, sessionId) => states.get(sessionId) ?? null),
      getStates: vi.fn(async () => [...states.values()]),
      getMessages: vi.fn(async () => []),
      getMessagesByUserTurns: vi.fn(async () => []),
      applySnapshot: vi.fn(),
      applyPage: vi.fn(),
      applyDelta: vi.fn(async (_accountId, delta: SessionBodyDeltaEvent) => {
        expect(states.get(delta.sessionId)?.cachedBodyRevision).toBe(delta.fromRevision)
        const next = state(delta.sessionId, delta.toRevision)
        states.set(delta.sessionId, next)
        return next
      }),
      restoreSession: vi.fn(async (_accountId, sessionId, deletionRevision) => {
        states.set(sessionId, { ...state(sessionId), deletionRevision })
      }),
      markDeleted: vi.fn(async () => undefined),
      removeAccount: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => {}),
    }
    const manager = {
      acquire: vi.fn((machineId: string, handler: (event: { event: string; payload?: unknown }) => void) => {
        handlers.set(machineId, handler)
        const source = machineId === machine.id ? machine : secondMachine
        const send = vi.fn(async (frame: { method: string; params: Record<string, unknown> }) => ({
          type: 'res' as const,
          id: 'response',
          ok: true,
          payload: {
            protocolVersion: 2,
            dataEpoch: 2,
            daemonInstallationId: source.daemonInstallationId,
            appInstallationId: 'app-install-1',
            streamId: frame.params.streamId,
            generation: frame.params.generation,
            highWatermarks: sessions
              .filter((item) => item.machineId === machineId)
              .map((item) => ({ sessionId: item.id, bodyRevision: 1 })),
          },
        }))
        sends.set(machineId, send)
        return { getState: () => 'connected', send, sendEvent: vi.fn() }
      }),
      release: vi.fn(),
      onStateChange: vi.fn(() => () => {}),
      sendWhenReady: vi.fn(),
    }
    const coordinator = new PersonalBodyReplicaSyncCoordinator({
      accountId: 'account-1',
      appInstallationId: 'app-install-1',
      store,
      getRelayManager: () => manager as never,
      getSessions: () => sessions,
      getMachines: () => [machine, secondMachine],
      getCurrentSessionId: () => null,
      onSessionCommitted: (sessionId) => { committed.push(sessionId) },
    })

    await coordinator.requestSync()
    await vi.waitFor(() => {
      expect(sends.get(machine.id)).toHaveBeenCalledOnce()
      expect(sends.get(secondMachine.id)).toHaveBeenCalledOnce()
    })

    for (const source of [machine, secondMachine]) {
      const machineSessions = sessions.filter((item) => item.machineId === source.id)
      const generation = Number(sends.get(source.id)?.mock.calls[0]?.[0].params.generation)
      handlers.get(source.id)?.({
        event: 'session.body.replica.delta',
        payload: {
          protocolVersion: 2,
          dataEpoch: 2,
          daemonInstallationId: source.daemonInstallationId,
          appInstallationId: 'app-install-1',
          streamId: `body_app-install-1_${source.id}`,
          generation,
          batches: machineSessions.map((item) => ({
            sessionId: item.id,
            fromRevision: 1,
            toRevision: 2,
            mutations: [{
              protocolVersion: 2,
              dataEpoch: 2,
              daemonInstallationId: source.daemonInstallationId,
              sessionId: item.id,
              subscriptionId: `body_app-install-1_${source.id}`,
              revision: 2,
              mutation: 'append',
              messageId: `${item.id}-message-2`,
              sequence: 2,
              message: {
                id: `${item.id}-message-2`,
                sessionId: item.id,
                role: 'agent',
                ts: 2,
                payload: `body from ${source.id}`,
              },
            }],
          })),
        },
      })
    }

    await vi.waitFor(() => {
      expect(committed).toHaveLength(4)
      expect([...states.values()].every((item) => item.cachedBodyRevision === 2)).toBe(true)
    })
    expect(manager.acquire).toHaveBeenCalledTimes(2)
    expect(manager.sendWhenReady).not.toHaveBeenCalled()
    coordinator.stop()
  })

  it('keeps one machine stream through a 100-request navigation storm', async () => {
    const indexed = session(1, 1)
    const other = session(2, 1)
    const states = new Map([
      [indexed.id, state(indexed.id, 1)],
      [other.id, state(other.id, 1)],
    ])
    let eventHandler: ((event: { event: string; payload?: unknown }) => void) | undefined
    const send = vi.fn(async (frame: { method: string; params: Record<string, unknown> }) => ({
      type: 'res' as const,
      id: 'response',
      ok: true,
      payload: frame.method === 'session.body.replica.subscribe'
        ? {
            protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
            appInstallationId: 'app-install-1', streamId: frame.params.streamId,
            generation: frame.params.generation,
            highWatermarks: [indexed, other].map((item) => ({ sessionId: item.id, bodyRevision: 1 })),
          }
        : { closed: true },
    }))
    const store: PersonalSessionBodyStore = {
      getState: vi.fn(async (_accountId, sessionId) => states.get(sessionId) ?? null),
      getStates: vi.fn(async () => [...states.values()]),
      getMessages: vi.fn(async () => []),
      getMessagesByUserTurns: vi.fn(async () => []),
      applySnapshot: vi.fn(),
      applyPage: vi.fn(),
      applyDelta: vi.fn(async (_accountId, delta: SessionBodyDeltaEvent) => {
        if ((states.get(delta.sessionId)?.cachedBodyRevision ?? 0) !== delta.fromRevision) {
          throw new Error('revision_gap')
        }
        const next = state(delta.sessionId, delta.toRevision)
        states.set(delta.sessionId, next)
        return next
      }),
      restoreSession: vi.fn(async (_accountId, sessionId, deletionRevision) => {
        states.set(sessionId, { ...state(sessionId), deletionRevision })
      }),
      markDeleted: vi.fn(async () => undefined),
      removeAccount: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => {}),
    }
    const manager = {
      acquire: vi.fn((_machineId: string, handler: typeof eventHandler) => {
        eventHandler = handler
        return { getState: () => 'connected', send, sendEvent: vi.fn() }
      }),
      release: vi.fn(),
      onStateChange: vi.fn(() => () => {}),
      sendWhenReady: vi.fn(),
    }
    const coordinator = new PersonalBodyReplicaSyncCoordinator({
      accountId: 'account-1', appInstallationId: 'app-install-1', store,
      getRelayManager: () => manager as never,
      getSessions: () => [indexed, other],
      getMachines: () => [machine],
      getCurrentSessionId: () => indexed.id,
    })

    await Promise.all(Array.from({ length: 100 }, () => coordinator.requestSync()))
    await vi.waitFor(() => {
      expect(send.mock.calls.filter(([frame]) =>
        frame.method === 'session.body.replica.subscribe')).toHaveLength(1)
    })
    expect(manager.acquire).toHaveBeenCalledOnce()
    expect(manager.sendWhenReady).not.toHaveBeenCalled()

    const generation = Number(send.mock.calls.find(([frame]) =>
      frame.method === 'session.body.replica.subscribe')?.[0].params.generation)

    eventHandler?.({
      event: 'session.body.replica.delta',
      payload: {
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
        appInstallationId: 'app-install-1', streamId: 'body_app-install-1_machine-1', generation,
        batches: [
          {
            // A broken range for one conversation must not block the next batch.
            sessionId: other.id, fromRevision: 0, toRevision: 2,
            mutations: [{
              protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
              sessionId: other.id, subscriptionId: 'body_app-install-1_machine-1',
              revision: 2, mutation: 'append', messageId: 'other-message-2', sequence: 2,
              message: { id: 'other-message-2', sessionId: other.id, role: 'agent', ts: 2, payload: 'gap' },
            }],
          },
          {
            sessionId: indexed.id, fromRevision: 1, toRevision: 2,
            mutations: [{
              protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'daemon-1',
              sessionId: indexed.id, subscriptionId: 'body_app-install-1_machine-1',
              revision: 2, mutation: 'append', messageId: 'message-2', sequence: 2,
              message: { id: 'message-2', sessionId: indexed.id, role: 'agent', ts: 2, payload: 'done' },
            }],
          },
        ],
      },
    })
    await vi.waitFor(() => expect(states.get(indexed.id)?.cachedBodyRevision).toBe(2))
    expect(states.get(other.id)?.cachedBodyRevision).toBe(1)
    expect(send.mock.calls.filter(([frame]) =>
      frame.method === 'session.body.replica.subscribe')).toHaveLength(1)
    coordinator.stop()
  })

  it('incrementally catches up all 65 sessions without evicting the oldest one', async () => {
    const sessions = Array.from({ length: 65 }, (_, index) => session(index + 1))
    const value = fixture(sessions)

    await value.coordinator.requestSync()

    expect(value.sendWhenReady).toHaveBeenCalledTimes(65)
    expect(value.store.applyDelta).toHaveBeenCalledTimes(65)
    expect(value.states.get('session-1')?.cachedBodyRevision).toBe(1)
    expect(value.states.get('session-65')?.cachedBodyRevision).toBe(1)
    expect(value.getMaxActive()).toBeLessThanOrEqual(2)
    value.coordinator.stop()
  })

  it('prioritizes but does not skip the visible session', async () => {
    const value = fixture([session(1)], 'session-1')

    await value.coordinator.requestSync()
    expect(value.sendWhenReady).toHaveBeenCalledOnce()
    expect(value.states.get('session-1')?.cachedBodyRevision).toBe(1)
    value.coordinator.stop()
  })

  it('requests only revisions missing after the last durable SQLite commit', async () => {
    const value = fixture([session(1, 2)])
    value.states.set('session-1', state('session-1', 1))

    await value.coordinator.requestSync()

    expect(value.sendWhenReady).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'session.history.sync',
        params: expect.objectContaining({ sessionId: 'session-1', afterRevision: 1 }),
      }),
      5_000,
      30_000,
    )
    expect(value.states.get('session-1')?.cachedBodyRevision).toBe(2)
    value.coordinator.stop()
  })

  it('refreshes only the visible Room-bound session when its Server index is stale', async () => {
    const roomSession = {
      ...session(1, 0),
      localReady: false,
      bodyRevision: 0,
      indexRevision: 0,
    }
    const backgroundSession = session(2, 0)
    const { coordinator, states, sendWhenReady } = fixture(
      [roomSession, backgroundSession],
      roomSession.id,
      (item) => (item.id === roomSession.id ? 5 : 7),
    )

    await coordinator.syncVisibleSession(roomSession.id)

    expect(sendWhenReady).toHaveBeenCalledTimes(1)
    expect(sendWhenReady.mock.calls[0]?.[1]).toMatchObject({
      method: 'session.history.sync',
      params: { sessionId: roomSession.id, afterRevision: 0 },
    })
    expect(states.get(roomSession.id)?.cachedBodyRevision).toBe(5)
    expect(states.get(backgroundSession.id)?.cachedBodyRevision).toBe(0)
  })

  it('treats a phone replica ahead of the cached index as converged', async () => {
    const value = fixture([session(1, 10)])
    value.states.set('session-1', state('session-1', 11))

    await Promise.all(Array.from({ length: 100 }, () => value.coordinator.requestSync()))

    expect(value.sendWhenReady).not.toHaveBeenCalled()
    expect(value.store.applySnapshot).not.toHaveBeenCalled()
    value.coordinator.stop()
  })

  it('never opens a background snapshot for an already indexed legacy window', async () => {
    const value = fixture([session(1, 10)])
    value.states.set('session-1', {
      ...state('session-1', 10),
      hasOlder: true,
    })

    await Promise.all(Array.from({ length: 100 }, () => value.coordinator.requestSync()))

    expect(value.sendWhenReady).not.toHaveBeenCalled()
    expect(value.store.applySnapshot).not.toHaveBeenCalled()
    expect(value.store.applyPage).not.toHaveBeenCalled()
    value.coordinator.stop()
  })

  it('keeps a daemon response ahead of the index without reopening a snapshot', async () => {
    const indexed = session(1, 1)
    const value = fixture([indexed], null, () => 2)

    await value.coordinator.requestSync()
    await Promise.all(Array.from({ length: 50 }, () => value.coordinator.requestSync()))

    expect(value.states.get(indexed.id)?.cachedBodyRevision).toBe(2)
    expect(value.sendWhenReady).toHaveBeenCalledOnce()
    expect(value.sendWhenReady.mock.calls[0]?.[1]).toMatchObject({
      method: 'session.history.sync',
      params: { afterRevision: 0 },
    })
    value.coordinator.stop()
  })

  it('ignores preview, activity and chat-message-only store updates', () => {
    const indexed = session(1, 3)
    const other = session(2, 4)
    const sessionSignal = buildPersonalBodyReplicaSessionSignal([indexed, other])
    expect(buildPersonalBodyReplicaSessionSignal([other, {
      ...indexed,
      lastMessagePreview: 'new preview',
      lastMessagePreviewMessageId: 'message-3',
      lastMessagePreviewAt: new Date(3).toISOString(),
      lastActivityAt: new Date(4).toISOString(),
      activity: {
        sessionId: indexed.id,
        runPhase: 'thinking',
        runId: 'run-1',
        canStop: true,
        startedAt: new Date(3).toISOString(),
        updatedAt: new Date(4).toISOString(),
      },
    }])).toBe(sessionSignal)
    expect(buildPersonalBodyReplicaSessionSignal([
      { ...indexed, bodyRevision: 4 },
    ])).not.toBe(sessionSignal)

    const machineSignal = buildPersonalBodyReplicaMachineSignal([machine])
    expect(buildPersonalBodyReplicaMachineSignal([{
      ...machine,
      lastSeen: new Date(Date.now() + 10_000).toISOString(),
      agents: [],
      sessionSyncCapabilities: [...(machine.sessionSyncCapabilities ?? [])].reverse(),
    }])).toBe(machineSignal)
    expect(buildPersonalBodyReplicaMachineSignal([{
      ...machine,
      online: false,
    }])).not.toBe(machineSignal)
  })
})


function cloudPage(params: SessionHistorySyncParams, revision = 1): SessionHistorySyncPage {
  return {
    protocolVersion: params.protocolVersion, dataEpoch: params.dataEpoch,
    daemonInstallationId: params.daemonInstallationId, sessionId: params.sessionId,
    syncId: params.syncId, fromRevision: params.afterRevision, toRevision: revision,
    targetRevision: revision, hasMore: false,
    mutations: Array.from({ length: Math.max(0, revision - params.afterRevision) }, (_, index) => ({
      protocolVersion: params.protocolVersion, dataEpoch: params.dataEpoch,
      daemonInstallationId: params.daemonInstallationId, sessionId: params.sessionId,
      subscriptionId: params.syncId, revision: params.afterRevision + index + 1,
      mutation: 'append', messageId: `cloud-${index}`, sequence: params.afterRevision + index + 1,
      message: { id: `cloud-${index}`, sessionId: params.sessionId, role: 'agent', ts: index, payload: 'cloud body' },
    })),
  }
}

describe('cloud body recovery without an online origin', () => {
  it('loads history into the local store while the origin is offline and Relay is absent', async () => {
    const readCloudPage = vi.fn(async (params: SessionHistorySyncParams) => cloudPage(params, 3))
    const h = fixture([session(1, 3)], null, undefined, {
      getMachines: () => [{ ...machine, online: false }], getRelayManager: () => null, readCloudPage,
    })
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(readCloudPage).toHaveBeenCalledOnce()
    expect(h.states.get('session-1')?.cachedBodyRevision).toBe(3)
    expect(h.sendWhenReady).not.toHaveBeenCalled()
  })
  it('persists each cloud page and sends only the remaining revision on the next request', async () => {
    const readCloudPage = vi.fn(async (params: SessionHistorySyncParams) => ({
      ...cloudPage(params, params.afterRevision + 1), targetRevision: 2, hasMore: params.afterRevision === 0,
    }))
    const h = fixture([session(1, 2)], null, undefined, {
      getMachines: () => [{ ...machine, online: false }], getRelayManager: () => null, readCloudPage,
    })
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(readCloudPage.mock.calls.map(call => call[0].afterRevision)).toEqual([0, 1])
    expect(h.store.applyDelta).toHaveBeenCalledTimes(2)
    expect(h.states.get('session-1')?.cachedBodyRevision).toBe(2)
  })
  it('skips network requests for history already committed locally', async () => {
    const readCloudPage = vi.fn()
    const h = fixture([session(1)], null, undefined, { getMachines: () => [{ ...machine, online: false }], readCloudPage })
    h.states.set('session-1', state('session-1', 1))
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(readCloudPage).not.toHaveBeenCalled(); expect(h.sendWhenReady).not.toHaveBeenCalled()
  })
  it('falls back to the existing daemon protocol for an old/disabled Server', async () => {
    const h = fixture([session(1)], null, undefined, { readCloudPage: vi.fn().mockRejectedValue(new Error('404')) })
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(h.states.get('session-1')?.cachedBodyRevision).toBe(1)
    expect(h.sendWhenReady).toHaveBeenCalledOnce()
  })
  it('keeps a partial local replica and retries until the cloud catches up with the index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let available = 1
    const h = fixture([session(1, 3)], null, undefined, {
      getMachines: () => [{ ...machine, online: false }], getRelayManager: () => null,
      readCloudPage: async params => cloudPage(params, available),
    })
    try {
      await h.coordinator.requestSync()
      expect(h.states.get('session-1')?.cachedBodyRevision).toBe(1)
      // The targeted priority path may retry immediately after cloud progress.
      available = 3
      await h.coordinator.syncVisibleSession('session-1')
      expect(h.states.get('session-1')?.cachedBodyRevision).toBe(3)
      expect(h.store.applySnapshot).not.toHaveBeenCalled()
    } finally { h.coordinator.stop(); warn.mockRestore() }
  })
  it('does not regress a phone already ahead through the live stream', async () => {
    const readCloudPage = vi.fn(async (params: SessionHistorySyncParams) => cloudPage(params, 1))
    const h = fixture([session(1, 1)], null, undefined, { readCloudPage })
    h.states.set('session-1', state('session-1', 2))
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(readCloudPage).not.toHaveBeenCalled()
    expect(h.states.get('session-1')?.cachedBodyRevision).toBe(2)
  })
  it('rejects a cross-session cloud response before falling back to the authorized daemon', async () => {
    const h = fixture([session(1)], null, undefined, {
      readCloudPage: async params => ({ ...cloudPage(params), sessionId: 'other-session' }),
    })
    await h.coordinator.requestSync(); h.coordinator.stop()
    expect(h.sendWhenReady).toHaveBeenCalledOnce()
    expect(h.store.applyDelta).toHaveBeenCalledOnce()
    expect(h.states.has('other-session')).toBe(false)
  })
  it('does not write a delayed response after coordinator stop/account switch', async () => {
    let resolve!: (page: SessionHistorySyncPage) => void
    let request!: SessionHistorySyncParams
    const h = fixture([session(1)], null, undefined, {
      readCloudPage: params => { request = params; return new Promise(done => { resolve = done }) },
    })
    const work = h.coordinator.requestSync()
    await vi.waitFor(() => expect(resolve).toBeDefined())
    h.coordinator.stop(); resolve(cloudPage(request))
    await work
    expect(h.store.applyDelta).not.toHaveBeenCalled()
  })
})


describe('targeted replica scheduling without account-wide SQLite scans', () => {
  it('reads only changed session targets and states, while full recovery still checks the whole inventory', async () => {
    const sessions = Array.from({ length: 5000 }, (_, index) => session(index + 1))
    const getSessions = vi.fn(async () => sessions)
    const getSession = vi.fn(async (id: string) => sessions.find(item => item.id === id))
    const h = fixture(sessions, null, undefined, { getSessions, getSession })
    try {
      await h.coordinator.requestSync('session-42')
      expect(getSessions).not.toHaveBeenCalled()
      expect(h.store.getStates).not.toHaveBeenCalled()
      expect(getSession).toHaveBeenCalledWith('session-42')
      expect(h.sendWhenReady).toHaveBeenCalledTimes(1)
      expect(h.states.get('session-42')?.cachedBodyRevision).toBe(1)
      expect(h.states.get('session-43')?.cachedBodyRevision).toBe(0)
      // The high-water can arrive before the next index signal. Cached-ahead
      // targets stay safe and must not force repair or reset the local body.
      h.states.set('session-42', state('session-42', 3))
      await h.coordinator.requestSync('session-42')
      expect(h.sendWhenReady).toHaveBeenCalledTimes(1)
      await h.coordinator.requestSync()
      expect(getSessions).toHaveBeenCalled()
      expect(h.store.getStates).toHaveBeenCalled()
      expect(h.states.get('session-43')?.cachedBodyRevision).toBe(1)
    } finally { h.coordinator.stop() }
  })

  it('does not lose targeted or full requests arriving during a targeted read', async () => {
    const sessions = [session(1), session(2)]
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const getSessions = vi.fn(async () => sessions)
    const getSession = vi.fn(async (id: string) => { if (id === 'session-1') await gate; return sessions.find(s => s.id === id) })
    const h = fixture(sessions, null, undefined, { getSessions, getSession })
    try {
      const first = h.coordinator.requestSync('session-1')
      const second = h.coordinator.requestSync('session-2')
      release()
      await Promise.all([first, second])
      expect(getSessions).not.toHaveBeenCalled()
      expect(h.states.get('session-1')?.cachedBodyRevision).toBe(1)
      expect(h.states.get('session-2')?.cachedBodyRevision).toBe(1)
      const targeted = h.coordinator.requestSync('session-1')
      await Promise.all([targeted, h.coordinator.requestSync()])
      expect(getSessions).toHaveBeenCalledOnce()
    } finally { h.coordinator.stop() }
  })

  it('uses targeted visible-session recovery and ignores missing/deleted session identities', async () => {
    const sessions = [session(1)]
    const getSessions = vi.fn(async () => sessions)
    const getSession = vi.fn(async (id: string) => sessions.find(s => s.id === id))
    const h = fixture(sessions, null, undefined, { getSessions, getSession })
    try {
      await h.coordinator.syncVisibleSession('session-1')
      expect(getSessions).not.toHaveBeenCalled()
      expect(h.states.get('session-1')?.cachedBodyRevision).toBe(1)
      await h.coordinator.requestSync('missing')
      sessions[0] = { ...sessions[0], deletedAt: new Date().toISOString(), bodyRevision: 2 }
      await h.coordinator.requestSync('session-1')
      expect(h.sendWhenReady).toHaveBeenCalledTimes(1)
    } finally { h.coordinator.stop() }
  })

  it('retains the full-read fallback for coordinators without targeted storage support', async () => {
    const sessions = [session(1)]
    const getSessions = vi.fn(async () => sessions)
    const h = fixture(sessions, null, undefined, { getSessions })
    try {
      await h.coordinator.requestSync('session-1')
      expect(getSessions).toHaveBeenCalledOnce()
      expect(h.states.get('session-1')?.cachedBodyRevision).toBe(1)
    } finally { h.coordinator.stop() }
  })
})


describe('replica retries stop after convergence or target removal', () => {
  it.each(['converged', 'removed', 'deleted', 'unavailable'] as const)(
    'does not enter a zero-delay full-scan loop when a failed target is %s', async reason => {
      vi.useFakeTimers()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const sessions = [session(1, 3)]
      let online = true
      const getSessions = vi.fn(async () => sessions)
      const h = fixture(sessions, null, undefined, {
        getSessions, getMachines: () => online ? [machine] : [],
      })
      try {
        h.sendWhenReady.mockRejectedValueOnce(new Error('temporary_disconnect'))
        await h.coordinator.requestSync()
        expect(vi.getTimerCount()).toBe(1)
        if (reason === 'converged') h.states.set('session-1', state('session-1', 3))
        else if (reason === 'removed') sessions.splice(0)
        else if (reason === 'deleted') sessions[0] = { ...sessions[0], deletedAt: new Date().toISOString() }
        else online = false
        await vi.advanceTimersToNextTimerAsync()
        expect(getSessions).toHaveBeenCalledTimes(2)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(getSessions).toHaveBeenCalledTimes(2)
      } finally { h.coordinator.stop(); warn.mockRestore(); vi.useRealTimers() }
    },
  )
})
