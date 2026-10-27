// @arch open-source/docs/server-runtime.md
// @test src/__tests__/review-account-machine-cleanup.test.ts

import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { connections } from '../relay/connections.js'
import { reviewAccountPhones } from './review-account-policy.js'

export type ReviewAccountMachineCleanupReport = {
  mode: 'audit' | 'apply'
  reviewAccounts: number
  machines: number
  machineTokens: number
  pairTokens: number
  pairedMachines: number
  onlineMachines: number
  activeGrants: number
  revokedMachines: number
  revokedGrants: number
  disconnectedSockets: number
}

export async function cleanupReviewAccountMachines(
  options: { apply?: boolean } = {},
): Promise<ReviewAccountMachineCleanupReport> {
  const users = await prisma.user.findMany({
    where: { phone: { in: reviewAccountPhones() } },
    select: { id: true },
  })
  const userIds = users.map((user) => user.id)
  const machines = userIds.length
    ? await prisma.machine.findMany({
        where: { userId: { in: userIds } },
        select: {
          id: true,
          paired: true,
          online: true,
          machineToken: true,
          pairToken: true,
        },
      })
    : []
  const machineIds = machines.map((machine) => machine.id)
  const activeGrants = machineIds.length
    ? await prisma.machineGrant.count({
        where: { machineId: { in: machineIds }, revokedAt: null },
      })
    : 0

  const report: ReviewAccountMachineCleanupReport = {
    mode: options.apply ? 'apply' : 'audit',
    reviewAccounts: users.length,
    machines: machines.length,
    machineTokens: machines.filter((machine) => Boolean(machine.machineToken)).length,
    pairTokens: machines.filter((machine) => Boolean(machine.pairToken)).length,
    pairedMachines: machines.filter((machine) => machine.paired).length,
    onlineMachines: machines.filter((machine) => machine.online).length,
    activeGrants,
    revokedMachines: 0,
    revokedGrants: 0,
    disconnectedSockets: 0,
  }
  if (!options.apply || machineIds.length === 0) return report

  const changedAt = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const grants = await tx.machineGrant.updateMany({
      where: { machineId: { in: machineIds }, revokedAt: null },
      data: { revokedAt: changedAt },
    })
    const revoked = await tx.machine.updateMany({
      where: { id: { in: machineIds } },
      data: {
        machineToken: null,
        pairToken: null,
        paired: false,
        online: false,
        lastSeen: changedAt,
      },
    })
    return { grants: grants.count, machines: revoked.count }
  })

  for (const machineId of machineIds) {
    const machineSocket = connections.getMachine(machineId)
    if (machineSocket) {
      machineSocket.close(4403, 'review_account_machine_access_forbidden')
      report.disconnectedSockets += 1
    }
    for (const client of connections.getClients(machineId) ?? []) {
      client.close(4403, 'review_account_machine_access_forbidden')
      report.disconnectedSockets += 1
    }
    connections.removeMachine(machineId)
    await redis.del(`machine:${machineId}:region`)
  }
  report.revokedMachines = result.machines
  report.revokedGrants = result.grants
  return report
}
