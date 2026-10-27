// @covers open-source/packages/server/src/services/room-agent-actions.ts
// @covers open-source/packages/server/src/services/room-core.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockGetSessionActivity } = vi.hoisted(() => ({
  mockGetSessionActivity: vi.fn(),
  mockPrisma: {
    roomBinding: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    roomMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    roomMessage: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    roomAttachment: { findUnique: vi.fn() },
    roomReadState: { upsert: vi.fn() },
    room: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../services/session-activity.js', () => ({ getSessionActivity: mockGetSessionActivity }))
vi.mock('../lib/oss.js', () => ({
  signDownloadUrl: vi.fn(() => 'https://room-files.example/attachment?signature=short'),
}))

import {
  getRoomAgentStatus,
  getRoomAgentAttachmentCapability,
  readRoomAgentMessages,
  sendRoomAgentMessage,
  updateRoomAgentMode,
  pauseRoomAgentWork,
} from '../services/room-agent-actions.js'

const ROOM = {
  id: 'room_1',
  name: '项目空间',
  status: 'active',
  nextSequence: 5n,
  maxAutoFollowAgents: 8,
  _count: { memberships: 2 },
  memberships: [
    { displayAlias: '李辰', principalType: 'human' },
    {
      displayAlias: '服务端 Agent',
      principalType: 'agent',
      agentIdentity: { description: '负责服务端研发' },
      parentHumanMembership: { displayAlias: '李辰' },
    },
  ],
}
const MEMBERSHIP = {
  id: 'agent_member_1',
  roomId: 'room_1',
  principalType: 'agent',
  ownerUserId: 'user_1',
  displayAlias: '服务端 Agent',
  status: 'active',
  historyFromSequence: 3n,
  readState: { lastDeliveredSequence: 2n },
  room: ROOM,
}
const BINDING = {
  nianSessionId: 'nian_current',
  sourceSessionKey: 'a'.repeat(64),
  id: 'binding_1',
  roomId: 'room_1',
  userId: 'user_1',
  machineId: 'machine_1',
  runtimeAdapter: 'codex',
  agentIdentityId: 'agent_1',
  agentMembershipId: 'agent_member_1',
  status: 'active',
  updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  capabilityEpoch: 0,
  appliedConfigurationVersion: 4,
  pendingConfigurationVersion: null,
  activationCapability: 'managed',
  activationMode: 'auto_follow',
  lastDeliveredSequence: 2n,
  lastActivatedSequence: 1n,
  room: ROOM,
  agentIdentity: {
    id: 'agent_1',
    ownerUserId: 'user_1',
    machineId: 'machine_1',
    runtimeAdapter: 'codex',
    sessionMode: 'standard',
    configurationVersion: 4,
    displayName: '服务端 Agent',
    description: '负责服务端研发',
    permissionPolicy: {
      version: 3,
      fileAccess: 'workspace-write',
      externalCapabilities: {
        commandNetwork: false,
        webSearch: true,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    },
    permissionPolicyVersion: 3,
    permissionConfirmation: null,
  },
  machine: {
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
          unsupportedCapabilities: ['computerUse'],
          capabilityMatrix: {
            fileAccess: {
              'workspace-read': true,
              'workspace-write': true,
              'host-full': true,
            },
            externalCapabilities: {
              commandNetwork: { allow: true, deny: true },
              webSearch: { allow: true, deny: true },
              browser: { allow: true, deny: true },
              computerUse: { allow: false, deny: true },
              mcp: { allow: true, deny: true },
            },
          },
        },
      },
    ],
  },
  agentMembership: MEMBERSHIP,
  nianSession: {
    userId: 'user_1',
    machineId: 'machine_1',
    workDir: '/code/shennian',
    deletedAt: null,
  },
}
const MESSAGE = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: 5n,
  authorMembershipId: 'agent_member_1',
  authorPrincipalTypeSnapshot: 'agent',
  ownerUserIdSnapshot: 'user_1',
  authorDisplayNameSnapshot: '服务端 Agent',
  ownerDisplayNameSnapshot: '李辰',
  authorAvatarSnapshot: null,
  mentionSnapshots: null,
  kind: 'text',
  text: '完成了',
  replyToMessageId: null,
  createdAt: new Date('2026-08-23T10:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  attachments: [],
}
const ACTOR = {
  roomId: 'room_1',
  bindingId: 'binding_1',
  userId: 'user_1',
  machineId: 'machine_1',
}

describe('Room Agent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    )
    mockPrisma.roomBinding.findUnique.mockResolvedValue(BINDING)
    mockGetSessionActivity.mockResolvedValue(null)
    mockPrisma.roomBinding.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...BINDING,
      ...data,
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    }))
    mockPrisma.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.roomBinding.findUniqueOrThrow.mockResolvedValue({
      ...BINDING,
      status: 'paused',
      activationMode: 'paused',
      updatedAt: new Date('2026-09-06T00:00:00.000Z'),
    })
    mockPrisma.roomBinding.count.mockResolvedValue(0)
    mockPrisma.roomMessage.findUnique.mockResolvedValue(null)
    mockPrisma.roomMessage.findMany.mockResolvedValue([MESSAGE])
    mockPrisma.roomMessage.create.mockResolvedValue(MESSAGE)
    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      id: 'attachment_1',
      roomId: 'room_1',
      status: 'ready',
      objectKey: 'rooms/room_1/attachment_1',
      safeName: 'diagram.png',
      mimeType: 'image/png',
      byteSize: 3n,
      sha256: 'a'.repeat(64),
      expiresAt: null,
      message: { roomId: 'room_1', sequence: 5n, deletedAt: null },
    })
    mockPrisma.roomReadState.upsert.mockResolvedValue({ lastDeliveredSequence: 5n })
    mockPrisma.roomMembership.findUnique.mockResolvedValue({
      ...MEMBERSHIP,
      displayAlias: '服务端 Agent',
      ownerUserId: 'user_1',
      ownerUser: {
        id: 'user_1',
        name: '李辰',
        avatarVersion: null,
        avatarUpdatedAt: null,
      },
    })
    mockPrisma.roomMembership.findMany.mockResolvedValue([])
    mockPrisma.room.update.mockResolvedValue({ nextSequence: 5n })
  })

  it.each([
    ['agent', 'provider-a/deepseek-flash', 'provider-b/deepseek-flash', 'provider-a/deepseek-flash'],
    ['session', 'provider-a/deepseek-flash', 'provider-b/deepseek-flash', 'provider-b/deepseek-flash'],
    ['agent', null, 'stale/model', null],
    ['session', 'provider-a/deepseek-flash', null, null],
  ])('reports the effective model for %s model policy', async (modelSource, agentModel, sessionModel, expected) => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      agentIdentity: { ...BINDING.agentIdentity, modelId: agentModel },
      nianSession: { ...BINDING.nianSession, modelSource, modelId: sessionModel },
    })
    await expect(getRoomAgentStatus(ACTOR)).resolves.toHaveProperty('effectiveModelId', expected)
  })

  it('returns status only for the exact user, machine, Room and Binding tuple', async () => {
    await expect(getRoomAgentStatus(ACTOR)).resolves.toMatchObject({
      nianSessionId: 'nian_current',
      sessionRegistryKey: 'a'.repeat(64),
      bindingId: 'binding_1',
      roomId: 'room_1',
      status: 'active',
      activationCapability: 'managed',
      managedWorkspacePath: '/code/shennian',
      appliedConfigurationVersion: 4,
      pendingConfigurationVersion: null,
      agent: {
        displayName: '服务端 Agent',
        description: '负责服务端研发',
        sessionMode: 'standard',
        permissionPolicy: {
          version: 3,
          fileAccess: 'workspace-write',
          externalCapabilities: { webSearch: true },
        },
        permissionConfirmation: null,
        configurationVersion: 4,
        configurationPending: false,
      },
      room: {
        name: '项目空间',
        lastSequence: '5',
        memberCount: 2,
        members: [
          { displayName: '李辰', principalType: 'human' },
          {
            displayName: '服务端 Agent',
            principalType: 'agent',
            description: '负责服务端研发',
            ownerDisplayName: '李辰',
          },
        ],
      },
    })
    await expect(
      getRoomAgentStatus({ ...ACTOR, machineId: 'machine_other' }),
    ).rejects.toMatchObject({ code: 'room_binding_unavailable' })
  })

  it('reports a pending next-turn configuration without detaching the current Binding', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      pendingConfigurationVersion: 5,
      agentIdentity: {
        ...BINDING.agentIdentity,
        configurationVersion: 5,
        machineId: 'machine_2',
        runtimeAdapter: 'claude',
      },
    })

    await expect(getRoomAgentStatus(ACTOR)).resolves.toMatchObject({
      status: 'active',
      appliedConfigurationVersion: 4,
      pendingConfigurationVersion: 5,
      agent: { configurationVersion: 5, configurationPending: true },
    })
    expect(mockPrisma.roomBinding.updateMany).not.toHaveBeenCalled()
  })

  it('reports a legacy Manager mode explicitly so the daemon can fail closed', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      agentIdentity: { ...BINDING.agentIdentity, sessionMode: 'manager' },
    })

    await expect(getRoomAgentStatus(ACTOR)).resolves.toMatchObject({
      agent: { sessionMode: 'manager' },
    })
  })

  it('quarantines a legacy policy-less Room Agent instead of allowing silent host access', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      agentIdentity: {
        id: 'agent_1',
        ownerUserId: 'user_1',
        machineId: 'machine_1',
        runtimeAdapter: 'codex',
        displayName: '旧 Agent',
        description: '旧数据',
        systemPrompt: '',
      },
    })

    await expect(getRoomAgentStatus(ACTOR)).rejects.toMatchObject({
      code: 'managed_agent_security_pending',
    })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding_1',
        status: { in: ['active', 'paused'] },
        capabilityEpoch: 0,
      },
      data: expect.objectContaining({
        status: 'detached',
        activationMode: 'paused',
        detachedReason: 'security_pending',
        recoveryErrorCode: 'permission_confirmation_required',
      }),
    })
  })

  it('keeps an existing full-access authorization after the Agent executable upgrades', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      machine: {
        ...BINDING.machine,
        agents: [
          {
            ...BINDING.machine.agents[0],
            managedAgentProtection: {
              ...BINDING.machine.agents[0]!.managedAgentProtection,
              level: 'partial',
            },
          },
        ],
      },
      agentIdentity: {
        ...BINDING.agentIdentity,
        permissionPolicy: {
          ...BINDING.agentIdentity.permissionPolicy,
          executionMode: 'native-full',
          fileAccess: 'host-full',
        },
        permissionConfirmation: {
          policyVersion: 3,
          runtimeAdapter: 'codex',
          runtimeVersion: '0.151.0',
          platform: 'darwin',
          executableFingerprint: `sha256:${'f'.repeat(64)}`,
          executionMode: 'native-full',
          hostFullAccess: true,
          limitedProtection: false,
          confirmedAt: '2026-09-11T00:00:00.000Z',
        },
      },
    })

    await expect(getRoomAgentStatus(ACTOR)).resolves.toMatchObject({ status: 'active' })
    expect(mockPrisma.roomBinding.updateMany).not.toHaveBeenCalled()
  })

  it('keeps native protection gaps visible without disabling the bound Agent', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      machine: { ...BINDING.machine, agents: [{ type: 'codex', supportsManagedAgent: true }] },
    })

    await expect(readRoomAgentMessages(ACTOR)).resolves.toMatchObject({ roomName: '项目空间' })
    await expect(
      sendRoomAgentMessage({ ...ACTOR, clientMessageId: 'allowed_1', text: '继续工作' }),
    ).resolves.toMatchObject({ message: { id: 'message_1' } })
  })

  it('allows a partial native protection runtime under the injected policy ceiling', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      machine: {
        ...BINDING.machine,
        agents: [
          {
            ...BINDING.machine.agents[0],
            managedAgentProtection: {
              ...BINDING.machine.agents[0]!.managedAgentProtection,
              level: 'partial',
              executableFingerprint: `sha256:${'b'.repeat(64)}`,
            },
          },
        ],
      },
    })

    await expect(readRoomAgentMessages(ACTOR)).resolves.toMatchObject({ roomName: '项目空间' })
  })

  it('reports a pending Binding without inventing an Agent membership', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      agentMembershipId: null,
      agentMembership: null,
      status: 'pending_approval',
    })

    await expect(getRoomAgentStatus(ACTOR)).resolves.toMatchObject({
      bindingId: 'binding_1',
      agentMembershipId: null,
      status: 'pending_approval',
      room: { name: '项目空间' },
    })
  })

  it('reads from the Membership history floor and atomically advances delivery cursors', async () => {
    const result = await readRoomAgentMessages({ ...ACTOR, afterSequence: '0', limit: 20 })

    expect(result).toMatchObject({
      nextSequence: '5',
      hasMore: false,
      historyFromSequence: '3',
      roomName: '项目空间',
    })
    expect(mockPrisma.roomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: 'room_1',
          sequence: { gt: 2n },
          createdAt: { gte: expect.any(Date) },
        },
        take: 20,
      }),
    )
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_1' },
      data: { lastDeliveredSequence: 5n },
    })
    expect(mockPrisma.roomReadState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { membershipId: 'agent_member_1' },
        update: { lastDeliveredSequence: 5n },
      }),
    )
  })

  it('rejects reading and sending after the Binding is detached', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({ ...BINDING, status: 'detached' })

    await expect(readRoomAgentMessages(ACTOR)).rejects.toMatchObject({
      code: 'room_binding_unavailable',
    })
    await expect(
      sendRoomAgentMessage({ ...ACTOR, clientMessageId: 'client_1', text: 'hello' }),
    ).rejects.toMatchObject({ code: 'room_binding_unavailable' })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('revalidates the exact Binding inside the send transaction', async () => {
    await expect(
      sendRoomAgentMessage({ ...ACTOR, clientMessageId: 'client_1', text: '完成了' }),
    ).resolves.toMatchObject({ message: { id: 'message_1' }, idempotent: false })

    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorMembershipId: 'agent_member_1',
          authorPrincipalTypeSnapshot: 'agent',
        }),
      }),
    )
    expect(mockPrisma.roomBinding.findUnique).toHaveBeenCalledTimes(3)
  })

  it('derives trusted activation causality from the cause message', async () => {
    mockPrisma.roomMessage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      roomId: 'room_1',
      activationRootCauseMessageId: 'root_1',
      activationHopCount: 2,
    })
    await sendRoomAgentMessage({
      ...ACTOR,
      clientMessageId: 'client_causal',
      text: '继续处理',
      activationCauseMessageId: 'cause_2',
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activationCauseMessageId: 'cause_2',
          activationRootCauseMessageId: 'root_1',
          activationHopCount: 3,
        }),
      }),
    )
  })

  it('rejects reuse of a client message id with different content or causality', async () => {
    mockPrisma.roomMessage.findUnique.mockResolvedValue({
      ...MESSAGE,
      text: '原内容',
      activationCauseMessageId: 'cause_1',
    })
    await expect(
      sendRoomAgentMessage({
        ...ACTOR,
        clientMessageId: 'client_1',
        text: '篡改内容',
        activationCauseMessageId: 'cause_2',
      }),
    ).rejects.toMatchObject({ code: 'client_message_id_conflict' })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('stops an Agent-authored chain beyond four trusted hops', async () => {
    mockPrisma.roomMessage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      roomId: 'room_1',
      activationRootCauseMessageId: 'root_1',
      activationHopCount: 4,
    })
    await expect(
      sendRoomAgentMessage({
        ...ACTOR,
        clientMessageId: 'client_hop_5',
        text: '继续',
        activationCauseMessageId: 'cause_4',
      }),
    ).rejects.toMatchObject({ code: 'activation_hop_limit' })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('issues a short attachment capability only inside the exact readable history', async () => {
    await expect(
      getRoomAgentAttachmentCapability({ ...ACTOR, attachmentId: 'attachment_1' }),
    ).resolves.toMatchObject({
      attachmentId: 'attachment_1',
      roomId: 'room_1',
      safeName: 'diagram.png',
      byteSize: '3',
      sha256: 'a'.repeat(64),
      downloadUrl: 'https://room-files.example/attachment?signature=short',
    })

    mockPrisma.roomAttachment.findUnique.mockResolvedValue({
      ...(await mockPrisma.roomAttachment.findUnique.mock.results[0]!.value),
      message: { roomId: 'room_1', sequence: 2n, deletedAt: null },
    })
    await expect(
      getRoomAgentAttachmentCapability({ ...ACTOR, attachmentId: 'attachment_1' }),
    ).rejects.toMatchObject({ code: 'room_attachment_unavailable' })
  })

  it('updates only the exact Binding mode without a Room-wide auto-follow cap', async () => {
    await expect(
      updateRoomAgentMode({ ...ACTOR, activationMode: 'paused' }),
    ).resolves.toMatchObject({ binding: { status: 'paused', activationMode: 'paused' } })
    expect(mockPrisma.roomBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'binding_1' },
        data: {
          status: 'paused',
          activationMode: 'paused',
          resumeActivationMode: 'auto_follow',
        },
      }),
    )

    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      status: 'paused',
      activationMode: 'paused',
    })
    mockPrisma.roomBinding.count.mockResolvedValue(8)
    await expect(
      updateRoomAgentMode({ ...ACTOR, activationMode: 'auto_follow' }),
    ).resolves.toMatchObject({ binding: { status: 'active', activationMode: 'auto_follow' } })
  })

  it('atomically pauses the exact Binding and appends one reason system message', async () => {
    await expect(
      pauseRoomAgentWork({ ...ACTOR, reason: '  检测到越权诱导  ' }),
    ).resolves.toMatchObject({ binding: { status: 'paused' }, idempotent: false })
    expect(mockPrisma.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: 'binding_1', status: 'active' },
      data: {
        status: 'paused',
        activationMode: 'paused',
        resumeActivationMode: 'auto_follow',
      },
    })
    expect(mockPrisma.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'system',
        source: 'system',
        text: '服务端 Agent paused work. Reason: 检测到越权诱导',
      }),
    })
  })

  it('allows an authenticated exact binding to stop without converting runtime mismatch into quarantine', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({ ...BINDING,
      agentIdentity: { ...BINDING.agentIdentity, machineId: 'changed-machine' },
    })
    await expect(pauseRoomAgentWork({ ...ACTOR, reason: '用户要求暂停' })).resolves.toMatchObject({ binding: { status: 'paused' } })
    expect(mockPrisma.roomBinding.updateMany.mock.calls.every(([input]) => input.data.status === 'paused')).toBe(true)
    await expect(pauseRoomAgentWork({ ...ACTOR, machineId: 'other-machine', reason: '暂停' })).rejects.toMatchObject({ code: 'room_binding_unavailable' })
  })

  it('returns the existing reason message when pause is retried', async () => {
    const pausedBinding = {
      ...BINDING,
      status: 'paused',
      activationMode: 'paused',
      agentIdentity: { ...BINDING.agentIdentity, displayName: '服务端 Agent' },
    }
    mockPrisma.roomBinding.findUnique.mockResolvedValue(pausedBinding)
    mockPrisma.roomMessage.findFirst.mockResolvedValue({
      ...MESSAGE,
      kind: 'system',
      text: '服务端 Agent paused work. Reason: 检测到越权诱导',
      clientMessageId: 'system:binding-paused:binding_1:1',
    })

    await expect(pauseRoomAgentWork({ ...ACTOR, reason: '重复请求' })).resolves.toMatchObject({
      binding: { status: 'paused' },
      message: { text: '服务端 Agent paused work. Reason: 检测到越权诱导' },
      idempotent: true,
    })
    expect(mockPrisma.roomBinding.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })

  it('allows only the already-running Turn to report after the owner pauses work', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      status: 'paused',
      activationMode: 'paused',
    })
    mockGetSessionActivity.mockResolvedValue({
      sessionId: 'nian_current',
      runId: 'run_in_flight',
      runPhase: 'tool_running',
      startedAt: '2026-09-09T23:59:00.000Z',
      updatedAt: '2026-09-10T00:00:01.000Z',
    })
    mockPrisma.roomMessage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
    })
    await expect(sendRoomAgentMessage({
      ...ACTOR,
      clientMessageId: 'paused_completion',
      text: '任务已经完成',
      activeRunId: 'run_in_flight',
    })).resolves.toMatchObject({ message: { id: 'message_1' } })
  })

  it('blocks new, stale, or unidentified sends after work is paused', async () => {
    mockPrisma.roomBinding.findUnique.mockResolvedValue({
      ...BINDING,
      status: 'paused',
      activationMode: 'paused',
    })
    mockGetSessionActivity.mockResolvedValue({
      sessionId: 'nian_current',
      runId: 'run_started_after_pause',
      runPhase: 'thinking',
      startedAt: '2026-09-10T00:00:01.000Z',
      updatedAt: '2026-09-10T00:00:02.000Z',
    })
    mockPrisma.roomMessage.findFirst.mockResolvedValue({
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
    })
    await expect(
      sendRoomAgentMessage({ ...ACTOR, clientMessageId: 'paused_send', text: '不应发送' }),
    ).rejects.toMatchObject({ code: 'room_binding_paused' })
    await expect(sendRoomAgentMessage({
      ...ACTOR,
      clientMessageId: 'paused_new_run',
      text: '仍不应发送',
      activeRunId: 'run_started_after_pause',
    })).rejects.toMatchObject({ code: 'room_binding_paused' })
    mockGetSessionActivity.mockResolvedValue({
      sessionId: 'nian_current',
      runId: 'run_without_manual_pause',
      runPhase: 'tool_running',
      startedAt: '2026-09-09T23:59:00.000Z',
      updatedAt: '2026-09-10T00:00:02.000Z',
    })
    mockPrisma.roomMessage.findFirst.mockResolvedValue(null)
    await expect(sendRoomAgentMessage({
      ...ACTOR,
      clientMessageId: 'self_paused_send',
      text: '安全暂停后不应继续发送',
      activeRunId: 'run_without_manual_pause',
    })).rejects.toMatchObject({ code: 'room_binding_paused' })
    expect(mockPrisma.roomMessage.create).not.toHaveBeenCalled()
  })
})
