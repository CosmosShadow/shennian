// @covers open-source/packages/cli/src/room/managed-room-binding.ts
// @covers open-source/packages/cli/src/session/handlers/room-managed.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TrustedManagedRoomBinder } from '../room/managed-room-binding.js'
import { RoomHostSessionObservationStore } from '../room/host-session-observations.js'
import { RoomSessionRegistry } from '../room/session-registry.js'
import {
  handleManagedRoomBind,
  handleManagedRoomRestart,
} from '../session/handlers/room-managed.js'

describe('trusted managed Room binding', () => {
  it('stops active work and clears the old queue before a hard conversation restart', async () => {
    const stop = vi.fn(async () => {})
    const restart = vi.fn(async () => ({
      binding: { id: 'binding-1' },
      resumeSequence: '9',
      idempotent: false,
    }))
    const sendRes = vi.fn()
    const purgeSession = vi.fn()
    const retireManagerAndWorkers = vi.fn(async () => ['worker-old'])
    const sessions = new Map([
      [
        'session-old',
        {
          currentRunId: 'run-1',
          managedRoomContextToken: null,
          heartbeatTimer: null,
          adapter: { stop, removeAllListeners: vi.fn() },
        },
      ],
    ])

    await handleManagedRoomRestart(
      {
        client: { sendRes }, sessions, chatQueue: { purgeSession },
        managerRuntime: { retireManagerAndWorkers },
      } as never,
      { restart } as never,
      {
        type: 'req',
        id: 'req-restart',
        method: 'room.agent.restart-managed',
        params: {
          roomId: 'room-1',
          bindingId: 'binding-1',
          agentIdentityId: 'agent-1',
          previousNianSessionId: 'session-old',
          nianSessionId: 'session-new',
          assignmentIntentId: 'restart-1',
          agentType: 'codex',
        },
      },
    )

    expect(stop).toHaveBeenCalledOnce()
    expect(retireManagerAndWorkers).toHaveBeenCalledWith('session-old')
    expect(retireManagerAndWorkers.mock.invocationCallOrder[0])
      .toBeLessThan(stop.mock.invocationCallOrder[0]!)
    expect(purgeSession).toHaveBeenCalledWith('session-old')
    expect(sessions.has('session-old')).toBe(false)
    expect(restart).toHaveBeenCalledOnce()
    expect(sendRes).toHaveBeenCalledWith({
      type: 'res',
      id: 'req-restart',
      ok: true,
      payload: expect.any(Object),
    })
  })

  it.each(['standard', 'manager'] as const)(
    'binds a %s Agent before any turn and persists only the server-owned workspace',
    async (sessionMode) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-managed-bind-'))
      const registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
      const observations = new RoomHostSessionObservationStore(path.join(root, 'observations.json'))
      const create = vi.fn(async (input) => ({
        binding: {
          id: 'binding-1',
          roomId: input.roomId,
          agentIdentityId: input.agentIdentityId,
          agentMembershipId: 'agent-member-1',
          nianSessionId: input.nianSessionId,
          runtimeAdapter: input.runtimeAdapter,
          activationCapability: input.activationCapability,
          activationMode: input.activationMode,
          status: 'active' as const,
        },
        resumeSequence: '12',
        idempotent: false,
      }))
      const status = vi.fn(async () => ({
        bindingId: 'binding-1',
        roomId: 'room-1',
        agentIdentityId: 'agent-1',
        agentMembershipId: 'agent-member-1',
        status: 'active' as const,
        activationMode: 'mention_only' as const,
        managedWorkspacePath: '/code/shennian',
        lastDeliveredSequence: '0',
        lastActivatedSequence: '0',
        agent: {
          displayName: 'Agent',
          description: '',
          sessionMode,
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
        room: { name: 'Room', status: 'active', lastSequence: '0' },
      }))
      const binder = new TrustedManagedRoomBinder({
        registry,
        observations,
        bindingClient: { create, restart: vi.fn(), status },
        getMachineCredentials: () => ({ machineId: 'machine-1', machineToken: 'machine-token' }),
        hostProcessIdentity: () => 'daemon:test-process',
      })
      const client = { sendRes: vi.fn() }
      const sessions = new Map()
      await handleManagedRoomBind({ client, sessions } as never, binder, {
        type: 'req',
        id: 'req-1',
        method: 'room.agent.bind-managed',
        params: {
          roomId: 'room-1',
          agentIdentityId: 'agent-1',
          nianSessionId: 'session-1',
          assignmentIntentId: 'assignment-1',
          agentType: 'codex',
          activationMode: 'mention_only',
        },
      })

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          machineToken: 'machine-token',
          bindingIntentId: 'assignment-1',
          nianSessionId: 'session-1',
          runtimeAdapter: 'codex',
          activationMode: 'mention_only',
          sessionRegistryKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      )
      expect(create.mock.calls[0]?.[0]).not.toHaveProperty('sourceSessionKey')
      expect(registry.getByNianSessionId('session-1')).toMatchObject({
        sourceSessionKey: 'managed:session-1',
        binding: {
          bindingId: 'binding-1',
          roomId: 'room-1',
          lastDeliveredSequence: '12',
          lastActivatedSequence: '12',
        },
      })
      expect(observations.list()).toEqual([
        expect.objectContaining({
          runtimeAdapter: 'codex',
          sourceSessionKey: 'managed:session-1',
          workspacePath: '/code/shennian',
          lifecycleState: 'active',
          lastEventName: 'ManagedBind',
        }),
      ])
      expect(client.sendRes).toHaveBeenCalledWith({
        type: 'res',
        id: 'req-1',
        ok: true,
        payload: expect.objectContaining({ binding: expect.objectContaining({ id: 'binding-1' }) }),
      })
    },
  )

  it('rejects App-supplied native fields and unsupported managed runtimes', async () => {
    const binder = { bind: vi.fn(), restart: vi.fn() }
    const client = { sendRes: vi.fn() }
    const runtime = {
      client,
      sessions: new Map([
        ['session-1', { agentSessionId: null, workDir: '/code/shennian', agentType: 'codex' }],
      ]),
    }
    const base = {
      roomId: 'room-1',
      agentIdentityId: 'agent-1',
      nianSessionId: 'session-1',
      assignmentIntentId: 'assignment-1',
    }
    await expect(
      handleManagedRoomBind(runtime as never, binder, {
        type: 'req',
        id: 'req-extra',
        method: 'room.agent.bind-managed',
        params: { ...base, sourceSessionKey: 'forged' },
      }),
    ).rejects.toThrow('unsupported parameters')
    await expect(
      handleManagedRoomBind(runtime as never, binder, {
        type: 'req',
        id: 'req-manager',
        method: 'room.agent.bind-managed',
        params: { ...base, agentType: 'manager' },
      }),
    ).rejects.toThrow('managed_agent_runtime_unsupported')
    expect(binder.bind).not.toHaveBeenCalled()
  })

  it('stops and discards a legacy pre-binding Session before creating the Binding', async () => {
    const binder = {
      bind: vi.fn(async () => ({
        binding: {
          id: 'binding-1',
          roomId: 'room-1',
          agentIdentityId: 'agent-1',
          agentMembershipId: 'agent-member-1',
          nianSessionId: 'session-1',
          status: 'active' as const,
          activationMode: 'mention_only' as const,
        },
        resumeSequence: '12',
        idempotent: false,
      })),
      restart: vi.fn(),
    }
    const client = { sendRes: vi.fn() }
    const stop = vi.fn(async () => {})
    const session = {
      adapter: { stop, removeAllListeners: vi.fn() },
      heartbeatTimer: null,
      managedRoomContextToken: null,
    }
    const runtime = { client, sessions: new Map([['session-1', session]]) }
    await handleManagedRoomBind(runtime as never, binder, {
      type: 'req',
      id: 'req-wait',
      method: 'room.agent.bind-managed',
      params: {
        roomId: 'room-1',
        agentIdentityId: 'agent-1',
        nianSessionId: 'session-1',
        assignmentIntentId: 'assignment-1',
        agentType: 'workbuddy',
      },
    })

    expect(stop).toHaveBeenCalledOnce()
    expect(runtime.sessions.has('session-1')).toBe(false)
    expect(binder.bind).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSessionKey: 'managed:session-1', agentType: 'workbuddy' }),
    )
    expect(client.sendRes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-wait', ok: true }),
    )
  })

  it('atomically restarts a Manager Binding on a fresh native session without replaying history', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-managed-restart-'))
    const registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
    const observations = new RoomHostSessionObservationStore(path.join(root, 'observations.json'))
    const previous = registry.register({
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'native-old',
      nianSessionId: 'session-old',
      hostProcessIdentity: 'daemon:test-process',
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: false,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: true,
      },
    })
    registry.setBinding({
      registryKey: previous.registryKey,
      bindingId: 'binding-1',
      roomId: 'room-1',
      agentIdentityId: 'agent-1',
      agentMembershipId: 'agent-member-1',
      status: 'active',
      activationMode: 'mention_only',
    })
    const restart = vi.fn(async (input) => ({
      binding: {
        id: input.bindingId,
        roomId: input.roomId,
        agentIdentityId: input.agentIdentityId,
        agentMembershipId: 'agent-member-1',
        nianSessionId: input.nianSessionId,
        runtimeAdapter: input.runtimeAdapter,
        activationCapability: 'managed' as const,
        activationMode: 'mention_only' as const,
        status: 'active' as const,
      },
      resumeSequence: '42',
      idempotent: false,
    }))
    const status = vi.fn(async () => ({
      bindingId: 'binding-1',
      roomId: 'room-1',
      agentIdentityId: 'agent-1',
      agentMembershipId: 'agent-member-1',
      status: 'active' as const,
      activationMode: 'mention_only' as const,
      managedWorkspacePath: '/code/shennian',
      lastDeliveredSequence: '42',
      lastActivatedSequence: '42',
      agent: {
        displayName: 'Agent',
        description: '',
        sessionMode: 'manager' as const,
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
      room: { name: 'Room', status: 'active', lastSequence: '42' },
    }))
    const binder = new TrustedManagedRoomBinder({
      registry,
      observations,
      bindingClient: { create: vi.fn(), restart, status },
      getMachineCredentials: () => ({ machineId: 'machine-1', machineToken: 'machine-token' }),
      hostProcessIdentity: () => 'daemon:test-process',
    })

    await binder.restart({
      roomId: 'room-1',
      bindingId: 'binding-1',
      agentIdentityId: 'agent-1',
      previousNianSessionId: 'session-old',
      nianSessionId: 'session-new',
      assignmentIntentId: 'restart-1',
      sourceSessionKey: 'managed:session-new',
      agentType: 'codex',
    })

    expect(registry.getByNianSessionId('session-new')?.binding).toMatchObject({
      bindingId: 'binding-1',
      activationMode: 'mention_only',
      lastDeliveredSequence: '42',
      lastActivatedSequence: '42',
    })
    expect(registry.getByNianSessionId('session-old')).toBeNull()
    expect(registry.list().find((record) => record.nianSessionId === 'session-old')?.binding).toMatchObject({
      status: 'detached',
      activationMode: 'paused',
    })
  })

  it('keeps the committed replacement Binding when post-swap workspace observation fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-managed-restart-'))
    const registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
    const observations = new RoomHostSessionObservationStore(path.join(root, 'observations.json'))
    const previous = registry.register({
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'managed:session-old',
      nianSessionId: 'session-old',
      hostProcessIdentity: 'daemon:test-process',
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: false,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: true,
      },
    })
    registry.setBinding({
      registryKey: previous.registryKey,
      bindingId: 'binding-1',
      roomId: 'room-1',
      agentIdentityId: 'agent-1',
      agentMembershipId: 'agent-member-1',
      status: 'active',
      activationMode: 'mention_only',
    })
    const binder = new TrustedManagedRoomBinder({
      registry,
      observations,
      bindingClient: {
        create: vi.fn(),
        restart: vi.fn(async (input) => ({
          binding: {
            id: input.bindingId,
            roomId: input.roomId,
            agentIdentityId: input.agentIdentityId,
            agentMembershipId: 'agent-member-1',
            nianSessionId: input.nianSessionId,
            runtimeAdapter: input.runtimeAdapter,
            activationCapability: 'managed' as const,
            activationMode: 'mention_only' as const,
            status: 'active' as const,
          },
          resumeSequence: '42',
          idempotent: false,
        })),
        status: vi.fn(async () => {
          throw new Error('temporary status lookup failure')
        }),
      },
      getMachineCredentials: () => ({ machineId: 'machine-1', machineToken: 'machine-token' }),
      hostProcessIdentity: () => 'daemon:test-process',
    })

    await expect(
      binder.restart({
        roomId: 'room-1',
        bindingId: 'binding-1',
        agentIdentityId: 'agent-1',
        previousNianSessionId: 'session-old',
        nianSessionId: 'session-new',
        assignmentIntentId: 'restart-1',
        sourceSessionKey: 'managed:session-new',
        agentType: 'codex',
      }),
    ).rejects.toThrow('temporary status lookup failure')

    expect(registry.getByNianSessionId('session-new')?.binding).toMatchObject({
      bindingId: 'binding-1',
      status: 'active',
      activationMode: 'mention_only',
      lastDeliveredSequence: '42',
      lastActivatedSequence: '42',
    })
    expect(registry.getByNianSessionId('session-old')).toBeNull()
    expect(registry.list().find((record) => record.nianSessionId === 'session-old')?.binding).toMatchObject({
      status: 'detached',
      activationMode: 'paused',
    })
  })

  it.each(['future-mode', undefined])(
    'rejects unsupported server-owned session mode %s during workspace enrichment',
    async (sessionMode) => {
      const binder = new TrustedManagedRoomBinder({
        registry: {} as never,
        observations: {} as never,
        bindingClient: {
          create: vi.fn(),
          restart: vi.fn(),
          status: vi.fn(async () => ({
            agentIdentityId: 'agent-1',
            managedWorkspacePath: '/code/shennian',
            agent: { sessionMode },
          })) as never,
        },
        getMachineCredentials: () => ({ machineId: 'machine-1', machineToken: 'machine-token' }),
        hostProcessIdentity: () => 'daemon:test-process',
      })

      await expect(
        (binder as any).resolveServerOwnedWorkspace({
          machineToken: 'machine-token',
          roomId: 'room-1',
          bindingId: 'binding-1',
          agentIdentityId: 'agent-1',
        }),
      ).rejects.toThrow('managed_room_workspace_unavailable')
    },
  )
})
