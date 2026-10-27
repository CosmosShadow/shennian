// @covers open-source/packages/server/src/services/room-agent-onboarding.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    machine: { findFirst: vi.fn() },
    nianSession: { findUnique: vi.fn(), update: vi.fn() },
    room: { create: vi.fn(), update: vi.fn() },
    roomMembership: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    roomReadState: { create: vi.fn(), upsert: vi.fn() },
    agentIdentity: { create: vi.fn(), findFirst: vi.fn() },
    roomBinding: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    roomInvite: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    roomJoinRequest: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    roomMessage: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  createRoomFromAgent,
  deriveCreateInviteToken,
  joinRoomFromAgent,
} from '../services/room-agent-onboarding.js'
import { hashRoomInviteCapability } from '../services/room-invite-browser.js'

const INPUT = {
  bindingIntentId: 'room-create:intent_1',
  userId: 'user_1',
  machineId: 'machine_1',
  nianSessionId: 'nian_1',
  runtimeAdapter: 'codex' as const,
  sessionRegistryKey: 'a'.repeat(64),
  name: '研发协作',
  agentAlias: '我的 Codex',
  agentDescription: '负责研发协作',
  activationCapability: 'idle_resume' as const,
  activationMode: 'auto_follow' as const,
}
const INVITE_TOKEN = 'i'.repeat(43)
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

describe('Room Agent onboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomBinding.findUnique.mockResolvedValue(null)
    mockPrisma.roomMembership.findMany.mockResolvedValue([])
    mockPrisma.roomBinding.count.mockResolvedValue(0)
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', name: '李辰' })
    mockPrisma.machine.findFirst.mockResolvedValue({
      agents: [
        {
          type: 'codex',
          managedAgentProtection: {
            level: 'hard',
            runtimeVersion: '1.0.0',
            platform: 'darwin',
            executableFingerprint: `sha256:${'a'.repeat(64)}`,
            unsupportedCapabilities: [],
            capabilityMatrix: hardCapabilityMatrix,
          },
        },
        {
          type: 'claude',
          managedAgentProtection: {
            level: 'hard',
            runtimeVersion: '2.1.260',
            platform: 'darwin',
            executableFingerprint: `sha256:${'b'.repeat(64)}`,
            unsupportedCapabilities: [],
            capabilityMatrix: hardCapabilityMatrix,
          },
        },
      ],
    })
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      deletedAt: null,
    })
    mockPrisma.room.create.mockResolvedValue({
      id: 'room_1',
      name: '研发协作',
      visibility: 'private',
      joinPolicy: 'approval',
    })
    mockPrisma.roomMembership.create
      .mockResolvedValueOnce({ id: 'human_1' })
      .mockResolvedValueOnce({ id: 'agent_member_1' })
    mockPrisma.roomReadState.create.mockResolvedValue({})
    mockPrisma.roomReadState.upsert.mockResolvedValue({})
    mockPrisma.nianSession.update.mockResolvedValue({})
    mockPrisma.roomMembership.count.mockResolvedValue(0)
    mockPrisma.agentIdentity.create.mockResolvedValue({
      id: 'agent_1',
      displayName: '我的 Codex',
    })
    mockPrisma.roomBinding.create.mockResolvedValue({
      id: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_1',
      status: 'active',
      activationMode: 'auto_follow',
    })
    mockPrisma.roomInvite.create.mockResolvedValue({ id: 'invite_1', roomId: 'room_1' })
    mockPrisma.roomInvite.update.mockResolvedValue({})
    mockPrisma.roomInvite.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 1n })
    mockPrisma.roomMessage.create.mockResolvedValue({ id: 'system_1' })
  })

  it('atomically creates the safe-default Room, human, Agent, Binding and invitation', async () => {
    const result = await createRoomFromAgent(INPUT)

    expect(result).toMatchObject({
      room: { id: 'room_1', visibility: 'private', joinPolicy: 'approval' },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      binding: { id: 'binding_1', agentMembershipId: 'agent_member_1' },
      idempotent: false,
    })
    expect(result.rawInviteToken).toHaveLength(43)
    expect(mockPrisma.roomMembership.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          principalType: 'agent',
          parentHumanMembershipId: 'human_1',
          displayAlias: '我的 Codex',
        }),
      }),
    )
    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bindingIntentId: 'room-create:intent_1',
        nianSessionId: 'nian_1',
        sourceSessionKey: 'a'.repeat(64),
      }),
    })
    expect(mockPrisma.roomInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 'room_1',
        tokenHash: hashRoomInviteCapability(result.rawInviteToken),
        maxUses: 20,
      }),
    })
  })

  it('derives the same unguessable invitation capability for an idempotent retry', () => {
    expect(deriveCreateInviteToken('room-create:intent_1')).toBe(
      deriveCreateInviteToken('room-create:intent_1'),
    )
    expect(deriveCreateInviteToken('room-create:intent_1')).not.toBe(
      deriveCreateInviteToken('room-create:intent_2'),
    )
  })

  it('rejects a mismatched native Session before creating any identity or Room', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_other',
      agentType: 'codex',
      deletedAt: null,
    })

    await expect(createRoomFromAgent(INPUT)).rejects.toMatchObject({
      code: 'nian_session_mismatch',
    })
    expect(mockPrisma.room.create).not.toHaveBeenCalled()
    expect(mockPrisma.agentIdentity.create).not.toHaveBeenCalled()
  })

  it('fails closed when legacy Room onboarding cannot prove managed protection', async () => {
    mockPrisma.machine.findFirst.mockResolvedValue({
      agents: [{ type: 'codex', managedAgentProtection: { level: 'hard' } }],
    })

    await expect(createRoomFromAgent(INPUT)).rejects.toMatchObject({
      code: 'managed_agent_protection_unavailable',
    })
  })

  it('requires an explicit limited-protection confirmation for a partial runtime', async () => {
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_1',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'codex',
      agentIdentityId: 'agent_1',
      deletedAt: null,
    })
    mockPrisma.machine.findFirst.mockResolvedValue({
      agents: [
        {
          type: 'codex',
          managedAgentProtection: {
            level: 'partial',
            runtimeVersion: '1.0.0',
            platform: 'darwin',
            executableFingerprint: `sha256:${'a'.repeat(64)}`,
            unsupportedCapabilities: ['externalCapabilities.commandNetwork'],
            capabilityMatrix: hardCapabilityMatrix,
          },
        },
      ],
    })
    mockPrisma.agentIdentity.findFirst.mockResolvedValue({
      id: 'agent_1',
      ownerType: 'user',
      ownerUserId: 'user_1',
      status: 'active',
      displayName: '我的 Codex',
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
    })

    await expect(createRoomFromAgent(INPUT)).rejects.toMatchObject({
      code: 'managed_agent_confirmation_required',
    })
  })

  it('rejects an empty Agent description before creating any identity or Room', async () => {
    await expect(createRoomFromAgent({ ...INPUT, agentDescription: '   ' })).rejects.toMatchObject({
      code: 'invalid_agent_description',
    })
    expect(mockPrisma.room.create).not.toHaveBeenCalled()
    expect(mockPrisma.agentIdentity.create).not.toHaveBeenCalled()
  })

  it('recovers an exact retry and rejects reuse with changed user-confirmed names', async () => {
    const rawInviteToken = deriveCreateInviteToken(INPUT.bindingIntentId)
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      id: 'binding_1',
      roomId: 'room_1',
      userId: 'user_1',
      machineId: 'machine_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'a'.repeat(64),
      activationCapability: 'idle_resume',
      activationMode: 'auto_follow',
      status: 'active',
      room: { id: 'room_1', name: '研发协作' },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      agentMembership: { id: 'agent_member_1' },
    })
    mockPrisma.roomInvite.findUnique.mockResolvedValue({
      id: 'invite_1',
      roomId: 'room_1',
      tokenHash: hashRoomInviteCapability(rawInviteToken),
    })

    await expect(createRoomFromAgent(INPUT)).resolves.toMatchObject({ idempotent: true })
    await expect(createRoomFromAgent({ ...INPUT, agentAlias: '换一个名字' })).rejects.toMatchObject(
      { code: 'room_create_conflict' },
    )
    expect(mockPrisma.room.create).not.toHaveBeenCalled()
  })

  it('creates a pending Binding together with an approval request', async () => {
    const room = inviteRoom('approval')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomBinding.create.mockResolvedValue({
      id: 'binding_pending',
      roomId: 'room_2',
      agentIdentityId: 'agent_1',
      agentMembershipId: null,
      status: 'pending_approval',
      activationMode: 'auto_follow',
    })
    mockPrisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    mockPrisma.roomJoinRequest.create.mockResolvedValue({
      id: 'request_1',
      pendingBindingId: 'binding_pending',
      status: 'pending',
    })

    const result = await joinRoomFromAgent({
      ...INPUT,
      bindingIntentId: 'room-join:intent_1',
      inviteToken: INVITE_TOKEN,
      message: '希望加入协作',
    })

    expect(result).toMatchObject({
      outcome: 'pending_approval',
      binding: { id: 'binding_pending', status: 'pending_approval' },
      joinRequest: { id: 'request_1' },
    })
    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'pending_approval',
        bindingIntentId: 'room-join:intent_1',
      }),
    })
    expect(mockPrisma.roomJoinRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pendingBindingId: 'binding_pending',
        requestedAgentAlias: '我的 Codex',
      }),
    })
  })

  it('joins an open Room and activates the exact Agent Binding atomically', async () => {
    const room = inviteRoom('open')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.roomMembership.findUnique.mockResolvedValue(null)
    mockPrisma.roomMembership.create
      .mockReset()
      .mockResolvedValueOnce({
        id: 'human_2',
        roomId: 'room_2',
        principalType: 'human',
        ownerUserId: 'user_1',
        displayAlias: '李辰',
        membershipEpoch: 1,
        historyFromSequence: 9n,
      })
      .mockResolvedValueOnce({ id: 'agent_member_2' })
    mockPrisma.roomBinding.create.mockResolvedValue({
      id: 'binding_2',
      roomId: 'room_2',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_2',
      status: 'active',
      activationMode: 'auto_follow',
    })

    const result = await joinRoomFromAgent({
      ...INPUT,
      bindingIntentId: 'room-join:intent_2',
      inviteToken: INVITE_TOKEN,
    })

    expect(result).toMatchObject({
      outcome: 'joined',
      humanMembership: { id: 'human_2' },
      agentMembership: { id: 'agent_member_2' },
      binding: { id: 'binding_2', status: 'active' },
    })
    expect(mockPrisma.roomInvite.updateMany).toHaveBeenCalled()
    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentMembershipId: 'agent_member_2' }),
    })
  })

  it('adds a second independently named Agent under the same active human membership', async () => {
    const room = inviteRoom('open')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.nianSession.findUnique.mockResolvedValue({
      id: 'nian_2',
      userId: 'user_1',
      machineId: 'machine_1',
      agentType: 'claude',
      deletedAt: null,
    })
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'human_existing',
      roomId: room.id,
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      status: 'active',
      membershipEpoch: 1,
      historyFromSequence: 3n,
    })
    mockPrisma.roomMembership.count.mockResolvedValue(1)
    mockPrisma.roomBinding.count.mockResolvedValue(1)
    mockPrisma.agentIdentity.create.mockResolvedValue({
      id: 'agent_edge',
      displayName: '边缘测试',
    })
    mockPrisma.roomMembership.create.mockReset().mockResolvedValue({ id: 'agent_member_edge' })
    mockPrisma.roomBinding.create.mockResolvedValue({
      id: 'binding_edge',
      roomId: room.id,
      agentIdentityId: 'agent_edge',
      agentMembershipId: 'agent_member_edge',
      status: 'active',
      activationMode: 'mention_only',
    })

    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:intent_edge',
        nianSessionId: 'nian_2',
        runtimeAdapter: 'claude_code',
        sessionRegistryKey: 'b'.repeat(64),
        inviteToken: INVITE_TOKEN,
        agentAlias: '边缘测试',
        agentDescription: '负责边缘场景测试',
        activationMode: 'mention_only',
      }),
    ).resolves.toMatchObject({
      humanMembership: { id: 'human_existing' },
      agentIdentity: { id: 'agent_edge', displayName: '边缘测试' },
      agentMembership: { id: 'agent_member_edge' },
      binding: { id: 'binding_edge', activationMode: 'mention_only' },
    })

    expect(mockPrisma.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerType: 'user',
        ownerUserId: 'user_1',
        displayName: '边缘测试',
        description: '负责边缘场景测试',
      }),
    })
    expect(mockPrisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentIdentityId: 'agent_edge',
        ownerUserId: 'user_1',
        parentHumanMembershipId: 'human_existing',
        displayAlias: '边缘测试',
      }),
    })
    expect(mockPrisma.roomBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nianSessionId: 'nian_2',
        runtimeAdapter: 'claude_code',
        sourceSessionKey: 'b'.repeat(64),
        agentIdentityId: 'agent_edge',
        agentMembershipId: 'agent_member_edge',
        activationMode: 'mention_only',
      }),
    })
  })

  it('repairs only the exact detached Binding with a fresh valid invitation', async () => {
    const room = inviteRoom('open')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'human_existing',
      roomId: room.id,
      userId: 'user_1',
      principalType: 'human',
      ownerUserId: 'user_1',
      displayAlias: '李辰',
      status: 'active',
      membershipEpoch: 1,
      historyFromSequence: 3n,
    })
    const detached = {
      id: 'binding_detached',
      roomId: room.id,
      userId: 'user_1',
      machineId: 'machine_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'a'.repeat(64),
      status: 'detached',
      activationCapability: 'idle_resume',
      activationMode: 'paused',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_old',
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex', status: 'active' },
      agentMembership: { id: 'agent_member_old', status: 'removed' },
    }
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(detached)
    mockPrisma.roomMembership.update.mockResolvedValue({
      id: 'agent_member_old',
      status: 'active',
    })
    mockPrisma.roomBinding.update.mockResolvedValue({
      ...detached,
      bindingIntentId: 'room-join:repair_1',
      status: 'active',
      activationMode: 'auto_follow',
      agentMembership: { id: 'agent_member_old', status: 'active' },
    })

    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:repair_1',
        inviteToken: INVITE_TOKEN,
      }),
    ).resolves.toMatchObject({
      outcome: 'joined',
      repaired: true,
      binding: { id: 'binding_detached', status: 'active' },
    })

    expect(mockPrisma.agentIdentity.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 'agent_member_old' },
      data: expect.objectContaining({
        parentHumanMembershipId: 'human_existing',
        status: 'active',
        membershipEpoch: { increment: 1 },
      }),
    })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_detached' },
      data: expect.objectContaining({
        bindingIntentId: 'room-join:repair_1',
        status: 'active',
        lastDeliveredSequence: 2n,
        lastActivatedSequence: 2n,
      }),
    })

    mockPrisma.roomBinding.findUnique.mockReset().mockResolvedValue({
      ...detached,
      bindingIntentId: 'room-join:repair_1',
      status: 'active',
      activationMode: 'auto_follow',
      room,
      agentMembership: { id: 'agent_member_old', status: 'active' },
      joinRequest: null,
    })
    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:repair_1',
        inviteToken: INVITE_TOKEN,
      }),
    ).resolves.toMatchObject({ idempotent: true, binding: { id: 'binding_detached' } })
  })

  it('refuses detached Binding repair when any exact Session field differs', async () => {
    const room = inviteRoom('open')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'human_existing',
      userId: 'user_1',
      status: 'active',
      historyFromSequence: 3n,
    })
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'binding_detached',
      roomId: room.id,
      userId: 'user_1',
      machineId: 'machine_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'f'.repeat(64),
      status: 'detached',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_old',
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex', status: 'active' },
      agentMembership: { id: 'agent_member_old', status: 'removed' },
    })

    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:repair_bad',
        inviteToken: INVITE_TOKEN,
      }),
    ).rejects.toMatchObject({ code: 'room_binding_repair_conflict' })
    expect(mockPrisma.roomMembership.update).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.update).not.toHaveBeenCalled()
  })

  it('does not restore a detached Agent before its human membership is active again', async () => {
    const room = inviteRoom('open')
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      id: 'human_removed',
      userId: 'user_1',
      status: 'removed',
      historyFromSequence: 3n,
    })
    mockPrisma.roomBinding.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'binding_detached',
      roomId: room.id,
      userId: 'user_1',
      machineId: 'machine_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'a'.repeat(64),
      status: 'detached',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_old',
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex', status: 'active' },
      agentMembership: { id: 'agent_member_old', status: 'removed' },
    })

    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:repair_without_human',
        inviteToken: INVITE_TOKEN,
      }),
    ).rejects.toMatchObject({ code: 'room_binding_repair_membership_required' })
    expect(mockPrisma.roomBinding.update).not.toHaveBeenCalled()
  })

  it('fails closed without creating an Agent when the Room no longer accepts joins', async () => {
    const room = { ...inviteRoom('approval'), joinPolicy: 'closed' as const }
    mockPrisma.roomInvite.findUnique.mockResolvedValue(activeInvite(room))

    await expect(
      joinRoomFromAgent({
        ...INPUT,
        bindingIntentId: 'room-join:intent_closed',
        inviteToken: INVITE_TOKEN,
      }),
    ).rejects.toMatchObject({ code: 'room_invite_unavailable' })
    expect(mockPrisma.agentIdentity.create).not.toHaveBeenCalled()
    expect(mockPrisma.roomBinding.create).not.toHaveBeenCalled()
  })
})

function inviteRoom(joinPolicy: 'open' | 'approval' | 'closed') {
  return {
    id: 'room_2',
    name: '外部协作',
    status: 'active',
    visibility: 'private',
    joinPolicy,
    nextSequence: 8n,
    maxAgentsPerUser: 8,
    maxAgentsPerRoom: 32,
    maxAutoFollowAgents: 8,
  }
}

function activeInvite(room: ReturnType<typeof inviteRoom>) {
  return {
    id: 'invite_2',
    roomId: room.id,
    status: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    useCount: 0,
    maxUses: 20,
    room,
  }
}
