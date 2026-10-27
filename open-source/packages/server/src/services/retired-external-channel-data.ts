// @arch open-source/docs/server-runtime.md
// @test src/__tests__/device-management.test.ts
import { prisma } from '../lib/prisma.js'

/** Delete dependent historical rows before a machine is removed. No connector
 * runtime imports this compatibility cleanup and it cannot create new data. */
export async function cleanupRetiredExternalChannelMachineData(machineId: string) {
  const bindings = await prisma.wechatChannelBinding.findMany({
    where: { machineId },
    select: { id: true, sessionId: true },
  })
  const bindingIds = bindings.map((binding) => binding.id)
  const sessionIds = bindings.map((binding) => binding.sessionId)
  if (!bindingIds.length) return
  const whereByBinding = { bindingId: { in: bindingIds } }
  await Promise.all([
    prisma.wechatChannelVisualVector.deleteMany({ where: whereByBinding }),
    prisma.wechatChannelRecentMessage.deleteMany({ where: whereByBinding }),
    prisma.wechatChannelOutboundReply.deleteMany({ where: whereByBinding }),
    prisma.wechatChannelIdempotency.deleteMany({
      where: {
        OR: [
          { bindingId: { in: bindingIds } },
          ...(sessionIds.length ? [{ sessionId: { in: sessionIds } }] : []),
        ],
      },
    }),
  ])
}
