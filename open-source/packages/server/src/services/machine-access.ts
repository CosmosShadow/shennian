// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-access.test.ts

import { prisma } from '../lib/prisma.js'

export type MachineAccess = {
  machine: { id: string; userId: string | null; remoteAccessDisabledAt?: Date | null }
  role: 'owner' | 'granted'
  permission: string | null
  expiresAt: Date | null
}

export function isActiveMachineGrant(grant: {
  granteeId: string | null
  revokedAt: Date | null
  expiresAt: Date | null
}, userId: string, now = new Date()): boolean {
  return grant.granteeId === userId && grant.revokedAt === null &&
    (grant.expiresAt === null || grant.expiresAt > now)
}

export function historicalPermissionAllowsUse(permission: string): boolean {
  return permission === 'use' || permission === 'full' || permission === 'admin'
}

export async function getMachineAccess(
  machineId: string,
  userId: string,
  minimum: 'view' | 'use' = 'view',
): Promise<MachineAccess | null> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true, userId: true, remoteAccessDisabledAt: true },
  })
  if (!machine || machine.remoteAccessDisabledAt) return null
  if (machine.userId === userId) return { machine, role: 'owner', permission: null, expiresAt: null }

  const grant = await prisma.machineGrant.findFirst({
    where: {
      machineId,
      granteeId: userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { permission: true, expiresAt: true },
  })
  if (!grant) return null
  if (minimum === 'use' && !historicalPermissionAllowsUse(grant.permission)) return null
  return { machine, role: 'granted', permission: grant.permission, expiresAt: grant.expiresAt }
}

export async function requireMachineAccess(
  machineId: string,
  userId: string,
  minimum: 'view' | 'use' = 'view',
): Promise<MachineAccess> {
  const access = await getMachineAccess(machineId, userId, minimum)
  if (!access) throw new Error('machine_access_denied')
  return access
}
