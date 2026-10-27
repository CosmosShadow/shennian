// @covers open-source/packages/server/src/services/machine-status.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    machine: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    agentIdentity: { findMany: vi.fn() },
    agentPublication: { updateMany: vi.fn() },
    agentDirectMessage: { updateMany: vi.fn() },
    roomMessage: { updateMany: vi.fn() },
    roomBinding: { findMany: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))
vi.mock('../lib/redis.js', () => ({ redis: { set: vi.fn(), del: vi.fn() } }))
vi.mock('../relay/connections.js', () => ({
  connections: { broadcastToClientsOfUser: vi.fn() },
}))
vi.mock('../relay/pubsub.js', () => ({
  pubsub: { isActive: true, publishToClient: vi.fn(), publishToUser: vi.fn() },
}))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: vi.fn() }))

import {
  setMachineAgents,
  setMachineAgentList,
  setMachineAutoUpgrade,
  setMachineOnline,
  setMachineRemoteAccessDisabled,
} from '../services/machine-status.js'

describe('machine status service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (run) => run(mockPrisma))
    mockPrisma.machine.update.mockResolvedValue({ userId: null })
    mockPrisma.machine.findUnique.mockResolvedValue({ agents: [] })
    mockPrisma.agentIdentity.findMany.mockResolvedValue([])
    mockPrisma.roomBinding.findMany.mockResolvedValue([])
  })

  it('keeps share authorization but cancels stale work when the runtime fingerprint changes', async () => {
    const protection = (fingerprint: string) => ({
      level: 'hard', runtimeVersion: '1.0.0', platform: 'darwin',
      executableFingerprint: `sha256:${fingerprint.repeat(64)}`,
      unsupportedCapabilities: [],
      capabilityMatrix: {
        fileAccess: { 'workspace-read': true, 'workspace-write': false, 'host-full': false },
        externalCapabilities: Object.fromEntries(['commandNetwork', 'webSearch', 'browser',
          'computerUse', 'mcp'].map((key) => [key, { allow: false, deny: true }])),
      },
    })
    mockPrisma.machine.findUnique.mockResolvedValue({ agents: [{
      type: 'codex', supportsManagedAgent: true,
      managedAgentProtection: protection('a'),
    }] })
    mockPrisma.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1', runtimeAdapter: 'codex' }])
    await setMachineAgents('machine-1', [{ type: 'codex', supportsManagedAgent: true,
      managedAgentProtection: protection('b') }])
    expect(mockPrisma.agentPublication.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.agentDirectMessage.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending', 'running'] },
        conversation: { agentIdentityId: { in: ['agent-1'] } } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    })
    expect(mockPrisma.machine.update).toHaveBeenCalled()

    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (run) => run(mockPrisma))
    mockPrisma.machine.findUnique.mockResolvedValue({ agents: [{ type: 'codex',
      supportsManagedAgent: true, managedAgentProtection: protection('b') }] })
    mockPrisma.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1', runtimeAdapter: 'codex' }])
    mockPrisma.machine.update.mockResolvedValue({ userId: null })
    await setMachineAgents('machine-1', [{ type: 'codex', supportsManagedAgent: true,
      display: { name: 'New display label' }, managedAgentProtection: protection('b') }])
    expect(mockPrisma.agentPublication.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.agentDirectMessage.updateMany).not.toHaveBeenCalled()
  })

  it('drops stale runtime proof and cancels work without revoking sharing when a daemon sends only names', async () => {
    mockPrisma.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1' }])
    await setMachineAgentList('machine-1', ['codex'])
    expect(mockPrisma.agentPublication.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.agentDirectMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    }))
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { agentList: ['codex'], agents: [] },
    }))
  })

  it('does not pause when a reconnect resends the same agent list', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ agentList: ['codex'] })
    mockPrisma.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1' }])
    await setMachineAgentList('machine-1', ['codex'])
    expect(mockPrisma.agentPublication.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.agentDirectMessage.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { agentList: ['codex'] },
    }))
  })

  it('serializes machine capability reports and retries a transient transaction conflict', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2034' })
    await setMachineAgents('machine-1', [{ type: 'codex' }])
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2)
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(mockPrisma.machine.update).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' })
    await expect(setMachineAgentList('machine-1', ['codex']))
      .rejects.toMatchObject({ code: 'P2034' })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3)
  })

  it('sanitizes undefined model fields before writing agents JSON', async () => {
    await setMachineAgents('machine-1', [
      {
        type: 'codex',
        models: [
          {
            id: 'gpt-5.5',
            name: 'GPT-5.5',
            description: undefined,
            supportedReasoningEfforts: [{ id: 'medium', name: 'Medium', description: undefined }],
          },
        ],
      },
    ])

    expect(mockPrisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'machine-1' },
        data: {
          agentList: ['codex'],
          agents: [
            {
              type: 'codex',
              models: [
                {
                  id: 'gpt-5.5',
                  name: 'GPT-5.5',
                  supportedReasoningEfforts: [{ id: 'medium', name: 'Medium' }],
                },
              ],
            },
          ],
        },
      }),
    )
  })

  it('preserves dynamic ACP ids and additive metadata from a newer daemon', async () => {
    await setMachineAgents('machine-1', [{
      type: 'acp:company-agent',
      models: [],
      integration: 'acp',
      display: { name: 'Company Agent', version: '1.2.3' },
      acpCapabilities: { protocolVersion: 1, listSessions: false },
    }])
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentList: ['acp:company-agent'],
        agents: [expect.objectContaining({ type: 'acp:company-agent', integration: 'acp' })],
      }),
    }))
  })

  it('persists the policy reported by the connected daemon', async () => {
    await setMachineOnline('machine-1', 'cn', '0.3.2', 'none')

    expect(mockPrisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'machine-1' },
        data: expect.objectContaining({ autoUpgrade: 'none', cliVersion: '0.3.2', online: true }),
      }),
    )
  })

  it('broadcasts the additive updater protocol adoption signal without persisting it', async () => {
    mockPrisma.machine.update.mockResolvedValue({ userId: 'owner-1' })
    await setMachineOnline('machine-1', 'cn', '0.4.13', 'patch', {
      protocolVersion: 1,
      dataEpoch: 2,
      capabilities: ['session_index_v1'],
      daemonInstallationId: 'install-1',
      updaterProtocolVersion: 1,
    })
    const { pubsub } = await import('../relay/pubsub.js')
    expect(pubsub.publishToUser).toHaveBeenCalledWith(
      'owner-1',
      expect.stringContaining('"updaterProtocolVersion":1'),
    )
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ updaterProtocolVersion: expect.anything() }),
    }))
  })

  it('updates the database projection when the daemon hot-switches policy', async () => {
    await setMachineAutoUpgrade('machine-1', 'patch')
    expect(mockPrisma.machine.update).toHaveBeenCalledWith({
      where: { id: 'machine-1' },
      data: { autoUpgrade: 'patch' },
    })
  })

  it('persists pause only after the daemon report and broadcasts the canonical timestamp', async () => {
    mockPrisma.machine.update.mockResolvedValue({
      userId: 'owner-1',
      cliVersion: '0.3.2',
      autoUpgrade: 'patch',
    })

    const disabledAt = await setMachineRemoteAccessDisabled('machine-1')

    expect(Date.parse(disabledAt)).not.toBeNaN()
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'machine-1' },
        data: expect.objectContaining({ online: false, remoteAccessDisabledAt: expect.any(Date) }),
      }),
    )
    const { pubsub } = await import('../relay/pubsub.js')
    expect(pubsub.publishToUser).toHaveBeenCalledWith(
      'owner-1',
      expect.stringContaining('remoteAccessDisabledAt'),
    )
    expect(pubsub.publishToClient).toHaveBeenCalledWith(
      'machine-1',
      expect.stringContaining('remoteAccessDisabledAt'),
    )
    const { connections } = await import('../relay/connections.js')
    expect(connections.broadcastToClientsOfUser).not.toHaveBeenCalled()
  })
})
