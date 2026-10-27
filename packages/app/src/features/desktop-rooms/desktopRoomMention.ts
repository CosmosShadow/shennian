// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-public-conversation.test.ts

import type { RoomMemberGroup } from '../rooms/roomPresentation'
import type { RoomMemberView } from '../rooms/types'

export const DESKTOP_MENTION_LIST_ID = 'desktop-room-mention-list'
export const desktopMentionOptionId = (memberId: string) => `desktop-room-mention-${memberId}`
export const DESKTOP_MENTION_ROW_HEIGHT = 32
export const DESKTOP_MENTION_LIST_INSET = 4

export type DesktopMentionKeyAction =
  | { type: 'move'; index: number }
  | { type: 'select' }
  | { type: 'close' }

/** Visual order of the picker: each human followed by their own Agents. */
export function flattenMentionGroups(groups: RoomMemberGroup[]): RoomMemberView[] {
  const items: RoomMemberView[] = []
  for (const group of groups) items.push(group.human, ...group.agents)
  return items
}

/**
 * Keys the composer hands to the open mention list. Returns null for anything the
 * textarea should keep (typing, Shift+Enter, IME composition, Enter with nothing to pick).
 */
export function resolveDesktopMentionKey(
  input: { key: string; shiftKey: boolean; isComposing: boolean },
  activeIndex: number,
  count: number,
): DesktopMentionKeyAction | null {
  if (input.isComposing) return null
  if (input.key === 'Escape') return { type: 'close' }
  if (count === 0 || input.shiftKey) return null
  if (input.key === 'ArrowDown') return { type: 'move', index: (activeIndex + 1) % count }
  if (input.key === 'ArrowUp') return { type: 'move', index: (activeIndex - 1 + count) % count }
  if (input.key === 'Enter' || input.key === 'Tab') return { type: 'select' }
  return null
}

/** Smallest scroll change that keeps the active row (and its edge padding) fully visible. */
export function desktopMentionScrollOffset(input: {
  index: number
  scrollTop: number
  viewportHeight: number
}): number {
  const rowTop = DESKTOP_MENTION_LIST_INSET + input.index * DESKTOP_MENTION_ROW_HEIGHT
  const rowBottom = rowTop + DESKTOP_MENTION_ROW_HEIGHT
  if (rowTop - DESKTOP_MENTION_LIST_INSET < input.scrollTop) {
    return Math.max(0, rowTop - DESKTOP_MENTION_LIST_INSET)
  }
  const bottomEdge = rowBottom + DESKTOP_MENTION_LIST_INSET
  if (bottomEdge > input.scrollTop + input.viewportHeight) {
    return Math.max(0, bottomEdge - input.viewportHeight)
  }
  return input.scrollTop
}
