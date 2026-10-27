// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-onboarding.test.ts

import crypto from 'node:crypto'
import type {
  RoomActivationCapability,
  RoomActivationMode,
  RoomRuntimeAdapter,
} from '@shennian/wire'
import {
  isRoomRuntimeAdapter,
  resolveManagedAgentPermissionPolicy,
  roomRuntimeAgentType,
} from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { createRoomWithOwnerInTransaction, normalizeRoomName } from './room-core.js'
import { hashRoomInviteCapability } from './room-invite-browser.js'
import { allocateRoomDisplayAlias } from './room-display-alias.js'
import {
  assertHumanRoomCapacity,
  buildPendingJoinKey,
  buildRoomPrincipalKey,
  resolveInviteJoinResult,
  RoomPolicyError,
} from './room-policy.js'
import {
  activateHumanMembership,
  appendSystemMessage,
  consumeInviteUse,
  normalizeJoinMessage,
  requireNamedUser,
} from './room-membership.js'
import {
  managedAgentPermissionConfirmationMatches,
  parseManagedAgentRuntimeProtection,
  parseStoredManagedAgentPermissionConfirmation,
  resolveStoredManagedAgentPermissionPolicy,
} from './managed-agent-permission-policy.js'

type AgentSessionInput = {
  bindingIntentId: string
  userId: string
  machineId: string
  nianSessionId: string
  runtimeAdapter: RoomRuntimeAdapter
  sessionRegistryKey: string
  agentAlias: string
  agentDescription?: string
  activationCapability: RoomActivationCapability
  activationMode: RoomActivationMode
}

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,191}$/
const REGISTRY_KEY = /^[a-f0-9]{64}$/
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export async function createRoomFromAgent(input: AgentSessionInput & { name: string }) {
  validateAgentSessionInput(input)
  const name = normalizeRoomName(input.name)
  const agentAlias = normalizeAgentAlias(input.agentAlias)
  const agentDescription = normalizeAgentDescription(input.agentDescription)
  const rawInviteToken = deriveCreateInviteToken(input.bindingIntentId)
  const execute = () =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.roomBinding.findUnique({
          where: { bindingIntentId: input.bindingIntentId },
          include: { room: true, agentIdentity: true, agentMembership: true },
        })
        if (existing) {
          assertExistingCreateBinding(existing, input, name, agentAlias)
          const invite = await tx.roomInvite.findUnique({
            where: { tokenHash: hashRoomInviteCapability(rawInviteToken) },
          })
          if (!invite || invite.roomId !== existing.roomId) {
            throw new RoomPolicyError(
              'room_create_recovery_failed',
              'The Room was created but its invitation could not be recovered.',
            )
          }
          return {
            room: existing.room,
            humanMembership: null,
            agentIdentity: existing.agentIdentity,
            agentMembership: existing.agentMembership!,
            binding: existing,
            invite,
            idempotent: true,
          }
        }

        const session = await requireExactNianSession(tx, input)
        const created = await createRoomWithOwnerInTransaction(tx, {
          userId: input.userId,
          name,
          visibility: 'private',
          joinPolicy: 'open',
        })
        const agentIdentity = await resolveSessionAgentIdentity(
          tx,
          input,
          session,
          agentAlias,
          agentDescription,
        )
        const agentDisplayAlias = await allocateRoomDisplayAlias(tx, created.room.id, agentAlias)
        const agentMembership = await tx.roomMembership.create({
          data: {
            roomId: created.room.id,
            principalType: 'agent',
            principalKey: buildRoomPrincipalKey({
              principalType: 'agent',
              agentIdentityId: agentIdentity.id,
              ownerUserId: input.userId,
              parentHumanMembershipId: created.membership.id,
            }),
            agentIdentityId: agentIdentity.id,
            ownerUserId: input.userId,
            parentHumanMembershipId: created.membership.id,
            displayAlias: agentDisplayAlias,
            role: 'member',
            historyFromSequence: 1,
          },
        })
        await tx.roomReadState.create({
          data: { roomId: created.room.id, membershipId: agentMembership.id },
        })
        const binding = await tx.roomBinding.create({
          data: {
            bindingIntentId: input.bindingIntentId,
            roomId: created.room.id,
            userId: input.userId,
            agentIdentityId: agentIdentity.id,
            agentMembershipId: agentMembership.id,
            nianSessionId: input.nianSessionId,
            machineId: input.machineId,
            runtimeAdapter: input.runtimeAdapter,
            sourceSessionKey: input.sessionRegistryKey,
            bindingMode: 'hook_native',
            activationCapability: input.activationCapability,
            activationMode: input.activationMode,
            status: input.activationMode === 'paused' ? 'paused' : 'active',
          },
        })
        const invite = await tx.roomInvite.create({
          data: {
            roomId: created.room.id,
            tokenHash: hashRoomInviteCapability(rawInviteToken),
            createdByUserId: input.userId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            maxUses: 20,
          },
        })
        return {
          room: created.room,
          humanMembership: created.membership,
          agentIdentity,
          agentMembership,
          binding,
          invite,
          idempotent: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  let result: Awaited<ReturnType<typeof execute>>
  try {
    result = await execute()
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    result = await execute()
  }
  return { ...result, rawInviteToken }
}

export async function joinRoomFromAgent(
  input: AgentSessionInput & { inviteToken: string; message?: string },
) {
  validateAgentSessionInput(input)
  if (!INVITE_TOKEN.test(input.inviteToken)) {
    throw new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.')
  }
  const agentAlias = normalizeAgentAlias(input.agentAlias)
  const agentDescription = normalizeAgentDescription(input.agentDescription)
  const message = normalizeJoinMessage(input.message)
  const execute = () =>
    prisma.$transaction(
      async (tx) => {
        const invite = await tx.roomInvite.findUnique({
          where: { tokenHash: hashRoomInviteCapability(input.inviteToken) },
          include: { room: true },
        })
        if (!invite) throw inviteUnavailable()
        const existingBinding = await tx.roomBinding.findUnique({
          where: { bindingIntentId: input.bindingIntentId },
          include: {
            room: true,
            agentIdentity: true,
            agentMembership: true,
            joinRequest: true,
          },
        })
        if (existingBinding) {
          assertExistingJoinBinding(existingBinding, input, invite.roomId, agentAlias)
          return recoverJoinResult(existingBinding)
        }

        const resolution = resolveInviteJoinResult({
          roomStatus: invite.room.status as 'active' | 'archived' | 'deleted',
          visibility: invite.room.visibility as 'private' | 'public_read',
          joinPolicy: invite.room.joinPolicy as 'open' | 'approval' | 'closed',
          inviteActive: invite.status === 'active',
          inviteExpired: invite.expiresAt != null && invite.expiresAt <= new Date(),
          inviteUseCount: invite.useCount,
          inviteMaxUses: invite.maxUses,
        })
        if (resolution === 'closed') throw inviteUnavailable()
        const session = await requireExactNianSession(tx, input)
        const user = await requireNamedUser(tx, input.userId)
        const existingHuman = await tx.roomMembership.findUnique({
          where: {
            roomId_principalKey: {
              roomId: invite.roomId,
              principalKey: `human:${input.userId}`,
            },
          },
        })
        const existingBySession = await tx.roomBinding.findUnique({
          where: { nianSessionId: input.nianSessionId },
          include: { agentIdentity: true, agentMembership: true },
        })
        const existingBySource = existingBySession
          ? null
          : await tx.roomBinding.findUnique({
              where: {
                machineId_runtimeAdapter_sourceSessionKey: {
                  machineId: input.machineId,
                  runtimeAdapter: input.runtimeAdapter,
                  sourceSessionKey: input.sessionRegistryKey,
                },
              },
              include: { agentIdentity: true, agentMembership: true },
            })
        const detachedBinding = existingBySession ?? existingBySource
        if (detachedBinding) {
          return repairDetachedAgentBinding(tx, {
            input,
            inviteRoom: invite.room,
            humanMembership: existingHuman,
            binding: detachedBinding,
            agentAlias,
          })
        }
        if (existingHuman?.status !== 'active') {
          const activeHumanCount = await tx.roomMembership.count({
            where: { roomId: invite.roomId, principalType: 'human', status: 'active' },
          })
          assertHumanRoomCapacity({
            activeHumanCount,
            maxHumanMembers: invite.room.maxHumanMembers,
          })
        }
        const agentIdentity = await resolveSessionAgentIdentity(
          tx,
          input,
          session,
          agentAlias,
          agentDescription,
        )

        if (existingHuman?.status === 'active') {
          const active = await createActiveAgentBinding(tx, {
            input,
            room: invite.room,
            humanMembership: existingHuman,
            agentIdentity,
          })
          return {
            outcome: 'joined' as const,
            room: invite.room,
            humanMembership: existingHuman,
            agentIdentity,
            ...active,
            joinRequest: null,
            message: null,
            idempotent: false,
          }
        }

        if (resolution === 'pending_approval') {
          const pendingBinding = await tx.roomBinding.create({
            data: {
              bindingIntentId: input.bindingIntentId,
              roomId: invite.roomId,
              userId: input.userId,
              agentIdentityId: agentIdentity.id,
              nianSessionId: input.nianSessionId,
              machineId: input.machineId,
              runtimeAdapter: input.runtimeAdapter,
              sourceSessionKey: input.sessionRegistryKey,
              bindingMode: 'hook_native',
              activationCapability: input.activationCapability,
              activationMode: input.activationMode,
              status: 'pending_approval',
            },
          })
          const pendingKey = buildPendingJoinKey(invite.roomId, input.userId)
          const existingRequest = await tx.roomJoinRequest.findUnique({ where: { pendingKey } })
          if (existingRequest?.pendingBindingId) {
            throw new RoomPolicyError(
              'pending_agent_conflict',
              'Another Agent session is already waiting to join this Room.',
            )
          }
          const joinRequest = existingRequest
            ? await tx.roomJoinRequest.update({
                where: { id: existingRequest.id },
                data: {
                  pendingBindingId: pendingBinding.id,
                  requestedAgentAlias: agentAlias,
                  message: message || existingRequest.message,
                },
              })
            : await tx.roomJoinRequest.create({
                data: {
                  roomId: invite.roomId,
                  inviteId: invite.id,
                  applicantUserId: user.id,
                  pendingKey,
                  pendingBindingId: pendingBinding.id,
                  requestedAgentAlias: agentAlias,
                  message,
                },
              })
          if (!existingRequest) {
            await tx.roomInvite.update({
              where: { id: invite.id },
              data: { requestCount: { increment: 1 } },
            })
          }
          return {
            outcome: 'pending_approval' as const,
            room: invite.room,
            humanMembership: null,
            agentIdentity,
            agentMembership: null,
            binding: pendingBinding,
            joinRequest,
            message: null,
            idempotent: false,
          }
        }

        const humanMembership = await activateHumanMembership(tx, {
          roomId: invite.roomId,
          userId: user.id,
          displayName: user.name.trim(),
          existing: existingHuman,
          historyFromSequence: invite.room.nextSequence + 1n,
          now: new Date(),
        })
        const humanJoinMessage = await appendSystemMessage(tx, {
          roomId: invite.roomId,
          author: humanMembership,
          text: `${humanMembership.displayAlias} joined the Room.`,
          clientMessageId: `system:membership-joined:${humanMembership.id}:${humanMembership.membershipEpoch}`,
        })
        await consumeInviteUse(tx, invite)
        const active = await createActiveAgentBinding(tx, {
          input,
          room: invite.room,
          humanMembership,
          agentIdentity,
        })
        return {
          outcome: 'joined' as const,
          room: invite.room,
          humanMembership,
          agentIdentity,
          ...active,
          joinRequest: null,
          message: humanJoinMessage,
          idempotent: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  try {
    return await execute()
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    return execute()
  }
}

async function repairDetachedAgentBinding(
  tx: Prisma.TransactionClient,
  context: {
    input: AgentSessionInput
    inviteRoom: {
      id: string
      name: string
      status: string
      ownerUserId: string
      maxAgentsPerUser: number
      maxAgentsPerRoom: number
      maxAutoFollowAgents: number
    }
    humanMembership: {
      id: string
      status: string
      userId: string | null
      historyFromSequence: bigint
    } | null
    binding: {
      id: string
      roomId: string
      userId: string
      machineId: string
      nianSessionId: string | null
      runtimeAdapter: string
      sourceSessionKey: string
      status: string
      agentIdentityId: string
      agentMembershipId: string | null
      agentIdentity: { id: string; displayName: string; status?: string }
      agentMembership: { id: string; status: string } | null
    }
    agentAlias: string
  },
) {
  const { input, inviteRoom, humanMembership, binding, agentAlias } = context
  if (
    binding.status !== 'detached' ||
    binding.roomId !== inviteRoom.id ||
    binding.userId !== input.userId ||
    binding.machineId !== input.machineId ||
    binding.nianSessionId !== input.nianSessionId ||
    binding.runtimeAdapter !== input.runtimeAdapter ||
    binding.sourceSessionKey !== input.sessionRegistryKey ||
    binding.agentIdentity.displayName !== agentAlias ||
    binding.agentIdentity.status === 'disabled' ||
    !binding.agentMembership ||
    binding.agentMembershipId !== binding.agentMembership.id
  ) {
    throw new RoomPolicyError(
      'room_binding_repair_conflict',
      'The detached Room binding does not match this exact Agent session.',
    )
  }
  if (
    !humanMembership ||
    humanMembership.status !== 'active' ||
    humanMembership.userId !== input.userId
  ) {
    throw new RoomPolicyError(
      'room_binding_repair_membership_required',
      'Rejoin the Room as a person before repairing this Agent.',
    )
  }

  const agentMembership = await tx.roomMembership.update({
    where: { id: binding.agentMembership.id },
    data: {
      ownerUserId: input.userId,
      parentHumanMembershipId: humanMembership.id,
      status: 'active',
      role: 'member',
      historyFromSequence: humanMembership.historyFromSequence,
      membershipEpoch: { increment: 1 },
      joinedAt: new Date(),
      removedAt: null,
    },
  })
  await tx.roomReadState.upsert({
    where: { membershipId: agentMembership.id },
    create: { roomId: inviteRoom.id, membershipId: agentMembership.id },
    update: {},
  })
  const cursor =
    humanMembership.historyFromSequence > 0n ? humanMembership.historyFromSequence - 1n : 0n
  const repairedBinding = await tx.roomBinding.update({
    where: { id: binding.id },
    data: {
      bindingIntentId: input.bindingIntentId,
      activationCapability: input.activationCapability,
      activationMode: input.activationMode,
      status: input.activationMode === 'paused' ? 'paused' : 'active',
      agentMembershipId: agentMembership.id,
      lastDeliveredSequence: cursor,
      lastActivatedSequence: cursor,
    },
  })
  return {
    outcome: 'joined' as const,
    room: inviteRoom,
    humanMembership,
    agentIdentity: binding.agentIdentity,
    agentMembership,
    binding: repairedBinding,
    joinRequest: null,
    message: null,
    idempotent: false,
    repaired: true as const,
  }
}

export function deriveCreateInviteToken(bindingIntentId: string): string {
  if (!SAFE_ID.test(bindingIntentId)) {
    throw new RoomPolicyError('invalid_binding_intent', 'Invalid Room action intent.')
  }
  const secret =
    process.env.ROOM_CAPABILITY_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me'
  return crypto
    .createHmac('sha256', secret)
    .update(`room-create-invite\0${bindingIntentId}`, 'utf8')
    .digest('base64url')
}

function normalizeAgentAlias(value: string): string {
  const alias = value.trim()
  if (!alias || alias.length > 80 || /[\0\r\n]/.test(alias)) {
    throw new RoomPolicyError(
      'invalid_agent_alias',
      'Choose an Agent name between 1 and 80 characters.',
    )
  }
  return alias
}

function normalizeAgentDescription(value: string | undefined): string {
  const description = value?.trim() ?? ''
  if (!description || description.length > 1000 || /\0/.test(description)) {
    throw new RoomPolicyError('invalid_agent_description', 'Agent description is invalid.')
  }
  return description
}

async function requireExactNianSession(tx: Prisma.TransactionClient, input: AgentSessionInput) {
  const session = await tx.nianSession.findUnique({ where: { id: input.nianSessionId } })
  if (
    !session ||
    session.deletedAt ||
    session.userId !== input.userId ||
    session.machineId !== input.machineId ||
    !runtimeMatchesNianSession(input.runtimeAdapter, session.agentType)
  ) {
    throw new RoomPolicyError(
      'nian_session_mismatch',
      'The exact Shennian Agent session could not be verified.',
    )
  }
  return session
}

async function resolveSessionAgentIdentity(
  tx: Prisma.TransactionClient,
  input: AgentSessionInput,
  session: Awaited<ReturnType<typeof requireExactNianSession>>,
  displayName: string,
  description: string,
) {
  const runtimeAdapter = roomRuntimeAgentType(input.runtimeAdapter)
  if (!runtimeAdapter) {
    throw new RoomPolicyError('invalid_runtime_adapter', 'Unsupported Room runtime adapter.')
  }
  const machine = await tx.machine.findFirst({
    where: { id: input.machineId, userId: input.userId, paired: true },
    select: { agents: true },
  })
  const runtimeInfo = Array.isArray(machine?.agents)
    ? machine.agents.find(
        (item) =>
          item && typeof item === 'object' && (item as { type?: unknown }).type === runtimeAdapter,
      )
    : null
  const protection = parseManagedAgentRuntimeProtection(
    runtimeInfo && typeof runtimeInfo === 'object'
      ? (runtimeInfo as { managedAgentProtection?: unknown }).managedAgentProtection
      : null,
  )
  if (!protection) {
    throw new RoomPolicyError(
      'managed_agent_protection_unavailable',
      'Managed Agent permissions require an updated Shennian daemon.',
    )
  }
  if (protection.level === 'unverified') {
    throw new RoomPolicyError(
      'managed_agent_protection_unavailable',
      'This Agent runtime cannot safely run as a managed Room member on this platform.',
    )
  }
  if (protection.level === 'partial' && !session.agentIdentityId) {
    throw new RoomPolicyError(
      'managed_agent_confirmation_required',
      'Create and confirm this Agent security configuration in the Shennian app before adding it to a Room.',
    )
  }
  if (session.agentIdentityId) {
    const existing = await tx.agentIdentity.findFirst({
      where: {
        id: session.agentIdentityId,
        ownerType: 'user',
        ownerUserId: input.userId,
        status: { not: 'deleted' },
      },
    })
    if (!existing) {
      throw new RoomPolicyError('agent_identity_unavailable', 'The Agent profile is unavailable.')
    }
    if (existing.displayName !== displayName) {
      throw new RoomPolicyError(
        'agent_alias_mismatch',
        'Use the name configured on this Agent profile.',
      )
    }
    const policy = resolveStoredManagedAgentPermissionPolicy(existing)
    const confirmation = parseStoredManagedAgentPermissionConfirmation(
      existing.permissionConfirmation,
    )
    if (
      (policy.fileAccess === 'host-full' || protection.level === 'partial') &&
      !managedAgentPermissionConfirmationMatches({
        confirmation,
        policy,
        runtimeAdapter,
        protection,
      })
    ) {
      throw new RoomPolicyError(
        'managed_agent_confirmation_required',
        'Review and confirm this Agent security configuration in the Shennian app.',
      )
    }
    return existing
  }
  // Implicit profiles can originate from older clients and never expand authority.
  const permissionPolicy = resolveManagedAgentPermissionPolicy(undefined, 'legacy')
  const created = await tx.agentIdentity.create({
    data: {
      ownerType: 'user',
      ownerUserId: input.userId,
      displayName,
      description,
      machineId: input.machineId,
      runtimeAdapter,
      workDir: session.workDir,
      modelId: session.modelId,
      permissionPolicy: permissionPolicy as Prisma.InputJsonValue,
      permissionPolicyVersion: permissionPolicy.version,
      permissionConfirmation: Prisma.JsonNull,
    },
  })
  await tx.nianSession.update({
    where: { id: session.id },
    data: { agentIdentityId: created.id },
  })
  return created
}

function validateAgentSessionInput(input: AgentSessionInput): void {
  for (const value of [input.bindingIntentId, input.userId, input.machineId, input.nianSessionId]) {
    if (!SAFE_ID.test(value)) {
      throw new RoomPolicyError('invalid_agent_session', 'Invalid Agent session context.')
    }
  }
  if (!REGISTRY_KEY.test(input.sessionRegistryKey)) {
    throw new RoomPolicyError('invalid_agent_session', 'Invalid Agent session context.')
  }
  if (!isRoomRuntimeAdapter(input.runtimeAdapter)) {
    throw new RoomPolicyError('invalid_runtime_adapter', 'Unsupported Room runtime adapter.')
  }
  if (!['managed', 'idle_resume', 'notify_only'].includes(input.activationCapability)) {
    throw new RoomPolicyError('invalid_activation_capability', 'Unsupported activation capability.')
  }
  if (!['auto_follow', 'mention_only', 'paused'].includes(input.activationMode)) {
    throw new RoomPolicyError('invalid_activation_mode', 'Unsupported activation mode.')
  }
}

function assertExistingCreateBinding(
  binding: {
    userId: string
    machineId: string
    nianSessionId: string | null
    runtimeAdapter: string
    sourceSessionKey: string
    activationCapability: string
    activationMode: string
    status: string
    room: { name: string }
    agentIdentity: { displayName: string }
    agentMembership: unknown
  },
  input: AgentSessionInput,
  roomName: string,
  agentAlias: string,
): void {
  if (
    binding.userId !== input.userId ||
    binding.machineId !== input.machineId ||
    binding.nianSessionId !== input.nianSessionId ||
    binding.runtimeAdapter !== input.runtimeAdapter ||
    binding.sourceSessionKey !== input.sessionRegistryKey ||
    binding.activationCapability !== input.activationCapability ||
    binding.activationMode !== input.activationMode ||
    binding.status === 'detached' ||
    binding.room.name !== roomName ||
    binding.agentIdentity.displayName !== agentAlias ||
    !binding.agentMembership
  ) {
    throw new RoomPolicyError(
      'room_create_conflict',
      'This Room create action was already used with different parameters.',
    )
  }
}

async function createActiveAgentBinding(
  tx: Prisma.TransactionClient,
  input: {
    input: AgentSessionInput
    room: {
      id: string
      ownerUserId: string
      maxAgentsPerUser: number
      maxAgentsPerRoom: number
      maxAutoFollowAgents: number
    }
    humanMembership: { id: string; historyFromSequence: bigint }
    agentIdentity: { id: string; displayName: string }
  },
) {
  const displayAlias = await allocateRoomDisplayAlias(
    tx,
    input.room.id,
    input.agentIdentity.displayName,
  )
  const agentMembership = await tx.roomMembership.create({
    data: {
      roomId: input.room.id,
      principalType: 'agent',
      principalKey: buildRoomPrincipalKey({
        principalType: 'agent',
        agentIdentityId: input.agentIdentity.id,
        ownerUserId: input.input.userId,
        parentHumanMembershipId: input.humanMembership.id,
      }),
      agentIdentityId: input.agentIdentity.id,
      ownerUserId: input.input.userId,
      parentHumanMembershipId: input.humanMembership.id,
      displayAlias,
      role: 'member',
      historyFromSequence: input.humanMembership.historyFromSequence,
    },
  })
  await tx.roomReadState.create({
    data: {
      roomId: input.room.id,
      membershipId: agentMembership.id,
      lastReadSequence: input.humanMembership.historyFromSequence - 1n,
      lastDeliveredSequence: input.humanMembership.historyFromSequence - 1n,
    },
  })
  const binding = await tx.roomBinding.create({
    data: {
      bindingIntentId: input.input.bindingIntentId,
      roomId: input.room.id,
      userId: input.input.userId,
      agentIdentityId: input.agentIdentity.id,
      agentMembershipId: agentMembership.id,
      nianSessionId: input.input.nianSessionId,
      machineId: input.input.machineId,
      runtimeAdapter: input.input.runtimeAdapter,
      sourceSessionKey: input.input.sessionRegistryKey,
      bindingMode: 'hook_native',
      activationCapability: input.input.activationCapability,
      activationMode: input.input.activationMode,
      status: input.input.activationMode === 'paused' ? 'paused' : 'active',
    },
  })
  return { agentMembership, binding }
}

function assertExistingJoinBinding(
  binding: {
    roomId: string
    userId: string
    machineId: string
    nianSessionId: string | null
    runtimeAdapter: string
    sourceSessionKey: string
    activationCapability: string
    activationMode: string
    status: string
    agentIdentity: { displayName: string }
  },
  input: AgentSessionInput,
  roomId: string,
  agentAlias: string,
): void {
  if (
    binding.roomId !== roomId ||
    binding.userId !== input.userId ||
    binding.machineId !== input.machineId ||
    binding.nianSessionId !== input.nianSessionId ||
    binding.runtimeAdapter !== input.runtimeAdapter ||
    binding.sourceSessionKey !== input.sessionRegistryKey ||
    binding.activationCapability !== input.activationCapability ||
    binding.activationMode !== input.activationMode ||
    binding.status === 'detached' ||
    binding.agentIdentity.displayName !== agentAlias
  ) {
    throw new RoomPolicyError(
      'room_join_conflict',
      'This Room join action was already used with different parameters.',
    )
  }
}

function recoverJoinResult<
  Binding extends {
    id: string
    roomId: string
    agentIdentityId: string
    agentMembershipId: string | null
    status: string
    activationMode: string
    room: { id: string; name: string }
    agentIdentity: { id: string; displayName: string }
    agentMembership: { id: string } | null
    joinRequest: { id: string } | null
  },
>(binding: Binding) {
  if (binding.status === 'pending_approval') {
    if (!binding.joinRequest) {
      throw new RoomPolicyError(
        'room_join_recovery_failed',
        'The pending Room request could not be recovered.',
      )
    }
    return {
      outcome: 'pending_approval' as const,
      room: binding.room,
      humanMembership: null,
      agentIdentity: binding.agentIdentity,
      agentMembership: null,
      binding,
      joinRequest: binding.joinRequest,
      message: null,
      idempotent: true,
    }
  }
  if (!binding.agentMembership) {
    throw new RoomPolicyError(
      'room_join_recovery_failed',
      'The joined Agent membership could not be recovered.',
    )
  }
  return {
    outcome: 'joined' as const,
    room: binding.room,
    humanMembership: null,
    agentIdentity: binding.agentIdentity,
    agentMembership: binding.agentMembership,
    binding,
    joinRequest: null,
    message: null,
    idempotent: true,
  }
}

function inviteUnavailable(): RoomPolicyError {
  return new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.')
}

function runtimeMatchesNianSession(adapter: RoomRuntimeAdapter, agentType: string): boolean {
  return roomRuntimeAgentType(adapter) === agentType
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
