// @arch open-source/docs/server-runtime.md
// @test src/__tests__/unread-badge.test.ts

import { prisma } from '../lib/prisma.js'

// Lists and notification badges must use the same access scope. Offline is
// not unpaired: a paired machine retains its unread results while offline.
export async function getAccessibleMachineMap(userId: string): Promise<Map<string, string>> {
  const [owned, grants] = await Promise.all([
    prisma.machine.findMany({
      where: { userId, paired: true },
      select: { id: true, name: true },
    }),
    prisma.machineGrant.findMany({
      where: {
        granteeId: userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        machine: { select: { id: true, name: true, paired: true } },
      },
    }),
  ])

  const map = new Map(owned.map((m) => [m.id, m.name]))
  for (const grant of grants) {
    if (grant.machine.paired && !map.has(grant.machine.id)) {
      map.set(grant.machine.id, grant.machine.name)
    }
  }
  return map
}

