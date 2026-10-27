// @arch open-source/docs/server-runtime.md

import { Prisma } from '../generated/prisma/client.js'

/** Mirror internal job cancellation into the one canonical Room timeline. */
export async function syncCancelledPublishedAiRoomMessages(
  tx: Prisma.TransactionClient,
  conversation: Prisma.AgentDirectConversationWhereInput,
) {
  await tx.roomMessage.updateMany({
    where: { room: { conversationKind: 'published_ai' },
      deliveryStatus: { not: 'cancelled' },
      legacyDirectMessage: { is: { status: 'cancelled', conversation } } },
    data: { deliveryStatus: 'cancelled' },
  })
}
