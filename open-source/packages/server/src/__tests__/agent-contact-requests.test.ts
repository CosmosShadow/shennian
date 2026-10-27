// @covers open-source/packages/server/src/services/agent-contact-requests.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  agentPublication: { findFirst: vi.fn() },
  agentIdentity: { findFirst: vi.fn() },
  agentContactRequest: { upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(),
    findUnique: vi.fn(), updateMany: vi.fn() },
  userContact: { findUnique: vi.fn(), upsert: vi.fn() },
  agentDirectConversation: { findUnique: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: db }))

import { getAgentContactRequestStatus, listAgentContactRequests,
  requestAgentContact, reviewAgentContactRequest } from '../services/agent-contact-requests.js'

const publicId = 'a'.repeat(32)
const card = { id: 'publication-1', agentIdentityId: 'agent-1', ownerUserId: 'owner-1',
  requireContactApproval: true }

describe('AI contact approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.$transaction.mockImplementation(async (run) => run(db))
    db.agentPublication.findFirst.mockResolvedValue(card)
    db.userContact.findUnique.mockResolvedValue(null)
  })

  it('creates a pending request without creating a contact', async () => {
    db.agentContactRequest.upsert.mockResolvedValue({ id: 'request-1' })
    const result = await requestAgentContact({ requesterUserId: 'visitor-1', publicId })
    expect(result).toEqual({ outcome: 'pending_approval', requestId: 'request-1' })
    expect(db.agentContactRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentIdentityId_requesterUserId: {
        agentIdentityId: 'agent-1', requesterUserId: 'visitor-1',
      } },
      create: expect.objectContaining({ ownerUserId: 'owner-1' }),
    }))
    expect(db.userContact.upsert).not.toHaveBeenCalled()
  })

  it('refuses a request when approval is off or the card is unavailable', async () => {
    db.agentPublication.findFirst.mockResolvedValueOnce(null)
    await expect(requestAgentContact({ requesterUserId: 'visitor-1', publicId }))
      .rejects.toMatchObject({ code: 'not_found' })
    db.agentPublication.findFirst.mockResolvedValueOnce({ ...card, requireContactApproval: false })
    await expect(requestAgentContact({ requesterUserId: 'visitor-1', publicId }))
      .rejects.toMatchObject({ code: 'conflict' })
  })

  it('exposes only own pending requests to the owner', async () => {
    db.agentIdentity.findFirst.mockResolvedValueOnce(null)
    await expect(listAgentContactRequests({ ownerUserId: 'other', agentIdentityId: 'agent-1' }))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(db.agentContactRequest.findMany).not.toHaveBeenCalled()
  })

  it('approves by creating a saved contact, and rejects without one', async () => {
    db.agentContactRequest.findFirst.mockResolvedValue({ id: 'request-1',
      requesterUserId: 'visitor-1', publication: { status: 'active', allowNewContacts: true } })
    db.agentContactRequest.updateMany.mockResolvedValue({ count: 1 })
    expect(await reviewAgentContactRequest({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      requestId: 'request-1', approved: true })).toEqual({ outcome: 'approved' })
    expect(db.userContact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { ownerUserId: 'visitor-1', targetAgentIdentityId: 'agent-1' },
    }))
    db.userContact.upsert.mockClear()
    expect(await reviewAgentContactRequest({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      requestId: 'request-1', approved: false })).toEqual({ outcome: 'rejected' })
    expect(db.userContact.upsert).not.toHaveBeenCalled()
  })

  it('does not approve after accepting new contacts is disabled', async () => {
    db.agentContactRequest.findFirst.mockResolvedValue({ id: 'request-1',
      requesterUserId: 'visitor-1', publication: { status: 'active', allowNewContacts: false } })
    await expect(reviewAgentContactRequest({ ownerUserId: 'owner-1', agentIdentityId: 'agent-1',
      requestId: 'request-1', approved: true })).rejects.toMatchObject({ code: 'conflict' })
    expect(db.userContact.upsert).not.toHaveBeenCalled()
  })

  it('shows pending state without granting a contact', async () => {
    db.agentContactRequest.findUnique.mockResolvedValue({ status: 'pending' })
    expect(await getAgentContactRequestStatus({ requesterUserId: 'visitor-1', publicId }))
      .toEqual({ status: 'pending' })
  })
})
