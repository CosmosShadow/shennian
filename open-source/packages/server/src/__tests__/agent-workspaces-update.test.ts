// @covers open-source/packages/server/src/services/agent-workspaces.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  prismaMock,
  createSessionMock,
  deleteSessionMock,
  broadcastPolicyMock,
  removeMembershipMock,
  broadcastRoomMock,
  reconcileMock,
} = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    machine: { findFirst: vi.fn() },
    nianSession: { findMany: vi.fn() },
    agentIdentity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    roomMembership: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    roomBinding: { findMany: vi.fn(), updateMany: vi.fn() },
    agentPublication: { updateMany: vi.fn() },
    agentDirectMessage: { updateMany: vi.fn() },
    roomMessage: { updateMany: vi.fn() },
  },
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  broadcastPolicyMock: vi.fn(),
  removeMembershipMock: vi.fn(),
  broadcastRoomMock: vi.fn(),
  reconcileMock: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/sessions.js', () => ({
  createSessionForUser: createSessionMock,
  deleteSessionForUser: deleteSessionMock,
  broadcastAgentRuntimePolicy: broadcastPolicyMock,
}))
vi.mock('../services/room-core.js', () => ({ removeRoomMembership: removeMembershipMock }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: broadcastRoomMock }))
vi.mock('../services/agent-room-recovery.js', () => ({
  reconcileAgentRoomBindings: reconcileMock,
}))

import {
  listAgentWorkspaces,
  updateAgentWorkspace,
} from '../services/agent-workspaces.js'

const now = new Date('2026-08-25T00:00:00.000Z')
const managedAgentProtection = {
  level: 'hard',
  runtimeVersion: '1.0.0',
  platform: 'darwin',
  executableFingerprint: `sha256:${'a'.repeat(64)}`,
  unsupportedCapabilities: [],
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
      computerUse: { allow: true, deny: true },
      mcp: { allow: true, deny: true },
    },
  },
}
function managedMachine(id: string, agentType: 'codex' | 'claude' = 'codex') {
  return {
    id,
    userId: 'user-1',
    agentList: [agentType],
    agents: [
      {
        type: agentType,
        supportsManagedAgent: true,
        supportsManagedNativeFull: true,
        supportsWorker: true,
        supportsManagerMode: true,
        managedAgentProtection,
      },
    ],
  }
}
const agent = {
  id: 'agent-1',
  ownerType: 'user',
  ownerUserId: 'user-1',
  displayName: '开发工程师',
  description: '负责开发',
  systemPrompt: '先读项目文档',
  status: 'active',
  machineId: 'machine-1',
  runtimeAdapter: 'codex',
  workDir: '/code/shennian',
  modelId: null,
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
  configurationVersion: 1,
  permissionConfirmation: null,
  createdAt: now,
  updatedAt: now,
  machine: { id: 'machine-1', name: 'Mac' },
  sessions: [],
}

describe('Agent workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.nianSession.findMany.mockResolvedValue([])
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    broadcastPolicyMock.mockResolvedValue(undefined)
    deleteSessionMock.mockResolvedValue(undefined)
    removeMembershipMock.mockResolvedValue({ removedMembershipIds: [], detachedBindingCount: 0 })
    broadcastRoomMock.mockResolvedValue(undefined)
    prismaMock.roomBinding.findMany.mockResolvedValue([])
    prismaMock.roomMembership.findMany.mockResolvedValue([])
    prismaMock.agentIdentity.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$queryRaw.mockResolvedValue([])
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.agentDirectMessage.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.roomMessage.updateMany.mockResolvedValue({ count: 0 })
    reconcileMock.mockResolvedValue({ attempted: 0, recovered: 0, failed: 0, waiting: 0 })
    prismaMock.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return input({
          $queryRaw: prismaMock.$queryRaw,
          agentIdentity: prismaMock.agentIdentity,
          agentPublication: prismaMock.agentPublication,
          agentDirectMessage: prismaMock.agentDirectMessage,
          roomMessage: prismaMock.roomMessage,
          roomBinding: prismaMock.roomBinding,
          roomMembership: prismaMock.roomMembership,
        })
      }
      if (Array.isArray(input)) return Promise.all(input)
      return input
    })
  })

  it('updates the complete runtime configuration only after ownership and runtime validation', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-2', 'claude'))
    prismaMock.agentIdentity.update.mockResolvedValue({})

    await updateAgentWorkspace('user-1', 'agent-1', {
      machineId: 'machine-2',
      runtimeAdapter: 'claude',
      workDir: '/code/other',
      modelId: 'claude-opus',
    })

    expect(prismaMock.machine.findFirst).toHaveBeenCalledWith({
      where: { id: 'machine-2', userId: 'user-1', paired: true },
    })
    expect(prismaMock.agentIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', configurationVersion: 1 },
      data: expect.objectContaining({
        configurationVersion: 2,
        machineId: 'machine-2',
        runtimeAdapter: 'claude',
        workDir: '/code/other',
        modelId: 'claude-opus',
      }),
    })
    expect(reconcileMock).toHaveBeenCalledWith({ agentId: 'agent-1', userId: 'user-1' })
  })

  it.each([
    ['machine', { machineId: 'machine-2' }, managedMachine('machine-2')],
    ['working directory', { workDir: '/code/other' }, managedMachine('machine-1')],
    ['runtime Agent', { runtimeAdapter: 'claude' }, managedMachine('machine-1', 'claude')],
  ])('stages a fresh Room conversation when the %s changes', async (_label, patch, machine) => {
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(agent)
      .mockResolvedValueOnce({ ...agent, ...patch })
    prismaMock.machine.findFirst.mockResolvedValue(machine)
    prismaMock.roomBinding.findMany.mockResolvedValue([
      {
        id: 'binding-1',
        roomId: 'room-1',
        recoveryIntentId: null,
        nianSessionId: 'session-1',
        machineId: 'machine-1',
        machine: { daemonInstallationId: 'daemon-1' },
      },
    ])

    await updateAgentWorkspace('user-1', 'agent-1', patch)

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] } },
      data: expect.objectContaining({
        detachedReason: 'runtime_reconfigured',
        pendingConfigurationVersion: 2,
      }),
    })
    expect(reconcileMock).toHaveBeenCalledWith({ agentId: 'agent-1', userId: 'user-1' })
  })

  it('reuses each Room recovery intent when the same configuration is saved again', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.agentIdentity.update.mockResolvedValue({})
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', recoveryIntentId: 'intent-stable' },
    ])

    await updateAgentWorkspace('user-1', 'agent-1', { machineId: 'machine-1' })

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] } },
      data: {
        detachedReason: 'recovery_requested',
        recoveryLeaseUntil: null,
        recoveryErrorCode: null,
      },
    })
  })

  it('broadcasts the latest prompt and model policy without rewriting session runtime bindings', async () => {
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(agent)
      .mockResolvedValueOnce({ ...agent, systemPrompt: '新的行为', modelId: 'gpt-5.6-terra' })
    prismaMock.agentIdentity.update.mockResolvedValue({})

    await updateAgentWorkspace('user-1', 'agent-1', {
      systemPrompt: '新的行为',
      modelId: 'gpt-5.6-terra',
    })

    expect(prismaMock.agentIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', configurationVersion: 1 },
      data: {
        systemPrompt: '新的行为',
        modelId: 'gpt-5.6-terra',
        configurationVersion: 2,
      },
    })
    expect(broadcastPolicyMock).toHaveBeenCalledWith({
      agentIdentityId: 'agent-1',
      modelId: 'gpt-5.6-terra',
      systemPrompt: '新的行为',
    })
  })

  it('increments the server-owned permission revision only for an explicit current policy update', async () => {
    const nextPolicy = {
      version: 2,
      fileAccess: 'workspace-read',
      externalCapabilities: {
        commandNetwork: false,
        webSearch: false,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    }
    prismaMock.agentIdentity.findFirst.mockResolvedValueOnce(agent).mockResolvedValueOnce({
      ...agent,
      permissionPolicy: nextPolicy,
      permissionPolicyVersion: 2,
    })
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', pendingConfigurationVersion: null },
    ])
    prismaMock.agentIdentity.update.mockResolvedValue({})

    const updated = await updateAgentWorkspace('user-1', 'agent-1', {
      permissionPolicy: {
        ...nextPolicy,
        version: 1,
      },
    })

    expect(prismaMock.agentIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', permissionPolicyVersion: 1, configurationVersion: 1 },
      data: {
        configurationVersion: 2,
        permissionPolicy: { ...nextPolicy, executionMode: 'restricted' },
        permissionPolicyVersion: 2,
      },
    })
    expect(updated.permissionPolicy).toEqual({ ...nextPolicy, executionMode: 'restricted' })
  })

  it('applies permission changes at the next turn without replacing Room conversations', async () => {
    const nextPolicy = {
      ...agent.permissionPolicy,
      version: 2,
      fileAccess: 'workspace-read',
    }
    prismaMock.agentIdentity.findFirst.mockResolvedValueOnce(agent).mockResolvedValueOnce({
      ...agent,
      permissionPolicy: nextPolicy,
      permissionPolicyVersion: 2,
    })
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', pendingConfigurationVersion: null },
    ])
    await updateAgentWorkspace('user-1', 'agent-1', {
      permissionPolicy: { ...nextPolicy, version: 1 },
    })

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] }, pendingConfigurationVersion: null },
      data: { appliedConfigurationVersion: 2 },
    })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('does not depend on aborting an in-flight turn when permissions tighten', async () => {
    const nextPolicy = {
      ...agent.permissionPolicy,
      version: 2,
      fileAccess: 'workspace-read',
    }
    prismaMock.agentIdentity.findFirst.mockResolvedValueOnce(agent).mockResolvedValueOnce({
      ...agent,
      permissionPolicy: nextPolicy,
      permissionPolicyVersion: 2,
    })
    await updateAgentWorkspace('user-1', 'agent-1', {
      permissionPolicy: { ...nextPolicy, version: 1 },
    })

    expect(prismaMock.roomBinding.updateMany).not.toHaveBeenCalled()
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it.each([
    ['system prompt', { systemPrompt: '新的行为' }],
    ['model', { modelId: 'gpt-5.6-terra' }],
    ['work mode', { sessionMode: 'manager' }],
    [
      'Manager defaults',
      {
        sessionMode: 'manager',
        managerConfig: {
          defaultWorkerAgentType: 'codex',
          defaultWorkerModelId: 'gpt-5.6-sol',
        },
      },
    ],
  ])('keeps Room conversations for a changed %s', async (_label, patch) => {
    const current =
      patch.sessionMode === 'manager'
        ? { ...agent, sessionMode: 'standard', managerConfig: null }
        : agent
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, ...patch })
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', pendingConfigurationVersion: null },
    ])

    await updateAgentWorkspace('user-1', 'agent-1', patch)

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] }, pendingConfigurationVersion: null },
      data: { appliedConfigurationVersion: 2 },
    })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('keeps a hard restart pending when a turn policy changes during recovery', async () => {
    const recoveringAgent = { ...agent, configurationVersion: 2 }
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(recoveringAgent)
      .mockResolvedValueOnce({
        ...recoveringAgent,
        systemPrompt: '新的行为',
        configurationVersion: 3,
      })
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { id: 'binding-1', roomId: 'room-1', pendingConfigurationVersion: 2 },
    ])

    await updateAgentWorkspace('user-1', 'agent-1', { systemPrompt: '新的行为' })

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] }, pendingConfigurationVersion: { not: null } },
      data: { pendingConfigurationVersion: 3 },
    })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('atomically rejects a policy update that races with a newer revision', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.agentIdentity.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      updateAgentWorkspace('user-1', 'agent-1', {
        permissionPolicy: { ...agent.permissionPolicy, fileAccess: 'workspace-read' },
      }),
    ).rejects.toMatchObject({ code: 'invalid', message: 'Agent configuration version is stale' })
    expect(prismaMock.agentIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', permissionPolicyVersion: 1, configurationVersion: 1 },
      data: expect.objectContaining({ permissionPolicyVersion: 2, configurationVersion: 2 }),
    })
  })

  it('preserves permissions for old-client patches and rejects stale policy revisions', async () => {
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(agent)
      .mockResolvedValueOnce({ ...agent, displayName: '旧客户端改名' })
    prismaMock.agentIdentity.update.mockResolvedValue({})

    await updateAgentWorkspace('user-1', 'agent-1', { displayName: '旧客户端改名' })
    expect(prismaMock.agentIdentity.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { displayName: '旧客户端改名' },
    })

    vi.clearAllMocks()
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', {
        permissionPolicy: {
          ...agent.permissionPolicy,
          version: 9,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid', message: 'permissionPolicy version is stale' })
    expect(prismaMock.agentIdentity.update).not.toHaveBeenCalled()
  })

  it('reconciles every active Room alias and broadcasts only committed changes', async () => {
    prismaMock.agentIdentity.findFirst
      .mockResolvedValueOnce(agent)
      .mockResolvedValueOnce({ ...agent, displayName: '神念客服' })
    prismaMock.agentIdentity.update.mockResolvedValue({})
    prismaMock.roomMembership.findMany
      .mockResolvedValueOnce([
        { id: 'membership-1', roomId: 'room-1', displayAlias: '神念扫地僧' },
        { id: 'membership-2', roomId: 'room-2', displayAlias: '神念客服 2' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ displayAlias: '神念客服' }])
    prismaMock.roomMembership.update.mockResolvedValue({})

    await updateAgentWorkspace('user-1', 'agent-1', { displayName: '神念客服' })

    expect(prismaMock.roomMembership.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        agentIdentityId: 'agent-1',
        ownerUserId: 'user-1',
        principalType: 'agent',
        status: 'active',
      },
      select: { id: true, roomId: true, displayAlias: true },
    })
    expect(prismaMock.roomMembership.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'membership-1' },
      data: { displayAlias: '神念客服' },
    })
    expect(prismaMock.roomMembership.update).toHaveBeenCalledTimes(1)
    expect(broadcastRoomMock).toHaveBeenNthCalledWith(1, 'room-1', {
      event: 'room.membership.updated',
      roomId: 'room-1',
      entityId: 'membership-1',
    })
    expect(broadcastRoomMock).not.toHaveBeenCalledWith(
      'room-2',
      expect.objectContaining({ event: 'room.membership.updated' }),
    )
  })

  it('does not misreport a legacy policy-less Agent as restricted', async () => {
    prismaMock.agentIdentity.findMany.mockResolvedValue([
      {
        ...agent,
        permissionPolicy: undefined,
        permissionPolicyVersion: undefined,
      },
    ])

    const [result] = await listAgentWorkspaces('user-1')
    expect(result.permissionPolicy).toEqual({
      version: 1,
      executionMode: 'restricted',
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    })
  })

  it('rejects an unavailable machine and retired runtime during an update', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.machine.findFirst.mockResolvedValue(null)
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { machineId: 'machine-other' }),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { runtimeAdapter: 'pi' }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(prismaMock.agentIdentity.update).not.toHaveBeenCalled()
  })

  it('limits machine-authenticated listing and updates to that machine', async () => {
    prismaMock.agentIdentity.findMany.mockResolvedValue([])
    await listAgentWorkspaces('user-1', 'machine-1')
    expect(prismaMock.agentIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerUserId: 'user-1', machineId: 'machine-1' }),
      }),
    )

    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { machineId: 'machine-2' }, 'machine-1'),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { displayName: '越权修改' }, 'machine-2'),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(prismaMock.agentIdentity.update).not.toHaveBeenCalled()
  })

  it('lists owner chats and Room-bound conversations but excludes internal visitor sessions', async () => {
    const baseSession = {
      id: 'session-empty',
      title: '',
      status: 'active',
      agentType: 'codex',
      agentSessionId: null,
      modelId: null,
      machineId: 'machine-1',
      workDir: '/code/shennian',
      lastActivityAt: now,
      transcriptMessageCount: 0,
      machine: { name: 'Mac' },
      roomBinding: null,
    }
    prismaMock.agentIdentity.findMany.mockResolvedValue([
      {
        ...agent,
        sessions: [
          baseSession,
          { ...baseSession, id: 'session-native', agentSessionId: 'native-session-1' },
          { ...baseSession, id: 'session-visitor', nativeSessionVisibility: 'internal' },
          {
            ...baseSession,
            id: 'session-room',
            roomBinding: {
              id: 'binding-1',
              status: 'active',
              activationMode: 'mention_only',
              machine: { paired: true, online: true },
              agentMembership: { status: 'active' },
              room: { id: 'room-1', name: '产品群', status: 'active' },
            },
          },
        ],
      },
    ])

    const [result] = await listAgentWorkspaces('user-1')
    expect(result.sessions.map((session) => session.id)).toEqual(['session-empty', 'session-native', 'session-room'])
    expect(result.sessions[2]?.room?.activationMode).toBe('mention_only')
    expect(prismaMock.agentIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          sessions: expect.objectContaining({
            where: {
              deletedAt: null,
              OR: [
                { roomBinding: { isNot: null } },
                { nativeSessionVisibility: 'user' },
                { roomBinding: { is: null }, sessionScope: 'personal', creationKey: { not: null }, NOT: { id: { startsWith: 'sess_worker_' } } },
              ],
            },
          }),
        }),
      }),
    )
  })

  it('keeps recoverable detached Room relationships and exposes one owner repair action', async () => {
    prismaMock.agentIdentity.findMany.mockResolvedValue([
      {
        ...agent,
        machine: { id: 'machine-2', name: 'New Mac', paired: true, online: true },
        sessions: [
          {
            id: 'session-room',
            title: '',
            status: 'active',
            agentType: 'codex',
            modelId: null,
            machineId: 'machine-1',
            workDir: '/code/shennian',
            lastActivityAt: now,
            machine: { name: 'Old Mac', paired: false, online: false },
            roomBinding: {
              id: 'binding-1',
              status: 'detached',
              detachedReason: 'recovery_failed',
              activationMode: 'auto_follow',
              machine: { paired: false, online: false },
              agentMembership: { status: 'active' },
              room: { id: 'room-1', name: '产品群', status: 'active' },
            },
          },
        ],
      },
    ])

    const [result] = await listAgentWorkspaces('user-1')

    expect(result).toMatchObject({
      availability: 'unavailable',
      repairAction: 'retry',
      sessions: [
        {
          id: 'session-room',
          room: { status: 'detached', availability: 'unavailable', repairAction: 'retry' },
        },
      ],
    })
  })

  it('does not present a security quarantine as an in-progress recovery', async () => {
    prismaMock.agentIdentity.findMany.mockResolvedValue([
      {
        ...agent,
        machine: { id: 'machine-2', name: 'New Mac', paired: true, online: true },
        sessions: [
          {
            id: 'session-room',
            title: '',
            status: 'active',
            agentType: 'codex',
            modelId: null,
            machineId: 'machine-2',
            workDir: '/code/shennian',
            lastActivityAt: now,
            machine: { name: 'New Mac', paired: true, online: true },
            roomBinding: {
              id: 'binding-1',
              status: 'detached',
              detachedReason: 'security_pending',
              activationMode: 'paused',
              machine: { paired: true, online: true },
              agentMembership: { status: 'active' },
              room: { id: 'room-1', name: '产品群', status: 'active' },
            },
          },
        ],
      },
    ])

    const [result] = await listAgentWorkspaces('user-1')

    expect(result).toMatchObject({
      availability: 'unavailable',
      repairAction: 'configure',
      sessions: [{ room: { availability: 'unavailable', repairAction: 'configure' } }],
    })
  })

  it('offers configuration when an active Binding loses its runtime machine', async () => {
    prismaMock.agentIdentity.findMany.mockResolvedValue([
      {
        ...agent,
        machine: { id: 'machine-1', name: 'Offline Mac', paired: true, online: false },
        sessions: [
          {
            id: 'session-room',
            title: '',
            status: 'active',
            agentType: 'codex',
            modelId: null,
            machineId: 'machine-1',
            workDir: '/code/shennian',
            lastActivityAt: now,
            machine: { name: 'Offline Mac', paired: true, online: false },
            roomBinding: {
              id: 'binding-1',
              status: 'active',
              detachedReason: null,
              activationMode: 'mention_only',
              machine: { paired: true, online: false },
              agentMembership: { status: 'active' },
              room: { id: 'room-1', name: '产品群', status: 'active' },
            },
          },
        ],
      },
    ])

    const [result] = await listAgentWorkspaces('user-1')

    expect(result).toMatchObject({
      availability: 'unavailable',
      repairAction: 'configure',
      sessions: [{ room: { availability: 'unavailable', repairAction: 'configure' } }],
    })
  })
})
