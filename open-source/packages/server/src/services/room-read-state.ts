// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-read-state.test.ts

import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

/**
 * Advances the account membership watermark without allowing stale devices to move it back.
 * `advanced` is false when the request did not change the stored watermark, so callers can
 * skip fan-out; otherwise idempotent re-reports would ping-pong between devices.
 */
export async function advanceRoomReadState(input: {
  roomId: string
  membershipId: string
  lastReadSequence: bigint
}): Promise<{ lastReadSequence: bigint; advanced: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.roomReadState.findUnique({
      where: { membershipId: input.membershipId },
      select: { lastReadSequence: true },
    })
    await tx.roomReadState.upsert({
      where: { membershipId: input.membershipId },
      create: {
        roomId: input.roomId,
        membershipId: input.membershipId,
        lastReadSequence: input.lastReadSequence,
      },
      update: { roomId: input.roomId },
    })
    await tx.roomReadState.updateMany({
      where: {
        membershipId: input.membershipId,
        lastReadSequence: { lt: input.lastReadSequence },
      },
      data: { lastReadSequence: input.lastReadSequence },
    })
    const state = await tx.roomReadState.findUnique({
      where: { membershipId: input.membershipId },
      select: { lastReadSequence: true },
    })
    if (!state) throw new Error('Room read state disappeared during advancement.')
    return {
      lastReadSequence: state.lastReadSequence,
      advanced: before === null || state.lastReadSequence > before.lastReadSequence,
    }
  })
}

/**
 * A human's own message never creates unread for that account: when the sender had already read
 * everything before it, the watermark moves onto the new message in the same transaction.
 * If earlier messages are still unread the watermark stays put, so sending cannot swallow them
 * (for example a CLI/Skill message sent under the human identity).
 * Returns whether the watermark moved, so callers can invalidate the sender's other devices.
 */
export async function advanceReadStateForOwnMessage(
  tx: Pick<Prisma.TransactionClient, 'roomReadState'>,
  input: { roomId: string; membershipId: string; sequence: bigint },
): Promise<boolean> {
  const previous = input.sequence - 1n
  const moved = await tx.roomReadState.updateMany({
    where: { membershipId: input.membershipId, lastReadSequence: previous },
    data: { lastReadSequence: input.sequence },
  })
  if (moved.count > 0) return true
  if (previous !== 0n) return false
  const existing = await tx.roomReadState.findUnique({
    where: { membershipId: input.membershipId },
    select: { lastReadSequence: true },
  })
  if (existing) return false
  await tx.roomReadState.create({
    data: {
      roomId: input.roomId,
      membershipId: input.membershipId,
      lastReadSequence: input.sequence,
    },
  })
  return true
}
