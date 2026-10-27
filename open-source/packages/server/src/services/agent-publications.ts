// @arch open-source/docs/server-runtime.md

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { Prisma } from '../generated/prisma/client.js'
import { publicAgentAvatar } from './agent-avatar.js'
import { managedAgentExecutionMode } from '@shennian/wire'
import { assessPublicAgentRuntime } from './public-agent-runtime-proof.js'
import { resolveStoredManagedAgentPermissionPolicy } from './managed-agent-permission-policy.js'
import { syncCancelledPublishedAiRoomMessages } from './published-ai-room-status.js'

export class AgentPublicationError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid' | 'conflict',
    message: string,
  ) {
    super(message)
  }
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new AgentPublicationError('invalid', 'displayName is required')
  const name = value.trim()
  if (!name || name.length > 80) {
    throw new AgentPublicationError('invalid', 'displayName must be 1–80 characters')
  }
  return name
}

function normalizeDescription(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > 1000) {
    throw new AgentPublicationError('invalid', 'description is invalid')
  }
  return value.trim()
}

function normalizeSuggestedQuestions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 3) {
    throw new AgentPublicationError('invalid', 'suggestedQuestions must contain at most 3 questions')
  }
  const questions = value.map((item) => {
    if (typeof item !== 'string') throw new AgentPublicationError('invalid', 'question is invalid')
    const question = item.trim()
    if (!question || question.length > 80) throw new AgentPublicationError('invalid', 'question is invalid')
    return question
  })
  if (new Set(questions).size !== questions.length) {
    throw new AgentPublicationError('invalid', 'questions must be distinct')
  }
  return questions
}

function publicSuggestedQuestions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeDailyMessageLimit(value: unknown): number {
  if (value === undefined) return 100
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1000) {
    throw new AgentPublicationError('invalid', 'dailyMessageLimit must be 1–1000')
  }
  return Number(value)
}

/** Draft creation never enables visitor execution; its card URL only exposes public profile data. */
export async function createAgentPublicationDraft(input: {
  ownerUserId: string
  agentIdentityId: string
  displayName: unknown
  description?: unknown
  suggestedQuestions?: unknown
  dailyMessageLimit?: unknown
}) {
  const displayName = normalizeName(input.displayName)
  const description = normalizeDescription(input.description)
  const suggestedQuestions = input.suggestedQuestions === undefined
    ? undefined : normalizeSuggestedQuestions(input.suggestedQuestions)
  const dailyMessageLimit = normalizeDailyMessageLimit(input.dailyMessageLimit)
  const agent = await prisma.agentIdentity.findFirst({
    where: {
      id: input.agentIdentityId,
      ownerType: 'user',
      ownerUserId: input.ownerUserId,
      status: 'active',
    },
    select: { id: true },
  })
  if (!agent) throw new AgentPublicationError('not_found', 'Agent not found')

  // The unique agentIdentityId constraint handles concurrent first requests.
  // Upsert is idempotent and deliberately cannot modify a live publication.
  const publication = await prisma.agentPublication.upsert({
    where: { agentIdentityId: agent.id },
    create: {
      agentIdentityId: agent.id,
      ownerUserId: input.ownerUserId,
      publicId: crypto.randomBytes(24).toString('base64url'),
      displayName,
      description,
      ...(suggestedQuestions !== undefined ? { suggestedQuestions } : {}),
      dailyMessageLimit,
      allowNewContacts: true,
      status: 'draft',
    },
    update: {},
  })
  if (publication.ownerUserId !== input.ownerUserId) {
    throw new AgentPublicationError('conflict', 'Publication owner mismatch')
  }
  if (publication.status === 'revoked') {
    // Re-drafting preserves the logical publication and old conversations. The
    // revoke already rotated publicId and generation, so no old URL revives.
    await prisma.agentPublication.updateMany({
      where: {
        id: publication.id,
        ownerUserId: input.ownerUserId,
        status: 'revoked',
        agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId },
      },
      data: {
        status: 'draft', displayName, description,
        ...(suggestedQuestions !== undefined ? { suggestedQuestions } : {}), dailyMessageLimit,
        policyVersion: { increment: 1 }, revokedAt: null,
      },
    })
    // Another device may have re-drafted first. Return its current projection
    // without overwriting that device's edits or activating anything.
    const current = await getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
    if (!current) throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
    return current
  }
  return {
    id: publication.id,
    agentIdentityId: publication.agentIdentityId,
    status: publication.status,
    generation: publication.generation,
    policyVersion: publication.policyVersion,
    publicId: publication.publicId,
    displayName: publication.displayName,
    description: publication.description,
    suggestedQuestions: publicSuggestedQuestions(publication.suggestedQuestions),
    plazaListed: publication.plazaListed,
    allowNewContacts: publication.allowNewContacts,
    requireContactApproval: publication.requireContactApproval,
    allowAnonymousVisitors: publication.allowAnonymousVisitors,
    dailyMessageLimit: publication.dailyMessageLimit,
    messagesUsedToday: publication.quotaDay === new Date().toISOString().slice(0, 10)
      ? publication.quotaUsed : 0,
    updatedAt: publication.updatedAt.toISOString(),
  }
}

export async function getOwnedAgentPublication(ownerUserId: string, agentIdentityId: string) {
  const agent = await prisma.agentIdentity.findFirst({
    where: { id: agentIdentityId, ownerType: 'user', ownerUserId },
    select: { id: true },
  })
  if (!agent) throw new AgentPublicationError('not_found', 'Agent not found')
  const publication = await prisma.agentPublication.findFirst({
    where: { agentIdentityId: agent.id, ownerUserId },
  })
  if (!publication) return null
  return {
    id: publication.id,
    agentIdentityId: publication.agentIdentityId,
    status: publication.status,
    generation: publication.generation,
    policyVersion: publication.policyVersion,
    publicId: publication.publicId,
    displayName: publication.displayName,
    description: publication.description,
    suggestedQuestions: publicSuggestedQuestions(publication.suggestedQuestions),
    plazaListed: publication.plazaListed,
    allowNewContacts: publication.allowNewContacts,
    requireContactApproval: publication.requireContactApproval,
    allowAnonymousVisitors: publication.allowAnonymousVisitors,
    dailyMessageLimit: publication.dailyMessageLimit,
    messagesUsedToday: publication.quotaDay === new Date().toISOString().slice(0, 10)
      ? publication.quotaUsed : 0,
    updatedAt: publication.updatedAt.toISOString(),
  }
}

/** Controls only new contact saves; it does not pause existing conversations. */
export async function setAgentCardContactAdding(input: {
  ownerUserId: string
  agentIdentityId: string
  allowed: unknown
  expectedGeneration: unknown
  expectedPolicyVersion: unknown
}) {
  if (typeof input.allowed !== 'boolean'
    || !Number.isSafeInteger(input.expectedGeneration)
    || !Number.isSafeInteger(input.expectedPolicyVersion)) {
    throw new AgentPublicationError('invalid', 'Invalid card setting')
  }
  const changed = await prisma.agentPublication.updateMany({
    where: {
      agentIdentityId: input.agentIdentityId,
      ownerUserId: input.ownerUserId,
      generation: input.expectedGeneration as number,
      policyVersion: input.expectedPolicyVersion as number,
      status: { not: 'revoked' },
      agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId, status: 'active' },
    },
    data: { allowNewContacts: input.allowed, policyVersion: { increment: 1 } },
  })
  if (changed.count !== 1) throw new AgentPublicationError('conflict', 'Card setting changed')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Anonymous chat is opt-in per link and incompatible with contact approval. */
export async function setAgentPublicationAnonymousAccess(input: {
  ownerUserId: string
  agentIdentityId: string
  allowed: unknown
  expectedGeneration: unknown
  expectedPolicyVersion: unknown
}) {
  if (typeof input.allowed !== 'boolean'
    || !Number.isSafeInteger(input.expectedGeneration)
    || !Number.isSafeInteger(input.expectedPolicyVersion)) {
    throw new AgentPublicationError('invalid', 'Invalid anonymous access setting')
  }
  const changed = await prisma.agentPublication.updateMany({
    where: {
      agentIdentityId: input.agentIdentityId,
      ownerUserId: input.ownerUserId,
      generation: input.expectedGeneration as number,
      policyVersion: input.expectedPolicyVersion as number,
      status: { not: 'revoked' },
      ...(input.allowed ? { requireContactApproval: false } : {}),
      agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId, status: 'active' },
    },
    data: { allowAnonymousVisitors: input.allowed, policyVersion: { increment: 1 } },
  })
  if (changed.count !== 1) throw new AgentPublicationError('conflict', 'Anonymous access setting changed')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Review only changes how new visitors establish a contact, not existing access. */
export async function setAgentCardContactApproval(input: {
  ownerUserId: string
  agentIdentityId: string
  required: unknown
  expectedGeneration: unknown
  expectedPolicyVersion: unknown
}) {
  if (typeof input.required !== 'boolean'
    || !Number.isSafeInteger(input.expectedGeneration)
    || !Number.isSafeInteger(input.expectedPolicyVersion)) {
    throw new AgentPublicationError('invalid', 'Invalid approval setting')
  }
  const changed = await prisma.agentPublication.updateMany({
    where: {
      agentIdentityId: input.agentIdentityId,
      ownerUserId: input.ownerUserId,
      generation: input.expectedGeneration as number,
      policyVersion: input.expectedPolicyVersion as number,
      status: { not: 'revoked' },
      ...(input.required ? { allowAnonymousVisitors: false } : {}),
      agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId, status: 'active' },
    },
    data: { requireContactApproval: input.required, policyVersion: { increment: 1 } },
  })
  if (changed.count !== 1) throw new AgentPublicationError('conflict', 'Approval setting changed')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Owner-only snapshot for the publication confirmation UI; no runtime paths or credentials. */
export async function getOwnedAgentPublicationReadiness(ownerUserId: string, agentIdentityId: string) {
  const agent = await prisma.agentIdentity.findFirst({
    where: { id: agentIdentityId, ownerType: 'user', ownerUserId },
    select: { status: true, sessionMode: true, runtimeAdapter: true,
      permissionPolicy: true, permissionPolicyVersion: true, permissionConfirmation: true,
      machine: { select: { userId: true, paired: true, online: true, agents: true } } },
  })
  if (!agent) throw new AgentPublicationError('not_found', 'Agent not found')
  const machine = agent.machine
  const runtime = assessPublicAgentRuntime(machine?.agents, agent.runtimeAdapter,
    resolveStoredManagedAgentPermissionPolicy(agent), agent.permissionConfirmation)
  const executionMode = managedAgentExecutionMode(resolveStoredManagedAgentPermissionPolicy(agent))
  const blockers: string[] = []
  if (agent.status !== 'active') blockers.push('agent_unavailable')
  if (agent.sessionMode !== 'standard') blockers.push('agent_mode_unavailable')
  if (!machine?.paired || machine.userId !== ownerUserId) blockers.push('machine_unavailable')
  // Sharing is persisted Owner consent, not a second runtime admission check.
  // Keep live diagnostics separate so old clients using activationAvailable
  // can also share an offline or not-yet-reported runtime.
  const activationAvailable = blockers.length === 0
  if (machine?.paired && machine.userId === ownerUserId && !machine.online) {
    blockers.push('machine_offline')
  }
  blockers.push(...runtime.blockers)
  return {
    machineOnline: machine?.paired === true && machine.userId === ownerUserId
      && machine.online === true,
    runtimeAdapter: agent.runtimeAdapter,
    executionMode,
    runtimeVersion: runtime.runtimeVersion,
    runtimePlatform: runtime.runtimePlatform,
    protectionLevel: runtime.protectionLevel,
    authState: runtime.authState,
    runtimeEligible: blockers.length === 0,
    blockers,
    activationAvailable,
  }
}

/** Sharing records Owner consent; availability is evaluated when a visitor turn runs. */
export async function activateAgentPublication(input: {
  ownerUserId: string
  agentIdentityId: string
  expectedGeneration: number
  expectedPolicyVersion: number
}) {
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1
    || !Number.isSafeInteger(input.expectedPolicyVersion) || input.expectedPolicyVersion < 1) {
    throw new AgentPublicationError('invalid', 'Publication version is invalid')
  }
  const candidate = await prisma.agentIdentity.findFirst({
    where: { id: input.agentIdentityId, ownerType: 'user', ownerUserId: input.ownerUserId },
    select: { machineId: true },
  })
  const machineId = candidate?.machineId
  if (!machineId) throw new AgentPublicationError('conflict', 'Agent machine is unavailable')
  const changed = await prisma.$transaction(async (tx) => {
    // Capability reports lock Machine before publication; use the same order.
    await tx.$queryRaw`SELECT id FROM Machine WHERE id = ${machineId} FOR UPDATE`
    const machine = await tx.machine.findUnique({ where: { id: machineId },
      select: { userId: true, paired: true } })
    const publicationId = await tx.agentPublication.findUnique({
      where: { agentIdentityId: input.agentIdentityId },
      select: { id: true },
    })
    if (!publicationId) throw new AgentPublicationError('not_found', 'Publication not found')
    await tx.$queryRaw`SELECT id FROM AgentPublication WHERE id = ${publicationId.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${input.agentIdentityId} FOR UPDATE`
    const publication = await tx.agentPublication.findUnique({
      where: { id: publicationId.id },
      select: { id: true, ownerUserId: true, status: true,
        generation: true, policyVersion: true },
    })
    const agent = await tx.agentIdentity.findUnique({ where: { id: input.agentIdentityId },
      select: { ownerType: true, ownerUserId: true, status: true, machineId: true,
        sessionMode: true } })
    if (!machine || machine.userId !== input.ownerUserId || !machine.paired
      || !agent || agent.ownerType !== 'user' || agent.ownerUserId !== input.ownerUserId
      || agent.status !== 'active' || agent.machineId !== machineId
      || agent.sessionMode !== 'standard') {
      throw new AgentPublicationError('conflict', 'Agent or paired machine is unavailable')
    }
    if (!publication || publication.ownerUserId !== input.ownerUserId
      || publication.generation !== input.expectedGeneration
      || publication.policyVersion !== input.expectedPolicyVersion
      || !['draft', 'paused'].includes(publication.status)) {
      throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
    }
    return tx.agentPublication.updateMany({
      where: { id: publication.id, ownerUserId: input.ownerUserId,
        generation: input.expectedGeneration, policyVersion: input.expectedPolicyVersion,
        status: { in: ['draft', 'paused'] } },
      data: { status: 'active', policyVersion: { increment: 1 } },
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (changed.count !== 1) throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Owner edits are conditional so a stale device cannot overwrite a newer state. */
export async function updateAgentPublicationDetails(input: {
  ownerUserId: string
  agentIdentityId: string
  expectedGeneration: number
  expectedPolicyVersion: number
  displayName: unknown
  description?: unknown
  suggestedQuestions?: unknown
  dailyMessageLimit?: unknown
}) {
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1) {
    throw new AgentPublicationError('invalid', 'expectedGeneration is invalid')
  }
  if (!Number.isSafeInteger(input.expectedPolicyVersion) || input.expectedPolicyVersion < 1) {
    throw new AgentPublicationError('invalid', 'expectedPolicyVersion is invalid')
  }
  const displayName = normalizeName(input.displayName)
  const description = normalizeDescription(input.description)
  const suggestedQuestions = input.suggestedQuestions === undefined
    ? undefined : normalizeSuggestedQuestions(input.suggestedQuestions)
  const dailyMessageLimit = normalizeDailyMessageLimit(input.dailyMessageLimit)
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.agentPublication.findFirst({
      where: { agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
        generation: input.expectedGeneration, policyVersion: input.expectedPolicyVersion },
      select: { dailyMessageLimit: true },
    })
    const presentationOnly = current?.dailyMessageLimit === dailyMessageLimit
    const changed = await tx.agentPublication.updateMany({
      where: {
        agentIdentityId: input.agentIdentityId,
        ownerUserId: input.ownerUserId,
        generation: input.expectedGeneration,
        policyVersion: input.expectedPolicyVersion,
        status: { in: ['draft', 'active', 'paused'] },
        agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId },
      },
      data: { displayName, description,
        ...(suggestedQuestions !== undefined ? { suggestedQuestions } : {}),
        dailyMessageLimit, policyVersion: { increment: 1 } },
    })
    if (changed.count === 1) {
      await tx.room.updateMany({
        where: { conversationKind: 'published_ai', legacyDirectConversation: {
          is: { agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId },
        } },
        data: { name: displayName },
      })
      if (presentationOnly) {
        // Keep optimistic edit versions, but carry valid in-flight leases and
        // their bindings forward when only public presentation has changed.
        await tx.agentDirectMessage.updateMany({
          where: { authorRole: 'visitor', status: { in: ['pending', 'running'] },
            publicationGeneration: input.expectedGeneration,
            policyVersion: input.expectedPolicyVersion,
            conversation: { agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId } },
          data: { policyVersion: input.expectedPolicyVersion + 1 },
        })
        await tx.agentDirectBinding.updateMany({
          where: { appliedPolicyVersion: input.expectedPolicyVersion,
            conversation: { agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId } },
          data: { appliedPolicyVersion: input.expectedPolicyVersion + 1 },
        })
      } else {
        await tx.agentDirectMessage.updateMany({
          where: { status: { in: ['pending', 'running'] }, conversation: {
            agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
          } },
          data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
        })
        await syncCancelledPublishedAiRoomMessages(tx, {
          agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
        })
      }
    }
    return changed
  })
  if (result.count !== 1) throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Revocation rotates the bearer URL atomically; historical conversations remain. */
export async function revokeAgentPublication(input: {
  ownerUserId: string
  agentIdentityId: string
  expectedGeneration: number
}) {
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1) {
    throw new AgentPublicationError('invalid', 'expectedGeneration is invalid')
  }
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.agentPublication.updateMany({
      where: {
        agentIdentityId: input.agentIdentityId,
        ownerUserId: input.ownerUserId,
        generation: input.expectedGeneration,
        status: { in: ['draft', 'active', 'paused'] },
        agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId },
      },
      data: {
        status: 'revoked',
        plazaListed: false,
        publicId: crypto.randomBytes(24).toString('base64url'),
        generation: { increment: 1 },
        revokedAt: new Date(),
      },
    })
    if (changed.count === 1) {
      await tx.agentDirectMessage.updateMany({
      where: { status: { in: ['pending', 'running'] }, conversation: {
        agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
      } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, {
        agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
      })
    }
    return changed
  })
  if (result.count !== 1) throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Pausing immediately stops new visitor messages; resumption needs runtime attestation. */
export async function pauseAgentPublication(input: {
  ownerUserId: string
  agentIdentityId: string
  expectedGeneration: number
  expectedPolicyVersion: number
}) {
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1
    || !Number.isSafeInteger(input.expectedPolicyVersion) || input.expectedPolicyVersion < 1) {
    throw new AgentPublicationError('invalid', 'Publication version is invalid')
  }
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.agentPublication.updateMany({
      where: {
        agentIdentityId: input.agentIdentityId,
        ownerUserId: input.ownerUserId,
        generation: input.expectedGeneration,
        policyVersion: input.expectedPolicyVersion,
        status: 'active',
        agentIdentity: { ownerType: 'user', ownerUserId: input.ownerUserId },
      },
      data: { status: 'paused', policyVersion: { increment: 1 } },
    })
    if (changed.count === 1) {
      await tx.agentDirectMessage.updateMany({
      where: { status: { in: ['pending', 'running'] }, conversation: {
        agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
      } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, {
        agentIdentityId: input.agentIdentityId, ownerUserId: input.ownerUserId,
      })
    }
    return changed
  })
  if (result.count !== 1) throw new AgentPublicationError('conflict', 'Publication changed or unavailable')
  return getOwnedAgentPublication(input.ownerUserId, input.agentIdentityId)
}

/** Public lookup intentionally returns no runtime config, Prompt, owner ID or visitor data. */
export async function getPublicAgentPublication(publicId: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(publicId)) return null
  const publication = await prisma.agentPublication.findUnique({
    where: { publicId },
    select: {
      publicId: true,
      status: true,
      allowNewContacts: true,
      requireContactApproval: true,
      allowAnonymousVisitors: true,
      displayName: true,
      description: true,
      suggestedQuestions: true,
      ownerUserId: true,
      agentIdentity: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true,
        status: true, ownerUserId: true,
        machine: { select: { paired: true, online: true } } } },
    },
  })
  if (!publication || publication.status === 'revoked'
    || publication.agentIdentity.ownerUserId !== publication.ownerUserId) return null
  return {
    publicId: publication.publicId,
    status: publication.agentIdentity.status === 'active' && publication.status !== 'draft'
      ? publication.status : 'unavailable',
    allowNewContacts: publication.allowNewContacts,
    requireContactApproval: publication.requireContactApproval,
    allowAnonymousVisitors: publication.allowAnonymousVisitors,
    machineOnline: publication.agentIdentity.machine?.paired === true
      && publication.agentIdentity.machine.online === true,
    displayName: publication.displayName,
    description: publication.description,
    suggestedQuestions: publicSuggestedQuestions(publication.suggestedQuestions),
    avatar: publicAgentAvatar(publication.agentIdentity),
    creatorCanReadConversation: true,
  }
}
