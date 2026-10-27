// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import { publicAgentAvatar } from './agent-avatar.js'

export class AgentDiscoveryError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict') { super(code) }
}

const PUBLIC_ID = /^[A-Za-z0-9_-]{32}$/

function searchTerm(value: unknown) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > 80) throw new AgentDiscoveryError('invalid')
  return value.trim()
}

function pageSize(value: unknown) {
  if (value === undefined) return 30
  const size = Number(value)
  if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new AgentDiscoveryError('invalid')
  return size
}

function project(publication: {
  publicId: string
  displayName: string
  description: string
  allowNewContacts: boolean
  requireContactApproval: boolean
  status: string
  updatedAt: Date
  agentIdentity: {
    id: string
    avatarVersion: string | null
    avatarUpdatedAt: Date | null
    status: string
    machine: { paired: boolean; online: boolean } | null
  }
}) {
  return {
    publicId: publication.publicId,
    agentIdentityId: publication.agentIdentity.id,
    displayName: publication.displayName,
    description: publication.description,
    allowNewContacts: publication.allowNewContacts,
    requireContactApproval: publication.requireContactApproval,
    avatar: publicAgentAvatar(publication.agentIdentity),
    status: publication.agentIdentity.status === 'active' && publication.status === 'active'
      ? 'active' : 'unavailable',
    machineOnline: publication.agentIdentity.machine?.paired === true
      && publication.agentIdentity.machine.online === true,
    updatedAt: publication.updatedAt.toISOString(),
  }
}

const agentSelect = {
  id: true, avatarVersion: true, avatarUpdatedAt: true, status: true,
  machine: { select: { paired: true, online: true } },
} as const

/** Listing and accepting new contacts are independent card settings. */
export async function listPlazaAgents(input: { query?: unknown; limit?: unknown; cursor?: unknown }) {
  const query = searchTerm(input.query)
  const take = pageSize(input.limit)
  const cursor = input.cursor
  if (cursor !== undefined && (typeof cursor !== 'string' || !PUBLIC_ID.test(cursor))) {
    throw new AgentDiscoveryError('invalid')
  }
  const rows = await prisma.agentPublication.findMany({
    where: {
      plazaListed: true,
      status: { not: 'revoked' },
      ...(cursor ? { publicId: { gt: cursor } } : {}),
      agentIdentity: { status: 'active', ownerType: 'user' },
      ...(query ? { OR: [
        { displayName: { contains: query } },
        { description: { contains: query } },
      ] } : {}),
    },
    select: {
      publicId: true, displayName: true, description: true, allowNewContacts: true,
      requireContactApproval: true,
      status: true, updatedAt: true,
      agentIdentity: { select: agentSelect },
    },
    orderBy: { publicId: 'asc' },
    take: take + 1,
  })
  const page = rows.slice(0, take)
  return {
    agents: page.map(project),
    nextCursor: rows.length > take ? page.at(-1)?.publicId ?? null : null,
  }
}

export async function getPlazaAgent(publicId: string) {
  if (!PUBLIC_ID.test(publicId)) throw new AgentDiscoveryError('not_found')
  const publication = await prisma.agentPublication.findFirst({
    where: {
      publicId, plazaListed: true, status: { not: 'revoked' },
      agentIdentity: { status: 'active', ownerType: 'user' },
    },
    select: {
      publicId: true, displayName: true, description: true, allowNewContacts: true,
      requireContactApproval: true,
      status: true, updatedAt: true,
      agentIdentity: { select: agentSelect },
    },
  })
  if (!publication) throw new AgentDiscoveryError('not_found')
  return project(publication)
}

/** Publishing a share link never implies consent to appear in search. */
export async function setPlazaListing(input: {
  ownerUserId: string
  agentIdentityId: string
  listed: unknown
  expectedGeneration: unknown
  expectedPolicyVersion: unknown
}) {
  if (typeof input.listed !== 'boolean'
    || !Number.isSafeInteger(input.expectedGeneration)
    || !Number.isSafeInteger(input.expectedPolicyVersion)) throw new AgentDiscoveryError('invalid')
  const changed = await prisma.agentPublication.updateMany({
    where: {
      agentIdentityId: input.agentIdentityId,
      ownerUserId: input.ownerUserId,
      generation: input.expectedGeneration as number,
      policyVersion: input.expectedPolicyVersion as number,
      status: { not: 'revoked' },
      agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId, status: 'active' },
    },
    data: { plazaListed: input.listed, policyVersion: { increment: 1 } },
  })
  if (changed.count !== 1) throw new AgentDiscoveryError('conflict')
  const publication = await prisma.agentPublication.findUnique({
    where: { agentIdentityId: input.agentIdentityId },
    select: { plazaListed: true, generation: true, policyVersion: true },
  })
  return publication
}
