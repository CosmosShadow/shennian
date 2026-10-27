// @covers open-source/packages/server/src/services/contacts.ts
// @covers open-source/packages/server/src/services/agent-discovery.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  userContact: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  agentIdentity: { findMany: vi.fn() },
  agentPublication: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))

import { listContacts, removeContact, saveContact } from '../services/contacts.js'
import { getPlazaAgent, listPlazaAgents, setPlazaListing } from '../services/agent-discovery.js'

const publicId = 'a'.repeat(32)

describe('private contacts and opt-in plaza discovery', () => {
  beforeEach(() => { vi.clearAllMocks(); db.$transaction.mockImplementation(async (run) => run(db)) })

  it('rejects ambiguous contact targets and requires permission to add an AI', async () => {
    await expect(saveContact({ ownerUserId: 'owner-1234' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(saveContact({ ownerUserId: 'owner-1234', targetUserId: 'user-1234',
      publicAgentId: publicId })).rejects.toMatchObject({ code: 'invalid' })
    db.agentPublication.findFirst.mockResolvedValue(null)
    await expect(saveContact({ ownerUserId: 'owner-1234', publicAgentId: publicId }))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(db.agentPublication.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ publicId, allowNewContacts: true, status: { not: 'revoked' } }),
    }))
    expect(db.userContact.upsert).not.toHaveBeenCalled()
  })

  it('saves only the exact AI resolved from a public link, without a Room write', async () => {
    db.agentPublication.findFirst.mockResolvedValue({ agentIdentityId: 'agent-1234' })
    db.userContact.upsert.mockResolvedValue({ id: 'contact-1234' })
    await saveContact({ ownerUserId: 'owner-1234', publicAgentId: publicId })
    expect(db.userContact.upsert).toHaveBeenCalledWith({
      where: { ownerUserId_targetAgentIdentityId: {
        ownerUserId: 'owner-1234', targetAgentIdentityId: 'agent-1234',
      } },
      create: { ownerUserId: 'owner-1234', targetAgentIdentityId: 'agent-1234' },
      update: {},
    })
  })

  it('scopes removal and search to the current owner', async () => {
    db.userContact.deleteMany.mockResolvedValue({ count: 1 })
    await removeContact({ ownerUserId: 'owner-1234', contactId: 'contact-1234' })
    expect(db.userContact.deleteMany).toHaveBeenCalledWith({ where: {
      ownerUserId: 'owner-1234', id: 'contact-1234',
    } })
    db.userContact.findMany.mockResolvedValue([])
    db.agentIdentity.findMany.mockResolvedValue([])
    await listContacts({ ownerUserId: 'owner-1234', query: 'Ada' })
    expect(db.userContact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1234' }),
    }))
    expect(db.agentIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1234' }),
    }))
  })

  it('returns the actual workspace ID for an owned AI', async () => {
    db.userContact.findMany.mockResolvedValue([])
    db.agentIdentity.findMany.mockResolvedValue([{ id: 'agent-1234', displayName: 'Ada',
      avatarVersion: null, avatarUpdatedAt: null }])
    const result = await listContacts({ ownerUserId: 'owner-1234' })
    expect(result.contacts).toContainEqual(expect.objectContaining({
      owned: true, agentIdentityId: 'agent-1234', agentWorkspaceId: 'agent-1234',
    }))
  })

  it('lists explicitly displayed cards independently of add permission', async () => {
    db.agentPublication.findMany.mockResolvedValue([{ publicId, displayName: 'Ada',
      description: 'Verified introduction', updatedAt: new Date('2026-09-27T00:00:00Z'),
      agentIdentity: { id: 'agent-1234', avatarVersion: null, avatarUpdatedAt: null,
        status: 'active', machine: { paired: true, online: true } },
    }])
    const result = await listPlazaAgents({ query: 'Ada' })
    expect(db.agentPublication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ plazaListed: true, status: { not: 'revoked' } }),
    }))
    expect(result.agents[0]).toMatchObject({ publicId, machineOnline: true })
    expect(JSON.stringify(result)).not.toContain('ownerUserId')
  })

  it('continues a plaza page even if the previous listing was removed', async () => {
    db.agentPublication.findMany.mockResolvedValue([])
    await listPlazaAgents({ cursor: publicId })
    expect(db.agentPublication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ publicId: { gt: publicId } }),
    }))
  })

  it('does not expose an unlisted AI detail and gates owner listing with generation', async () => {
    db.agentPublication.findFirst.mockResolvedValue(null)
    await expect(getPlazaAgent(publicId)).rejects.toMatchObject({ code: 'not_found' })
    db.agentPublication.updateMany.mockResolvedValue({ count: 0 })
    await expect(setPlazaListing({ ownerUserId: 'owner-1234', agentIdentityId: 'agent-1234',
      listed: true, expectedGeneration: 2, expectedPolicyVersion: 3 }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(db.agentPublication.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1234', generation: 2,
        policyVersion: 3, status: { not: 'revoked' } }),
    }))
  })
})
