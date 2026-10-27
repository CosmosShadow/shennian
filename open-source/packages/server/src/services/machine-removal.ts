// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machines.test.ts

import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { connections } from '../relay/connections.js'
import { pubsub } from '../relay/pubsub.js'
import { broadcastRoomEvent } from './room-events.js'
import { Prisma } from '../generated/prisma/client.js'
import { publishMachineAccessPaused } from '../relay/connection-control.js'

export type RemoveOwnedMachineResult = {
  affectedBindingIds: string[]
  affectedRoomIds: string[]
  idempotent: boolean
}

/**
 * Revoke one owned machine while preserving agent identities and ending dependent Room memberships.
 * The database transition is atomic; transport teardown and refresh events follow
 * only after the revoked credential can no longer authenticate a new connection.
 */
export async function removeOwnedMachine(
  machineId: string,
  ownerUserId: string,
): Promise<RemoveOwnedMachineResult | null> {
  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const machine = await tx.machine.findFirst({
      where: { id: machineId, userId: ownerUserId },
      select: { id: true, paired: true, online: true, machineToken: true, pairToken: true },
    })
    if (!machine) return null

    const alreadyRemoved =
      !machine.paired && !machine.online && !machine.machineToken && !machine.pairToken
    if (alreadyRemoved) return { affectedBindings: [], idempotent: true }

    const affectedBindings = await tx.roomBinding.findMany({
      where: {
        machineId,
        userId: ownerUserId,
        OR: [
          { status: { in: ['pending_approval', 'active', 'paused'] } },
          { status: 'detached', agentMembership: { status: 'active' } },
        ],
      },
      select: { id: true, roomId: true, agentMembershipId: true },
    })

    if (affectedBindings.length > 0) {
      await tx.roomBinding.updateMany({
        where: { id: { in: affectedBindings.map((binding) => binding.id) } },
        data: {
          status: 'detached',
          detachedReason: 'machine_removed',
          recoveryIntentId: null,
          recoveryLeaseUntil: null,
          recoveryErrorCode: null,
          capabilityEpoch: { increment: 1 },
        },
      })
    }
    const membershipIds = affectedBindings.flatMap((binding) =>
      binding.agentMembershipId ? [binding.agentMembershipId] : [],
    )
    if (membershipIds.length > 0) {
      await tx.roomMembership.updateMany({
        where: { id: { in: membershipIds }, ownerUserId, principalType: 'agent', status: 'active' },
        data: { status: 'left', removedAt: new Date() },
      })
    }
    await tx.machineGrant.deleteMany({ where: { machineId } })
    await tx.qrSession.deleteMany({ where: { machineId } })
    await tx.machine.update({
      where: { id: machineId },
      data: {
        paired: false,
        online: false,
        machineToken: null,
        pairToken: null,
      },
    })

    return { affectedBindings, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

  if (!result) return null

  if (!result.idempotent) {
    const machineEvent = JSON.stringify({
      type: 'event',
      event: 'machine.removed',
      payload: { machineId },
    })
    try {
      if (pubsub.isActive) pubsub.publishToUser(ownerUserId, machineEvent)
      else connections.broadcastToClientsOfUser(ownerUserId, machineEvent)
    } catch {
      // Credential revocation and transport teardown must not depend on refresh delivery.
    }
  }

  closeRemovedMachineConnections(machineId)
  publishMachineAccessPaused(machineId)
  await redis.del(`machine:${machineId}:region`).catch(() => {})

  await Promise.allSettled(
    result.affectedBindings.flatMap((binding) => [
      broadcastRoomEvent(binding.roomId, {
        event: 'room.binding.updated',
        roomId: binding.roomId,
        entityId: binding.id,
      }),
      ...(binding.agentMembershipId ? [broadcastRoomEvent(binding.roomId, {
        event: 'room.membership.updated', roomId: binding.roomId, entityId: binding.agentMembershipId,
      })] : []),
    ]),
  )

  return {
    affectedBindingIds: result.affectedBindings.map((binding) => binding.id),
    affectedRoomIds: [...new Set(result.affectedBindings.map((binding) => binding.roomId))],
    idempotent: result.idempotent,
  }
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const retryable =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
      if (!retryable || attempt === 2) throw error
    }
  }
  throw new Error('unreachable')
}

function closeRemovedMachineConnections(machineId: string): void {
  try {
    connections.getMachine(machineId)?.close(4403, 'machine_removed')
  } catch {
    // The database credential is already revoked; socket cleanup is best effort.
  }
  for (const client of connections.getClients(machineId) ?? []) {
    try {
      client.close(4403, 'machine_removed')
    } catch {
      // The client may already have disconnected.
    }
  }
  connections.removeMachine(machineId)
}
