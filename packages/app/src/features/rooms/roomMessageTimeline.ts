// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-message-timeline.test.ts

const ROOM_TIME_GAP_MS = 5 * 60 * 1000

export function shouldShowRoomTimeSeparator(
  createdAt: string,
  previousCreatedAt?: string,
): boolean {
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp)) return false
  if (!previousCreatedAt) return true

  const previousTimestamp = Date.parse(previousCreatedAt)
  if (!Number.isFinite(previousTimestamp)) return true

  return (
    timestamp - previousTimestamp > ROOM_TIME_GAP_MS ||
    isDifferentLocalDay(previousTimestamp, timestamp)
  )
}

function isDifferentLocalDay(previousTimestamp: number, timestamp: number): boolean {
  const previous = new Date(previousTimestamp)
  const current = new Date(timestamp)
  return (
    previous.getFullYear() !== current.getFullYear() ||
    previous.getMonth() !== current.getMonth() ||
    previous.getDate() !== current.getDate()
  )
}
