// @covers open-source/packages/server/src/services/agent-publications.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  agentIdentity: { findFirst: vi.fn() },
  agentPublication: { upsert: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  agentDirectMessage: { updateMany: vi.fn() },
  agentDirectBinding: { updateMany: vi.fn() },
  roomMessage: { updateMany: vi.fn() },
  room: { updateMany: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))

import {
  createAgentPublicationDraft,
  getOwnedAgentPublication,
  getOwnedAgentPublicationReadiness,
  getPublicAgentPublication,
  setAgentCardContactAdding,
  setAgentCardContactApproval,
  setAgentPublicationAnonymousAccess,
  pauseAgentPublication,
  revokeAgentPublication,
  updateAgentPublicationDetails,
} from '../services/agent-publications.js'

const publication = {
  id: 'publication-1',
  agentIdentityId: 'agent-1',
  ownerUserId: 'owner-1',
  publicId: 'a'.repeat(32),
  status: 'draft',
  generation: 1,
  policyVersion: 1,
  allowNewContacts: false,
  displayName: '公开智能体',
  description: '介绍',
  dailyMessageLimit: 100,
  updatedAt: new Date('2026-09-26T00:00:00Z'),
}

describe('published Agent ownership and public projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (run) => run(prismaMock))
  })

  it('keeps guest access off by default and makes it mutually exclusive with approval', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.upsert.mockResolvedValue({ ...publication,
      requireContactApproval: false, allowAnonymousVisitors: false })
    const draft = await createAgentPublicationDraft({ ownerUserId: 'owner-1',
      agentIdentityId: 'agent-1', displayName: 'AI' })
    expect(draft.allowAnonymousVisitors).toBe(false)
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentPublication.findFirst.mockResolvedValue({ ...publication,
      requireContactApproval: false, allowAnonymousVisitors: true })
    await setAgentPublicationAnonymousAccess({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      allowed: true, expectedGeneration: 1, expectedPolicyVersion: 1 })
    expect(prismaMock.agentPublication.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requireContactApproval: false }),
      data: { allowAnonymousVisitors: true, policyVersion: { increment: 1 } },
    }))
    await setAgentCardContactApproval({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      required: true, expectedGeneration: 1, expectedPolicyVersion: 1 })
    expect(prismaMock.agentPublication.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ allowAnonymousVisitors: false }),
    }))
  })

  it('rejects a draft for another owner before any publication write', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(null)
    await expect(createAgentPublicationDraft({
      ownerUserId: 'visitor-1',
      agentIdentityId: 'agent-1',
      displayName: '公开智能体',
    })).rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentPublication.upsert).not.toHaveBeenCalled()
  })

  it('creates a draft with add permission but without enabling execution', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.upsert.mockResolvedValue(publication)
    const result = await createAgentPublicationDraft({
      ownerUserId: 'owner-1',
      agentIdentityId: 'agent-1',
      displayName: ' 公开智能体 ',
    })
    expect(prismaMock.agentPublication.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentIdentityId: 'agent-1' },
      create: expect.objectContaining({ status: 'draft', ownerUserId: 'owner-1', allowNewContacts: true }),
      update: {},
    }))
    expect(result.publicId).toBe(publication.publicId)
    expect(result.allowNewContacts).toBe(false)
    expect(result.status).toBe('draft')
  })

  it('stores up to three distinct starter questions and rejects invalid input', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.upsert.mockResolvedValue({ ...publication,
      suggestedQuestions: ['如何开始？', '支持哪些文件？'] })
    const result = await createAgentPublicationDraft({ ownerUserId: 'owner-1',
      agentIdentityId: 'agent-1', displayName: 'AI',
      suggestedQuestions: [' 如何开始？ ', '支持哪些文件？'] })
    expect(prismaMock.agentPublication.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ suggestedQuestions: ['如何开始？', '支持哪些文件？'] }),
    }))
    expect(result.suggestedQuestions).toEqual(['如何开始？', '支持哪些文件？'])
    await expect(createAgentPublicationDraft({ ownerUserId: 'owner-1',
      agentIdentityId: 'agent-1', displayName: 'AI',
      suggestedQuestions: ['重复', '重复'] })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('re-drafts a revoked publication without reviving its old URL or losing conversations', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.upsert.mockResolvedValue({
      ...publication, status: 'revoked', generation: 2, policyVersion: 2,
    })
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentPublication.findFirst.mockResolvedValue({
      ...publication, status: 'draft', generation: 2, policyVersion: 3,
    })
    const result = await createAgentPublicationDraft({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      displayName: '新公开名', description: '新介绍', dailyMessageLimit: 50,
    })
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'publication-1', ownerUserId: 'owner-1', status: 'revoked',
        agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' },
      },
      data: {
        status: 'draft', displayName: '新公开名', description: '新介绍',
        dailyMessageLimit: 50, policyVersion: { increment: 1 }, revokedAt: null,
      },
    })
    expect(result).toMatchObject({ status: 'draft', generation: 2, policyVersion: 3 })
    expect(result.publicId).toBe(publication.publicId)
  })

  it('requires Agent ownership before reading a publication', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(null)
    await expect(getOwnedAgentPublication('visitor-1', 'agent-1'))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(prismaMock.agentPublication.findFirst).not.toHaveBeenCalled()
  })

  it('shows only sanitized machine and runtime readiness to the owner', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({
      status: 'active', sessionMode: 'standard', runtimeAdapter: 'codex',
      permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY, permissionPolicyVersion: 1,
      machine: {
        userId: 'owner-1', paired: true, online: true, agents: [{ type: 'codex', authState: 'ready',
          supportedAgentExecutionModes: ['restricted'],
          managedAgentProtection: { level: 'hard', runtimeVersion: '1.0.0', platform: 'darwin',
            executableFingerprint: `sha256:${'a'.repeat(64)}`,
            unsupportedCapabilities: [], capabilityMatrix: {
              fileAccess: { 'workspace-read': true, 'workspace-write': false, 'host-full': false },
              externalCapabilities: Object.fromEntries(['commandNetwork', 'webSearch', 'browser',
                'computerUse', 'mcp'].map((key) => [key, { allow: false, deny: true }])),
            } }, privatePath: '/owner/private', token: 'never-return',
        }],
      },
    })
    const result = await getOwnedAgentPublicationReadiness('owner-1', 'agent-1')
    expect(result).toMatchObject({ machineOnline: true, runtimeAdapter: 'codex',
      protectionLevel: 'hard', runtimeEligible: true, blockers: [], activationAvailable: true })
    expect(JSON.stringify(result)).not.toMatch(/privatePath|private|token|sha256:/)
  })

  it('reports runtime problems separately without blocking sharing', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ status: 'active', sessionMode: 'standard', runtimeAdapter: 'codex',
      machine: { userId: 'owner-1', paired: true, online: true, agents: [{ type: 'codex', authState: 'ready',
        supportedAgentExecutionModes: ['restricted'] }] } })
    const missing = await getOwnedAgentPublicationReadiness('owner-1', 'agent-1')
    expect(missing.runtimeEligible).toBe(false)
    expect(missing.activationAvailable).toBe(true)
    expect(missing.blockers).toContain('runtime_protection_unverified')
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ status: 'active', sessionMode: 'standard', runtimeAdapter: 'codex',
      machine: { userId: 'owner-1', paired: true, online: true, agents: [
        { type: 'codex', authState: 'ready' }, { type: 'codex', authState: 'ready' },
      ] } })
    const duplicated = await getOwnedAgentPublicationReadiness('owner-1', 'agent-1')
    expect(duplicated.runtimeEligible).toBe(false)
    expect(duplicated.activationAvailable).toBe(true)
    expect(duplicated.blockers).toContain('runtime_unavailable')
  })

  it('allows sharing while offline but still reports live runtime availability', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ status: 'active', sessionMode: 'standard',
      runtimeAdapter: 'codex', machine: { userId: 'owner-1', paired: true, online: false, agents: [] } })
    expect(await getOwnedAgentPublicationReadiness('owner-1', 'agent-1')).toMatchObject({
      activationAvailable: true, machineOnline: false, runtimeEligible: false,
      blockers: expect.arrayContaining(['machine_offline']),
    })
  })

  it.each([
    { status: 'deleted', sessionMode: 'standard', machine: { userId: 'owner-1', paired: true } },
    { status: 'active', sessionMode: 'manager', machine: { userId: 'owner-1', paired: true } },
    { status: 'active', sessionMode: 'standard', machine: { userId: 'other-owner', paired: true } },
    { status: 'active', sessionMode: 'standard', machine: { userId: 'owner-1', paired: false } },
  ])('keeps ownership and supported identity checks for sharing: %j', async (agent) => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue(agent)
    expect((await getOwnedAgentPublicationReadiness('owner-1', 'agent-1')).activationAvailable).toBe(false)
  })

  it('shows the stable link and current quota to its owner', async () => {
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue({
      ...publication, status: 'active', quotaDay: new Date().toISOString().slice(0, 10), quotaUsed: 7,
    })
    const result = await getOwnedAgentPublication('owner-1', 'agent-1')
    expect(result?.publicId).toBe(publication.publicId)
    expect(result?.messagesUsedToday).toBe(7)
    expect(prismaMock.agentPublication.findFirst).toHaveBeenCalledWith({
      where: { agentIdentityId: 'agent-1', ownerUserId: 'owner-1' },
    })
  })

  it('projects only public fields for active and paused links', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      ...publication,
      status: 'active',
      agentIdentity: { id: 'agent-1', status: 'active', ownerUserId: 'owner-1',
        avatarVersion: 'abcdefghijklmnopqrst', avatarUpdatedAt: new Date('2026-09-26T00:00:00Z'),
        machine: { paired: true, online: true } },
    })
    const result = await getPublicAgentPublication('a'.repeat(32))
    expect(result).toEqual({
      publicId: 'a'.repeat(32),
      status: 'active',
      machineOnline: true,
      displayName: '公开智能体',
      description: '介绍',
      suggestedQuestions: [],
      avatar: { version: 'abcdefghijklmnopqrst',
        smallUrl: '/public/agent-avatars/agent-1/abcdefghijklmnopqrst/96',
        mediumUrl: '/public/agent-avatars/agent-1/abcdefghijklmnopqrst/256',
        updatedAt: '2026-09-26T00:00:00.000Z' },
      creatorCanReadConversation: true,
      allowNewContacts: false,
    })
    expect(prismaMock.agentPublication.findUnique).toHaveBeenCalledWith({
      where: { publicId: 'a'.repeat(32) },
      select: {
        publicId: true,
        status: true,
        displayName: true,
        description: true,
        suggestedQuestions: true,
        allowNewContacts: true,
        requireContactApproval: true,
        allowAnonymousVisitors: true,
        ownerUserId: true,
        agentIdentity: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true,
          status: true, ownerUserId: true,
          machine: { select: { paired: true, online: true } } } },
      },
    })
  })

  it('shows a draft card without execution and hides revoked links', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      ...publication,
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    await expect(getPublicAgentPublication('a'.repeat(32))).resolves.toMatchObject({
      publicId: 'a'.repeat(32), status: 'unavailable', allowNewContacts: false,
    })
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      ...publication,
      status: 'revoked',
      agentIdentity: { status: 'active', ownerUserId: 'owner-1' },
    })
    await expect(getPublicAgentPublication('a'.repeat(32))).resolves.toBeNull()
    await expect(getPublicAgentPublication('invalid')).resolves.toBeNull()
  })

  it('changes only new-contact permission with owner and version fencing', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue({ ...publication, allowNewContacts: true })
    const result = await setAgentCardContactAdding({ ownerUserId: 'owner-1',
      agentIdentityId: 'agent-1', allowed: true, expectedGeneration: 1, expectedPolicyVersion: 1 })
    expect(result?.allowNewContacts).toBe(true)
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
        generation: 1, policyVersion: 1, status: { not: 'revoked' } }),
      data: { allowNewContacts: true, policyVersion: { increment: 1 } },
    })
  })

  it('retires a public link when the Agent owner changes', async () => {
    prismaMock.agentPublication.findUnique.mockResolvedValue({
      ...publication, status: 'active',
      agentIdentity: { status: 'active', ownerUserId: 'new-owner' },
    })
    await expect(getPublicAgentPublication(publication.publicId)).resolves.toBeNull()
  })

  it('edits only a matching owner and generation', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue(publication)
    const result = await updateAgentPublicationDetails({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1', expectedGeneration: 1,
      expectedPolicyVersion: 1,
      displayName: '新名称', description: '新介绍', dailyMessageLimit: 50,
    })
    expect(result?.id).toBe('publication-1')
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: {
        agentIdentityId: 'agent-1', ownerUserId: 'owner-1', generation: 1,
        policyVersion: 1,
        status: { in: ['draft', 'active', 'paused'] },
        agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' },
      },
      data: {
        displayName: '新名称', description: '新介绍', dailyMessageLimit: 50,
        policyVersion: { increment: 1 },
      },
    })
    expect(prismaMock.agentDirectMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    }))
  })

  it('keeps in-flight messages and leases valid for presentation-only edits', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue(publication)
    await updateAgentPublicationDetails({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      expectedGeneration: 1, expectedPolicyVersion: 1,
      displayName: '新名称', description: '新介绍', suggestedQuestions: ['问题'], dailyMessageLimit: 100 })
    expect(prismaMock.agentDirectMessage.updateMany).toHaveBeenCalledWith({
      where: { authorRole: 'visitor', status: { in: ['pending', 'running'] },
        publicationGeneration: 1, policyVersion: 1,
        conversation: { agentIdentityId: 'agent-1', ownerUserId: 'owner-1' } },
      data: { policyVersion: 2 },
    })
    expect(prismaMock.agentDirectBinding.updateMany).toHaveBeenCalledWith({
      where: { appliedPolicyVersion: 1,
        conversation: { agentIdentityId: 'agent-1', ownerUserId: 'owner-1' } },
      data: { appliedPolicyVersion: 2 },
    })
    expect(prismaMock.roomMessage.updateMany).not.toHaveBeenCalled()
  })

  it('rejects stale edits and never reads another owner publication', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 0 })
    await expect(updateAgentPublicationDetails({
      ownerUserId: 'visitor-1', agentIdentityId: 'agent-1', expectedGeneration: 1,
      expectedPolicyVersion: 1,
      displayName: '夺取',
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(prismaMock.agentPublication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'visitor-1' }),
    }))
    expect(prismaMock.agentDirectMessage.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.agentDirectBinding.updateMany).not.toHaveBeenCalled()
  })

  it('revokes a matching generation and rotates the public URL without deleting history', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue({ ...publication, status: 'revoked', generation: 2 })
    await revokeAgentPublication({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1', expectedGeneration: 1,
    })
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: {
        agentIdentityId: 'agent-1', ownerUserId: 'owner-1', generation: 1,
        status: { in: ['draft', 'active', 'paused'] },
        agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' },
      },
      data: {
        status: 'revoked', plazaListed: false,
        publicId: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
        generation: { increment: 1 }, revokedAt: expect.any(Date),
      },
    })
    expect(prismaMock.agentDirectMessage.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ['pending', 'running'] }, conversation: {
        agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
      } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    })
  })

  it('pauses only a matching active publication and increments its policy version', async () => {
    prismaMock.agentPublication.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.agentIdentity.findFirst.mockResolvedValue({ id: 'agent-1' })
    prismaMock.agentPublication.findFirst.mockResolvedValue({
      ...publication, status: 'paused', policyVersion: 2,
    })
    const result = await pauseAgentPublication({
      ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      expectedGeneration: 1, expectedPolicyVersion: 1,
    })
    expect(result?.status).toBe('paused')
    expect(prismaMock.agentPublication.updateMany).toHaveBeenCalledWith({
      where: {
        agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
        generation: 1, policyVersion: 1, status: 'active',
        agentIdentity: { ownerType: 'user', ownerUserId: 'owner-1' },
      },
      data: { status: 'paused', policyVersion: { increment: 1 } },
    })
    expect(prismaMock.agentDirectMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    }))
  })
})
