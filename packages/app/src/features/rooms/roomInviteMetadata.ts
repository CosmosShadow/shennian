// @arch docs/features/network-rooms/ui.md#六移动端
// @test src/__tests__/room-invite-metadata.test.ts

export function formatRoomInviteGeneratedAt(value: string | undefined, locale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
