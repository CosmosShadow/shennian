// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-membership.test.ts

import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { RoomPolicyError } from './room-policy.js'

/**
 * Deletes only the caller's conversation record. An active membership remains active and the
 * Room stays in the list with an empty transcript. An inactive membership is hidden permanently
 * unless the user joins the Room again.
 */
export async function deleteRoomRecord(input: {
  roomId: string
  userId: string
  expectedUpdatedAt?: Date
}) {
  return prisma.$transaction(
    async (tx) => {
      const membership = await tx.roomMembership.findUnique({
        where: {
          roomId_principalKey: { roomId: input.roomId, principalKey: `human:${input.userId}` },
        },
        include: { room: true },
      })
      if (!membership || membership.principalType !== 'human' || membership.status === 'deleted') {
        return {
          deleted: true,
          activeMembershipRetained: false,
          historyFromSequence: null,
          idempotent: true,
        }
      }
      if (membership.room.conversationKind === 'published_ai') {
        const [control, direct] = await Promise.all([
          tx.conversationWriteControl.findUnique({ where: { name: 'published_ai' },
            select: { mode: true } }),
          tx.agentDirectConversation.findUnique({ where: { roomId: input.roomId },
            select: { canonicalState: true } }),
        ])
        if (control?.mode !== 'canonical' || direct?.canonicalState !== 'ready') {
          throw new RoomPolicyError('room_not_found', 'Conversation is not available.')
        }
      }
      if (
        input.expectedUpdatedAt &&
        membership.room.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new RoomPolicyError(
          'room_version_conflict',
          'The Room changed after it was read. Read it again before deleting the chat record.',
        )
      }
      if (
        membership.status === 'active' &&
        membership.room.status === 'active' &&
        membership.historyFromSequence === membership.room.nextSequence + 1n
      ) {
        return {
          deleted: true,
          activeMembershipRetained: true,
          historyFromSequence: membership.historyFromSequence.toString(),
          idempotent: true,
        }
      }
      const historyFromSequence = membership.room.nextSequence + 1n
      const activeMembershipRetained =
        membership.status === 'active' && membership.room.status === 'active'
      await tx.roomMembership.update({
        where: { id: membership.id },
        data: activeMembershipRetained
          ? { historyFromSequence, historyThroughSequence: null }
          : {
              status: 'deleted',
              historyFromSequence,
              historyThroughSequence: null,
              pinnedAt: null,
            },
      })
      await tx.roomReadState.upsert({
        where: { membershipId: membership.id },
        create: {
          roomId: input.roomId,
          membershipId: membership.id,
          lastReadSequence: membership.room.nextSequence,
          lastDeliveredSequence: membership.room.nextSequence,
        },
        update: {
          lastReadSequence: membership.room.nextSequence,
          lastDeliveredSequence: membership.room.nextSequence,
        },
      })
      return {
        deleted: true,
        activeMembershipRetained,
        historyFromSequence: historyFromSequence.toString(),
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}
