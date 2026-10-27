// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-room-recovery.test.ts

import { randomUUID } from 'node:crypto'
import type { AgentType } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'
import { broadcastRoomEvent } from './room-events.js'
import { createSessionForUser, deleteSessionForUser } from './sessions.js'
import { agentRoomRecoveryCreationKey } from './agent-room-recovery-intent.js'
import { evaluateManagedAgentBindingSecurity } from './managed-agent-binding-security.js'

const runningBindings = new Set<string>()
const RECOVERY_LEASE_MS = 5 * 60_000
const ELIGIBLE_REASONS = [
  'runtime_reconfigured',
  'recovery_requested',
  'recovering',
]
const RECOVERY_INCLUDE = {
  agentIdentity: {
    include: {
      machine: {
        select: {
          id: true,
          paired: true,
          online: true,
          daemonInstallationId: true,
          userId: true,
          agents: true,
        },
      },
    },
  },
} satisfies Prisma.RoomBindingInclude
type RecoveryBinding = Prisma.RoomBindingGetPayload<{ include: typeof RECOVERY_INCLUDE }>

export type AgentRoomRecoveryReport = {
  attempted: number
  recovered: number
  failed: number
  waiting: number
}

export async function requestAgentRoomRecovery(agentId: string, userId: string): Promise<void> {
  const bindings = await prisma.roomBinding.findMany({
    where: {
      agentIdentityId: agentId,
      userId,
      status: 'detached',
      NOT: { detachedReason: 'machine_removed' },
      room: { status: 'active' },
      agentMembership: { status: 'active' },
    },
    select: { id: true, recoveryIntentId: true },
  })
  await Promise.all(
    bindings.map((binding) =>
      prisma.roomBinding.updateMany({
        where: {
          id: binding.id,
          status: 'detached',
          NOT: { detachedReason: 'machine_removed' },
          agentMembership: { status: 'active' },
        },
        data: {
          detachedReason: 'recovery_requested',
          recoveryIntentId: binding.recoveryIntentId ?? randomUUID(),
          recoveryLeaseUntil: null,
          recoveryErrorCode: null,
        },
      }),
    ),
  )
  await reconcileAgentRoomBindings({ agentId, userId })
}

export async function reconcileAgentRoomBindings(input: {
  agentId: string
  userId?: string
}): Promise<AgentRoomRecoveryReport> {
  const bindings = await prisma.roomBinding.findMany({
    where: {
      agentIdentityId: input.agentId,
      ...(input.userId ? { userId: input.userId } : {}),
      status: { in: ['active', 'paused', 'detached'] },
      detachedReason: { in: ELIGIBLE_REASONS },
      recoveryIntentId: { not: null },
      activationCapability: 'managed',
      room: { status: 'active' },
      agentMembership: { status: 'active' },
      agentIdentity: { status: 'active' },
    },
    include: RECOVERY_INCLUDE,
    orderBy: { updatedAt: 'asc' },
  })

  const report: AgentRoomRecoveryReport = {
    attempted: 0,
    recovered: 0,
    failed: 0,
    waiting: 0,
  }
  for (const binding of bindings) {
    const key = `${binding.id}:${binding.recoveryIntentId ?? ''}`
    if (runningBindings.has(key)) continue
    const machine = binding.agentIdentity.machine
    if (
      !binding.recoveryIntentId ||
      !machine?.paired ||
      !machine.online ||
      !machine.daemonInstallationId ||
      !binding.nianSessionId
    ) {
      report.waiting += 1
      continue
    }
    runningBindings.add(key)
    report.attempted += 1
    try {
      const recovered = await recoverOneBinding(binding)
      if (recovered) report.recovered += 1
    } catch (error) {
      report.failed += 1
      await markRecoveryFailure(binding.id, binding.roomId, binding.recoveryIntentId, error)
    } finally {
      runningBindings.delete(key)
    }
  }
  return report
}

async function recoverOneBinding(binding: RecoveryBinding): Promise<boolean> {
  const machine = binding.agentIdentity.machine!
  const intentId = binding.recoveryIntentId!
  const security = evaluateManagedAgentBindingSecurity({
    machineId: machine.id,
    // Recovery may intentionally move the Agent to a different adapter. Validate
    // the configured target runtime, not the stale adapter on the detached Binding.
    runtimeAdapter: binding.agentIdentity.runtimeAdapter ?? '',
    agentIdentity: binding.agentIdentity,
    machine,
  })
  if ('reason' in security) {
    const quarantined = await prisma.roomBinding.updateMany({
      where: {
        id: binding.id,
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId: intentId,
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
    if (quarantined.count > 0) await broadcastBindingRefresh(binding.roomId, binding.id)
    return false
  }
  const now = new Date()
  const claimed = await prisma.roomBinding.updateMany({
    where: {
      id: binding.id,
      status: { in: ['active', 'paused', 'detached'] },
      recoveryIntentId: intentId,
      OR: [{ recoveryLeaseUntil: null }, { recoveryLeaseUntil: { lt: now } }],
    },
    data: {
      detachedReason: 'recovering',
      recoveryLeaseUntil: new Date(now.getTime() + RECOVERY_LEASE_MS),
      recoveryErrorCode: null,
    },
  })
  if (claimed.count === 0) return false
  await broadcastBindingRefresh(binding.roomId, binding.id)

  const agent = binding.agentIdentity
  if (!agent.runtimeAdapter || !agent.workDir) throw new Error('runtime_configuration_incomplete')
  const sessionMode = agent.sessionMode === 'manager' ? 'manager' : 'standard'
  const managerConfig = sessionMode === 'manager' && agent.managerConfig && typeof agent.managerConfig === 'object'
    ? agent.managerConfig as { defaultWorkerAgentType?: AgentType | null; defaultWorkerModelId?: string | null }
    : null
  const creationKey = agentRoomRecoveryCreationKey({
    userId: binding.userId,
    agentIdentityId: agent.id,
    bindingId: binding.id,
    recoveryIntentId: intentId,
  })
  let replacement: Awaited<ReturnType<typeof createSessionForUser>> | null = null
  let swapped = false
  let replacementDisposable = true
  try {
    // A hard runtime-context change is a user-requested restart, not a deferred
    // rollout. Ask the old machine to stop current Provider work and discard
    // queued work before creating the replacement. If that machine is already
    // unreachable, the Binding swap and deletion still revoke its authority.
    if (binding.detachedReason === 'runtime_reconfigured') {
      await sendServerReqToMachine(
        binding.machineId,
        {
          type: 'req',
          method: 'chat.abort',
          params: { sessionId: binding.nianSessionId, discardPending: true },
        },
        30_000,
      ).catch(() => null)
    }
    replacement = await createSessionForUser({
      creationKey,
      userId: binding.userId,
      machineId: machine.id,
      agentType: agent.runtimeAdapter,
      sessionMode,
      managerConfig,
      managerDefaultWorkerAgentType: managerConfig?.defaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId: managerConfig?.defaultWorkerModelId ?? null,
      workDir: agent.workDir,
      modelId: agent.modelId ?? undefined,
      agentIdentityId: agent.id,
    })
    const assignmentIntentId = `recover:${binding.id}:${intentId}`
    try {
      const restarted = await sendServerReqToMachine(
        machine.id,
        {
          type: 'req',
          method: 'room.agent.restart-managed',
          params: {
            roomId: binding.roomId,
            bindingId: binding.id,
            agentIdentityId: agent.id,
            previousNianSessionId: binding.nianSessionId,
            nianSessionId: replacement.id,
            assignmentIntentId,
            agentType: replacement.agentType,
          },
        },
        120_000,
      )
      assertMachineResponse(restarted, 'managed_agent_restart_failed')
    } catch (error) {
      // The daemon may have committed the atomic swap but lost the response while
      // this server was restarting. Observe the durable binding before treating
      // the replacement as disposable.
      replacementDisposable = false
      const durable = await prisma.roomBinding.findUnique({
        where: { id: binding.id },
        select: { nianSessionId: true, status: true },
      })
      if (durable?.nianSessionId !== replacement.id) {
        replacementDisposable = true
        throw error
      }
      if (durable.status !== 'active' && durable.status !== 'paused') throw error
    }
    swapped = true
    return true
  } finally {
    if (replacement && !swapped && replacementDisposable) {
      await deleteSessionForUser(replacement.id, binding.userId, {
        nativeCleanupPolicy: 'auto',
      }).catch(() => {})
    }
  }
}

async function markRecoveryFailure(
  bindingId: string,
  roomId: string,
  recoveryIntentId: string,
  error: unknown,
): Promise<void> {
  const transient = /offline|timeout|closed|disconnect|active[_ -]turn|busy/i.test(
    error instanceof Error ? error.message : String(error),
  )
  const result = await prisma.roomBinding
    .updateMany({
      where: {
        id: bindingId,
        status: { in: ['active', 'paused', 'detached'] },
        recoveryIntentId,
      },
      data: {
        detachedReason: transient ? 'recovery_requested' : 'recovery_failed',
        recoveryLeaseUntil: null,
        recoveryErrorCode: safeRecoveryErrorCode(error),
      },
    })
    .catch(() => ({ count: 0 }))
  if (result.count > 0) await broadcastBindingRefresh(roomId, bindingId)
}

function safeRecoveryErrorCode(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (message.includes('offline')) return 'machine_offline'
  if (message.includes('timeout')) return 'machine_timeout'
  if (message.includes('closed') || message.includes('disconnect')) return 'machine_disconnected'
  if (message.includes('active_turn') || message.includes('active turn') || message.includes('busy'))
    return 'active_turn'
  if (message.includes('upgrade_required')) return 'upgrade_required'
  if (message.includes('runtime_configuration_incomplete'))
    return 'runtime_configuration_incomplete'
  if (message.includes('bootstrap')) return 'session_bootstrap_failed'
  if (message.includes('restart')) return 'binding_swap_failed'
  return 'recovery_failed'
}

async function broadcastBindingRefresh(roomId: string, bindingId: string): Promise<void> {
  await broadcastRoomEvent(roomId, {
    event: 'room.binding.updated',
    roomId,
    entityId: bindingId,
  })
}

function assertMachineResponse(response: { ok: boolean; error?: string }, fallback: string): void {
  if (!response.ok) throw new Error(response.error ?? fallback)
}

export async function runPendingAgentRoomRecoveries(): Promise<AgentRoomRecoveryReport> {
  await releaseSatisfiedPermissionConfirmations()
  const pending = await prisma.roomBinding.findMany({
    where: {
      status: { in: ['active', 'paused', 'detached'] },
      detachedReason: { in: ELIGIBLE_REASONS },
      recoveryIntentId: { not: null },
      activationCapability: 'managed',
      agentIdentity: {
        status: 'active',
        machine: { paired: true, online: true },
      },
      room: { status: 'active' },
      agentMembership: { status: 'active' },
    },
    select: { agentIdentityId: true, userId: true },
    distinct: ['agentIdentityId'],
    take: 20,
  })
  const total: AgentRoomRecoveryReport = { attempted: 0, recovered: 0, failed: 0, waiting: 0 }
  for (const item of pending) {
    const report = await reconcileAgentRoomBindings({
      agentId: item.agentIdentityId,
      userId: item.userId,
    })
    total.attempted += report.attempted
    total.recovered += report.recovered
    total.failed += report.failed
    total.waiting += report.waiting
  }
  return total
}

/**
 * Runtime upgrades do not revoke an owner's existing Agent authorization. Older
 * servers quarantined native-full bindings when the reported executable changed;
 * release only those rows whose persisted Agent policy is still authorized.
 */
async function releaseSatisfiedPermissionConfirmations(): Promise<void> {
  const bindings = await prisma.roomBinding.findMany({
    where: {
      status: 'detached',
      detachedReason: 'security_pending',
      recoveryErrorCode: 'permission_confirmation_required',
      recoveryIntentId: null,
      activationCapability: 'managed',
      room: { status: 'active' },
      agentMembership: { status: 'active' },
      agentIdentity: {
        status: 'active',
        machine: { paired: true, online: true },
      },
    },
    include: RECOVERY_INCLUDE,
    orderBy: { updatedAt: 'asc' },
    take: 100,
  })
  for (const binding of bindings) {
    const machine = binding.agentIdentity.machine
    if (
      !machine ||
      'reason' in
        evaluateManagedAgentBindingSecurity({
          machineId: machine.id,
          runtimeAdapter: binding.agentIdentity.runtimeAdapter ?? '',
          agentIdentity: binding.agentIdentity,
          machine,
        })
    ) {
      continue
    }
    await prisma.roomBinding.updateMany({
      where: {
        id: binding.id,
        status: 'detached',
        detachedReason: 'security_pending',
        recoveryErrorCode: 'permission_confirmation_required',
        recoveryIntentId: null,
      },
      data: {
        detachedReason: 'recovery_requested',
        recoveryIntentId: randomUUID(),
        recoveryLeaseUntil: null,
        recoveryErrorCode: null,
      },
    })
  }
}
