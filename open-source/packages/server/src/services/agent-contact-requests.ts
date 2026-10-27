// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-contact-requests.test.ts
import { prisma } from '../lib/prisma.js'
import { ContactError } from './contacts.js'

const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/

/** An application grants no contact or conversation access by itself. */
export async function requestAgentContact(input: { requesterUserId: string; publicId: string }) {
  if (!PUBLIC_ID.test(input.publicId)) throw new ContactError('invalid')
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE publicId = ${input.publicId} FOR UPDATE`
    const card = await tx.agentPublication.findFirst({
      where: { publicId: input.publicId, allowNewContacts: true,
        status: { not: 'revoked' }, agentIdentity: { ownerType: 'user', status: 'active' } },
      select: { id: true, agentIdentityId: true, ownerUserId: true,
        requireContactApproval: true },
    })
    if (!card) throw new ContactError('not_found')
    if (card.ownerUserId === input.requesterUserId) throw new ContactError('invalid')
    const existing = await tx.userContact.findUnique({
      where: { ownerUserId_targetAgentIdentityId: {
        ownerUserId: input.requesterUserId, targetAgentIdentityId: card.agentIdentityId,
      } }, select: { id: true },
    })
    if (existing) return { outcome: 'already_added' as const, contactId: existing.id }
    if (!card.requireContactApproval) throw new ContactError('conflict')
    const previous = await tx.agentContactRequest.findUnique({
      where: { agentIdentityId_requesterUserId: {
        agentIdentityId: card.agentIdentityId, requesterUserId: input.requesterUserId,
      } }, select: { status: true, updatedAt: true },
    })
    if (previous?.status === 'rejected'
      && previous.updatedAt.getTime() > Date.now() - 24 * 60 * 60 * 1000) {
      throw new ContactError('conflict')
    }
    const request = await tx.agentContactRequest.upsert({
      where: { agentIdentityId_requesterUserId: {
        agentIdentityId: card.agentIdentityId, requesterUserId: input.requesterUserId,
      } },
      create: { publicationId: card.id, agentIdentityId: card.agentIdentityId,
        ownerUserId: card.ownerUserId, requesterUserId: input.requesterUserId },
      update: { status: 'pending', publicationId: card.id, ownerUserId: card.ownerUserId },
      select: { id: true },
    })
    return { outcome: 'pending_approval' as const, requestId: request.id }
  })
}

export async function getAgentContactRequestStatus(input: { requesterUserId: string; publicId: string }) {
  if (!PUBLIC_ID.test(input.publicId)) throw new ContactError('invalid')
  const card = await prisma.agentPublication.findFirst({
    where: { publicId: input.publicId, status: { not: 'revoked' } },
    select: { agentIdentityId: true },
  })
  if (!card) throw new ContactError('not_found')
  const [contact, request, conversation] = await Promise.all([
    prisma.userContact.findUnique({ where: { ownerUserId_targetAgentIdentityId: {
      ownerUserId: input.requesterUserId, targetAgentIdentityId: card.agentIdentityId,
    } }, select: { id: true } }),
    prisma.agentContactRequest.findUnique({ where: { agentIdentityId_requesterUserId: {
      agentIdentityId: card.agentIdentityId, requesterUserId: input.requesterUserId,
    } }, select: { status: true } }),
    prisma.agentDirectConversation.findUnique({ where: { agentIdentityId_visitorUserId: {
      agentIdentityId: card.agentIdentityId, visitorUserId: input.requesterUserId,
    } }, select: { status: true } }),
  ])
  return { status: contact || conversation?.status === 'active'
    ? 'added' : request?.status === 'pending' ? 'pending' : 'none' }
}

export async function listAgentContactRequests(input: { ownerUserId: string; agentIdentityId: string }) {
  const owned = await prisma.agentIdentity.findFirst({
    where: { id: input.agentIdentityId, ownerType: 'user', ownerUserId: input.ownerUserId },
    select: { id: true },
  })
  if (!owned) throw new ContactError('not_found')
  const requests = await prisma.agentContactRequest.findMany({
    where: { ownerUserId: input.ownerUserId, agentIdentityId: input.agentIdentityId, status: 'pending' },
    select: { id: true, createdAt: true,
      requesterUser: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' }, take: 100,
  })
  return requests.map((item) => ({ id: item.id, requesterName: item.requesterUser.name,
    createdAt: item.createdAt.toISOString() }))
}

export async function reviewAgentContactRequest(input: {
  ownerUserId: string; agentIdentityId: string; requestId: string; approved: unknown
}) {
  if (typeof input.approved !== 'boolean' || !/^[A-Za-z0-9_-]{8,191}$/.test(input.requestId)) {
    throw new ContactError('invalid')
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE agentIdentityId = ${input.agentIdentityId} FOR UPDATE`
    const request = await tx.agentContactRequest.findFirst({
      where: { id: input.requestId, ownerUserId: input.ownerUserId,
        agentIdentityId: input.agentIdentityId, status: 'pending',
        agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId, status: 'active' } },
      select: { id: true, requesterUserId: true,
        publication: { select: { status: true, allowNewContacts: true } } },
    })
    if (!request) throw new ContactError('not_found')
    if (input.approved && (request.publication.status === 'revoked'
      || !request.publication.allowNewContacts)) throw new ContactError('conflict')
    const changed = await tx.agentContactRequest.updateMany({
      where: { id: request.id, status: 'pending', ownerUserId: input.ownerUserId },
      data: { status: input.approved ? 'approved' : 'rejected' },
    })
    if (changed.count !== 1) throw new ContactError('conflict')
    if (input.approved) {
      await tx.userContact.upsert({
        where: { ownerUserId_targetAgentIdentityId: {
          ownerUserId: request.requesterUserId, targetAgentIdentityId: input.agentIdentityId,
        } },
        create: { ownerUserId: request.requesterUserId,
          targetAgentIdentityId: input.agentIdentityId }, update: {},
      })
    }
    return { outcome: input.approved ? 'approved' as const : 'rejected' as const }
  })
}
