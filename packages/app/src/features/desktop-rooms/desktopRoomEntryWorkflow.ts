// @arch docs/features/desktop-room-entry.md
// @test ../../__tests__/desktop-room-entry.test.ts

export type DesktopRoomEntryFailure =
  | 'invite_unavailable'
  | 'forbidden'
  | 'offline'
  | 'failed'

export function classifyDesktopRoomEntryFailure(error: unknown): DesktopRoomEntryFailure {
  if (!error || typeof error !== 'object') return 'failed'
  const code = (error as { code?: unknown }).code
  if (code === 'GONE' || code === 'NOT_FOUND') return 'invite_unavailable'
  if (code === 'FORBIDDEN') return 'forbidden'
  if (code === 'OFFLINE') return 'offline'
  return 'failed'
}

export type DesktopRoomEntryStage =
  | 'create'
  | 'join-link'
  | 'join-preview'
  | 'pending'
  | 'cancelled'
  | 'failure'

export function nextDesktopRoomEntryMenuIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (!count || (key !== 'ArrowDown' && key !== 'ArrowUp')) return null
  if (current < 0) return key === 'ArrowDown' ? 0 : count - 1
  const step = key === 'ArrowDown' ? 1 : -1
  return (current + step + count) % count
}

export function canSubmitDesktopRoomJoin(input: {
  busy: boolean
  joinPolicy: 'open' | 'approval' | 'closed'
  message: string
}): boolean {
  if (input.busy || input.joinPolicy === 'closed') return false
  return input.joinPolicy !== 'approval' || input.message.trim().length > 0
}
