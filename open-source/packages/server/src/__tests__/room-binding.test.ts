// @covers open-source/packages/server/src/services/room-binding.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    room: { findUnique: vi.fn(), update: vi.fn() },
    roomMembership: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    roomReadState: { upsert: vi.fn() },
    roomMessage: { create: vi.fn() },
    roomBinding: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentIdentity: { findUnique: vi.fn() },
    nianSession: { findUnique: vi.fn() },
    machine: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/room-session-cleanup.js', () => ({
  commitExclusiveRoomSessionDeletions: vi.fn(async (_tx, targets) => targets),
}))

import {
  createRoomBindingAtomic,
  restartRoomBindingSession,
  resolveInitialRoomAgentActivationMode,
} from '../services/room-binding.js'
import { agentRoomRecoveryCreationKey } from '../services/agent-room-recovery-intent.js'

const REGISTRY_KEY = 'a'.repeat(64)
const hardCapabilityMatrix = {
  fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
  externalCapabilities: {
    commandNetwork: { allow: true, deny: true },
    webSearch: { allow: true, deny: true },
    browser: { allow: true, deny: true },
    computerUse: { allow: true, deny: true },
    mcp: { allow: true, deny: true },
  },
}
const INPUT = {
  bindingIntentId: 'room-bind:intent_1',
  roomId: 'room_1',
  userId: 'user_1',
  machineId: 'machine_1',
  agentIdentityId: 'agent_1',
  nianSessionId: 'nian_1',
  runtimeAdapter: 'codex' as const,
  sessionRegistryKey: REGISTRY_KEY,
  activationCapability: 'idle_resume' as const,
}

const BINDING = {
  id: 'binding_1',
  bindingIntentId: INPUT.bindingIntentId,
  roomId: INPUT.roomId,
  userId: INPUT.userId,
  agentIdentityId: INPUT.agentIdentityId,
  agentMembershipId: 'agent_member_1',
  nianSessionId: INPUT.nianSessionId,
  machineId: INPUT.machineId,
  runtimeAdapter: INPUT.runtimeAdapter,
  sourceSessionKey: REGISTRY_KEY,
  activationCapability: 'idle_resume',
  activationMode: 'auto_follow',
  status: 'active',
  capabilityEpoch: 0,
  lastDeliveredSequence: 10n,
  lastActivatedSequence: 7n,
  appliedConfigurationVersion: 4,
  pendingConfigurationVersion: null,
  agentIdentity: {
    id: 'agent_1',
    ownerUserId: 'user_1',
    machineId: 'machine_1',
    runtimeAdapter: 'codex',
    configurationVersion: 4,
    permissionPolicy: {
      version: 1,
      fileAccess: 'workspace-write',
      externalCapabilities: {
        commandNetwork: false,
        webSearch: false,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    },
    permissionPolicyVersion: 1,
    permissionConfirmation: null,
  },
}

const SECURE_MACHINE = {
  id: 'machine_1',
  userId: 'user_1',
  paired: true,
  agents: [
    {
      type: 'codex',
      supportsManagedAgent: true,
      managedAgentProtection: {
        level: 'hard',
        runtimeVersion: '0.152.1',
        platform: 'darwin',
        executableFingerprint: `sha256:${'a'.repeat(64)}`,
        unsupportedCapabilities: [],
        capabilityMatrix: hardCapabilityMatrix,
      },
    },
  ],
}

describe('Room Binding atomic creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.roomMembership.findUnique.mockReset()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomBinding.findUnique.mockResolvedValue(null)
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.machine.findFirst.mockResolvedValue(SECURE_MACHINE)
    mockPrisma.roomBinding.findFirst.mockResolvedValue(null)
    mockPrisma.roomMembership.findMany.mockResolvedValue([])
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'active',
      maxAgentsPerUser: 8,
      maxAgentsPerRoom: 32,
      maxAutoFollowAgents: 8,
    })
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce({
        id: 'human_1',
        roomId: 'room_1',
        userId: 'user_1',
        ownerUserId: 'user_1',
        principalType: 'human',
        status: 'active',
        historyFromSequence: 1n,
      })
      .mockResolvedValueOnce(null)
    mockPrisma.agentIdentity.findUnique.mockResolvedValue({
      id: 'agent_1',
      ownerType: 'user',
      ownerUserId: 'user_1',
      status: 'active',
      displayName: '李辰的开发 Agent',
      configurationVersion: 4,
    })
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.roomMembership.count.mockImplementation(async ({ where }) =>
      where.principalType === 'human' ? 1 : 0,
    )
    mockPrisma.roomBinding.count.mockResolvedValue(0)
    mockPrisma.roomMembership.create.mockResolvedValue({
      id: 'agent_member_1',
      principalType: 'agent',
      ownerUserId: 'user_1',
      displayAlias: '李辰的开发 Agent',
      membershipEpoch: 1,
    })
    mockPrisma.roomReadState.upsert.mockResolvedValue({})
    mockPrisma.roomBinding.create.mockResolvedValue(BINDING)
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 1n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'system_agent_joined', sequence: 1n })
  })

  it('creates Agent Membership, ReadState and Binding in one serializable transaction', async () => {
    const result = await createRoomBindingAtomic(INPUT)

    expect(result).toMatchObject({
      idempotent: false,
      binding: { id: 'binding_1' },
      resumeSequence: '1',
    })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        principalType: 'agent',
        principalKey: 'agent:agent_1',
        parentHumanMembershipId: 'human_1',
        displayAlias: '李辰的开发 Agent',
      }),
    })
    expect(mockPrisma.roomReadState.upsert).toHaveBeenCalledWith({
      where: { membershipId: 'agent_member_1' },
      create: { roomId: 'room_1', membershipId: 'agent_member_1' },
      update: {},
    })
    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bindingIntentId: 'room-bind:intent_1',
        nianSessionId: 'nian_1',
        sourceSessionKey: REGISTRY_KEY,
        bindingMode: 'hook_native',
        status: 'active',
        appliedConfigurationVersion: 4,
        pendingConfigurationVersion: null,
        lastDeliveredSequence: 1n,
        lastActivatedSequence: 1n,
      }),
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'system',
        text: '李辰的开发 Agent joined the Room and will automatically follow group messages.',
        clientMessageId: 'system:membership-joined:agent_member_1:1',
      }),
    })
  })

  it('reactivates a removed Agent with its fresh Session instead of returning 409', async () => {
    const detached = {
      ...BINDING,
      bindingIntentId: 'old-intent',
      nianSessionId: 'nian_old',
      sourceSessionKey: 'b'.repeat(64),
      status: 'detached',
      activationMode: 'paused',
      detachedReason: 'membership_removed',
    }
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'active',
      ownerUserId: 'user_1',
      nextSequence: 42n,
      maxAgentsPerUser: 8,
      maxAgentsPerRoom: 32,
      maxAutoFollowAgents: 8,
    })
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 43n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'system_agent_rejoined', sequence: 43n })
    mockPrisma.roomMembership.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        id: 'human_1',
        roomId: 'room_1',
        userId: 'user_1',
        ownerUserId: 'user_1',
        principalType: 'human',
        status: 'active',
        historyFromSequence: 1n,
      })
      .mockResolvedValueOnce({
        id: 'agent_member_1',
        roomId: 'room_1',
        status: 'removed',
      })
    mockPrisma.roomBinding.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detached)
    mockPrisma.roomMembership.update.mockResolvedValue({
      id: 'agent_member_1',
      status: 'active',
      principalType: 'agent',
      ownerUserId: 'user_1',
      displayAlias: '李辰的开发 Agent',
      membershipEpoch: 2,
    })
    mockPrisma.roomBinding.update.mockResolvedValue({
      ...detached,
      bindingIntentId: INPUT.bindingIntentId,
      nianSessionId: INPUT.nianSessionId,
      sourceSessionKey: INPUT.sessionRegistryKey,
      status: 'active',
    })

    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({
      idempotent: false,
      binding: { id: 'binding_1', nianSessionId: 'nian_1', status: 'active' },
    })

    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'agent_member_1' },
      data: expect.objectContaining({
        status: 'active',
        historyFromSequence: 43n,
        membershipEpoch: { increment: 1 },
        removedAt: null,
      }),
    })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_1' },
      data: expect.objectContaining({
        bindingIntentId: INPUT.bindingIntentId,
        nianSessionId: 'nian_1',
        sourceSessionKey: REGISTRY_KEY,
        status: 'active',
        lastDeliveredSequence: 43n,
        lastActivatedSequence: 43n,
        detachedReason: null,
      }),
    })
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('allows owners and regular members beyond the legacy Agent quota', async () => {
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'active',
      ownerUserId: 'user_1',
      maxAgentsPerUser: 1,
      maxAgentsPerRoom: 20,
      maxAutoFollowAgents: 3,
    })
    mockPrisma.roomMembership.count.mockImplementation(async ({ where }) =>
      where.principalType === 'human' ? 1 : 1,
    )
    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({ idempotent: false })

    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomBinding.findUnique.mockResolvedValue(null)
    mockPrisma.room.findUnique.mockResolvedValue({
      id: 'room_1',
      status: 'active',
      ownerUserId: 'owner_2',
      maxAgentsPerUser: 1,
      maxAgentsPerRoom: 20,
      maxAutoFollowAgents: 3,
    })
    mockPrisma.roomMembership.findUnique
      .mockResolvedValueOnce({
        id: 'human_1',
        roomId: 'room_1',
        userId: 'user_1',
        ownerUserId: 'user_1',
        principalType: 'human',
        status: 'active',
        historyFromSequence: 1n,
      })
      .mockResolvedValueOnce(null)
    mockPrisma.agentIdentity.findUnique.mockResolvedValue({
      id: 'agent_1',
      ownerType: 'user',
      ownerUserId: 'user_1',
      status: 'active',
      displayName: '成员 Agent',
    })
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.roomMembership.count.mockImplementation(async ({ where }) =>
      where.principalType === 'human' ? 1 : 1,
    )
    mockPrisma.roomBinding.count.mockResolvedValue(0)

    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({ idempotent: false })
  })

  it('returns the same Binding for an identical intent without creating another membership', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce(BINDING)

    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({
      idempotent: true,
      binding: { id: 'binding_1' },
    })
    expect(mockPrisma.roomMembership.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('rejects a conflicting replay instead of moving a Session to another Room', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce({ ...BINDING, roomId: 'room_other' })

    await expect(createRoomBindingAtomic(INPUT)).rejects.toMatchObject({
      code: 'room_binding_conflict',
    })
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('rejects a replay that changes activation behavior', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce({
      ...BINDING,
      activationMode: 'mention_only',
    })

    await expect(
      createRoomBindingAtomic({ ...INPUT, activationMode: 'auto_follow' }),
    ).rejects.toMatchObject({
      code: 'room_binding_conflict',
    })
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('does not impose an automatic Agent limit when Membership already exists', async () => {
    mockPrisma.roomMembership.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        id: 'human_1',
        roomId: 'room_1',
        userId: 'user_1',
        ownerUserId: 'user_1',
        principalType: 'human',
        status: 'active',
        historyFromSequence: 1n,
      })
      .mockResolvedValueOnce({
        id: 'agent_member_1',
        roomId: 'room_1',
        ownerUserId: 'user_1',
        principalType: 'agent',
        status: 'active',
      })
    mockPrisma.roomBinding.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockPrisma.roomBinding.count.mockResolvedValue(8)

    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({
      binding: { activationMode: 'auto_follow' },
    })
  })

  it('requires the exact Shennian Session to belong to the same user and machine', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_attacker',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })

    await expect(createRoomBindingAtomic(INPUT)).rejects.toMatchObject({
      code: 'nian_session_mismatch',
    })
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('rejects binding a Session owned by a different stable Agent identity', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_attacker',
      deletedAt: null,
    })

    await expect(createRoomBindingAtomic(INPUT)).rejects.toMatchObject({
      code: 'nian_session_mismatch',
    })
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })

  it('recovers a concurrent duplicate only when every bound identity still matches', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' })
    mockPrisma.roomBinding.findFirst.mockResolvedValue({
      ...BINDING,
      agentMembership: { id: 'agent_member_1' },
    })

    await expect(createRoomBindingAtomic(INPUT)).resolves.toMatchObject({
      idempotent: true,
      binding: { id: 'binding_1' },
    })
  })

  it('defaults every new Agent to auto-follow and preserves an explicit choice', () => {
    expect(
      resolveInitialRoomAgentActivationMode({
        requestedMode: 'auto_follow',
      }),
    ).toBe('auto_follow')
    expect(
      resolveInitialRoomAgentActivationMode({
        requestedMode: undefined,
      }),
    ).toBe('auto_follow')
    expect(
      resolveInitialRoomAgentActivationMode({
        requestedMode: 'mention_only',
      }),
    ).toBe('mention_only')
  })

  it('persists auto-follow for a newly managed Agent in a multi-person Room', async () => {
    mockPrisma.roomMembership.count.mockImplementation(async ({ where }) =>
      where.principalType === 'human' ? 2 : 0,
    )

    await createRoomBindingAtomic({
      ...INPUT,
      activationCapability: 'managed',
      activationMode: 'auto_follow',
    })

    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ activationMode: 'auto_follow' }),
    })
  })

  it('preserves an explicit non-managed or non-default activation choice', () => {
    expect(
      resolveInitialRoomAgentActivationMode({
        requestedMode: 'auto_follow',
      }),
    ).toBe('auto_follow')
    expect(
      resolveInitialRoomAgentActivationMode({
        requestedMode: 'paused',
      }),
    ).toBe('paused')
  })
})

describe('managed Room Binding restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.machine.findFirst.mockResolvedValue(SECURE_MACHINE)
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })
  })

  it('keeps membership and mode while moving to a fresh Session at the latest Room sequence', async () => {
    const current = {
      ...BINDING,
      activationCapability: 'managed',
      activationMode: 'mention_only',
      room: { id: 'room_1', status: 'active', nextSequence: 42n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    }
    mockPrisma.roomBinding.findUnique.mockResolvedValue(current)
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.roomBinding.findFirst.mockResolvedValue(null)
    mockPrisma.roomBinding.update.mockResolvedValue({
      ...current,
      nianSessionId: 'nian_2',
      sourceSessionKey: 'b'.repeat(64),
    })

    const result = await restartRoomBindingSession({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentIdentityId: 'agent_1',
      previousNianSessionId: 'nian_1',
      nianSessionId: 'nian_2',
      runtimeAdapter: 'codex',
      sessionRegistryKey: 'b'.repeat(64),
    })

    expect(result).toMatchObject({ resumeSequence: '42', idempotent: false })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'binding_1' },
        data: expect.objectContaining({
          nianSessionId: 'nian_2',
          lastDeliveredSequence: 42n,
          lastActivatedSequence: 42n,
          appliedConfigurationVersion: 4,
          pendingConfigurationVersion: null,
        }),
      }),
    )
  })

  it('keeps the committed restart boundary when retrying after new messages arrive', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      nianSessionId: 'nian_2',
      activationCapability: 'managed',
      lastActivatedSequence: 42n,
      room: { id: 'room_1', status: 'active', nextSequence: 45n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    })
    const result = await restartRoomBindingSession({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentIdentityId: 'agent_1',
      previousNianSessionId: 'nian_1',
      nianSessionId: 'nian_2',
      runtimeAdapter: 'codex',
      sessionRegistryKey: 'b'.repeat(64),
    })
    expect(result).toMatchObject({ resumeSequence: '42', idempotent: true })
    expect(mockPrisma.roomBinding.update).not.toHaveBeenCalled()
  })

  it.each([0n, 7n, 41n])('skips historical commands when the previous activation cursor is %s', async (lastActivatedSequence) => {
    const current = {
      ...BINDING,
      activationCapability: 'managed',
      lastActivatedSequence,
      pendingConfigurationVersion: 5,
      room: { id: 'room_1', status: 'active', nextSequence: 42n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    }
    mockPrisma.roomBinding.findUnique.mockResolvedValue(current)
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      creationKey: null,
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.roomBinding.findFirst.mockResolvedValue(null)
    mockPrisma.roomBinding.update.mockResolvedValue({ ...current, nianSessionId: 'nian_2' })

    const result = await restartRoomBindingSession({
      roomId: 'room_1',
      bindingId: 'binding_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentIdentityId: 'agent_1',
      previousNianSessionId: 'nian_1',
      nianSessionId: 'nian_2',
      runtimeAdapter: 'codex',
      sessionRegistryKey: 'b'.repeat(64),
    })

    expect(result.resumeSequence).toBe('42')
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastDeliveredSequence: 42n,
          lastActivatedSequence: 42n,
          appliedConfigurationVersion: 5,
          pendingConfigurationVersion: null,
        }),
      }),
    )
  })

  it('fails closed when an already-authenticated old machine was revoked before swap', async () => {
    mockPrisma.machine.findFirst.mockResolvedValue(null)
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      activationCapability: 'managed',
      status: 'detached',
      room: { id: 'room_1', status: 'active', nextSequence: 42n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    })
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })

    await expect(
      restartRoomBindingSession({
        roomId: 'room_1',
        bindingId: 'binding_1',
        userId: 'user_1',
        machineId: 'machine_1',
        agentIdentityId: 'agent_1',
        previousNianSessionId: 'nian_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'managed_agent_security_pending' })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'detached',
          activationMode: 'paused',
          detachedReason: 'security_pending',
          recoveryErrorCode: 'machine_unavailable',
        }),
      }),
    )
    expect(mockPrisma.roomBinding.update).not.toHaveBeenCalled()
  })

  it('can restart with an explicit unverified gap from an old daemon declaration', async () => {
    mockPrisma.machine.findFirst.mockResolvedValue({
      ...SECURE_MACHINE,
      agents: [{ type: 'codex', supportsManagedAgent: true }],
    })
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      activationCapability: 'managed',
      activationMode: 'paused',
      status: 'detached',
      detachedReason: 'security_pending',
      room: { id: 'room_1', status: 'active', nextSequence: 42n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    })

    await expect(
      restartRoomBindingSession({
        roomId: 'room_1',
        bindingId: 'binding_1',
        userId: 'user_1',
        machineId: 'machine_1',
        agentIdentityId: 'agent_1',
        previousNianSessionId: 'nian_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'b'.repeat(64),
      }),
    ).resolves.toMatchObject({ binding: { id: 'binding_1', status: 'active' } })
    expect(mockPrisma.nianSession.findUnique).toHaveBeenCalled()
    expect(mockPrisma.roomBinding.update).toHaveBeenCalled()
  })

  it('rejects a stale recovery worker after the user changes runtime configuration again', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      activationCapability: 'managed',
      status: 'detached',
      recoveryIntentId: 'intent-new',
      room: { id: 'room_1', status: 'active', nextSequence: 42n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    })
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })

    await expect(
      restartRoomBindingSession({
        roomId: 'room_1',
        bindingId: 'binding_1',
        userId: 'user_1',
        machineId: 'machine_1',
        agentIdentityId: 'agent_1',
        previousNianSessionId: 'nian_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'room_binding_restart_conflict' })
    expect(mockPrisma.roomBinding.update).not.toHaveBeenCalled()
  })

  it('accepts a detached recovery from an old CLI when the replacement Session proves the intent', async () => {
    const current = {
      ...BINDING,
      activationCapability: 'managed',
      activationMode: 'paused',
      status: 'detached',
      recoveryIntentId: 'intent-current',
      room: { id: 'room_1', status: 'active', nextSequence: 43n },
      agentMembership: { id: 'agent_member_1', status: 'active' },
    }
    mockPrisma.roomBinding.findUnique.mockResolvedValue(current)
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      creationKey: agentRoomRecoveryCreationKey({
        userId: 'user_1',
        agentIdentityId: 'agent_1',
        bindingId: 'binding_1',
        recoveryIntentId: 'intent-current',
      }),
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.roomBinding.findFirst.mockResolvedValue(null)
    mockPrisma.roomBinding.update.mockResolvedValue({
      ...current,
      nianSessionId: 'nian_2',
      status: 'paused',
    })

    await expect(
      restartRoomBindingSession({
        roomId: 'room_1',
        bindingId: 'binding_1',
        userId: 'user_1',
        machineId: 'machine_1',
        agentIdentityId: 'agent_1',
        previousNianSessionId: 'nian_1',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'b'.repeat(64),
      }),
    ).resolves.toMatchObject({ resumeSequence: '43', idempotent: false })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'paused', recoveryIntentId: null }),
      }),
    )
  })
})
