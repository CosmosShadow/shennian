// @covers src/manager/registry.ts
// @covers src/manager/runtime.ts
// @covers src/manager/worker-ipc.ts
// @covers src/manager/worker-markdown.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Manager event inbox', () => {
  let tempDir = ''
  let previousHome: string | undefined

  beforeEach(() => {
    previousHome = process.env.SHENNIAN_HOME
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-manager-inbox-'))
    process.env.SHENNIAN_HOME = tempDir
    vi.resetModules()
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.SHENNIAN_HOME
    else process.env.SHENNIAN_HOME = previousHome
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('rejects events after worker ownership or project scope changes', async () => {
    const { ManagerRegistry } = await import('../manager/registry.js')
    const registry = new ManagerRegistry()
    registry.upsertManager({ sessionId: 'manager-1', workDir: '/project-a', modelId: 'codex' })
    registry.upsertManager({ sessionId: 'manager-2', workDir: '/project-b', modelId: 'claude' })
    registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'codex',
      workDir: '/project-a',
    })

    registry.updateWorker('worker-1', { managedBy: 'manager-2' })
    const wrongOwner = registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.error',
      priority: 'normal',
      summary: 'must not be delivered',
    })
    expect(wrongOwner).toBeNull()

    registry.updateWorker('worker-1', { managedBy: 'manager-1', workDir: '/project-b' })
    const wrongProject = registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.aborted',
      priority: 'normal',
      summary: 'must not be delivered',
    })
    expect(wrongProject).toBeNull()
    expect(registry.listInboxEvents('manager-1')).toEqual([])
  })

  it('lists and resolves only Workers owned by the exact Manager', async () => {
    const { ManagerRegistry } = await import('../manager/registry.js')
    const { handleWorkerIpcRoute } = await import('../manager/worker-ipc.js')
    const registry = new ManagerRegistry()
    registry.upsertManager({ sessionId: 'manager-old', workDir: '/project', modelId: 'codex' })
    registry.upsertManager({ sessionId: 'manager-new', workDir: '/project', modelId: 'codex' })
    registry.addWorker({
      managerSessionId: 'manager-old',
      sessionId: 'worker-old',
      agentType: 'claude',
      workDir: '/project',
    })

    expect(registry.listWorkers('manager-new')).toEqual([])
    expect(registry.getWorkerForManager('manager-new', 'worker-old')).toBeUndefined()
    expect(registry.listWorkers('manager-old')).toEqual([
      expect.objectContaining({ sessionId: 'worker-old', managedBy: 'manager-old' }),
    ])

    const host = {
      registry,
      getRuntime: () => ({ sessions: new Map(), chatQueue: null }),
      dispatchReq: vi.fn(),
      dispatchChatEnqueue: vi.fn(),
      appendManagerVisibleMarkdown: vi.fn(),
    }
    await expect(
      handleWorkerIpcRoute(
        host as never,
        '/sessions/list',
        { managerSessionId: 'manager-new' },
        '',
      ),
    ).resolves.toMatchObject({ body: { sessions: [] } })
    for (const route of ['/sessions/read', '/sessions/send', '/sessions/stop']) {
      await expect(
        handleWorkerIpcRoute(
          host as never,
          route,
          { managerSessionId: 'manager-new', sessionId: 'worker-old', message: 'must fail' },
          '',
        ),
      ).rejects.toThrow('Worker not found in this manager scope')
    }
    expect(host.dispatchReq).not.toHaveBeenCalled()
    expect(host.dispatchChatEnqueue).not.toHaveBeenCalled()
  })

  it('ignores managed Worker Agent, model, and directory overrides', async () => {
    const { ManagerRegistry } = await import('../manager/registry.js')
    const { handleWorkerIpcRoute } = await import('../manager/worker-ipc.js')
    const registry = new ManagerRegistry()
    registry.upsertManager({
      sessionId: 'manager-fixed',
      workDir: tempDir,
      modelId: 'codex',
      agentType: 'codex',
      providerModelId: 'gpt-manager',
      defaultWorkerAgentType: 'codex',
      defaultWorkerModelId: 'gpt-manager',
    })
    const dispatchChatEnqueue = vi.fn(async () => {})
    const host = {
      registry,
      getRuntime: () => ({ sessions: new Map(), chatQueue: null }),
      dispatchReq: vi.fn(),
      dispatchChatEnqueue,
      appendManagerVisibleMarkdown: vi.fn(),
    }

    await expect(
      handleWorkerIpcRoute(
        host as never,
        '/sessions/start',
        {
          managerSessionId: 'manager-fixed',
          agentType: 'claude',
          modelId: 'claude-opus',
          workDir: '/different-project',
          title: '固定配置验收',
          message: '执行任务',
        },
        '',
      ),
    ).resolves.toMatchObject({ body: { ok: true } })
    expect(dispatchChatEnqueue).toHaveBeenCalledWith(
      expect.stringMatching(/^sess_worker_/),
      'codex',
      tempDir,
      '执行任务',
      null,
      'gpt-manager',
      'manager-fixed',
      undefined,
    )
  })

  it('retires a Manager before stopping all of its active and queued Workers', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const stop = vi.fn(async () => {})
    const managerStop = vi.fn(async () => {})
    const removeAllListeners = vi.fn()
    const purgeSession = vi.fn()
    const markSessionAborted = vi.fn()
    const end = vi.fn()
    const sessions = new Map<string, any>([
      [
        'manager-old',
        {
          managedRoomContextToken: 'manager-token',
          heartbeatTimer: null,
          adapter: { stop: managerStop, removeAllListeners: vi.fn() },
        },
      ],
      [
        'worker-1',
        {
          managedRoomContextToken: 'worker-token',
          heartbeatTimer: null,
          adapter: { stop, removeAllListeners },
        },
      ],
    ])
    const revokeManagedRoomContextToken = vi.fn()
    const service = new ManagerRuntimeService({
      getRuntime: () =>
        ({
          sessions,
          chatQueue: { purgeSession },
          runJournal: { markSessionAborted },
          recoveryBarrier: { end },
          revokeManagedRoomContextToken,
        }) as any,
      dispatchReq: async () => {},
    })
    service.registerManager({
      sessionId: 'manager-old',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-old',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-old',
      sessionId: 'worker-queued',
      agentType: 'codex',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-old',
      workerSessionId: 'worker-1',
      kind: 'worker.health',
      priority: 'normal',
      summary: 'running',
    })

    await expect(service.retireManagerAndWorkers('manager-old')).resolves.toEqual([
      'worker-1',
      'worker-queued',
    ])

    expect(service.registry.getManager('manager-old')).toBeUndefined()
    expect(service.registry.listInboxEvents('manager-old')).toEqual([])
    expect(service.registry.getWorkerForManager('manager-old', 'worker-1')).toBeUndefined()
    expect(sessions.has('worker-1')).toBe(false)
    expect(sessions.has('manager-old')).toBe(false)
    expect(managerStop).toHaveBeenCalledOnce()
    expect(markSessionAborted).toHaveBeenCalledWith('worker-1')
    expect(markSessionAborted).toHaveBeenCalledWith('worker-queued')
    expect(end).toHaveBeenCalledWith('worker-1')
    expect(end).toHaveBeenCalledWith('worker-queued')
    expect(purgeSession).toHaveBeenCalledWith('worker-1')
    expect(purgeSession).toHaveBeenCalledWith('worker-queued')
    expect(purgeSession).toHaveBeenCalledWith('manager-old')
    expect(revokeManagedRoomContextToken).toHaveBeenCalledWith('worker-token')
    expect(revokeManagedRoomContextToken).toHaveBeenCalledWith('manager-token')
    expect(removeAllListeners).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()

    service.noteAgentEvent('worker-1', {
      state: 'final',
      runId: 'late-worker-run',
      seq: 1,
      message: 'must not reach old Manager',
    })
    expect(service.registry.listInboxEvents('manager-old')).toEqual([])
  })

  it('retries a failed Worker stop without losing control or delivering late events', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const { handleManagedRoomRestart } = await import('../session/handlers/room-managed.js')
    const failedStop = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider still running'))
      .mockResolvedValueOnce(undefined)
    const successfulStop = vi.fn(async () => {})
    const purgeSession = vi.fn()
    const sendRes = vi.fn()
    const runtime = {
      client: { sendRes },
      sessions: new Map<string, any>([
        [
          'worker-fails-once',
          {
            managedRoomContextToken: null,
            heartbeatTimer: null,
            adapter: { stop: failedStop, removeAllListeners: vi.fn() },
          },
        ],
        [
          'worker-succeeds',
          {
            managedRoomContextToken: null,
            heartbeatTimer: null,
            adapter: { stop: successfulStop, removeAllListeners: vi.fn() },
          },
        ],
      ]),
      chatQueue: { purgeSession },
      runJournal: { markSessionAborted: vi.fn() },
      recoveryBarrier: { end: vi.fn() },
      managerRuntime: null as any,
    }
    const service = new ManagerRuntimeService({
      getRuntime: () => runtime as any,
      dispatchReq: async () => {},
    })
    runtime.managerRuntime = service
    service.registerManager({
      sessionId: 'manager-old',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-old',
      sessionId: 'worker-fails-once',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-old',
      sessionId: 'worker-succeeds',
      agentType: 'codex',
      workDir: '/project',
    })
    const restart = vi.fn(async () => ({ binding: { id: 'binding-1' } }))
    const request = {
      type: 'req',
      id: 'restart-manager',
      method: 'room.agent.restart-managed',
      params: {
        roomId: 'room-1',
        bindingId: 'binding-1',
        agentIdentityId: 'agent-1',
        previousNianSessionId: 'manager-old',
        nianSessionId: 'manager-new',
        assignmentIntentId: 'intent-1',
        agentType: 'codex',
      },
    } as const

    await expect(
      handleManagedRoomRestart(runtime as never, { restart } as never, request as never),
    ).rejects.toThrow('Failed to retire every Manager or Worker session')

    expect(service.registry.getManager('manager-old')).toBeUndefined()
    expect(runtime.sessions.has('worker-fails-once')).toBe(true)
    expect(runtime.sessions.has('worker-succeeds')).toBe(false)
    expect(service.registry.load().workers).toHaveProperty('worker-fails-once')
    expect(service.registry.load().workers).not.toHaveProperty('worker-succeeds')
    expect(successfulStop).toHaveBeenCalledOnce()
    expect(restart).not.toHaveBeenCalled()

    service.noteAgentEvent('worker-fails-once', {
      state: 'final',
      runId: 'late-run',
      seq: 1,
      message: 'late result',
    })
    expect(service.registry.listInboxEvents('manager-old')).toEqual([])

    await expect(
      handleManagedRoomRestart(runtime as never, { restart } as never, request as never),
    ).resolves.toBeUndefined()

    expect(failedStop).toHaveBeenCalledTimes(2)
    expect(successfulStop).toHaveBeenCalledOnce()
    expect(runtime.sessions.has('worker-fails-once')).toBe(false)
    expect(service.registry.load().workers).not.toHaveProperty('worker-fails-once')
    expect(
      purgeSession.mock.calls.filter(([sessionId]) => sessionId === 'worker-fails-once'),
    ).toHaveLength(2)
    expect(restart).toHaveBeenCalledOnce()
    expect(sendRes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'restart-manager', ok: true }),
    )
  })

  it('queues normal terminal events while Manager is running and drains them without aborting', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const dispatched: Array<{ method: string; params?: unknown }> = []
    const sessions = new Map<string, any>([
      ['manager-1', { currentRunId: 'manager-run', workDir: '/project', agentType: 'codex' }],
    ])
    const adapter = new EventEmitter()
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      dispatchReq: async (req) => {
        dispatched.push({ method: req.method, params: req.params })
        if (req.method === 'chat.enqueue') {
          sessions.get('manager-1').currentRunId = 'manager-inbox-run'
          adapter.emit('agentEvent', {
            state: 'start',
            runId: 'manager-inbox-run',
            seq: 0,
            agentSessionId: 'native-manager-1',
          })
        }
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      providerModelId: 'gpt-5.6-sol',
      managedRoomBound: true,
      status: 'running',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.bindManagerAdapterEvents('manager-1', adapter as any)

    service.noteAgentEvent('worker-1', {
      state: 'final',
      runId: 'worker-run',
      seq: 4,
      message: 'worker result',
    })
    await Promise.resolve()
    expect(dispatched).toEqual([])
    expect(service.registry.listInboxEvents('manager-1')).toHaveLength(1)

    sessions.get('manager-1').currentRunId = null
    service.updateManagerStatus('manager-1', 'idle')
    await (service as any).drainManagerInbox('manager-1')

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({
      method: 'chat.enqueue',
      params: {
        protocolVersion: expect.any(Number),
        dataEpoch: expect.any(Number),
        daemonInstallationId: expect.any(String),
        sessionId: 'manager-1',
        agentType: 'codex',
        sessionMode: 'manager',
        modelId: 'gpt-5.6-sol',
        managedAgentDirect: true,
        clientMessageId: expect.stringMatching(/^manager-inbox:[a-f0-9]{32}$/),
      },
    })
    expect(service.registry.listInboxEvents('manager-1')).toEqual([])
    expect(dispatched.some((request) => request.method === 'chat.abort')).toBe(false)
  })

  it('keeps inbox events durable and resets Manager idle when synthetic enqueue throws', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const sessions = new Map<string, any>()
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      dispatchReq: async () => {
        throw new Error('synthetic enqueue failed')
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'pi-coding-agent',
      agentType: 'pi-coding-agent',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'codex',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.final',
      priority: 'normal',
      summary: 'done',
    })

    await (service as any).drainManagerInbox('manager-1')

    expect(service.registry.listInboxEvents('manager-1')).toHaveLength(1)
    expect(service.registry.getManager('manager-1')).toMatchObject({
      status: 'idle',
      deliveringInboxEventIds: [],
    })
  })

  it('revalidates worker.health permission without adding a Room reply target', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const dispatched: Array<{ method: string; params?: Record<string, unknown> }> = []
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: new Map() }) as any,
      dispatchReq: async (req) => {
        dispatched.push({ method: req.method, params: req.params as Record<string, unknown> })
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      managedRoomBound: true,
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.health',
      priority: 'normal',
      summary: 'still running',
    })

    await (service as any).drainManagerInbox('manager-1')

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({
      method: 'chat.enqueue',
      params: {
        sessionId: 'manager-1',
        sessionMode: 'manager',
        managedAgentDirect: true,
      },
    })
    expect(dispatched[0]?.params).not.toHaveProperty('replyTarget')
  })

  it('carries the exact Worker run Room into its Manager continuation', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const dispatched: Array<{ params?: Record<string, unknown> }> = []
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: new Map() }) as any,
      dispatchReq: async (req) => {
        dispatched.push({ params: req.params as Record<string, unknown> })
        return { durableQueueHandoff: true }
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      managedRoomBound: true,
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-room',
      agentType: 'claude',
      workDir: '/project',
    })

    const roomOrigin = {
      registryKey: 'registry-exact-room',
      registrationEpoch: 3,
      bindingId: 'binding-exact-room',
      roomId: 'room-exact',
    }
    service.prepareWorkerTurnOrigin('worker-room', roomOrigin)
    service.noteAgentEvent('worker-room', {
      state: 'start',
      runId: 'worker-run',
      seq: 1,
    })
    service.noteAgentEvent('worker-room', {
      state: 'final',
      runId: 'worker-run',
      seq: 2,
      message: 'verified result',
    })
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    expect(dispatched[0]?.params).toMatchObject({
      managerEventRoomOrigin: roomOrigin,
      managerEventId: expect.stringMatching(/^manager-inbox:/),
    })
    expect(dispatched[0]?.params).not.toHaveProperty('replyTarget')
    expect(dispatched[0]?.params).not.toHaveProperty('externalChannel')
  })

  it('keeps Room authority isolated by Worker run including late terminals', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: new Map() }) as any,
      dispatchReq: async () => ({ durableQueueHandoff: true }),
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      status: 'running',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    const roomA = {
      registryKey: 'registry',
      registrationEpoch: 1,
      bindingId: 'binding-a',
      roomId: 'room-a',
    }
    const roomB = {
      registryKey: 'registry',
      registrationEpoch: 1,
      bindingId: 'binding-b',
      roomId: 'room-b',
    }
    service.prepareWorkerTurnOrigin('worker-1', roomA)
    service.noteAgentEvent('worker-1', { state: 'start', runId: 'run-a', seq: 1 })
    service.prepareWorkerTurnOrigin('worker-1')
    service.noteAgentEvent('worker-1', { state: 'start', runId: 'run-private', seq: 2 })
    service.prepareWorkerTurnOrigin('worker-1', roomB)
    service.noteAgentEvent('worker-1', { state: 'start', runId: 'run-b', seq: 3 })
    service.noteAgentEvent('worker-1', {
      state: 'final',
      runId: 'run-private',
      seq: 4,
      message: 'private',
    })
    service.noteAgentEvent('worker-1', { state: 'final', runId: 'run-b', seq: 5, message: 'B' })
    service.noteAgentEvent('worker-1', {
      state: 'final',
      runId: 'run-a',
      seq: 6,
      message: 'late A',
    })
    expect(
      service.registry.listInboxEvents('manager-1').map((event) => [event.runId, event.roomOrigin]),
    ).toEqual([
      ['run-private', null],
      ['run-b', roomB],
      ['run-a', roomA],
    ])
  })

  it('drops persisted Worker run Room authority when a daemon starts', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: new Map() }) as any,
      dispatchReq: async () => {},
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      status: 'running',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.updateWorker('worker-1', {
      runRoomOrigins: {
        old: {
          registryKey: 'registry',
          registrationEpoch: 1,
          bindingId: 'binding',
          roomId: 'room',
        },
      },
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      kind: 'worker.final',
      priority: 'normal',
      runId: 'old',
      summary: 'old result',
      roomOrigin: {
        registryKey: 'registry',
        registrationEpoch: 1,
        bindingId: 'binding',
        roomId: 'room',
      },
    })
    await service.start()
    expect(
      service.registry.getWorkerForManager('manager-1', 'worker-1')?.runRoomOrigins,
    ).toBeUndefined()
    expect(service.registry.listInboxEvents('manager-1')[0]?.roomOrigin).toBeUndefined()
    await service.stop()
  })

  it('does not require Room authorization for an ordinary standalone Manager wake', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const dispatched: Array<{ params?: Record<string, unknown> }> = []
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions: new Map() }) as any,
      dispatchReq: async (req) => {
        dispatched.push({ params: req.params as Record<string, unknown> })
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.final',
      priority: 'normal',
      summary: 'done',
    })

    await (service as any).drainManagerInbox('manager-1')

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.params).not.toHaveProperty('managedAgentDirect')
  })

  it('converges a stale registry-only running Worker instead of sending health forever', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const service = new ManagerRuntimeService({
      getRuntime: () =>
        ({
          sessions: new Map(),
          chatQueue: { getSnapshot: () => ({ pending: [] }) },
        }) as any,
      dispatchReq: async () => {},
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'claude',
      agentType: 'claude',
      controllerKind: 'ephemeral',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-orphan',
      agentType: 'claude',
      workDir: '/project',
    })
    const staleAt = new Date(Date.now() - 20 * 60_000).toISOString()
    service.registry.updateWorker('worker-orphan', {
      createdAt: staleAt,
      lastActivityAt: staleAt,
      runId: 'old-run',
      status: 'running',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-orphan',
      kind: 'worker.health',
      priority: 'normal',
      runId: 'old-run',
      summary: 'stale health',
    })
    ;(service as any).recoverPersistedInboxDeliveries()
    expect(service.registry.listInboxEvents('manager-1')).toEqual([])
    ;(service as any).scanWorkerHealth()

    expect(service.registry.getWorkerForManager('manager-1', 'worker-orphan')).toMatchObject({
      status: 'error',
      summary: expect.stringContaining('遗留的运行状态收敛为失败'),
    })
    expect(service.registry.listInboxEvents('manager-1')).toEqual([
      expect.objectContaining({
        workerSessionId: 'worker-orphan',
        kind: 'worker.error',
        runId: 'old-run',
      }),
    ])
  })

  it('does not acknowledge a swallowed synthetic enqueue without a provider start', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const sessions = new Map<string, any>()
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      // This reproduces SessionManager's former behavior: an internal error was
      // converted to ok:false on the wire while dispatchReq resolved normally.
      dispatchReq: async () => ({ durableQueueHandoff: false }),
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'pi-coding-agent',
      agentType: 'pi-coding-agent',
      status: 'idle',
    })
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'codex',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.final',
      priority: 'normal',
      summary: 'done',
    })

    await (service as any).drainManagerInbox('manager-1')

    expect(service.registry.listInboxEvents('manager-1')).toHaveLength(1)
    expect(service.registry.getManager('manager-1')).toMatchObject({
      status: 'idle',
      deliveringInboxEventIds: [],
    })
  })

  it('recovers stale running state after daemon restart and retains inbox for redelivery', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const sessions = new Map<string, any>()
    const first = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      dispatchReq: async () => {},
    })
    first.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'pi-coding-agent',
      agentType: 'pi-coding-agent',
      status: 'running',
    })
    first.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'codex',
      workDir: '/project',
    })
    const event = first.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.final',
      priority: 'normal',
      summary: 'done',
    })!
    first.registry.upsertManager({
      ...first.registry.getManager('manager-1')!,
      status: 'running',
      deliveringInboxEventIds: [event.id],
    })

    const restarted = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      dispatchReq: async () => {
        throw new Error('offline during restart')
      },
    })
    ;(restarted as any).recoverPersistedInboxDeliveries()
    await vi.waitFor(() => {
      expect(restarted.registry.getManager('manager-1')).toMatchObject({
        status: 'idle',
        deliveringInboxEventIds: [],
      })
    })

    expect(restarted.registry.listInboxEvents('manager-1')).toHaveLength(1)
  })

  it('interrupts an active Manager only for an explicitly high-priority inbox event', async () => {
    const { ManagerRuntimeService } = await import('../manager/runtime.js')
    const dispatched: Array<{ method: string; params?: unknown }> = []
    const sessions = new Map<string, any>([
      ['manager-1', { currentRunId: 'manager-run', workDir: '/project', agentType: 'codex' }],
    ])
    const adapter = new EventEmitter()
    const service = new ManagerRuntimeService({
      getRuntime: () => ({ sessions }) as any,
      dispatchReq: async (req) => {
        dispatched.push({ method: req.method, params: req.params })
        if (req.method === 'chat.enqueue') {
          sessions.get('manager-1').currentRunId = 'manager-resumed-run'
          adapter.emit('agentEvent', {
            state: 'start',
            runId: 'manager-resumed-run',
            seq: 0,
            agentSessionId: 'native-manager-1',
          })
        }
        return req.method === 'chat.enqueue' ? { durableQueueHandoff: true } : undefined
      },
    })
    service.registerManager({
      sessionId: 'manager-1',
      workDir: '/project',
      modelId: 'codex',
      agentType: 'codex',
      providerModelId: 'gpt-5.6-sol',
      status: 'running',
    })
    service.bindManagerAdapterEvents('manager-1', adapter as any)
    service.registry.addWorker({
      managerSessionId: 'manager-1',
      sessionId: 'worker-1',
      agentType: 'claude',
      workDir: '/project',
    })
    service.registry.enqueueInboxEvent({
      managerSessionId: 'manager-1',
      workerSessionId: 'worker-1',
      runId: 'worker-run',
      kind: 'worker.error',
      priority: 'high',
      summary: 'Worker requires immediate intervention.',
    })

    await (service as any).drainManagerInbox('manager-1')

    expect(dispatched.map((request) => request.method)).toEqual(['chat.abort', 'chat.enqueue'])
    for (const request of dispatched) {
      expect(request.params).toMatchObject({
        protocolVersion: expect.any(Number),
        dataEpoch: expect.any(Number),
        daemonInstallationId: expect.any(String),
      })
    }
    expect(service.registry.listInboxEvents('manager-1')).toEqual([])
  })
})
