// @covers open-source/packages/server/src/services/agent-workspaces.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType } from '@shennian/wire'

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
  createAgentWorkspace,
  listAgentWorkspaces,
  createAgentWorkspaceSession,
  deleteAgentWorkspace,
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
function managedMachine(id: string, agentType: AgentType = 'codex') {
  return {
    id,
    userId: 'user-1',
    agentList: [agentType],
    agents: [
      {
        type: agentType,
        supportsAgent: true,
        supportedAgentExecutionModes: ['native-full', 'restricted'],
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
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentDirectMessage.updateMany.mockResolvedValue({ count: 0 })
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

  it('creates a stable Agent profile from a Project runtime', async () => {
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        systemPrompt: '先读项目文档',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
      }),
    ).resolves.toMatchObject({ id: 'agent-1', machineName: 'Mac', runtimeAdapter: 'codex' })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permissionPolicyVersion: 1,
        permissionPolicy: {
          version: 1,
          executionMode: 'restricted',
          fileAccess: 'workspace-read',
          externalCapabilities: {
            commandNetwork: false,
            webSearch: false,
            browser: false,
            computerUse: false,
            mcp: false,
          },
        },
      }),
    })
  })

  it('includes owner conversations without a Room binding in the workspace', async () => {
    const session = {
      id: 'owner-session', title: 'Owner chat', status: 'idle', agentType: 'codex',
      modelId: null, machineId: 'machine-1', machine: { name: 'Mac' },
      workDir: '/code/shennian', lastActivityAt: new Date(0), roomBinding: null,
    }
    const record = { ...agent, sessions: [session] }
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.agentIdentity.create.mockResolvedValue(record)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(record)
    const result = await createAgentWorkspace('user-1', {
      displayName: 'AI', description: 'Owner AI', machineId: 'machine-1',
      runtimeAdapter: 'codex', workDir: '/code/shennian',
    })
    expect(result.sessions).toEqual([expect.objectContaining({ id: 'owner-session', room: null })])
    expect(prismaMock.agentIdentity.findFirst.mock.calls.at(-1)?.[0].include.sessions.where)
      .toEqual({ deletedAt: null, OR: [{ roomBinding: { isNot: null } }, { nativeSessionVisibility: 'user' },
        { roomBinding: { is: null }, sessionScope: 'personal', creationKey: { not: null }, NOT: { id: { startsWith: 'sess_worker_' } } }] })
  })

  it('keeps owner-created direct Agent chats accessible in explicit Agent views without exposing Workers or steward sessions', async () => {
    const base = { id: 'standalone-owner', title: 'Owner chat', status: 'active', agentType: 'codex',
      modelId: null, machineId: 'machine-1', machine: { name: 'Mac' }, workDir: '/code/shennian',
      lastActivityAt: new Date(0), roomBinding: null, nativeSessionVisibility: 'internal',
      sessionScope: 'personal', creationKey: 'owner-creation-key' }
    prismaMock.agentIdentity.findMany.mockResolvedValue([{ ...agent, sessions: [base,
      { ...base, id: 'sess_worker_child' }, { ...base, id: 'steward', sessionScope: 'steward' },
      { ...base, id: 'unkeyed', creationKey: null }] }])
    const [machineAgent] = await listAgentWorkspaces('user-1', 'machine-1')
    expect(machineAgent.sessions.map(session => session.id)).toEqual(['standalone-owner'])
    expect(prismaMock.agentIdentity.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({
      ownerUserId: 'user-1', machineId: 'machine-1', ownerType: 'user', status: { not: 'deleted' },
    })
    const [userAgent] = await listAgentWorkspaces('user-1')
    expect(userAgent.sessions.map(session => session.id)).toEqual(['standalone-owner'])
  })

  it('accepts a discovered custom runtime at the 64-character storage limit', async () => {
    const runtimeAdapter = `custom:${'a'.repeat(57)}` as AgentType
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1', runtimeAdapter))
    prismaMock.agentIdentity.create.mockResolvedValue({ ...agent, runtimeAdapter })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ ...agent, runtimeAdapter })

    await expect(createAgentWorkspace('user-1', {
      displayName: 'Custom Agent', description: 'Test runtime',
      machineId: 'machine-1', runtimeAdapter,
      workDir: '/code/shennian',
    })).resolves.toMatchObject({ runtimeAdapter })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ runtimeAdapter }),
    })

    await expect(createAgentWorkspace('user-1', {
      displayName: 'Custom Agent', description: 'Test runtime', machineId: 'machine-1',
      runtimeAdapter: `${runtimeAdapter}b`, workDir: '/code/shennian',
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('accepts an explicit create policy but keeps the initial server-owned version', async () => {
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)

    await createAgentWorkspace('user-1', {
      displayName: '开发工程师',
      description: '负责开发',
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      workDir: '/code/shennian',
      permissionPolicy: {
        version: 55,
        fileAccess: 'workspace-read',
        externalCapabilities: {
          commandNetwork: false,
          webSearch: true,
          browser: false,
          computerUse: false,
          mcp: false,
        },
      },
    })

    expect(prismaMock.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permissionPolicyVersion: 1,
        permissionPolicy: expect.objectContaining({ version: 1, fileAccess: 'workspace-read' }),
      }),
    })
  })

  it('requires one exact confirmation before creating a native-full Agent', async () => {
    const permissionPolicy = {
      version: 9,
      executionMode: 'native-full' as const,
      fileAccess: 'host-full' as const,
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    }
    const input = {
      displayName: '开发工程师',
      description: '负责开发',
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      workDir: '/code/shennian',
      permissionPolicy,
    }
    await expect(createAgentWorkspace('user-1', input)).rejects.toMatchObject({
      code: 'invalid',
      message: 'host file access confirmation is required',
    })

    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await createAgentWorkspace('user-1', {
      ...input,
      permissionConfirmation: {
        runtimeAdapter: 'codex',
        runtimeVersion: managedAgentProtection.runtimeVersion,
        platform: managedAgentProtection.platform,
        executableFingerprint: managedAgentProtection.executableFingerprint,
        executionMode: 'native-full',
        hostFullAccess: true,
        limitedProtection: false,
      },
    })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        permissionPolicy: expect.objectContaining({ executionMode: 'native-full' }),
        permissionConfirmation: expect.objectContaining({
          executionMode: 'native-full',
          policyVersion: 1,
        }),
      }),
    })
  })

  it('rejects native-full when the daemon has not declared support', async () => {
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1'),
      agents: [{ type: 'codex', supportsManagedAgent: true, managedAgentProtection }],
    })
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
        permissionPolicy: {
          version: 1,
          executionMode: 'native-full',
          fileAccess: 'host-full',
          externalCapabilities: {
            commandNetwork: true,
            webSearch: true,
            browser: true,
            computerUse: true,
            mcp: true,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'Native full access requires a newer Shennian CLI on this machine',
    })
  })

  it('keeps OpenCode eligible as an Agent while rejecting its unsupported restricted mode', async () => {
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1', 'opencode'),
      agents: [{ type: 'opencode', supportsAgent: true,
        supportedAgentExecutionModes: ['native-full'], supportsManagedAgent: false,
        supportsManagedNativeFull: true, supportsRoomTools: true, supportsWorker: true,
        supportsManagerMode: true, managedAgentProtection }],
    })
    await expect(createAgentWorkspace('user-1', {
      displayName: 'OpenCode 智能体', description: '负责开发', machineId: 'machine-1',
      runtimeAdapter: 'opencode', workDir: '/code/shennian',
      permissionPolicy: { version: 1, executionMode: 'restricted', fileAccess: 'workspace-write',
        externalCapabilities: { commandNetwork: false, webSearch: false, browser: false,
          computerUse: false, mcp: false } },
    })).rejects.toMatchObject({
      code: 'invalid', message: 'Restricted access is unavailable for this Agent',
    })
  })

  it('requires native-full confirmation again after moving the Agent to another machine', async () => {
    const nativeAgent = {
      ...agent,
      permissionPolicy: {
        version: 1,
        executionMode: 'native-full',
        fileAccess: 'host-full',
        externalCapabilities: {
          commandNetwork: true,
          webSearch: true,
          browser: true,
          computerUse: true,
          mcp: true,
        },
      },
      permissionConfirmation: {
        policyVersion: 1,
        runtimeAdapter: 'codex',
        runtimeVersion: managedAgentProtection.runtimeVersion,
        platform: managedAgentProtection.platform,
        executableFingerprint: managedAgentProtection.executableFingerprint,
        executionMode: 'native-full',
        hostFullAccess: true,
        limitedProtection: false,
        confirmedAt: now.toISOString(),
      },
    }
    prismaMock.agentIdentity.findFirst.mockResolvedValue(nativeAgent)
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-2'))

    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { machineId: 'machine-2' }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'host file access confirmation is required',
    })
  })

  it('stores requested capabilities even when native enforcement reports a gap', async () => {
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1'),
      agents: [
        {
          type: 'codex',
          supportsManagedAgent: true,
          managedAgentProtection: {
            ...managedAgentProtection,
            capabilityMatrix: {
              fileAccess: {
                'workspace-read': true,
                'workspace-write': true,
                'host-full': true,
              },
              externalCapabilities: {
                commandNetwork: { allow: true, deny: true },
                webSearch: { allow: true, deny: true },
                browser: { allow: false, deny: true },
                computerUse: { allow: false, deny: true },
                mcp: { allow: true, deny: true },
              },
            },
          },
        },
      ],
    })

    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
        permissionPolicy: {
          ...agent.permissionPolicy,
          externalCapabilities: {
            ...agent.permissionPolicy.externalCapabilities,
            browser: true,
          },
        },
      }),
    ).resolves.toMatchObject({ id: 'agent-1' })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalled()
  })

  it('allows a detected Agent when directional capability evidence is missing', async () => {
    const { capabilityMatrix: _missing, ...incompleteProtection } = managedAgentProtection
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1'),
      agents: [
        {
          type: 'codex',
          supportsManagedAgent: true,
          managedAgentProtection: incompleteProtection,
        },
      ],
    })

    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
      }),
    ).resolves.toMatchObject({ id: 'agent-1' })
  })

  it('still requires explicit confirmation for host-wide file access', async () => {
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1'),
      agents: [
        {
          type: 'codex',
          supportsManagedAgent: true,
          managedAgentProtection: {
            ...managedAgentProtection,
            capabilityMatrix: {
              fileAccess: {
                'workspace-read': true,
                'workspace-write': true,
                'host-full': false,
              },
              externalCapabilities: {
                commandNetwork: { allow: true, deny: true },
                webSearch: { allow: true, deny: true },
                browser: { allow: true, deny: true },
                computerUse: { allow: true, deny: true },
                mcp: { allow: true, deny: true },
              },
            },
          },
        },
      ],
    })

    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
        permissionPolicy: {
          ...agent.permissionPolicy,
          fileAccess: 'host-full',
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      message: 'host file access confirmation is required',
    })
  })

  it('rejects malformed permission policy input during creation', async () => {
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
        permissionPolicy: {
          version: 1,
          fileAccess: 'workspace-write',
          externalCapabilities: { commandNetwork: false },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(prismaMock.agentIdentity.create).not.toHaveBeenCalled()
  })

  it('persists Manager mode and worker configuration for managed Agents', async () => {
    prismaMock.machine.findFirst.mockResolvedValue(managedMachine('machine-1'))
    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
        sessionMode: 'manager',
        managerConfig: { defaultWorkerAgentType: 'codex', defaultWorkerModelId: 'gpt-6-astra' },
      }),
    ).resolves.toMatchObject({ id: 'agent-1' })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionMode: 'manager',
        managerConfig: {
          defaultWorkerAgentType: 'codex',
          defaultWorkerModelId: 'gpt-6-astra',
        },
      }),
    })

    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.agentIdentity.update.mockResolvedValue({ ...agent, sessionMode: 'manager' })
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { sessionMode: 'manager' }),
    ).resolves.toBeTruthy()
  })

  it('allows a detected Agent from an old daemon and records an unverified gap', async () => {
    prismaMock.machine.findFirst.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      agentList: ['codex'],
      agents: [{ type: 'codex', supportsManagedAgent: true }],
    })

    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    await expect(
      createAgentWorkspace('user-1', {
        displayName: '开发工程师',
        description: '负责开发',
        machineId: 'machine-1',
        runtimeAdapter: 'codex',
        workDir: '/code/shennian',
      }),
    ).resolves.toMatchObject({ id: 'agent-1' })

    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.agentIdentity.update.mockResolvedValue(agent)
    await expect(
      updateAgentWorkspace('user-1', 'agent-1', { workDir: '/code/other' }),
    ).resolves.toBeTruthy()
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: { agentIdentityId: 'agent-1', ownerUserId: 'user-1',
        status: { in: ['active', 'paused'] } },
      data: { status: 'paused', policyVersion: { increment: 1 } },
    })
    expect(prismaMock.agentDirectMessage.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending', 'running'] },
        conversation: { agentIdentityId: 'agent-1', ownerUserId: 'user-1' } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    })
  })

  it('allows limited protection and keeps the policy as an authorization ceiling', async () => {
    const partialProtection = {
      ...managedAgentProtection,
      level: 'partial',
      executableFingerprint: `sha256:${'c'.repeat(64)}`,
      unsupportedCapabilities: ['fileAccess.workspaceWrite'],
    }
    prismaMock.machine.findFirst.mockResolvedValue({
      ...managedMachine('machine-1'),
      agents: [
        {
          type: 'codex',
          supportsManagedAgent: true,
          managedAgentProtection: partialProtection,
        },
      ],
    })
    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)

    const input = {
      displayName: '开发工程师',
      description: '负责开发',
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      workDir: '/code/shennian',
    }
    await expect(createAgentWorkspace('user-1', input)).resolves.toMatchObject({ id: 'agent-1' })

    await expect(
      createAgentWorkspace('user-1', {
        ...input,
        permissionConfirmation: {
          runtimeAdapter: 'codex',
          runtimeVersion: partialProtection.runtimeVersion,
          platform: partialProtection.platform,
          executableFingerprint: partialProtection.executableFingerprint,
          hostFullAccess: false,
          limitedProtection: true,
        },
      }),
    ).resolves.toMatchObject({ id: 'agent-1' })
    expect(prismaMock.agentIdentity.create).toHaveBeenCalled()
  })

  it('requires a separate exact confirmation before enabling host file access', async () => {
    prismaMock.agentIdentity.create.mockResolvedValue(agent)
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    const permissionPolicy = {
      ...agent.permissionPolicy,
      fileAccess: 'host-full',
    }
    const input = {
      displayName: '开发工程师',
      description: '负责开发',
      machineId: 'machine-1',
      runtimeAdapter: 'codex',
      workDir: '/code/shennian',
      permissionPolicy,
    }
    await expect(createAgentWorkspace('user-1', input)).rejects.toMatchObject({
      message: 'host file access confirmation is required',
    })
    await expect(
      createAgentWorkspace('user-1', {
        ...input,
        permissionConfirmation: {
          runtimeAdapter: 'codex',
          runtimeVersion: managedAgentProtection.runtimeVersion,
          platform: managedAgentProtection.platform,
          executableFingerprint: `sha256:${'f'.repeat(64)}`,
          hostFullAccess: true,
          limitedProtection: false,
        },
      }),
    ).rejects.toMatchObject({ message: 'host file access confirmation is required' })

    await createAgentWorkspace('user-1', {
      ...input,
      permissionConfirmation: {
        runtimeAdapter: 'codex',
        runtimeVersion: managedAgentProtection.runtimeVersion,
        platform: managedAgentProtection.platform,
        executableFingerprint: managedAgentProtection.executableFingerprint,
        hostFullAccess: true,
        limitedProtection: false,
      },
    })
    expect(prismaMock.agentIdentity.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        permissionConfirmation: expect.objectContaining({
          hostFullAccess: true,
          limitedProtection: false,
          policyVersion: 1,
        }),
      }),
    })
  })

  it('creates every Room assignment as a new Session owned by the Agent', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    createSessionMock.mockResolvedValue({
      id: 'session-2',
      agentIdentityId: 'agent-1',
      machineId: 'machine-1',
      machineName: 'Mac',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: null,
      managerDefaultWorkerAgentType: null,
      managerDefaultWorkerModelId: null,
      title: '',
      status: 'active',
      workDir: '/code/shennian',
      lastMessagePreview: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      transcriptBytes: 0n,
      transcriptLastTs: null,
    })
    const result = await createAgentWorkspaceSession('user-1', 'agent-1', {
      assignmentIntentId: 'room-1-attempt-1',
    })
    expect(result).toMatchObject({
      id: 'session-2',
      agentIdentityId: 'agent-1',
      modelSource: 'agent',
      agentSystemPrompt: '先读项目文档',
    })
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        creationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        machineId: 'machine-1',
        agentType: 'codex',
        workDir: '/code/shennian',
        agentIdentityId: 'agent-1',
      }),
    )
  })

  it('copies Manager mode and worker defaults into a new Room Session snapshot', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({
      ...agent,
      sessionMode: 'manager',
      managerConfig: {
        defaultWorkerAgentType: 'cursor',
        defaultWorkerModelId: 'cursor-auto',
      },
    })
    await createAgentWorkspaceSession('user-1', 'agent-1', { assignmentIntentId: 'manager-room' })
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionMode: 'manager',
        managerConfig: { defaultWorkerAgentType: 'cursor', defaultWorkerModelId: 'cursor-auto' },
        managerDefaultWorkerAgentType: 'cursor',
        managerDefaultWorkerModelId: 'cursor-auto',
      }),
    )
  })

  it('deletes every dedicated conversation and removes only the Agent from its Rooms', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.roomMembership.findMany.mockResolvedValue([
      {
        id: 'member-agent-1',
        roomId: 'room-1',
        parentHumanMembershipId: 'member-human-1',
        parentHumanMembership: { status: 'active' },
        room: { status: 'active', nextSequence: 10n },
      },
      {
        id: 'member-agent-2',
        roomId: 'room-2',
        parentHumanMembershipId: 'member-human-2',
        parentHumanMembership: { status: 'active' },
        room: { status: 'active', nextSequence: 20n },
      },
    ])
    prismaMock.roomBinding.updateMany.mockResolvedValue({ count: 2 })
    prismaMock.agentIdentity.update.mockResolvedValue({})
    prismaMock.nianSession.findMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }])
    removeMembershipMock
      .mockResolvedValueOnce({ removedMembershipIds: ['member-agent-1'], detachedBindingCount: 1 })
      .mockResolvedValueOnce({ removedMembershipIds: ['member-agent-2'], detachedBindingCount: 1 })

    await expect(deleteAgentWorkspace('user-1', 'agent-1')).resolves.toMatchObject({
      removedMembershipIds: ['member-agent-1', 'member-agent-2'],
      deletedSessionIds: ['session-1', 'session-2'],
    })
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: { agentIdentityId: 'agent-1', ownerUserId: 'user-1',
        status: { in: ['active', 'paused'] } },
      data: { status: 'paused', policyVersion: { increment: 1 } },
    })
    expect(prismaMock.agentPublication.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      deleteSessionMock.mock.invocationCallOrder[0]!,
    )
    expect(removeMembershipMock).toHaveBeenNthCalledWith(1, {
      roomId: 'room-1',
      actorMembershipId: 'member-human-1',
      targetMembershipId: 'member-agent-1',
    })
    expect(deleteSessionMock).toHaveBeenCalledTimes(2)
    expect(deleteSessionMock).toHaveBeenNthCalledWith(1, 'session-1', 'user-1', {
      nativeCleanupPolicy: 'auto',
    })
    expect(deleteSessionMock).toHaveBeenNthCalledWith(2, 'session-2', 'user-1', {
      nativeCleanupPolicy: 'auto',
    })
    expect(prismaMock.agentIdentity.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { status: 'deleted', pinnedAt: null },
    })
    expect(deleteSessionMock.mock.invocationCallOrder[1]).toBeLessThan(
      prismaMock.agentIdentity.update.mock.invocationCallOrder[0],
    )
  })

  it('deletes an Agent whose active membership was orphaned by archived Room record deletion', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.roomMembership.findMany.mockResolvedValue([
      {
        id: 'member-agent-orphan',
        roomId: 'room-archived',
        parentHumanMembershipId: 'member-human-deleted',
        parentHumanMembership: { status: 'deleted' },
        room: { status: 'archived', nextSequence: 42n },
      },
    ])
    prismaMock.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.roomMembership.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.update.mockResolvedValue({})

    await expect(deleteAgentWorkspace('user-1', 'agent-1')).resolves.toMatchObject({
      removedMembershipIds: ['member-agent-orphan'],
      deletedSessionIds: [],
    })

    expect(removeMembershipMock).not.toHaveBeenCalled()
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { agentMembershipId: 'member-agent-orphan' },
      data: { status: 'detached', activationMode: 'paused' },
    })
    expect(prismaMock.roomMembership.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-agent-orphan',
        agentIdentityId: 'agent-1',
        ownerUserId: 'user-1',
        principalType: 'agent',
        status: 'active',
      },
      data: {
        status: 'removed',
        removedAt: expect.any(Date),
        historyThroughSequence: 42n,
      },
    })
    expect(broadcastRoomMock).toHaveBeenCalledWith('room-archived', {
      event: 'room.membership.updated',
      roomId: 'room-archived',
      entityId: 'member-agent-orphan',
    })
  })

  it('keeps the Agent visible and retryable when conversation cleanup fails', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    prismaMock.nianSession.findMany.mockResolvedValue([{ id: 'session-1' }])
    deleteSessionMock.mockRejectedValueOnce(new Error('cleanup failed'))

    await expect(deleteAgentWorkspace('user-1', 'agent-1')).rejects.toThrow('cleanup failed')

    expect(prismaMock.agentIdentity.update).not.toHaveBeenCalled()
    expect(prismaMock.roomBinding.updateMany).not.toHaveBeenCalled()
  })

  it('uses the same persistent creation key for retries of one Room assignment', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    createSessionMock.mockResolvedValue({
      id: 'session-2',
      agentIdentityId: 'agent-1',
      machineId: 'machine-1',
      machineName: 'Mac',
      userId: 'user-1',
      agentType: 'codex',
      agentSessionId: null,
      modelId: null,
      managerDefaultWorkerAgentType: null,
      managerDefaultWorkerModelId: null,
      title: '',
      status: 'active',
      workDir: '/code/shennian',
      lastMessagePreview: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    await createAgentWorkspaceSession('user-1', 'agent-1', {
      assignmentIntentId: 'room-1-attempt-1',
    })
    await createAgentWorkspaceSession('user-1', 'agent-1', {
      assignmentIntentId: 'room-1-attempt-1',
    })
    expect(createSessionMock.mock.calls[0]?.[0].creationKey).toBe(
      createSessionMock.mock.calls[1]?.[0].creationKey,
    )
  })
})
