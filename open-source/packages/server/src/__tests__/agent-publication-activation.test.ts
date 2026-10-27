// @covers open-source/packages/server/src/services/agent-publications.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), agentFindFirst: vi.fn(), agentFindUnique: vi.fn(),
  publicationFindUnique: vi.fn(), publicationFindFirst: vi.fn(), publicationUpdateMany: vi.fn(),
  machineFindUnique: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction,
  agentIdentity: { findFirst: mocks.agentFindFirst },
  agentPublication: { findFirst: mocks.publicationFindFirst },
} }))

import { activateAgentPublication } from '../services/agent-publications.js'

const input = { ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
  expectedGeneration: 1, expectedPolicyVersion: 2 }
const runtime = { type: 'codex', authState: 'ready',
  supportedAgentExecutionModes: ['restricted'],
  managedAgentProtection: { level: 'hard', runtimeVersion: '1.0.0', platform: 'darwin',
    executableFingerprint: `sha256:${'a'.repeat(64)}`, unsupportedCapabilities: [],
    capabilityMatrix: { fileAccess: { 'workspace-read': true, 'workspace-write': false,
      'host-full': false }, externalCapabilities: Object.fromEntries([
      'commandNetwork', 'webSearch', 'browser', 'computerUse', 'mcp',
    ].map((key) => [key, { allow: false, deny: true }])) } } }
const publication = { id: 'publication-1', ownerUserId: 'owner-1', status: 'draft',
  generation: 1, policyVersion: 2 }

describe('publication sharing authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('SHENNIAN_PUBLIC_AGENT_ACTIVATION', '')
    mocks.transaction.mockImplementation(async (run) => run({
      $queryRaw: mocks.query,
      machine: { findUnique: mocks.machineFindUnique },
      agentIdentity: { findUnique: mocks.agentFindUnique },
      agentPublication: { findUnique: mocks.publicationFindUnique,
        updateMany: mocks.publicationUpdateMany },
    }))
    mocks.agentFindFirst.mockImplementation(async (args) => args.select.machineId
      ? { machineId: 'machine-1' } : { id: 'agent-1' })
    mocks.machineFindUnique.mockResolvedValue({ userId: 'owner-1', paired: true,
      online: true, agents: [runtime] })
    mocks.publicationFindUnique.mockResolvedValue(publication)
    mocks.agentFindUnique.mockResolvedValue({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'codex', sessionMode: 'standard',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY, permissionPolicyVersion: 1 })
    mocks.publicationUpdateMany.mockResolvedValue({ count: 1 })
    mocks.publicationFindFirst.mockResolvedValue({ ...publication, status: 'active',
      agentIdentityId: 'agent-1', publicId: 'a'.repeat(32), displayName: 'Agent',
      description: '', dailyMessageLimit: 100, quotaDay: '', quotaUsed: 0,
      updatedAt: new Date('2026-09-26T00:00:00Z') })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('does not let the obsolete activation environment flag block an eligible Agent', async () => {
    vi.stubEnv('SHENNIAN_PUBLIC_AGENT_ACTIVATION', 'disabled')
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
    expect(mocks.agentFindFirst).toHaveBeenCalled()
  })

  it('activates only after owner, pairing, identity and publication version checks', async () => {
    const result = await activateAgentPublication(input)
    expect(result).toMatchObject({ status: 'active', publicId: 'a'.repeat(32) })
    expect(mocks.query.mock.calls.map((call) => String(call[0]?.[0]))).toEqual([
      expect.stringContaining('Machine'), expect.stringContaining('AgentPublication'),
      expect.stringContaining('AgentIdentity'),
    ])
    expect(mocks.publicationUpdateMany).toHaveBeenCalledWith({
      where: { id: publication.id, ownerUserId: 'owner-1', generation: 1,
        policyVersion: 2, status: { in: ['draft', 'paused'] } },
      data: { status: 'active', policyVersion: { increment: 1 } },
    })
  })

  it.each([
    { online: false, agents: [] },
    { online: true, agents: [{ ...runtime, authState: 'required' }] },
    { online: true, agents: [{ type: 'codex' }] },
  ])('can share without a new runtime check: %j', async (availability) => {
    mocks.machineFindUnique.mockResolvedValue({ userId: 'owner-1', paired: true,
      ...availability })
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
    expect(mocks.machineFindUnique).toHaveBeenCalledWith({ where: { id: 'machine-1' },
      select: { userId: true, paired: true } })
  })

  it.each([
    { userId: 'another-owner', paired: true },
    { userId: 'owner-1', paired: false },
    null,
  ])('does not share a missing, unpaired or other owner machine: %j', async (machine) => {
    mocks.machineFindUnique.mockResolvedValue(machine)
    await expect(activateAgentPublication(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.publicationUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    { ownerUserId: 'another-owner' },
    { status: 'deleted' },
    { machineId: 'another-machine' },
  ])('does not share an unavailable or changed Agent: %j', async (change) => {
    mocks.agentFindUnique.mockResolvedValue({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', sessionMode: 'standard', ...change })
    await expect(activateAgentPublication(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.publicationUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    { generation: 2 }, { policyVersion: 3 }, { status: 'revoked' },
    { ownerUserId: 'another-owner' },
  ])('does not overwrite a changed publication: %j', async (change) => {
    mocks.publicationFindUnique.mockResolvedValue({ ...publication, ...change })
    await expect(activateAgentPublication(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.publicationUpdateMany).not.toHaveBeenCalled()
  })

  it('does not mistake an unsupported sign-in probe for a failed sign-in', async () => {
    mocks.machineFindUnique.mockResolvedValueOnce({ userId: 'owner-1', paired: true,
      online: true, agents: [{ ...runtime, type: 'pi-coding-agent', authState: 'unknown' }] })
    mocks.agentFindUnique.mockResolvedValueOnce({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'pi-coding-agent', sessionMode: 'standard',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY, permissionPolicyVersion: 1 })
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
  })

  it('shares without rewriting or reconfirming the existing Agent permission policy', async () => {
    mocks.machineFindUnique.mockResolvedValue({ userId: 'owner-1', paired: true,
      online: true, agents: [{ ...runtime, supportedAgentExecutionModes: ['native-full'],
        managedAgentProtection: { ...runtime.managedAgentProtection, level: 'unverified' } }] })
    const permissionConfirmation = {
      runtimeAdapter: 'codex', runtimeVersion: '1.0.0', platform: 'darwin',
      executableFingerprint: `sha256:${'a'.repeat(64)}`, executionMode: 'native-full',
      hostFullAccess: true, limitedProtection: false, policyVersion: 1,
      confirmedAt: '2026-09-26T00:00:00.000Z',
    }
    mocks.agentFindUnique.mockResolvedValue({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'codex', sessionMode: 'standard',
      permissionPolicy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      permissionPolicyVersion: 1, permissionConfirmation })
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
    mocks.agentFindUnique.mockResolvedValue({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'codex', sessionMode: 'standard',
      permissionPolicy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      permissionPolicyVersion: 1,
      permissionConfirmation: { ...permissionConfirmation, executableFingerprint: `sha256:${'b'.repeat(64)}` } })
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
    mocks.agentFindUnique.mockResolvedValue({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'codex', sessionMode: 'standard',
      permissionPolicy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      permissionPolicyVersion: 1,
      permissionConfirmation: { ...permissionConfirmation, policyVersion: 2 } })
    await expect(activateAgentPublication(input)).resolves.toMatchObject({ status: 'active' })
  })

  it('rejects a stale generation or a manager-mode Agent', async () => {
    mocks.publicationFindUnique.mockResolvedValueOnce(publication)
      .mockResolvedValueOnce({ ...publication, generation: 2 })
    await expect(activateAgentPublication(input)).rejects.toMatchObject({ code: 'conflict' })
    mocks.agentFindUnique.mockResolvedValueOnce({ ownerType: 'user', ownerUserId: 'owner-1',
      status: 'active', machineId: 'machine-1', runtimeAdapter: 'codex', sessionMode: 'manager' })
    await expect(activateAgentPublication(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.publicationUpdateMany).not.toHaveBeenCalled()
  })
})
