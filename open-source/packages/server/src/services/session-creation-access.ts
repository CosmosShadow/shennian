// @arch open-source/docs/server-runtime.md
import { prisma } from '../lib/prisma.js'
import { historicalPermissionAllowsUse } from './machine-access.js'

export async function requireMachineAccess(machineId: string, userId: string) {
  const machine = await prisma.machine.findUnique({ where: { id: machineId } })
  if (!machine) {
    throw new Error('Machine not found')
  }

  const isOwner = machine.userId === userId
  if (!isOwner) {
    const grant = await prisma.machineGrant.findFirst({
      where: {
        machineId,
        granteeId: userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { permission: true },
    })
    if (!grant || !historicalPermissionAllowsUse(grant.permission)) {
      throw new Error('Not authorized')
    }
  }

  return machine
}

