// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-conversation-screen.test.ts

import type { RoomMessageView } from '@shennian/wire'

export function mergeRoomMessages(
  current: RoomMessageView[],
  incoming: RoomMessageView[],
): RoomMessageView[] {
  const map = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) map.set(message.id, message)
  return [...map.values()].sort((left, right) => {
    const leftSequence = BigInt(left.sequence)
    const rightSequence = BigInt(right.sequence)
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0
  })
}

export function createRoomClientMessageId(): string {
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function incrementRoomSequence(sequence: string): string {
  return (BigInt(sequence) + 1n).toString()
}

export function compareRoomSequence(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  return a === b ? 0 : a > b ? 1 : -1
}

export function maxRoomSequence(left: string, right: string): string {
  return compareRoomSequence(left, right) >= 0 ? left : right
}

/** Read reports are idempotent per scope; re-sending an already reported sequence only causes fan-out. */
export function shouldReportRoomRead(
  reported: { scope: string; sequence: string },
  scope: string,
  sequence: string,
): boolean {
  return reported.scope !== scope || compareRoomSequence(sequence, reported.sequence) > 0
}
