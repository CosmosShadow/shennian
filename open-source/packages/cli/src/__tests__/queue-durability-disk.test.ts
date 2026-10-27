// @covers src/session/queue.ts
// @covers src/session/store.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../session/types.js'
import { normalizeQueuedModelId } from '../session/queue-helpers.js'

vi.mock('../session/index-publisher.js', () => ({
  requestSessionIndexPublish: vi.fn(),
}))


let tempHome: string
const managers: Array<{ stop(): void }> = []

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-queue-disk-'))
  vi.stubEnv('SHENNIAN_HOME', tempHome)
  vi.resetModules()
})

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function request(id: string, clientMessageId: string, text: string): ReqFrame {
  return {
    type: 'req',
    id,
    method: 'chat.enqueue',
    params: {
      sessionId: 'session-durable-disk',
      clientMessageId,
      text,
      agentType: 'codex',
      workDir: tempHome,
    },
  }
}

function runtime(busy: boolean) {
  const sendRes = vi.fn()
  const sendEvent = vi.fn()
  const sessions = new Map()
  if (busy) {
    sessions.set('session-durable-disk', {
      currentRunId: 'run-in-progress',
      currentRunPhase: 'running',
    })
  }
  return {
    runtime: {
      client: { sendRes, sendEvent },
      sessions,
      resolvePath: (value: string) => value,
    } as unknown as SessionManagerRuntime,
    sendRes,
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for durable queue drain')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('ChatQueueManager real-disk durability', () => {
  it('persists the queue when Windows rejects fsync on read-only handles', async () => {
    const storage = await import('../session/queue-storage.js')
    const realOpenSync = fs.openSync.bind(fs)
    const realFsyncSync = fs.fsyncSync.bind(fs)
    const flagsByDescriptor = new Map<number, string>()
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
      const descriptor = realOpenSync(file, flags, mode)
      flagsByDescriptor.set(descriptor, String(flags))
      return descriptor
    })
    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      if (flagsByDescriptor.get(descriptor) === 'r') {
        throw Object.assign(new Error('Windows FlushFileBuffers requires a writable handle'), { code: 'EPERM' })
      }
      return realFsyncSync(descriptor)
    })

    storage.writeQueue({ sessions: { 'session-durable-disk': [] } })
    expect(storage.readQueue()).toEqual({ sessions: { 'session-durable-disk': [] } })
  })

  it('normalizes legacy blank queued model ids to the provider default', () => {
    expect(normalizeQueuedModelId('')).toBeUndefined()
    expect(normalizeQueuedModelId('   ')).toBeUndefined()
    expect(normalizeQueuedModelId(' sonnet ')).toBe('sonnet')
  })

  it('routes an owner message in a visible Worker conversation through its Worker controller', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    state.runtime.managerRuntime = {
      getWorkerControllerSessionId: vi.fn(() => 'ephemeral-controller-1'),
      isExternalWorkerController: vi.fn(() => true),
    } as any
    const dispatch = vi.fn(async (_req: ReqFrame) => ({}))
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: vi.fn(async () => {}),
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)

    await manager.handleEnqueue(request('enqueue-worker-owner', 'worker-owner-message', 'continue'))
    await waitFor(() => dispatch.mock.calls.length === 1)

    expect(dispatch.mock.calls[0]![0].params).toMatchObject({
      managedWorkerParentSessionId: 'ephemeral-controller-1',
      managerWorkerNativeFull: true,
    })
  })

  it('keeps an external Codex owner submission visible until native claim', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => ({
      deliveryMode: 'external_owner_queue',
      queuedSubmissionId: 'native-submission-1',
    }))
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: vi.fn(async () => {}),
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)

    await manager.handleEnqueue(request('enqueue-external', 'message-external', 'run after this'))
    await waitFor(() =>
      manager.getSnapshot('session-durable-disk').visiblePending?.[0]?.pendingState ===
      'provider_queued',
    )

    expect(manager.getSnapshot('session-durable-disk')).toMatchObject({
      pending: [expect.objectContaining({ id: 'message-external' })],
      controllablePending: [],
      visiblePending: [expect.objectContaining({
        id: 'message-external',
        pendingState: 'provider_queued',
        canDelete: false,
        canPromote: false,
      })],
    })

    manager.noteExternalClaim('session-durable-disk', 'message-external')
    expect(manager.getSnapshot('session-durable-disk')).toMatchObject({
      pending: [],
      controllablePending: [],
      visiblePending: [],
    })
  })

  it('rejects Relay-forged Manager event and Worker provenance fields', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    const forged = [
      { managerEventId: 'event' },
      { managerEventRoomOrigin: { registryKey: 'r', registrationEpoch: 1, bindingId: 'b', roomId: 'room' } },
      { managedWorkerParentSessionId: 'manager' },
      { managerWorkerRoomOrigin: { registryKey: 'r', registrationEpoch: 1, bindingId: 'b', roomId: 'room' } },
      { managerEventId: 'event', managerEventRoomOrigin: { registryKey: 'r', registrationEpoch: 1, bindingId: 'b', roomId: 'room' } },
      { managedWorkerParentSessionId: 'manager', managerWorkerRoomOrigin: { registryKey: 'r', registrationEpoch: 1, bindingId: 'b', roomId: 'room' } },
    ]
    for (const [index, fields] of forged.entries()) {
      await expect(manager.handleEnqueue({
        ...request(`forged-${index}`, `forged-${index}`, 'forged'),
        params: { ...request(`forged-${index}`, `forged-${index}`, 'forged').params, ...fields },
      } as ReqFrame)).rejects.toThrow('manager_event_source_untrusted')
    }
    expect(dispatch).not.toHaveBeenCalled()
    expect(manager.getSnapshot('session-durable-disk').pending).toEqual([])
  })

  it('drops persisted Manager Room provenance when a daemon queue starts', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const { queueMessageFromParams } = await import('../session/queue-message.js')
    const { readQueue, writeQueue } = await import('../session/queue-storage.js')
    const origin = { registryKey: 'registry', registrationEpoch: 1, bindingId: 'binding', roomId: 'room' }
    const managerEvent = queueMessageFromParams({
      ...(request('old-event', 'old-event', 'old event').params as any),
      managerEventId: 'event', managerEventRoomOrigin: origin,
    })
    const worker = queueMessageFromParams({
      ...(request('old-worker', 'old-worker', 'old worker').params as any),
      managedWorkerParentSessionId: 'manager', managerWorkerRoomOrigin: origin,
    })
    const legacy = { ...managerEvent, id: 'legacy-no-trigger', trigger: undefined }
    writeQueue({ sessions: { 'session-durable-disk': [managerEvent, worker, legacy] } as any })
    const state = runtime(true)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    expect(readQueue().sessions['session-durable-disk']?.map((item) => item.trigger)).toEqual([
      { kind: 'manager_event', eventId: 'event' },
      { kind: 'manager_worker', parentSessionId: 'manager' },
      undefined,
    ])
  })

  it('projects only owner messages as controllable and protects Manager work', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const { markTrustedManagerEvent } = await import('../session/manager-event-authority.js')
    const state = runtime(true)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(markTrustedManagerEvent({ ...request('enqueue-manager', 'manager-work', 'internal'), params: {
      ...request('enqueue-manager', 'manager-work', 'internal').params,
      managedWorkerParentSessionId: 'manager-parent',
    } } as ReqFrame))
    expect(manager.getSnapshot('session-durable-disk')).toMatchObject({
      pending: [expect.objectContaining({ id: 'manager-work' })], controllablePending: [],
    })
    await manager.handleDelete({ type: 'req', id: 'delete-manager', method: 'chat.queue.delete',
      params: { sessionId: 'session-durable-disk', queueMessageId: 'manager-work' } } as ReqFrame)
    expect(state.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      ok: false, error: 'managed_agent_queue_mutation_forbidden',
    }))
  })

  it('strips stale Room routing while reconstructing a Manager event capability', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const { markTrustedManagerEvent } = await import('../session/manager-event-authority.js')
    const state = runtime(false)
    const revokeManagedRoomContextToken = vi.fn()
    state.runtime.revokeManagedRoomContextToken = revokeManagedRoomContextToken
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: dispatch,
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)
    const prepared = {
      agentType: 'codex', workDir: tempHome, agentSessionId: 'native-manager',
      systemPrompt: 'private Manager event prompt', sessionMode: 'manager',
      managerConfig: null, managerDefaultWorkerAgentType: 'codex',
      managerDefaultWorkerModelId: null, roomContextRegistryKey: 'room-registry',
      managedRoomContextToken: `mrc_${'a'.repeat(43)}`,
      managedAgentPolicy: {},
      managedRoomPromptSnapshot: {
        managedRoomPolicyVersion: 'managed-room-surface-v6',
        runtimePermissionPolicyHash: 'policy-hash',
      },
    }
    manager.setManagedAgentDirectTurnPreparer(async () => prepared as any)

    await manager.handleEnqueue(markTrustedManagerEvent({
      ...request('manager-event', 'manager-event-message', 'internal result'),
      params: {
        ...request('manager-event', 'manager-event-message', 'internal result').params,
        sessionMode: 'manager', managerEventId: 'manager-event-id',
        replyTarget: 'stale-room-reply-target',
        externalChannel: { type: 'legacy-room-channel' },
      },
    } as ReqFrame))
    await waitFor(() => dispatch.mock.calls.length === 1)

    expect(dispatch.mock.calls[0]?.[0].params).toMatchObject({
      managedRecoverySource: 'manager_event',
      systemPrompt: 'private Manager event prompt',
    })
    expect(dispatch.mock.calls[0]?.[0].params).not.toMatchObject({
      replyTarget: 'stale-room-reply-target',
      externalChannel: { type: 'legacy-room-channel' },
      roomContextRegistryKey: 'room-registry',
    })
    expect(dispatch.mock.calls[0]?.[0].params).toMatchObject({
      managedRoomContextToken: prepared.managedRoomContextToken,
    })
    expect(dispatch.mock.calls[0]?.[0].params).toMatchObject({
      queuedBatchItems: [expect.objectContaining({
        systemPrompt: 'private Manager event prompt',
        externalChannel: null,
        replyTarget: null,
      })],
    })
    expect(revokeManagedRoomContextToken).not.toHaveBeenCalled()
  })

  it('stops unsupported active providers and dispatches only the selected owner message', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    Object.assign(state.runtime.sessions.get('session-durable-disk')!, { adapter: {}, workDir: tempHome,
      agentType: 'codex', agentSessionId: null, journalRunId: 'journal-run-in-progress' })
    state.runtime.runJournal = {
      get: vi.fn(() => ({ deliveryMode: 'direct' })),
    } as any
    const dispatch = vi.fn(async (_req: ReqFrame) => {
      state.runtime.sessions.set('session-durable-disk', {
        currentRunId: 'promoted-run',
      } as any)
    })
    const interrupt = vi.fn(async () => { state.runtime.sessions.clear() })
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch, interruptQueuedSession: interrupt })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue-b', 'owner-b', 'B'))
    await manager.handleEnqueue(request('enqueue-c', 'owner-c', 'C'))
    await manager.handlePromote({ type: 'req', id: 'promote-c', method: 'chat.queue.promote',
      params: { sessionId: 'session-durable-disk', queueMessageId: 'owner-c' } } as ReqFrame)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ params: { text: 'C' } })
    expect(state.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      ok: true, payload: expect.objectContaining({ mode: 'restarted', promotedMessageIds: ['owner-c'] }),
    }))
  })

  it('keeps the active turn and marks every injected owner message executing', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    const injectActiveInput = vi.fn(async () => {})
    const active = {
      currentRunId: 'run-in-progress', journalRunId: 'journal-1', currentRunPhase: 'running',
      workDir: tempHome, agentType: 'codex', agentSessionId: null,
      adapter: { supportsActiveInput: true, injectActiveInput },
    }
    state.runtime.sessions.set('session-durable-disk', active as any)
    state.runtime.runJournal = { get: vi.fn(() => ({ source: 'personal', deliveryMode: 'direct',
      agentType: 'codex', workDir: tempHome, agentSessionId: null, modelId: null, reasoningEffort: null })) } as any
    const registerManagedSend = vi.fn()
    const cancelManagedSend = vi.fn()
    state.runtime.nativeFusion = { registerManagedSend, cancelManagedSend } as any
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue-inject', 'owner-inject', 'correct it'))
    const dispatchedAt = Date.now() + 60_000
    vi.spyOn(Date, 'now').mockReturnValue(dispatchedAt)
    await manager.handlePromote({ type: 'req', id: 'promote-inject', method: 'chat.queue.promote',
      params: { sessionId: 'session-durable-disk', queueMessageId: 'owner-inject' } } as ReqFrame)
    expect(injectActiveInput).toHaveBeenCalledWith(expect.objectContaining({ text: 'correct it' }))
    const { getCanonicalSessionStore } = await import('../session/store.js')
    expect(getCanonicalSessionStore().getMessageState('session-durable-disk', 'owner-inject')?.message?.ts)
      .toBe(dispatchedAt)
    expect(registerManagedSend).toHaveBeenCalledWith(expect.objectContaining({
      canonicalMessageId: 'owner-inject',
      sourceAgentType: 'codex',
      text: 'correct it',
      managedEchoPolicy: 'suppress_following',
    }))
    expect(cancelManagedSend).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(manager.getSnapshot('session-durable-disk').pending).toEqual([])
    expect(state.sendRes).toHaveBeenLastCalledWith(expect.objectContaining({
      ok: true, payload: expect.objectContaining({ mode: 'injected' }),
    }))
  })

  it('does not expose an idle message after the scheduler has claimed it', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    let finishDispatch!: () => void
    const dispatchStarted = new Promise<void>((resolve) => {
      finishDispatch = resolve
    })
    const dispatch = vi.fn(async () => {
      state.runtime.sessions.set('session-durable-disk', {
        currentRunId: 'run-starting',
        currentRunPhase: 'thinking',
      } as any)
      await dispatchStarted
    })
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: dispatch,
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)

    await manager.handleEnqueue(request('enqueue-idle', 'owner-idle', 'start now'))
    await waitFor(() => dispatch.mock.calls.length === 1)
    expect(manager.getSnapshot('session-durable-disk')).toMatchObject({
      busy: true,
      pending: [expect.objectContaining({ id: 'owner-idle' })],
      controllablePending: [],
    })
    finishDispatch()
    await waitFor(() => manager.getSnapshot('session-durable-disk').pending.length === 0)
  })

  it('persists Manager Worker authority and restores the parent at dispatch', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const { markTrustedManagerEvent } = await import('../session/manager-event-authority.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: dispatch,
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)
    await manager.handleEnqueue(markTrustedManagerEvent({
      ...request('enqueue-worker', 'worker-message-1', 'do work'),
      params: {
        ...request('enqueue-worker', 'worker-message-1', 'do work').params,
        managedWorkerParentSessionId: 'manager-parent-1',
      },
    } as ReqFrame))
    await waitFor(() => dispatch.mock.calls.length === 1)
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      method: 'chat.send',
      params: { managedWorkerParentSessionId: 'manager-parent-1' },
    })
  })

  it('drains after a lost idle notification without opening the queue UI', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue', 'stable-idle', 'next'))
    expect(dispatch).not.toHaveBeenCalled()
    state.runtime.sessions.clear()
    await waitFor(() => dispatch.mock.calls.length === 1)
    expect(manager.getSnapshot('session-durable-disk').pending).toEqual([])
  }, 30_000)

  it('recovers transient dispatch failure with the same message ID without a UI read', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    const dispatch = vi.fn().mockRejectedValueOnce(new Error('transport unavailable')).mockResolvedValue(undefined)
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue', 'stable-retry', 'next'))
    state.runtime.sessions.clear()
    manager.noteTerminal('session-durable-disk')
    await waitFor(() => dispatch.mock.calls.length === 2)
    expect(dispatch.mock.calls.map(([frame]) => frame.params.clientMessageId)).toEqual(['stable-retry', 'stable-retry'])
    const store = await import('../session/store.js')
    expect(store.readMessages('session-durable-disk').filter((message) => message.id === 'stable-retry')).toHaveLength(1)
  }, 30_000)

  it('does not retry an irrecoverable managed claim/source binding conflict forever', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    const dispatch = vi.fn(async () => {
      throw new Error('managed claim session conflicts with source binding native-session-1')
    })
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue', 'stable-terminal-conflict', 'next'))
    state.runtime.sessions.clear()
    manager.noteTerminal('session-durable-disk')
    await waitFor(() => dispatch.mock.calls.length === 1)
    await waitFor(() => manager.getSnapshot('session-durable-disk').pending.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(dispatch).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('terminalizes a stale pre-trigger managed Worker message after dispatch cannot recover', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const storage = await import('../session/queue-storage.js')
    const state = runtime(true)
    state.runtime.managerRuntime = { isManagedWorkerSession: () => true } as any
    const dispatch = vi.fn(async () => { throw new Error('unknown legacy dispatch failure') })
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue', 'legacy-client-id', 'next'))
    const queue = storage.readQueue()
    const legacy = queue.sessions['session-durable-disk']![0]!
    delete legacy.clientMessageId
    delete legacy.trigger
    legacy.createdAt = new Date(Date.now() - 20 * 60_000).toISOString()
    storage.writeQueue(queue)
    state.runtime.sessions.clear()
    manager.noteTerminal('session-durable-disk')
    await waitFor(() => dispatch.mock.calls.length === 1)
    await waitFor(() => manager.getSnapshot('session-durable-disk').pending.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(dispatch).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('skips a deleted old Room owner without blocking its replacement', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const { NativeSourceDeletionStore } = await import('../native-fusion/native-source-deletions.js')
    new NativeSourceDeletionStore().recordSession({ sessionId: 'deleted-owner', deletionRevision: 1 })
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    manager.setManagedRoomTurnPreparer(async () => prepared())
    await manager.enqueueManagedRoomBatch([roomInput('deleted-owner'), roomInput('new-owner')])
    await waitFor(() => dispatch.mock.calls.length === 1)
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ params: { sessionId: 'new-owner' } })
    expect(manager.getSnapshot('deleted-owner').pending).toEqual([])
  }, 30_000)

  it('isolates canonical commit failure and heals the durable queue without another Room poll', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const store = await import('../session/store.js')
    vi.spyOn(store, 'appendMessage').mockImplementationOnce(() => { throw new Error('disk temporarily unavailable') })
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    manager.setManagedRoomTurnPreparer(async () => prepared())
    await expect(manager.enqueueManagedRoomBatch([roomInput('failing-owner'), roomInput('healthy-owner')]))
      .rejects.toThrow('disk temporarily unavailable')
    await waitFor(() => dispatch.mock.calls.some(([frame]) => frame.params.sessionId === 'healthy-owner'))
    await waitFor(() => dispatch.mock.calls.length === 2)
    expect(dispatch.mock.calls.map(([frame]) => frame.params.sessionId)).toEqual(['healthy-owner', 'failing-owner'])
    expect(store.readMessages('failing-owner').filter((message) => message.id === 'room-stable')).toHaveLength(1)
  }, 30_000)

  it('retains pending work when shutdown interrupts Room preparation', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    let release!: (value: ReturnType<typeof prepared>) => void
    const prepare = vi.fn(() => new Promise<ReturnType<typeof prepared>>((resolve) => { release = resolve }))
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    manager.setManagedRoomTurnPreparer(prepare)
    await manager.enqueueManagedRoomBatch([roomInput('pending-owner')])
    await waitFor(() => prepare.mock.calls.length === 1)
    manager.stop()
    release(prepared())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(dispatch).not.toHaveBeenCalled()
    expect(manager.getSnapshot('pending-owner').pending).toHaveLength(1)
  }, 30_000)

  it('does not dispatch a retired queue while its Room authority request is in flight', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    let release!: (value: ReturnType<typeof prepared>) => void
    const prepare = vi.fn(() => new Promise<ReturnType<typeof prepared>>((resolve) => { release = resolve }))
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    manager.setManagedRoomTurnPreparer(prepare)
    await manager.enqueueManagedRoomBatch([roomInput('retired-owner')])
    await waitFor(() => prepare.mock.calls.length === 1)
    manager.purgeSession('retired-owner')
    release(prepared())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(dispatch).not.toHaveBeenCalled()
    expect(manager.getSnapshot('retired-owner').pending).toEqual([])
  }, 30_000)

  it('persists compatible batches across restart and deduplicates a replay after a lost ACK', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const store = await import('../session/store.js')
    const beforeRestart = runtime(true)
    const firstProcessDispatch = vi.fn(async () => {})
    const firstManager = new ChatQueueManager({
      getRuntime: () => beforeRestart.runtime,
      dispatchReq: firstProcessDispatch,
      dispatchQueuedReq: firstProcessDispatch,
  })

    managers.push(firstManager)
    await firstManager.handleEnqueue(request('enqueue-2', 'client-message-2', 'second'))
    await firstManager.handleEnqueue(request('enqueue-3', 'client-message-3', 'third'))

    const queueFile = path.join(
      tempHome,
      'personal-sync',
      '2',
      'outbound-queue.json',
    )
    const persistedBeforeReplay = fs.readFileSync(queueFile, 'utf8')
    expect(JSON.parse(persistedBeforeReplay).sessions['session-durable-disk']
      .map((message: { clientMessageId: string }) => message.clientMessageId))
      .toEqual(['client-message-2', 'client-message-3'])

    // The daemon committed both messages but its ACK for the first queued turn
    // was lost. Replaying the same identity must return the durable status and
    // leave both the queue file and canonical body byte-for-byte deduplicated.
    await firstManager.handleEnqueue(request(
      'enqueue-2-replayed',
      'client-message-2',
      'second',
    ))
    expect(fs.readFileSync(queueFile, 'utf8')).toBe(persistedBeforeReplay)
    expect(store.getMessageDeliveryStatus(
      'session-durable-disk',
      'client-message-2',
    )).toMatchObject({
      state: 'queued',
      clientMessageId: 'client-message-2',
      messageId: 'client-message-2',
    })
    expect(store.readMessages('session-durable-disk')
      .filter((message) => message.id === 'client-message-2')).toHaveLength(1)
    expect(firstProcessDispatch).not.toHaveBeenCalled()

    // A new queue manager represents a fresh daemon process reading the same
    // files. It must drain owner-authored items as separate adapter turns while
    // retaining their separate canonical identities.
    firstManager.stop()
    const afterRestart = runtime(false)
    const dispatched: ReqFrame[] = []
    const restartedManager = new ChatQueueManager({
      getRuntime: () => afterRestart.runtime,
      dispatchReq: vi.fn(async () => {}),
      dispatchQueuedReq: vi.fn(async (frame) => {
        dispatched.push(frame)
        afterRestart.runtime.sessions.set('session-durable-disk', {
          currentRunId: `run-${dispatched.length}`,
        } as any)
      }),
    })
    managers.push(restartedManager)
    await waitFor(() => dispatched.length === 1)
    expect(dispatched[0]?.params).toMatchObject({
      clientMessageId: 'client-message-2',
      text: 'second',
    })
    expect(restartedManager.getSnapshot('session-durable-disk').pending)
      .toEqual([expect.objectContaining({ clientMessageId: 'client-message-3' })])
    afterRestart.runtime.sessions.clear()
    restartedManager.noteTerminal('session-durable-disk')
    await waitFor(() => dispatched.length === 2)
    expect(dispatched[1]?.params).toMatchObject({
      clientMessageId: 'client-message-3',
      text: 'third',
    })
    expect(restartedManager.getSnapshot('session-durable-disk').pending).toEqual([])
    expect(store.readMessages('session-durable-disk')
      .filter((message) => message.id === 'client-message-2')).toHaveLength(1)
    expect(store.readMessages('session-durable-disk')
      .filter((message) => message.id === 'client-message-3')).toHaveLength(1)
  }, 30_000)

  it('clears a legacy dispatch marker that has no Journal or active Provider evidence', async () => {
    const { ChatQueueManager } = await import('../session/queue.js')
    const state = runtime(true)
    state.runtime.runJournal = {} as any
    state.runtime.sessions.set('session-durable-disk', {
      currentRunId: 'dispatch:orphaned',
      currentRunPhase: 'thinking',
      journalRunId: null,
      adapter: { getStatus: vi.fn(async () => ({ active: false })) },
    } as any)
    const dispatch = vi.fn(async (_req: ReqFrame) => {})
    const manager = new ChatQueueManager({
      getRuntime: () => state.runtime,
      dispatchReq: dispatch,
      dispatchQueuedReq: dispatch,
    })
    managers.push(manager)
    await manager.handleEnqueue(request('enqueue-stale', 'stable-stale', 'continue'))
    await waitFor(() => dispatch.mock.calls.length === 1)
    expect(state.runtime.sessions.get('session-durable-disk')?.currentRunId).toBeNull()
  })

  it('grants Owner private turns Room send without Worker origin propagation, and keeps Manager events scoped to their origin', async () => {
    const { managedDirectTurnOptions } = await import('../session/queue-helpers.js')
    const roomOrigin = { registryKey: 'room-a', registrationEpoch: 1, bindingId: 'bind-a', roomId: 'room-a' }

    expect(managedDirectTurnOptions(null, true)).toEqual({
      allowedRoomActions: ['send'],
      propagateWorkerRoomOrigin: false,
    })
    expect(managedDirectTurnOptions({ roomOrigin }, false)).toEqual({
      roomOrigin, allowedRoomActions: ['send'], managerEvent: true,
    })
    expect(managedDirectTurnOptions({}, false)).toEqual({
      roomOrigin: undefined, allowedRoomActions: [], managerEvent: true,
    })
    expect(managedDirectTurnOptions(null, false)).toBeUndefined()
  })

  it('drains owner and Manager Worker messages one at a time while keeping Room messages batchable', async () => {
    const { takeCompatibleBatch } = await import('../session/queue-helpers.js')
    const base = {
      protocolVersion: 1,
      dataEpoch: 1,
      daemonInstallationId: 'daemon',
      sessionId: 'session',
      text: 'message',
      agentType: 'codex',
      workDir: tempHome,
      agentSessionId: null,
      modelId: null,
      systemPrompt: null,
      managerDefaultWorkerAgentType: null,
      managerDefaultWorkerModelId: null,
      reasoningEffort: null,
      clientMessageId: null,
      attachments: undefined,
      externalChannel: null,
      replyTarget: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as const
    const messages = [
      { ...base, id: 'owner-a', trigger: { kind: 'personal' as const }, modelId: 'model-a' },
      { ...base, id: 'room', trigger: { kind: 'room_activation' as const, registryKey: 'room', causeMessageId: 'c', rootCauseMessageId: 'c', sequence: '1', hopCount: 0 } },
      { ...base, id: 'owner-b', trigger: { kind: 'personal' as const }, modelId: 'model-b' },
      { ...base, id: 'owner-c', trigger: { kind: 'personal' as const }, modelId: 'model-a' },
      { ...base, id: 'worker-a', trigger: { kind: 'manager_worker' as const, parentSessionId: 'manager' } },
      { ...base, id: 'worker-b', trigger: { kind: 'manager_worker' as const, parentSessionId: 'manager', roomOrigin: { registryKey: 'room-b', registrationEpoch: 1, bindingId: 'bind-b', roomId: 'room-b' } } },
      { ...base, id: 'event-room-a', trigger: { kind: 'manager_event' as const, eventId: 'a', roomOrigin: { registryKey: 'room-a', registrationEpoch: 1, bindingId: 'bind-a', roomId: 'room-a' } } },
      { ...base, id: 'event-room-b', trigger: { kind: 'manager_event' as const, eventId: 'b', roomOrigin: { registryKey: 'room-b', registrationEpoch: 1, bindingId: 'bind-b', roomId: 'room-b' } } },
    ]
    expect(takeCompatibleBatch(messages as any).map((message) => message.id)).toEqual(['owner-a'])
    expect(takeCompatibleBatch(messages.slice(1) as any).map((message) => message.id)).toEqual(['owner-b'])
    expect(takeCompatibleBatch(messages.slice(4) as any).map((message) => message.id)).toEqual(['worker-a'])
    expect(takeCompatibleBatch(messages.slice(6) as any).map((message) => message.id)).toEqual(['event-room-a'])
  })

  it('selects one owner message across hidden room work and rejects protected targets', async () => {
    const { takeControllableMessage } = await import('../session/queue-helpers.js')
    const base = {
      protocolVersion: 1, dataEpoch: 1, daemonInstallationId: 'daemon', sessionId: 'session',
      text: 'message', agentType: 'codex', workDir: tempHome, agentSessionId: null,
      modelId: null, systemPrompt: null, managerDefaultWorkerAgentType: null,
      managerDefaultWorkerModelId: null, reasoningEffort: null, clientMessageId: null,
      externalChannel: null, replyTarget: null, createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
    const messages = [
      { ...base, id: 'owner-b', trigger: { kind: 'personal' as const } },
      { ...base, id: 'room', origin: 'room' as const, trigger: { kind: 'room_activation' as const,
        registryKey: 'room', causeMessageId: 'c', rootCauseMessageId: 'c', sequence: '1', hopCount: 0 } },
      { ...base, id: 'owner-c', trigger: { kind: 'personal' as const } },
    ]
    expect(takeControllableMessage(messages as any, 'owner-c').map((item) => item.id))
      .toEqual(['owner-c'])
    expect(takeControllableMessage(messages as any, 'room')).toEqual([])
  })


  it.each(['codex_windows_runtime_unavailable', 'codex_managed_permission_profile_unavailable', 'managed_agent_runtime_changed'])(
    'preserves legacy queued messages across restart and recovers exactly once after %s', async (code) => {
      vi.useFakeTimers()
      const { ChatQueueManager } = await import('../session/queue.js')
      const { readQueue, writeQueue } = await import('../session/queue-storage.js')
      const { readMessages, getMessageDeliveryStatus } = await import('../session/store.js')
      const state = runtime(true)
      let ready = false
      const executed: ReqFrame[] = []
      const dispatch = vi.fn(async (req: ReqFrame) => {
        if (!ready) throw new Error(`${code}: details not for public output`)
        executed.push(req)
      })
      const create = () => {
        const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
          dispatchReq: dispatch, dispatchQueuedReq: dispatch })
        managers.push(manager)
        return manager
      }
      const first = create()
      for (const id of ['original-one', 'original-two']) {
        const req = request(id, id, id)
        req.params.agentSessionId = 'original-native-thread'
        await first.handleEnqueue(req)
      }
      first.stop()
      const legacy = readQueue()
      for (const item of legacy.sessions['session-durable-disk']!) delete item.trigger
      writeQueue(legacy)
      state.runtime.sessions.clear()
      const blocked = create()
      await vi.advanceTimersByTimeAsync(0)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(executed).toEqual([])
      expect(readQueue().sessions['session-durable-disk']).toHaveLength(2)
      expect(getMessageDeliveryStatus('session-durable-disk', 'original-one').state).toBe('queued')
      expect(blocked.getSnapshot('session-durable-disk').pending[0]).not.toHaveProperty('dispatchBlock')
      const notice = readMessages('session-durable-disk').find((message) => message.id === 'queue-recovery-original-one')
      expect(notice?.payload).toContain('已保留')
      expect(notice?.payload).not.toContain('details not for public output')
      blocked.stop()
      create()
      await vi.advanceTimersByTimeAsync(59_999)
      expect(dispatch).toHaveBeenCalledTimes(1)
      ready = true
      await vi.advanceTimersByTimeAsync(1)
      expect(executed.map((req) => [req.params.clientMessageId, req.params.agentSessionId, req.params.text])).toEqual([
        ['original-one', 'original-native-thread', 'original-one'],
        ['original-two', 'original-native-thread', 'original-two'],
      ])
      expect(readQueue().sessions['session-durable-disk']).toBeUndefined()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(executed).toHaveLength(2)
      const notices = readMessages('session-durable-disk').filter((message) => message.id === 'queue-recovery-original-one')
      expect(notices).toHaveLength(1)
      expect(notices[0]?.payload).toContain('已恢复')
    },
  )

  it('announces recovery only for the message that owns the waiting notice in a Room batch', async () => {
    const { takeCompatibleBatch } = await import('../session/queue-helpers.js')
    const { readQueue, writeQueue } = await import('../session/queue-storage.js')
    const { readMessages } = await import('../session/store.js')
    const { handleQueueDispatchFailure, resolveQueueRecoveryNotice } = await import('../session/queue-dispatch-failure.js')
    const base = {
      protocolVersion: 1, dataEpoch: 1, daemonInstallationId: 'daemon', sessionId: 'session-durable-disk',
      text: 'message', agentType: 'codex', workDir: tempHome, agentSessionId: null,
      modelId: null, systemPrompt: null, managerDefaultWorkerAgentType: null,
      managerDefaultWorkerModelId: null, reasoningEffort: null, clientMessageId: null,
      externalChannel: null, replyTarget: null, createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(), origin: 'room' as const,
      trigger: { kind: 'room_activation' as const, registryKey: 'room', causeMessageId: 'c',
        rootCauseMessageId: 'c', sequence: '1', hopCount: 0 },
    }
    const queue = readQueue()
    queue.sessions['session-durable-disk'] = [{ ...base, id: 'room-a' }, { ...base, id: 'room-b' }] as any
    writeQueue(queue)
    const batch = takeCompatibleBatch(readQueue().sessions['session-durable-disk']!)
    expect(batch.map((message) => message.id)).toEqual(['room-a', 'room-b'])
    handleQueueDispatchFailure({
      error: new Error('codex_command_unavailable: details'), sessionId: 'session-durable-disk', batch,
      isManagedWorker: false, publish: () => {}, removeBatch: () => 0, log: () => {},
    })
    const blocked = readQueue().sessions['session-durable-disk']!
    expect(blocked.map((message) => Boolean(message.dispatchBlock?.notice))).toEqual([true, false])
    expect(blocked.every((message) => message.dispatchBlock?.code === 'codex_command_unavailable')).toBe(true)
    resolveQueueRecoveryNotice(blocked)
    const ids = readMessages('session-durable-disk').map((message) => message.id)
    expect(ids).toContain('queue-recovery-room-a')
    expect(ids).not.toContain('queue-recovery-room-b')
  })

  it('does not reclassify an already terminal Provider failure as a retryable capability block', async () => {
    vi.useFakeTimers()
    const { ChatQueueManager, TerminalQueuedChatDispatchError } = await import('../session/queue.js')
    const { readQueue } = await import('../session/queue-storage.js')
    const state = runtime(false)
    const dispatch = vi.fn(async (_req: ReqFrame) => {
      throw new TerminalQueuedChatDispatchError('codex_managed_permission_profile_unavailable')
    })
    const manager = new ChatQueueManager({ getRuntime: () => state.runtime,
      dispatchReq: dispatch, dispatchQueuedReq: dispatch })
    managers.push(manager)
    await manager.handleEnqueue(request('terminal', 'terminal', 'already attempted'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(readQueue().sessions['session-durable-disk']).toBeUndefined()
  })

})

function roomInput(sessionId: string) {
  return { params: { sessionId, text: '[群消息] 检查修复', agentType: 'codex' as const,
    workDir: tempHome, clientMessageId: 'room-stable' },
    context: { registryKey: 'a'.repeat(64), causeMessageId: 'cause', rootCauseMessageId: 'cause',
      sequence: '135', hopCount: 0 } }
}
function prepared(): import('../session/queue.js').PreparedManagedRoomTurn {
  // This suite exercises real queue/canonical persistence, not Provider policy compilation.
  return { agentType: 'codex', workDir: tempHome, sessionMode: 'standard',
    agentSessionId: '', systemPrompt: 'Room', managerConfig: null,
    managerDefaultWorkerAgentType: null, managerDefaultWorkerModelId: null,
    roomContextRegistryKey: 'a'.repeat(64), managedRoomContextToken: 'test-token',
  } as import('../session/queue.js').PreparedManagedRoomTurn
}

it('delivers a personal Worker event without managed Room preparation or changing the steward mode', async () => {
  const { ChatQueueManager } = await import('../session/queue.js')
  const { markTrustedManagerEvent } = await import('../session/manager-event-authority.js')
  const { recordSession } = await import('../session/store.js')
  recordSession({ sessionId: 'session-durable-disk', agentType: 'shennian', workDir: tempHome, sessionScope: 'steward' })
  const state = runtime(false), dispatch = vi.fn(async (_req: ReqFrame) => {})
  const manager = new ChatQueueManager({ getRuntime: () => state.runtime, dispatchReq: dispatch, dispatchQueuedReq: dispatch })
  managers.push(manager)
  const prepare = vi.fn(async () => { throw new Error('must not acquire managed Room authority') })
  manager.setManagedAgentDirectTurnPreparer(prepare)
  await manager.handleEnqueue(markTrustedManagerEvent({ ...request('personal-result', 'result-stable', 'Worker finished'), params: {
    ...request('personal-result', 'result-stable', 'Worker finished').params,
    agentType: 'shennian', sessionMode: 'standard', managerEventId: 'result-stable',
  } } as ReqFrame))
  await waitFor(() => dispatch.mock.calls.length === 1)
  expect(prepare).not.toHaveBeenCalled()
  expect(dispatch.mock.calls[0]?.[0].params).toMatchObject({ agentType: 'shennian', sessionMode: 'standard', managedRecoverySource: 'manager_event', managerEventId: 'result-stable' })
  expect(dispatch.mock.calls[0]?.[0].params.managedRoomContextToken).toBeUndefined()
})
