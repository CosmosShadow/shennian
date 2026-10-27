// @arch open-source/docs/server-runtime.md
// @test src/__tests__/user-account-delete.test.ts
import { randomBytes } from 'node:crypto'
import type { Prisma } from '../../generated/prisma/client.js'
/** Keep previously-public shared images usable, but revoke unshared material capabilities and private requests. */
export async function clearInteractiveAccountData(tx: Prisma.TransactionClient, userId: string, deletedId: string) {
  const owned = await tx.interactiveWork.findMany({ where: { creatorId: userId }, select: { id: true } })
  await tx.interactiveAsset.updateMany({ where: { ownerId: userId, publishedAt: null },
  data: { readToken: randomBytes(32).toString('base64url') } })
  await tx.interactiveAsset.updateMany({ where: { ownerId: userId }, data: { ownerId: deletedId } })
  await tx.interactiveWork.updateMany({ where: { creatorId: userId }, data: { creatorId: deletedId, status: 'deleted',
    headRevision: { increment: 1 }, writeEpoch: { increment: 1 }, leaseToken: null, leaseExpiresAt: null } })
  await tx.interactiveJob.deleteMany({ where: { OR: [{ actorId: userId }, { workId: { in: owned.map((work) => work.id) } }] } })
  await tx.interactiveActivity.deleteMany({ where: { userId } })
  await tx.interactiveVersion.updateMany({ where: { actorId: userId }, data: { actorId: deletedId } })
  await tx.interactiveHeadEvent.updateMany({ where: { actorId: userId }, data: { actorId: deletedId } })
}
