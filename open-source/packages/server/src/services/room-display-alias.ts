// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-display-alias.test.ts

import type { Prisma } from '../generated/prisma/client.js'

const MAX_ALIAS_LENGTH = 191

/**
 * Allocates a stable, human-readable alias inside one Room. Active membership
 * aliases follow the current public identity name, while an optional exclusion
 * lets an existing membership keep its collision suffix during a rename.
 * Removed names stay reserved so historical references remain legible.
 */
export async function allocateRoomDisplayAlias(
  tx: Prisma.TransactionClient,
  roomId: string,
  requestedName: string,
  options: { excludeMembershipId?: string } = {},
): Promise<string> {
  const base = requestedName.trim().slice(0, MAX_ALIAS_LENGTH)
  const memberships = await tx.roomMembership.findMany({
    where: {
      roomId,
      ...(options.excludeMembershipId ? { id: { not: options.excludeMembershipId } } : {}),
    },
    select: { displayAlias: true },
  })
  const occupied = new Set(memberships.map((item) => item.displayAlias.trim().toLocaleLowerCase()))
  if (!occupied.has(base.toLocaleLowerCase())) return base

  for (let ordinal = 2; ordinal < 10_000; ordinal += 1) {
    const suffix = ` ${ordinal}`
    const candidate = `${base.slice(0, MAX_ALIAS_LENGTH - suffix.length).trimEnd()}${suffix}`
    if (!occupied.has(candidate.toLocaleLowerCase())) return candidate
  }
  throw new Error('Unable to allocate a unique Room display alias.')
}
