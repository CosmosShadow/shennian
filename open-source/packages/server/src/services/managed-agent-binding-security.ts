// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-actions.test.ts

import { roomRuntimeAgentType } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  managedAgentPermissionConfirmationMatches,
  parseManagedAgentRuntimeProtection,
  parseStoredManagedAgentPermissionConfirmation,
  resolveStoredManagedAgentPermissionPolicy,
} from './managed-agent-permission-policy.js'
import { RoomPolicyError } from './room-policy.js'

const ACTIVE_BINDING_STATUSES = ['active', 'paused'] as const

const SECURITY_INCLUDE = {
  agentIdentity: true,
  machine: { select: { id: true, userId: true, paired: true, agents: true } },
} satisfies Prisma.RoomBindingInclude

type SecurityBindingInput = {
  pendingConfigurationVersion?: number | null
  machineId: string
  runtimeAdapter: string
  agentIdentity: {
    machineId: string | null
    runtimeAdapter: string | null
    ownerUserId: string | null
    permissionPolicy?: unknown
    permissionPolicyVersion?: number
    permissionConfirmation?: unknown
  }
  machine: {
    id: string
    userId: string | null
    paired: boolean
    agents: unknown
  } | null
}

export type ManagedAgentBindingSecurityResult =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | 'machine_unavailable'
        | 'runtime_mismatch'
        | 'runtime_protection_unavailable'
        | 'permission_confirmation_required'
    }

/**
 * Evaluate only server-owned state. A legacy daemon cannot opt an existing Binding
 * out of this check by omitting its protection declaration from an action request.
 */
export function evaluateManagedAgentBindingSecurity(
  binding: SecurityBindingInput,
): ManagedAgentBindingSecurityResult {
  const runtimeAdapter = roomRuntimeAgentType(binding.runtimeAdapter)
  if (
    !runtimeAdapter ||
    (binding.pendingConfigurationVersion == null &&
      (binding.agentIdentity.machineId !== binding.machineId ||
        binding.agentIdentity.runtimeAdapter !== runtimeAdapter))
  ) {
    return { allowed: false, reason: 'runtime_mismatch' }
  }
  if (
    !binding.machine ||
    binding.machine.id !== binding.machineId ||
    binding.machine.userId !== binding.agentIdentity.ownerUserId ||
    !binding.machine.paired
  ) {
    return { allowed: false, reason: 'machine_unavailable' }
  }
  const runtimeInfo = Array.isArray(binding.machine.agents)
    ? binding.machine.agents.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as { type?: unknown }).type === runtimeAdapter,
      )
    : null
  const protection = parseManagedAgentRuntimeProtection(
    runtimeInfo && typeof runtimeInfo === 'object' && !Array.isArray(runtimeInfo)
      ? (runtimeInfo as { managedAgentProtection?: unknown }).managedAgentProtection
      : null,
  )
  const policy = resolveStoredManagedAgentPermissionPolicy(binding.agentIdentity)
  // A replacement is already scheduled at the next idle boundary. The old
  // turn keeps its immutable permission snapshot, while the replacement path
  // validates the complete latest policy before committing.
  if (binding.pendingConfigurationVersion != null) return { allowed: true }
  if (policy.fileAccess === 'host-full' && protection?.executableFingerprint) {
    const confirmation = parseStoredManagedAgentPermissionConfirmation(
      binding.agentIdentity.permissionConfirmation,
    )
    if (
      !managedAgentPermissionConfirmationMatches({
        confirmation,
        policy,
        runtimeAdapter,
        protection,
      })
    ) {
      return { allowed: false, reason: 'permission_confirmation_required' }
    }
  }
  return { allowed: true }
}

/**
 * Fail closed before every daemon-facing Room action. The quarantine is committed
 * in its own serializable transaction before an error is returned, so throwing to
 * the caller cannot roll the state change back.
 */
export async function enforceManagedAgentBindingSecurity(input: {
  roomId: string
  bindingId: string
  userId: string
  machineId: string
}): Promise<void> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const binding = await tx.roomBinding.findUnique({
        where: { id: input.bindingId },
        include: SECURITY_INCLUDE,
      })
      if (
        !binding ||
        binding.roomId !== input.roomId ||
        binding.userId !== input.userId ||
        binding.machineId !== input.machineId ||
        !ACTIVE_BINDING_STATUSES.includes(
          binding.status as (typeof ACTIVE_BINDING_STATUSES)[number],
        )
      ) {
        return { kind: 'unavailable' as const }
      }
      const security = evaluateManagedAgentBindingSecurity(binding)
      if (!('reason' in security)) return { kind: 'allowed' as const }

      await tx.roomBinding.updateMany({
        where: {
          id: binding.id,
          status: { in: [...ACTIVE_BINDING_STATUSES] },
          capabilityEpoch: binding.capabilityEpoch,
        },
        data: {
          status: 'detached',
          activationMode: 'paused',
          detachedReason: 'security_pending',
          recoveryIntentId: null,
          recoveryLeaseUntil: null,
          recoveryErrorCode: security.reason,
          capabilityEpoch: { increment: 1 },
        },
      })
      return { kind: 'security_pending' as const }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  if (outcome.kind === 'allowed') return
  if (outcome.kind === 'security_pending') {
    throw new RoomPolicyError(
      'managed_agent_security_pending',
      'Review this Agent security configuration in the Shennian app before it can continue.',
    )
  }
  throw new RoomPolicyError(
    'room_binding_unavailable',
    'The exact Agent Room binding is unavailable.',
  )
}

/** Validate the target runtime before a detached Binding may be restarted. */
export async function enforceManagedAgentBindingRestartSecurity(input: {
  roomId: string
  bindingId: string
  userId: string
  machineId: string
  agentIdentityId: string
  runtimeAdapter: string
}): Promise<void> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const [binding, machine] = await Promise.all([
        tx.roomBinding.findUnique({
          where: { id: input.bindingId },
          include: { agentIdentity: true },
        }),
        tx.machine.findFirst({
          where: { id: input.machineId, userId: input.userId, paired: true },
          select: { id: true, userId: true, paired: true, agents: true },
        }),
      ])
      if (
        !binding ||
        binding.roomId !== input.roomId ||
        binding.userId !== input.userId ||
        binding.agentIdentityId !== input.agentIdentityId ||
        (binding.status !== 'active' &&
          binding.status !== 'paused' &&
          binding.status !== 'detached')
      ) {
        return { kind: 'unavailable' as const }
      }
      const security = evaluateManagedAgentBindingSecurity({
        machineId: input.machineId,
        runtimeAdapter: input.runtimeAdapter,
        agentIdentity: binding.agentIdentity,
        machine,
      })
      if (!('reason' in security)) return { kind: 'allowed' as const }

      await tx.roomBinding.updateMany({
        where: {
          id: binding.id,
          status: { in: ['active', 'paused', 'detached'] },
          capabilityEpoch: binding.capabilityEpoch,
        },
        data: {
          status: 'detached',
          activationMode: 'paused',
          detachedReason: 'security_pending',
          recoveryIntentId: null,
          recoveryLeaseUntil: null,
          recoveryErrorCode: security.reason,
          capabilityEpoch: { increment: 1 },
        },
      })
      return { kind: 'security_pending' as const }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  if (outcome.kind === 'allowed') return
  if (outcome.kind === 'security_pending') {
    throw new RoomPolicyError(
      'managed_agent_security_pending',
      'Review this Agent security configuration in the Shennian app before it can continue.',
    )
  }
  throw new RoomPolicyError(
    'room_binding_restart_forbidden',
    'This managed Agent conversation cannot be restarted.',
  )
}
