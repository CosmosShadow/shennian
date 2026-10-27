// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/message-time.test.ts

export function formatMessageTime(
  ts: number,
  options: { now?: number; yesterdayLabel?: string } = {},
): string {
  const date = new Date(ts)
  if (!Number.isFinite(date.getTime())) return ''

  const now = new Date(options.now ?? Date.now())
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const messageDayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  yesterday.setDate(yesterday.getDate() - 1)

  if (messageDayStart === dayStart) return time
  if (messageDayStart === yesterday.getTime()) {
    return `${options.yesterdayLabel ?? '昨天'} ${time}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`
  }
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
