// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import { publicUserAvatar } from './user-avatar.js'
import { publicAgentAvatar } from './agent-avatar.js'

export class ContactError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'approval_required' | 'conflict') { super(code) }
}

const ID = /^[A-Za-z0-9_-]{8,191}$/
const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/

/** A saved contact is private to its owner and confers no Room or profile access. */
export async function saveContact(input: {
  ownerUserId: string
  targetUserId?: unknown
  publicAgentId?: unknown
}) {
  const isHuman = typeof input.targetUserId === 'string'
  const isAgent = typeof input.publicAgentId === 'string'
  if (isHuman === isAgent) throw new ContactError('invalid')
  if (isHuman) {
    const targetUserId = input.targetUserId as string
    if (!ID.test(targetUserId) || targetUserId === input.ownerUserId) {
      throw new ContactError('invalid')
    }
    const user = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
    if (!user) throw new ContactError('not_found')
    return prisma.userContact.upsert({
      where: { ownerUserId_targetUserId: { ownerUserId: input.ownerUserId, targetUserId } },
      create: { ownerUserId: input.ownerUserId, targetUserId }, update: {},
    })
  }
  const publicId = input.publicAgentId as string
  if (!PUBLIC_ID.test(publicId)) throw new ContactError('invalid')
  return prisma.$transaction(async (tx) => {
    // Serialize the eligibility check with owner policy changes.
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE publicId = ${publicId} FOR UPDATE`
    const publication = await tx.agentPublication.findFirst({
      where: {
        publicId,
        allowNewContacts: true,
        status: { not: 'revoked' },
        agentIdentity: { ownerType: 'user', status: 'active' },
      },
      select: { agentIdentityId: true, requireContactApproval: true },
    })
    if (!publication) throw new ContactError('not_found')
    if (publication.requireContactApproval) {
      const existing = await tx.userContact.findUnique({
        where: { ownerUserId_targetAgentIdentityId: {
          ownerUserId: input.ownerUserId, targetAgentIdentityId: publication.agentIdentityId,
        } },
      })
      if (existing) return existing
      throw new ContactError('approval_required')
    }
    return tx.userContact.upsert({
      where: { ownerUserId_targetAgentIdentityId: {
        ownerUserId: input.ownerUserId, targetAgentIdentityId: publication.agentIdentityId,
      } },
      create: { ownerUserId: input.ownerUserId,
        targetAgentIdentityId: publication.agentIdentityId },
      update: {},
    })
  })
}

export async function removeContact(input: { ownerUserId: string; contactId: string }) {
  if (!ID.test(input.contactId)) throw new ContactError('not_found')
  const removed = await prisma.userContact.deleteMany({
    where: { id: input.contactId, ownerUserId: input.ownerUserId },
  })
  if (!removed.count) throw new ContactError('not_found')
}

export async function listContacts(input: { ownerUserId: string; query?: unknown }) {
  const query = input.query === undefined ? '' : input.query
  if (typeof query !== 'string' || query.trim().length > 80) throw new ContactError('invalid')
  const term = query.trim()
  const [saved, ownedAgents] = await Promise.all([
    prisma.userContact.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        ...(term ? { OR: [
          { targetUser: { name: { contains: term } } },
          { targetAgentIdentity: { displayName: { contains: term } } },
        ] } : {}),
      },
      select: {
        id: true, createdAt: true,
        targetUser: { select: { id: true, name: true, avatarVersion: true,
          avatarUpdatedAt: true } },
        targetAgentIdentity: { select: {
          id: true, displayName: true, status: true, avatarVersion: true,
          avatarUpdatedAt: true,
          publication: { select: { publicId: true, status: true } },
        } },
      },
      orderBy: { id: 'asc' }, take: 200,
    }),
    prisma.agentIdentity.findMany({
      where: { ownerType: 'user', ownerUserId: input.ownerUserId,
        status: { not: 'deleted' },
        ...(term ? { displayName: { contains: term } } : {}) },
      select: { id: true, displayName: true, status: true, avatarVersion: true,
        avatarUpdatedAt: true, publication: { select: { plazaListed: true, status: true } } },
      orderBy: { id: 'asc' }, take: 200,
    }),
  ])
  const contacts: Array<{
    id: string; kind: 'human' | 'agent'; displayName: string; savedAt: string;
    userId?: string; agentIdentityId?: string; avatar: ReturnType<typeof publicUserAvatar>;
    publicId?: string | null;
  }> = []
  for (const entry of saved) {
    if (entry.targetUser) {
      contacts.push({
      id: entry.id, kind: 'human' as const, userId: entry.targetUser.id,
      displayName: entry.targetUser.name,
      avatar: publicUserAvatar(entry.targetUser),
      savedAt: entry.createdAt.toISOString(),
      })
      continue
    }
    if (!entry.targetAgentIdentity || entry.targetAgentIdentity.status === 'deleted') continue
    const agent = entry.targetAgentIdentity
    contacts.push({
      id: entry.id, kind: 'agent' as const, agentIdentityId: agent.id,
      displayName: agent.displayName, avatar: publicAgentAvatar(agent),
      publicId: agent.publication && agent.publication.status !== 'revoked'
        ? agent.publication.publicId : null,
      savedAt: entry.createdAt.toISOString(),
    })
  }
  const own = ownedAgents.map((agent) => ({
    id: `own:${agent.id}`, kind: 'agent' as const, agentIdentityId: agent.id,
    agentWorkspaceId: agent.id,
    displayName: agent.displayName, avatar: publicAgentAvatar(agent),
    publicId: null, owned: true,
    plazaListed: agent.publication?.status !== 'revoked' && agent.publication?.plazaListed === true,
  }))
  return { contacts: [...contacts, ...own], truncated: saved.length === 200 || ownedAgents.length === 200 }
}
