// @covers open-source/packages/server/src/services/agent-room-recovery.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, sendMock, createSessionMock, deleteSessionMock, broadcastMock } = vi.hoisted(
  () => ({
    prismaMock: {
      roomBinding: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    },
    sendMock: vi.fn(),
    createSessionMock: vi.fn(),
    deleteSessionMock: vi.fn(),
    broadcastMock: vi.fn(),
  }),
)

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: sendMock }))
vi.mock('../services/sessions.js', () => ({
  createSessionForUser: createSessionMock,
  deleteSessionForUser: deleteSessionMock,
}))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: broadcastMock }))

import {
  reconcileAgentRoomBindings,
  requestAgentRoomRecovery,
  runPendingAgentRoomRecoveries,
} from '../services/agent-room-recovery.js'

const now = new Date('2026-09-03T00:00:00.000Z')
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
const agent = {
  id: 'agent-1',
  ownerType: 'user',
  ownerUserId: 'user-1',
  displayName: '小念',
  description: '产品助手',
  systemPrompt: '帮助群聊推进任务',
  status: 'active',
  machineId: 'machine-2',
  runtimeAdapter: 'codex',
  workDir: '/work/project',
  modelId: 'gpt-5.6-terra',
  sessionMode: 'standard',
  managerConfig: null,
  avatarVersion: null,
  avatarMimeType: null,
  avatarUpdatedAt: null,
  pinnedAt: null,
  createdAt: now,
  updatedAt: now,
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
  machine: {
    id: 'machine-2',
    userId: 'user-1',
    paired: true,
    online: true,
    daemonInstallationId: 'installation-2',
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
  },
}

function binding(id: string, roomId: string, intent: string) {
  return {
    id,
    bindingIntentId: null,
    roomId,
    userId: 'user-1',
    agentIdentityId: 'agent-1',
    agentMembershipId: `member-${id}`,
    nianSessionId: `old-${id}`,
    machineId: 'machine-1',
    runtimeAdapter: 'codex',
    sourceSessionKey: 'a'.repeat(64),
    bindingMode: 'hook_native',
    activationCapability: 'managed',
    activationMode: id === 'binding-2' ? 'paused' : 'auto_follow',
    lastDeliveredSequence: 0n,
    lastActivatedSequence: 0n,
    status: 'detached',
    detachedReason: 'runtime_reconfigured',
    recoveryIntentId: intent,
    appliedConfigurationVersion: 1,
    pendingConfigurationVersion: 2,
    capabilityEpoch: 0,
    createdAt: now,
    updatedAt: now,
    agentIdentity: agent,
  }
}

function session(id: string) {
  return {
    id,
    creationKey: null,
    machineId: 'machine-2',
    machineName: 'New Mac',
    userId: 'user-1',
    daemonInstallationId: 'installation-2',
    dataEpoch: 2,
    agentType: 'codex',
    sessionMode: 'standard',
    managerConfig: null,
    agentSessionId: null,
    modelId: 'gpt-5.6-terra',
    modelSource: 'agent',
    managerDefaultWorkerAgentType: null,
    managerDefaultWorkerModelId: null,
    agentIdentityId: 'agent-1',
    title: '',
    status: 'active',
    workDir: '/work/project',
    bodyStorageMode: 'machine_local',
    lastMessagePreview: null,
    lastMessagePreviewMessageId: null,
    lastMessagePreviewAt: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

describe('Agent Room recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.roomBinding.findUnique.mockResolvedValue(null)
    createSessionMock
      .mockReset()
      .mockResolvedValueOnce(session('new-session-1'))
      .mockResolvedValueOnce(session('new-session-2'))
    sendMock.mockReset().mockResolvedValue({ type: 'res', id: 'res-1', ok: true })
    deleteSessionMock.mockReset().mockResolvedValue({ alreadyDeleted: false })
    broadcastMock.mockReset().mockResolvedValue(undefined)
  })

  it('creates and swaps one independent Session per still-active Room', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-1'),
      binding('binding-2', 'room-2', 'intent-2'),
    ])

    const report = await reconcileAgentRoomBindings({ agentId: 'agent-1', userId: 'user-1' })

    expect(report).toEqual({ attempted: 2, recovered: 2, failed: 0, waiting: 0 })
    expect(createSessionMock).toHaveBeenCalledTimes(2)
    expect(createSessionMock.mock.calls[0]?.[0].creationKey).not.toBe(
      createSessionMock.mock.calls[1]?.[0].creationKey,
    )
    const restartCalls = sendMock.mock.calls.filter(
      (call) => call[1].method === 'room.agent.restart-managed',
    )
    const abortCalls = sendMock.mock.calls.filter((call) => call[1].method === 'chat.abort')
    expect(abortCalls).toHaveLength(2)
    expect(abortCalls[0]?.[1].params).toEqual({
      sessionId: 'old-binding-1',
      discardPending: true,
    })
    expect(restartCalls).toHaveLength(2)
    expect(restartCalls[0]?.[1].params).toMatchObject({
      roomId: 'room-1',
      bindingId: 'binding-1',
      previousNianSessionId: 'old-binding-1',
      nianSessionId: 'new-session-1',
      agentType: 'codex',
    })
    expect(restartCalls[1]?.[1].params).toMatchObject({
      roomId: 'room-2',
      bindingId: 'binding-2',
      previousNianSessionId: 'old-binding-2',
      nianSessionId: 'new-session-2',
      agentType: 'codex',
    })
    expect(sendMock.mock.calls.some((call) => call[1].method === 'chat.send')).toBe(false)
    expect(prismaMock.roomBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['active', 'paused', 'detached'] },
          recoveryIntentId: { not: null },
          activationCapability: 'managed',
          room: { status: 'active' },
          agentMembership: { status: 'active' },
        }),
      }),
    )
  })

  it('replaces an active Binding without detaching its visible Room membership first', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      { ...binding('binding-1', 'room-1', 'intent-active'), status: 'active' },
    ])

    await expect(
      reconcileAgentRoomBindings({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual({ attempted: 1, recovered: 1, failed: 0, waiting: 0 })
    expect(sendMock).toHaveBeenCalledWith(
      'machine-2',
      expect.objectContaining({ method: 'room.agent.restart-managed' }),
      120_000,
    )
  })

  it('quarantines an active pending rollout when the replacement security check fails', async () => {
    const active = {
      ...binding('binding-1', 'room-1', 'intent-security'),
      status: 'active',
      agentIdentity: {
        ...agent,
        permissionPolicy: {
          ...agent.permissionPolicy,
          fileAccess: 'host-full',
        },
      },
    }
    prismaMock.roomBinding.findMany.mockResolvedValue([active])

    await expect(
      reconcileAgentRoomBindings({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual({ attempted: 1, recovered: 0, failed: 0, waiting: 0 })

    expect(createSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-1',
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId: 'intent-security',
      },
      data: expect.objectContaining({
        status: 'detached',
        activationMode: 'paused',
        detachedReason: 'security_pending',
        recoveryIntentId: null,
        recoveryErrorCode: 'permission_confirmation_required',
      }),
    })
  })

  it('keeps a stable operation key across a server retry of the same recovery intent', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-stable'),
    ])
    createSessionMock.mockReset().mockResolvedValue(session('new-session-1'))

    await reconcileAgentRoomBindings({ agentId: 'agent-1', userId: 'user-1' })
    await reconcileAgentRoomBindings({ agentId: 'agent-1', userId: 'user-1' })

    expect(createSessionMock.mock.calls[0]?.[0].creationKey).toBe(
      createSessionMock.mock.calls[1]?.[0].creationKey,
    )
    const restartCalls = sendMock.mock.calls.filter(
      (call) => call[1].method === 'room.agent.restart-managed',
    )
    expect(restartCalls).toHaveLength(2)
    expect(restartCalls[0]?.[1].params).toMatchObject({
      assignmentIntentId: 'recover:binding-1:intent-stable',
      agentType: 'codex',
    })
    expect(restartCalls[1]?.[1].params).toMatchObject({
      assignmentIntentId: 'recover:binding-1:intent-stable',
      agentType: 'codex',
    })
    expect(sendMock.mock.calls.some((call) => call[1].method === 'chat.send')).toBe(false)
  })

  it('does not roll back successful Rooms when a later Room fails', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-1'),
      binding('binding-2', 'room-2', 'intent-2'),
    ])
    sendMock.mockImplementation(async (_machineId, request) =>
      request.method === 'room.agent.restart-managed' && request.params.roomId === 'room-2'
        ? { type: 'res', id: '2', ok: false, error: 'runtime unavailable' }
        : { type: 'res', id: '1', ok: true },
    )

    const report = await reconcileAgentRoomBindings({ agentId: 'agent-1' })

    expect(report).toEqual({ attempted: 2, recovered: 1, failed: 1, waiting: 0 })
    expect(deleteSessionMock).toHaveBeenCalledWith('new-session-2', 'user-1', {
      nativeCleanupPolicy: 'auto',
    })
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-2',
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId: 'intent-2',
      },
      data: {
        detachedReason: 'recovery_failed',
        recoveryLeaseUntil: null,
        recoveryErrorCode: 'recovery_failed',
      },
    })
  })

  it('waits without creating a Session while the selected machine is offline', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      {
        ...binding('binding-1', 'room-1', 'intent-1'),
        agentIdentity: { ...agent, machine: { ...agent.machine, online: false } },
      },
    ])

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 0,
      recovered: 0,
      failed: 0,
      waiting: 1,
    })
    expect(createSessionMock).not.toHaveBeenCalled()
  })

  it('recovers with an explicit unverified gap when protection metadata is unavailable', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      {
        ...binding('binding-1', 'room-1', 'intent-insecure'),
        agentIdentity: {
          ...agent,
          machine: { ...agent.machine, agents: [{ type: 'codex', supportsManagedAgent: true }] },
        },
      },
    ])

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
      waiting: 0,
    })
    expect(createSessionMock).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalled()
  })

  it('recreates a Manager Room Session with the same mode snapshot', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      {
        ...binding('binding-1', 'room-1', 'intent-manager'),
        agentIdentity: { ...agent, sessionMode: 'manager' },
      },
    ])

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
      waiting: 0,
    })
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ sessionMode: 'manager' }))
    expect(sendMock).toHaveBeenCalled()
  })

  it('lets only one concurrent worker claim a binding lease', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-concurrent'),
    ])
    prismaMock.roomBinding.updateMany.mockResolvedValue({ count: 1 })
    let releaseRestart!: () => void
    sendMock.mockImplementation(async (_machineId, request) => {
      if (request.method !== 'room.agent.restart-managed') {
        return { type: 'res', id: 'abort', ok: true }
      }
      return new Promise((resolve) => {
        releaseRestart = () => resolve({ type: 'res', id: '1', ok: true })
      })
    })

    const first = reconcileAgentRoomBindings({ agentId: 'agent-1' })
    await vi.waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
    const second = reconcileAgentRoomBindings({ agentId: 'agent-1' })
    releaseRestart()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { attempted: 1, recovered: 1, failed: 0, waiting: 0 },
      { attempted: 0, recovered: 0, failed: 0, waiting: 0 },
    ])
    expect(createSessionMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-1',
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId: 'intent-concurrent',
        OR: [{ recoveryLeaseUntil: null }, { recoveryLeaseUntil: { lt: expect.any(Date) } }],
      },
      data: {
        detachedReason: 'recovering',
        recoveryLeaseUntil: expect.any(Date),
        recoveryErrorCode: null,
      },
    })
  })

  it('accepts a durable swap after a lost daemon response and never deletes its Session', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-restart'),
    ])
    sendMock.mockImplementation(async (_machineId, request) => {
      if (request.method === 'room.agent.restart-managed') throw new Error('connection closed')
      return { type: 'res', id: 'abort', ok: true }
    })
    prismaMock.roomBinding.findUnique.mockResolvedValue({
      nianSessionId: 'new-session-1',
      status: 'active',
    })

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
      waiting: 0,
    })
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })

  it('preserves a replacement already detached by a newer configuration intent', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      binding('binding-1', 'room-1', 'intent-old'),
    ])
    sendMock.mockImplementation(async (_machineId, request) => {
      if (request.method === 'room.agent.restart-managed') throw new Error('connection closed')
      return { type: 'res', id: 'abort', ok: true }
    })
    prismaMock.roomBinding.findUnique.mockResolvedValue({
      nianSessionId: 'new-session-1',
      status: 'detached',
    })

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 1,
      recovered: 0,
      failed: 1,
      waiting: 0,
    })
    expect(deleteSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.roomBinding.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'binding-1',
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId: 'intent-old',
      },
      data: {
        detachedReason: 'recovery_requested',
        recoveryLeaseUntil: null,
        recoveryErrorCode: 'machine_disconnected',
      },
    })
  })

  it('reuses the failed Room intent when the owner requests a retry', async () => {
    prismaMock.roomBinding.findMany
      .mockResolvedValueOnce([{ id: 'binding-1', recoveryIntentId: 'intent-stable' }])
      .mockResolvedValueOnce([])

    await requestAgentRoomRecovery('agent-1', 'user-1')
    expect(prismaMock.roomBinding.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ NOT: { detachedReason: 'machine_removed' }, agentMembership: { status: 'active' } }),
    }))

    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: { id: 'binding-1', status: 'detached', NOT: { detachedReason: 'machine_removed' }, agentMembership: { status: 'active' } },
      data: {
        detachedReason: 'recovery_requested',
        recoveryIntentId: 'intent-stable',
        recoveryLeaseUntil: null,
        recoveryErrorCode: null,
      },
    })
  })

  it('automatically releases bindings quarantined only by an executable upgrade', async () => {
    const authorizedAgent = {
      ...agent,
      permissionPolicy: {
        ...agent.permissionPolicy,
        executionMode: 'native-full',
        fileAccess: 'host-full',
      },
      permissionConfirmation: {
        policyVersion: 1,
        runtimeAdapter: 'codex',
        runtimeVersion: '0.151.0',
        platform: 'darwin',
        executableFingerprint: `sha256:${'f'.repeat(64)}`,
        executionMode: 'native-full',
        hostFullAccess: true,
        limitedProtection: false,
        confirmedAt: now.toISOString(),
      },
    }
    const quarantined = {
      ...binding('binding-1', 'room-1', ''),
      detachedReason: 'security_pending',
      recoveryIntentId: null,
      recoveryErrorCode: 'permission_confirmation_required',
      agentIdentity: authorizedAgent,
    }
    prismaMock.roomBinding.findMany
      .mockResolvedValueOnce([quarantined])
      .mockResolvedValueOnce([{ agentIdentityId: 'agent-1', userId: 'user-1' }])
      .mockResolvedValueOnce([
        {
          ...quarantined,
          detachedReason: 'recovery_requested',
          recoveryIntentId: 'released-intent',
        },
      ])

    await expect(runPendingAgentRoomRecoveries()).resolves.toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
      waiting: 0,
    })
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-1',
        status: 'detached',
        detachedReason: 'security_pending',
        recoveryErrorCode: 'permission_confirmation_required',
        recoveryIntentId: null,
      },
      data: {
        detachedReason: 'recovery_requested',
        recoveryIntentId: expect.any(String),
        recoveryLeaseUntil: null,
        recoveryErrorCode: null,
      },
    })
  })

  it('reclaims an expired durable lease after a server restart', async () => {
    prismaMock.roomBinding.findMany.mockResolvedValue([
      {
        ...binding('binding-1', 'room-1', 'intent-after-restart'),
        detachedReason: 'recovering',
        recoveryLeaseUntil: new Date('2026-09-02T23:55:00.000Z'),
      },
    ])

    await expect(reconcileAgentRoomBindings({ agentId: 'agent-1' })).resolves.toEqual({
      attempted: 1,
      recovered: 1,
      failed: 0,
      waiting: 0,
    })
    expect(prismaMock.roomBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recoveryIntentId: 'intent-after-restart',
          OR: [{ recoveryLeaseUntil: null }, { recoveryLeaseUntil: { lt: expect.any(Date) } }],
        }),
      }),
    )
  })
})
