// @covers open-source/packages/cli/src/room/mirror-sync-service.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RoomMessageView } from '@shennian/wire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomActionHttpError } from '../room/room-action-client.js'
import { RoomMirrorSyncService } from '../room/mirror-sync-service.js'
import { RoomHostSessionObservationStore } from '../room/host-session-observations.js'
import {
  RoomSessionRegistry,
  type RoomSessionRegistration,
} from '../room/session-registry.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Room managed-message background synchronization', () => {
  let registry: RoomSessionRegistry
  let observations: RoomHostSessionObservationStore
  let append: ReturnType<typeof vi.fn>
  let revoke: ReturnType<typeof vi.fn>
  let recordError: ReturnType<typeof vi.fn>
  let status: ReturnType<typeof vi.fn>
  let read: ReturnType<typeof vi.fn>
  let onMessages: ReturnType<typeof vi.fn<(
    roomId: string,
    messages: RoomMessageView[],
    registrations: ReturnType<RoomSessionRegistry['list']>,
  ) => Promise<void>>>
  let onBindingPaused: ReturnType<typeof vi.fn<(registration: RoomSessionRegistration) => void>>

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-sync-'))
    roots.push(root)
    registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
    observations = new RoomHostSessionObservationStore(path.join(root, 'observations.json'))
    append = vi.fn(({ messages }) => ({
      appended: messages.length,
      lastSyncedSequence: messages.at(-1)?.sequence ?? '0',
    }))
    revoke = vi.fn()
    recordError = vi.fn()
    onMessages = vi.fn(async () => {})
    onBindingPaused = vi.fn()
    status = vi.fn(async ({ bindingId, roomId }) => ({
      bindingId,
      roomId,
      agentIdentityId: `identity_${bindingId}`,
      agentMembershipId: `membership_${bindingId}`,
      status: 'active' as const,
      activationCapability: 'managed' as const,
      activationMode: 'auto_follow' as const,
      managedWorkspacePath: '/code/shennian',
      lastDeliveredSequence: '0',
      lastActivatedSequence: '0',
      agent: {
        displayName: `Agent ${bindingId}`,
        description: '负责研发协作',
        sessionMode: 'standard' as const,
        permissionPolicy: {
          version: 1,
          fileAccess: 'workspace-write' as const,
          externalCapabilities: {
            commandNetwork: false,
            webSearch: false,
            browser: false,
            computerUse: false,
            mcp: false,
          },
        },
        permissionConfirmation: null,
      },
      room: {
        name: '研发协作',
        status: 'active',
        lastSequence: '2',
        members: [
          { displayName: '李辰', principalType: 'human' as const },
          { displayName: `Agent ${bindingId}`, principalType: 'agent' as const },
        ],
      },
    }))
    read = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ id: 'message_1', sequence: '1' }],
        nextSequence: '1',
        hasMore: true,
        historyFromSequence: '1',
        roomName: '研发协作',
      })
      .mockResolvedValueOnce({
        messages: [{ id: 'message_2', sequence: '2' }],
        nextSequence: '2',
        hasMore: false,
        historyFromSequence: '1',
        roomName: '研发协作',
      })
  })

  it('keeps authoritative models scoped to each managed Session, including an explicit default', async () => {
    register('codex', 'session_1', 'nian_1', 'binding_1')
    register('claude_code', 'session_2', 'nian_2', 'binding_2')
    const original = status.getMockImplementation() as (input: { bindingId: string; roomId: string }) => Promise<Record<string, unknown>>
    const first = await original({ bindingId: 'binding_1', roomId: 'room_1' })
    const second = await original({ bindingId: 'binding_2', roomId: 'room_1' })
    status.mockResolvedValueOnce({ ...first, effectiveModelId: 'provider/deepseek-flash' })
    status.mockResolvedValueOnce({ ...second, effectiveModelId: null })
    await createService().runOnce()
    expect(onMessages).toHaveBeenCalledWith(
      'room_1', expect.any(Array), expect.any(Array),
      expect.objectContaining({
        effectiveModelsBySessionId: { nian_1: 'provider/deepseek-flash', nian_2: null },
      }),
    )
  })

  it('pulls one user-level Room mirror once even when two Sessions share the Room', async () => {
    register('codex', 'session_1', 'nian_1', 'binding_1')
    register('claude_code', 'session_2', 'nian_2', 'binding_2')
    const service = createService()

    await service.runOnce()

    expect(status).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0]![0]).toMatchObject({ afterSequence: '0', limit: 100 })
    expect(read.mock.calls[1]![0]).toMatchObject({ afterSequence: '1', limit: 100 })
    expect(append).not.toHaveBeenCalled()
    expect(onMessages).toHaveBeenCalledTimes(2)
    expect(onMessages).toHaveBeenLastCalledWith(
      'room_1',
      [{ id: 'message_2', sequence: '2' }],
      expect.arrayContaining([
        expect.objectContaining({ binding: expect.objectContaining({ bindingId: 'binding_1' }) }),
        expect.objectContaining({ binding: expect.objectContaining({ bindingId: 'binding_2' }) }),
      ]),
      {
        roomName: '研发协作',
        memberCount: undefined,
        members: [
          { displayName: '李辰', principalType: 'human' },
          { displayName: 'Agent binding_1', principalType: 'agent' },
        ],
        agentsByIdentityId: {
          identity_binding_1: expect.objectContaining({
            displayName: 'Agent binding_1',
            description: '负责研发协作',
            sessionMode: 'standard',
          }),
          identity_binding_2: expect.objectContaining({
            displayName: 'Agent binding_2',
            description: '负责研发协作',
            sessionMode: 'standard',
          }),
        },
        agentSystemPromptsByIdentityId: {
          identity_binding_1: '',
          identity_binding_2: '',
        },
      },
    )
  })

  it('delivers a Relay message immediately without status/read HTTP polling', async () => {
    const key = register('codex', 'session_1', 'nian_1', 'binding_1')
    const service = createService()
    const message = {
      id: 'message_live',
      roomId: 'room_1',
      sequence: '7',
      kind: 'text',
      author: { membershipId: 'human_1', principalType: 'human', ownerUserId: 'user_1', displayName: '李辰' },
      text: '实时消息',
      attachments: [],
      createdAt: '2026-09-17T02:03:04.000Z',
    } satisfies RoomMessageView

    await expect(service.deliverLive(message)).resolves.toEqual({ accepted: true, registrationCount: 1 })

    expect(status).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(onMessages).toHaveBeenCalledWith(
      'room_1', [message], [expect.objectContaining({ registryKey: key })], { roomName: '当前群聊' },
    )
    expect(registry.getByRegistryKey(key)?.binding?.lastDeliveredSequence).toBe('7')
  })

  it('deduplicates already delivered Relay messages before queue activation', async () => {
    const key = register('codex', 'session_1', 'nian_1', 'binding_1')
    registry.advanceCursor({ registryKey: key, cursor: 'delivered', sequence: '7' })

    await expect(createService().deliverLive({
      id: 'message_live', roomId: 'room_1', sequence: '7', kind: 'text',
      author: { membershipId: 'human_1', principalType: 'human', ownerUserId: 'user_1', displayName: '李辰' },
      text: '重复消息', attachments: [], createdAt: '2026-09-17T02:03:04.000Z',
    })).resolves.toEqual({ accepted: false, registrationCount: 0 })

    expect(onMessages).not.toHaveBeenCalled()
  })

  it('does not sync a pending approval Binding', async () => {
    const key = register('codex', 'session_1', 'nian_1', 'binding_1')
    registry.detachBinding(key)
    registry.setBinding({
      registryKey: key,
      bindingId: 'binding_pending',
      roomId: 'room_1',
      agentIdentityId: 'identity_pending',
      agentMembershipId: null,
      status: 'pending_approval',
    })

    await createService().runOnce()

    expect(status).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('notifies the queue immediately when the authoritative Binding is paused', async () => {
    const key = register('codex', 'session_1', 'nian_1', 'binding_1')
    status.mockResolvedValue({
      bindingId: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'identity_binding_1',
      agentMembershipId: 'membership_binding_1',
      status: 'paused',
      activationCapability: 'managed',
      activationMode: 'paused',
      managedWorkspacePath: '/code/shennian',
      room: { name: '研发协作', status: 'active', lastSequence: '0', members: [] },
    })

    await createService().runOnce()

    expect(onBindingPaused).toHaveBeenCalledWith(
      expect.objectContaining({
        registryKey: key,
        nianSessionId: 'nian_1',
        binding: expect.objectContaining({ status: 'paused', activationMode: 'paused' }),
      }),
    )
  })

  it('backfills the trusted workspace observation for an existing managed Binding', async () => {
    register('codex', 'session_1', 'nian_1', 'binding_1')

    await createService().runOnce()

    expect(observations.list()).toEqual([
      expect.objectContaining({
        runtimeAdapter: 'codex',
        sourceSessionKey: 'session_1',
        workspacePath: '/code/shennian',
        lifecycleState: 'active',
        lastEventName: 'ManagedSync',
      }),
    ])
  })

  it('marks local access revoked only after every usable Binding is unavailable', async () => {
    register('codex', 'session_1', 'nian_1', 'binding_1')
    register('claude_code', 'session_2', 'nian_2', 'binding_2')
    status.mockRejectedValue(
      new RoomActionHttpError('room_binding_unavailable', 'Binding unavailable.'),
    )

    await createService().runOnce()

    expect(status).toHaveBeenCalledTimes(2)
    expect(revoke).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(registry.list().every((record) => record.binding?.status === 'detached')).toBe(true)

    await createService().runOnce()

    expect(status).toHaveBeenCalledTimes(2)
  })

  it('keeps syncing through a sibling Agent when only one Binding is revoked', async () => {
    const revokedKey = register('codex', 'session_1', 'nian_1', 'binding_1')
    const activeKey = register('claude_code', 'session_2', 'nian_2', 'binding_2')
    status.mockRejectedValueOnce(
      new RoomActionHttpError('room_binding_unavailable', 'Binding unavailable.'),
    )

    await createService().runOnce()

    expect(status).toHaveBeenCalledTimes(2)
    expect(registry.getByRegistryKey(revokedKey)?.binding?.status).toBe('detached')
    expect(registry.getByRegistryKey(activeKey)?.binding?.status).toBe('active')
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0]![0]).toMatchObject({ bindingId: 'binding_2' })
    expect(revoke).not.toHaveBeenCalled()
  })

  it('records transient errors without revoking access', async () => {
    register('codex', 'session_1', 'nian_1', 'binding_1')
    status.mockRejectedValue(
      new RoomActionHttpError('room_action_server_unavailable', 'Unavailable.'),
    )

    await createService().runOnce()

    expect(recordError).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('does not resurrect a registration retired while status was in flight', async () => {
    const key = register('codex', 'old', 'nian_old', 'binding_1')
    const original = status.getMockImplementation()! as (target: { bindingId: string; roomId: string }) => Promise<Record<string, unknown>>
    let release!: (value: unknown) => void
    status.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = createService().runOnce()
    await Promise.resolve()
    registry.updateLifecycle(key, 'closed')
    release(await original({ bindingId: 'binding_1', roomId: 'room_1' }))
    await pending
    expect(registry.getByRegistryKey(key)?.binding?.status).toBe('detached')
    expect(read).not.toHaveBeenCalled()
    expect(onMessages).not.toHaveBeenCalled()
  })

  it('retires a local session when authoritative status belongs to its replacement', async () => {
    const key = register('codex', 'old', 'nian_old', 'binding_1')
    const original = status.getMockImplementation()! as (target: { bindingId: string; roomId: string }) => Promise<Record<string, unknown>>
    status.mockImplementation(async (target) => ({
      ...await original(target),
      nianSessionId: 'nian_new',
      sessionRegistryKey: 'a'.repeat(64),
    }))
    await createService().runOnce()
    expect(registry.getByRegistryKey(key)?.lifecycleState).toBe('closed')
    expect(onBindingPaused).toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('retires a tombstoned owner even when an older server omits ownership fields', async () => {
    const old = register('codex', 'old', 'nian_old', 'binding_old')
    const service = new RoomMirrorSyncService({ registry, observations,
      actionClient: { status, read } as never,
      getMachineCredentials: () => ({ machineToken: 'test-token' }),
      isSessionDeleted: (id) => id === 'nian_old', onMessages, onBindingPaused })
    await service.runOnce()
    expect(registry.getByRegistryKey(old)?.lifecycleState).toBe('closed')
    expect(status).not.toHaveBeenCalled()
    expect(onMessages).not.toHaveBeenCalled()
    expect(onBindingPaused).toHaveBeenCalledOnce()
  })

  it('starts reads at the replacement boundary instead of replaying the Room from zero', async () => {
    const key = register('codex', 'current', 'nian_current', 'binding_current')
    registry.advanceCursor({ registryKey: key, cursor: 'delivered', sequence: '135' })
    read.mockReset().mockResolvedValue({ messages: [], nextSequence: '135', hasMore: false, roomName: 'Room' })
    await createService().runOnce()
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ afterSequence: '135' }))
  })

  describe('idle polling backoff', () => {
    const emptyPage = { messages: [], nextSequence: '0', hasMore: false, historyFromSequence: '1', roomName: '研发协作' }

    function pollingService(random = 0.5) {
      const delays: number[] = []
      let fire: (() => void) | null = null
      const service = new RoomMirrorSyncService({
        registry,
        observations,
        actionClient: { status, read } as never,
        getMachineCredentials: () => ({ machineToken: 'machine-secret' }),
        onMessages,
        onBindingPaused,
        intervalMs: 5_000,
        maxIntervalMs: 30_000,
        random: () => random,
        setTimeout: ((handler: () => void, delay: number) => {
          delays.push(delay)
          fire = handler
          return { unref() {} } as never
        }) as never,
        clearTimeout: (() => {}) as never,
      })
      const tick = async () => {
        const before = delays.length
        fire!()
        await vi.waitFor(() => expect(delays.length).toBe(before + 1))
      }
      return { service, delays, tick }
    }

    it('slows down while nothing changes and never exceeds the cap', async () => {
      register('codex', 'session_1', 'nian_1', 'binding_1')
      read.mockReset().mockResolvedValue(emptyPage)
      const { service, delays, tick } = pollingService()

      service.start()
      for (let i = 0; i < 5; i += 1) await tick()

      expect(delays).toEqual([0, 5_000, 10_000, 20_000, 30_000, 30_000])
    })

    it('keeps positive jitter inside the documented maximum interval', async () => {
      register('codex', 'session_1', 'nian_1', 'binding_1')
      read.mockReset().mockResolvedValue(emptyPage)
      const { service, delays, tick } = pollingService(1)

      service.start()
      for (let i = 0; i < 6; i += 1) await tick()

      expect(Math.max(...delays)).toBe(30_000)
      expect(delays.every((delay) => delay <= 30_000)).toBe(true)
    })

    it('returns to the base interval as soon as a poll delivers messages', async () => {
      register('codex', 'session_1', 'nian_1', 'binding_1')
      read.mockReset().mockResolvedValue(emptyPage)
      const { service, delays, tick } = pollingService()

      service.start()
      for (let i = 0; i < 3; i += 1) await tick()
      read.mockResolvedValueOnce({
        messages: [{ id: 'message_9', sequence: '9' }],
        nextSequence: '9',
        hasMore: false,
        historyFromSequence: '1',
        roomName: '研发协作',
      })
      await tick()
      await tick()

      expect(delays.slice(-3)).toEqual([20_000, 5_000, 5_000])
    })

    it('treats a Relay-delivered message as activity so the next poll is not delayed further', async () => {
      register('codex', 'session_1', 'nian_1', 'binding_1')
      read.mockReset().mockResolvedValue(emptyPage)
      const { service, delays, tick } = pollingService()

      service.start()
      for (let i = 0; i < 3; i += 1) await tick()
      await service.deliverLive({ id: 'live_1', roomId: 'room_1', sequence: '5' } as RoomMessageView)
      await tick()

      expect(delays.slice(-2)).toEqual([20_000, 5_000])
    })
  })

  function register(
    runtimeAdapter: 'codex' | 'claude_code',
    sourceSessionKey: string,
    nianSessionId: string,
    bindingId: string,
  ): string {
    const registration = registry.register({
      machineId: 'machine_1',
      runtimeAdapter,
      sourceSessionKey,
      nianSessionId,
      hostProcessIdentity: `${runtimeAdapter}:process`,
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: true,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: true,
      },
    })
    registry.setBinding({
      registryKey: registration.registryKey,
      bindingId,
      roomId: 'room_1',
      agentIdentityId: `identity_${bindingId}`,
      agentMembershipId: `membership_${bindingId}`,
      status: 'active',
    })
    return registration.registryKey
  }

  function createService(): RoomMirrorSyncService {
    return new RoomMirrorSyncService({
      registry,
      observations,
      actionClient: { status, read } as never,
      getMachineCredentials: () => ({ machineToken: 'machine-secret' }),
      mirrorFactory: () =>
        ({
          append,
          markAccessRevoked: revoke,
          recordSyncError: recordError,
          readState: () => ({ lastSyncedSequence: '0' }),
        }) as never,
      onMessages,
      onBindingPaused,
    })
  }
})
