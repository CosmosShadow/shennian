// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-binding.test.ts

import type {
  RoomActivationCapability,
  RoomActivationMode,
  RoomRuntimeAdapter,
} from '@shennian/wire'
import { isRoomRuntimeAdapter, roomRuntimeAgentType } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { buildRoomPrincipalKey, RoomPolicyError } from './room-policy.js'
import { allocateRoomDisplayAlias } from './room-display-alias.js'
import { commitExclusiveRoomSessionDeletions } from './room-session-cleanup.js'
import { agentRoomRecoveryCreationKey } from './agent-room-recovery-intent.js'
import { enforceManagedAgentBindingRestartSecurity } from './managed-agent-binding-security.js'
import { appendSystemMessage } from './room-membership.js'
import { roomAgentJoinedSystemText } from './room-agent-system-messages.js'

type CreateRoomBindingInput = {
  bindingIntentId: string
  roomId: string
  userId: string
  machineId: string
  agentIdentityId: string
  nianSessionId: string
  runtimeAdapter: RoomRuntimeAdapter
  sessionRegistryKey: string
  activationCapability: RoomActivationCapability
  activationMode?: RoomActivationMode
}

type RestartRoomBindingSessionInput = {
  roomId: string
  bindingId: string
  userId: string
  machineId: string
  agentIdentityId: string
  previousNianSessionId: string
  nianSessionId: string
  runtimeAdapter: RoomRuntimeAdapter
  sessionRegistryKey: string
}

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,191}$/
const REGISTRY_KEY = /^[a-f0-9]{64}$/
const ACTIVATION_CAPABILITIES = new Set<RoomActivationCapability>([
  'managed',
  'idle_resume',
  'notify_only',
])
const ACTIVATION_MODES = new Set<RoomActivationMode>(['auto_follow', 'mention_only', 'paused'])

export async function createRoomBindingAtomic(input: CreateRoomBindingInput) {
  validateInput(input)

  const execute = () =>
    prisma.$transaction(
      async (tx) => {
        const byIntent = await tx.roomBinding.findUnique({
          where: { bindingIntentId: input.bindingIntentId },
        })
        if (byIntent) return assertIdempotentBinding(byIntent, input)

        const byNativeSession = await tx.roomBinding.findUnique({
          where: {
            machineId_runtimeAdapter_sourceSessionKey: {
              machineId: input.machineId,
              runtimeAdapter: input.runtimeAdapter,
              sourceSessionKey: input.sessionRegistryKey,
            },
          },
        })
        if (byNativeSession) return assertIdempotentBinding(byNativeSession, input)

        const [room, humanMembership, agentIdentity, nianSession, machine] = await Promise.all([
          tx.room.findUnique({ where: { id: input.roomId } }),
          tx.roomMembership.findUnique({
            where: {
              roomId_principalKey: {
                roomId: input.roomId,
                principalKey: `human:${input.userId}`,
              },
            },
          }),
          tx.agentIdentity.findUnique({ where: { id: input.agentIdentityId } }),
          tx.nianSession.findUnique({ where: { id: input.nianSessionId } }),
          tx.machine.findFirst({
            where: { id: input.machineId, userId: input.userId, paired: true },
            select: { id: true },
          }),
        ])
        if (!room || room.status !== 'active') {
          throw new RoomPolicyError('room_not_found', 'Active Room not found.')
        }
        if (
          !humanMembership ||
          humanMembership.status !== 'active' ||
          humanMembership.userId !== input.userId
        ) {
          throw new RoomPolicyError(
            'room_membership_required',
            'Join the Room as a person before binding an Agent.',
          )
        }
        if (
          !agentIdentity ||
          agentIdentity.status !== 'active' ||
          agentIdentity.ownerType !== 'user' ||
          agentIdentity.ownerUserId !== input.userId
        ) {
          throw new RoomPolicyError(
            'agent_identity_forbidden',
            'Agent identity is not owned by this user.',
          )
        }
        if (
          !machine ||
          !nianSession ||
          nianSession.deletedAt ||
          nianSession.userId !== input.userId ||
          nianSession.machineId !== input.machineId ||
          nianSession.agentIdentityId !== input.agentIdentityId ||
          !runtimeMatchesNianSession(input.runtimeAdapter, nianSession.agentType)
        ) {
          throw new RoomPolicyError(
            'nian_session_mismatch',
            'The exact Shennian Agent session could not be verified.',
          )
        }

        const principalKey = buildRoomPrincipalKey({
          principalType: 'agent',
          agentIdentityId: agentIdentity.id,
          ownerUserId: input.userId,
          parentHumanMembershipId: humanMembership.id,
        })
        const existingMembership = await tx.roomMembership.findUnique({
          where: { roomId_principalKey: { roomId: input.roomId, principalKey } },
        })
        const existingMembershipBinding = existingMembership
          ? await tx.roomBinding.findUnique({
              where: { agentMembershipId: existingMembership.id },
            })
          : null
        if (existingMembershipBinding && existingMembershipBinding.status !== 'detached') {
          return assertIdempotentBinding(existingMembershipBinding, input)
        }
        if (
          existingMembershipBinding &&
          (existingMembershipBinding.roomId !== input.roomId ||
            existingMembershipBinding.userId !== input.userId ||
            existingMembershipBinding.agentIdentityId !== input.agentIdentityId ||
            existingMembershipBinding.agentMembershipId !== existingMembership?.id)
        ) {
          throw new RoomPolicyError(
            'room_binding_conflict',
            'The detached Agent membership belongs to another Room binding.',
          )
        }

        const activationMode = resolveInitialRoomAgentActivationMode({
          requestedMode: input.activationMode,
        })
        const displayAlias = existingMembership
          ? null
          : await allocateRoomDisplayAlias(tx, input.roomId, agentIdentity.displayName)
        const agentMembership = existingMembership
          ? await tx.roomMembership.update({
              where: { id: existingMembership.id },
              data: {
                ownerUserId: input.userId,
                parentHumanMembershipId: humanMembership.id,
                status: 'active',
                role: 'member',
                historyFromSequence: existingMembershipBinding
                  ? room.nextSequence + 1n
                  : humanMembership.historyFromSequence,
                membershipEpoch: { increment: 1 },
                joinedAt: new Date(),
                removedAt: null,
              },
            })
          : await tx.roomMembership.create({
              data: {
                roomId: input.roomId,
                principalType: 'agent',
                principalKey,
                agentIdentityId: agentIdentity.id,
                ownerUserId: input.userId,
                parentHumanMembershipId: humanMembership.id,
                displayAlias: displayAlias!,
                role: 'member',
                historyFromSequence: humanMembership.historyFromSequence,
              },
            })
        await tx.roomReadState.upsert({
          where: { membershipId: agentMembership.id },
          create: { roomId: input.roomId, membershipId: agentMembership.id },
          update: {},
        })
        const message = await appendSystemMessage(tx, {
          roomId: input.roomId,
          author: agentMembership,
          text: roomAgentJoinedSystemText(agentMembership.displayAlias, activationMode),
          clientMessageId: `system:membership-joined:${agentMembership.id}:${agentMembership.membershipEpoch}`,
        })
        const bindingData = {
          bindingIntentId: input.bindingIntentId,
          roomId: input.roomId,
          userId: input.userId,
          agentIdentityId: agentIdentity.id,
          agentMembershipId: agentMembership.id,
          nianSessionId: nianSession.id,
          machineId: input.machineId,
          runtimeAdapter: input.runtimeAdapter,
          // Compatibility column: only the irreversible registry key leaves the daemon.
          sourceSessionKey: input.sessionRegistryKey,
          bindingMode: 'hook_native' as const,
          activationCapability: input.activationCapability,
          activationMode,
          status: activationMode === 'paused' ? ('paused' as const) : ('active' as const),
          appliedConfigurationVersion: agentIdentity.configurationVersion,
          pendingConfigurationVersion: null,
          // A newly added Agent may read earlier Room context, but historical
          // messages must never become fresh commands. Start after its own
          // joined-system message, which is committed in this transaction.
          lastDeliveredSequence: message.sequence,
          lastActivatedSequence: message.sequence,
        }
        const binding = existingMembershipBinding
          ? await tx.roomBinding.update({
              where: { id: existingMembershipBinding.id },
              data: {
                ...bindingData,
                detachedReason: null,
                recoveryIntentId: null,
                recoveryLeaseUntil: null,
                recoveryErrorCode: null,
              },
            })
          : await tx.roomBinding.create({ data: bindingData })
        return {
          binding,
          agentMembership,
          message,
          resumeSequence: message.sequence.toString(),
          idempotent: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

  try {
    return await execute()
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const recovered = await prisma.roomBinding.findFirst({
      where: {
        OR: [
          { bindingIntentId: input.bindingIntentId },
          {
            machineId: input.machineId,
            runtimeAdapter: input.runtimeAdapter,
            sourceSessionKey: input.sessionRegistryKey,
          },
          { nianSessionId: input.nianSessionId },
        ],
      },
      include: { agentMembership: true },
    })
    if (!recovered) throw error
    return assertIdempotentBinding(recovered, input)
  }
}

export async function restartRoomBindingSession(input: RestartRoomBindingSessionInput) {
  for (const [field, value] of Object.entries({
    room_id: input.roomId,
    binding_id: input.bindingId,
    user_id: input.userId,
    machine_id: input.machineId,
    agent_identity_id: input.agentIdentityId,
    previous_nian_session_id: input.previousNianSessionId,
    nian_session_id: input.nianSessionId,
  })) {
    if (!SAFE_ID.test(value)) throw new RoomPolicyError(`invalid_${field}`, `Invalid ${field}.`)
  }
  if (!REGISTRY_KEY.test(input.sessionRegistryKey)) {
    throw new RoomPolicyError('invalid_session_registry_key', 'Invalid Agent session registry key.')
  }
  if (!isRoomRuntimeAdapter(input.runtimeAdapter)) {
    throw new RoomPolicyError('invalid_runtime_adapter', 'Invalid Agent runtime adapter.')
  }

  await enforceManagedAgentBindingRestartSecurity(input)

  return prisma.$transaction(
    async (tx) => {
      const [binding, nextSession, machine] = await Promise.all([
        tx.roomBinding.findUnique({
          where: { id: input.bindingId },
          include: { room: true, agentMembership: true },
        }),
        tx.nianSession.findUnique({ where: { id: input.nianSessionId } }),
        tx.machine.findFirst({
          where: { id: input.machineId, userId: input.userId, paired: true },
          select: { id: true },
        }),
      ])
      if (
        !machine ||
        !binding ||
        binding.roomId !== input.roomId ||
        binding.userId !== input.userId ||
        binding.agentIdentityId !== input.agentIdentityId ||
        binding.room.status !== 'active' ||
        !binding.agentMembership ||
        binding.agentMembership.status !== 'active' ||
        (binding.status !== 'active' &&
          binding.status !== 'paused' &&
          binding.status !== 'detached') ||
        binding.activationCapability !== 'managed'
      ) {
        throw new RoomPolicyError(
          'room_binding_restart_forbidden',
          'This managed Agent conversation cannot be restarted.',
        )
      }
      if (binding.nianSessionId === input.nianSessionId) {
        if (binding.status === 'detached') {
          throw new RoomPolicyError(
            'room_binding_restart_conflict',
            'The managed Agent conversation was detached again before restart completed.',
          )
        }
        return {
          binding,
          // Preserve the committed boundary on retries; newer messages must remain eligible.
          resumeSequence: binding.lastActivatedSequence.toString(),
          committedSessionDeletions: [],
          idempotent: true,
        }
      }
      if (binding.nianSessionId !== input.previousNianSessionId) {
        throw new RoomPolicyError(
          'room_binding_restart_conflict',
          'The managed Agent conversation changed before restart completed.',
        )
      }
      if (
        !nextSession ||
        nextSession.deletedAt ||
        nextSession.userId !== input.userId ||
        nextSession.machineId !== input.machineId ||
        nextSession.agentIdentityId !== input.agentIdentityId ||
        !runtimeMatchesNianSession(input.runtimeAdapter, nextSession.agentType)
      ) {
        throw new RoomPolicyError(
          'nian_session_mismatch',
          'The replacement Shennian Agent session could not be verified.',
        )
      }
      if (
        binding.status === 'detached' &&
        binding.recoveryIntentId &&
        nextSession.creationKey !==
          agentRoomRecoveryCreationKey({
            userId: input.userId,
            agentIdentityId: input.agentIdentityId,
            bindingId: input.bindingId,
            recoveryIntentId: binding.recoveryIntentId,
          })
      ) {
        throw new RoomPolicyError(
          'room_binding_restart_conflict',
          'The Agent recovery intent changed before restart completed.',
        )
      }
      const occupied = await tx.roomBinding.findFirst({
        where: {
          id: { not: binding.id },
          OR: [
            { nianSessionId: input.nianSessionId },
            {
              machineId: input.machineId,
              runtimeAdapter: input.runtimeAdapter,
              sourceSessionKey: input.sessionRegistryKey,
            },
          ],
        },
        select: { id: true },
      })
      if (occupied) {
        throw new RoomPolicyError(
          'room_binding_restart_conflict',
          'The replacement Agent conversation is already bound.',
        )
      }
      // Replacing a Session starts a new conversation, including configuration
      // changes. Historical messages remain readable context, never new commands.
      // Capture the tail in the binding-swap transaction so only later messages
      // can activate the replacement. Reconnecting the same Session is separate.
      const resumeSequence = binding.room.nextSequence
      const updated = await tx.roomBinding.update({
        where: { id: binding.id },
        data: {
          nianSessionId: input.nianSessionId,
          machineId: input.machineId,
          runtimeAdapter: input.runtimeAdapter,
          sourceSessionKey: input.sessionRegistryKey,
          lastDeliveredSequence: resumeSequence,
          lastActivatedSequence: resumeSequence,
          status: binding.activationMode === 'paused' ? 'paused' : 'active',
          detachedReason: null,
          recoveryIntentId: null,
          recoveryLeaseUntil: null,
          recoveryErrorCode: null,
          appliedConfigurationVersion:
            binding.pendingConfigurationVersion ?? binding.appliedConfigurationVersion,
          pendingConfigurationVersion: null,
        },
        include: { room: true, agentMembership: true },
      })
      const committedSessionDeletions = await commitExclusiveRoomSessionDeletions(tx, [
        { sessionId: input.previousNianSessionId, userId: input.userId },
      ])
      return {
        binding: updated,
        resumeSequence: resumeSequence.toString(),
        committedSessionDeletions,
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export function resolveInitialRoomAgentActivationMode({
  requestedMode,
}: {
  requestedMode?: RoomActivationMode
}): RoomActivationMode {
  return requestedMode ?? 'auto_follow'
}

function assertIdempotentBinding<
  Binding extends {
    id: string
    roomId: string
    userId: string
    agentIdentityId: string
    nianSessionId: string | null
    machineId: string
    runtimeAdapter: string
    sourceSessionKey: string
    status: string
    agentMembershipId: string | null
    activationCapability: string
    activationMode: string
    lastActivatedSequence: bigint
  },
>(binding: Binding, input: CreateRoomBindingInput) {
  const hasExplicitMode = Boolean(input.activationMode)
  if (
    binding.roomId !== input.roomId ||
    binding.userId !== input.userId ||
    binding.agentIdentityId !== input.agentIdentityId ||
    binding.nianSessionId !== input.nianSessionId ||
    binding.machineId !== input.machineId ||
    binding.runtimeAdapter !== input.runtimeAdapter ||
    binding.sourceSessionKey !== input.sessionRegistryKey ||
    binding.activationCapability !== input.activationCapability ||
    (hasExplicitMode && binding.activationMode !== input.activationMode) ||
    binding.status === 'detached'
  ) {
    throw new RoomPolicyError(
      'room_binding_conflict',
      'This Agent session is already bound differently.',
    )
  }
  return {
    binding,
    agentMembership: 'agentMembership' in binding ? binding.agentMembership : null,
    message: null,
    resumeSequence: binding.lastActivatedSequence.toString(),
    idempotent: true,
  }
}

function runtimeMatchesNianSession(adapter: RoomRuntimeAdapter, agentType: string): boolean {
  return roomRuntimeAgentType(adapter) === agentType
}

function validateInput(input: CreateRoomBindingInput): void {
  for (const [field, value] of Object.entries({
    binding_intent_id: input.bindingIntentId,
    room_id: input.roomId,
    user_id: input.userId,
    machine_id: input.machineId,
    agent_identity_id: input.agentIdentityId,
    nian_session_id: input.nianSessionId,
  })) {
    if (!SAFE_ID.test(value)) throw new RoomPolicyError(`invalid_${field}`, `Invalid ${field}.`)
  }
  if (!REGISTRY_KEY.test(input.sessionRegistryKey)) {
    throw new RoomPolicyError('invalid_session_registry_key', 'Invalid Agent session registry key.')
  }
  if (!isRoomRuntimeAdapter(input.runtimeAdapter)) {
    throw new RoomPolicyError('invalid_runtime_adapter', 'Unsupported Room runtime adapter.')
  }
  if (!ACTIVATION_CAPABILITIES.has(input.activationCapability)) {
    throw new RoomPolicyError(
      'invalid_activation_capability',
      'Unsupported Agent activation capability.',
    )
  }
  if (input.activationMode && !ACTIVATION_MODES.has(input.activationMode)) {
    throw new RoomPolicyError('invalid_activation_mode', 'Unsupported Agent activation mode.')
  }
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
