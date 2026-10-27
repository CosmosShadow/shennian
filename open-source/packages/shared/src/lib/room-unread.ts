// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/room-unread.test.ts

import type { RoomMessageView } from '@shennian/wire'

export type RoomUnreadProjection = {
  lastReadSequence?: string | null
  lastSequence: string
  unreadCount?: number
}

/** A message the signed-in human wrote themself; Agents owned by the account do not count. */
export function isOwnHumanRoomMessage(
  message: Pick<RoomMessageView, 'author'>,
  accountId: string | null | undefined,
): boolean {
  return (
    Boolean(accountId) &&
    message.author.principalType === 'human' &&
    message.author.ownerUserId === accountId
  )
}

/**
 * Unread projection after a live Room message arrives. Mirrors the server: the sender's own
 * message moves the watermark onto it only if everything before it was already read, so it never
 * creates unread and never hides earlier unread messages.
 */
export function applyIncomingRoomMessageUnread(
  current: RoomUnreadProjection,
  message: Pick<RoomMessageView, 'author' | 'sequence'>,
  accountId: string | null | undefined,
): { lastReadSequence: string | undefined; unreadCount: number } {
  const lastRead = BigInt(current.lastReadSequence ?? '0')
  const sequence = BigInt(message.sequence)
  if (isOwnHumanRoomMessage(message, accountId) && lastRead + 1n >= sequence) {
    const nextRead = lastRead > sequence ? lastRead : sequence
    const latest = BigInt(current.lastSequence) > sequence ? BigInt(current.lastSequence) : sequence
    return { lastReadSequence: nextRead.toString(), unreadCount: nextRead < latest ? 1 : 0 }
  }
  return {
    lastReadSequence: current.lastReadSequence ?? undefined,
    unreadCount: sequence > lastRead ? 1 : (current.unreadCount ?? 0),
  }
}
