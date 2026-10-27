// @arch docs/features/published-agent-direct-conversations.md
// @test src/__tests__/chat-delivery-copy.test.ts
import type { RoomListItem } from '../rooms/roomListCache'
import type { MyPublishedConversation } from './directConversationClient'

export type ConversationListEntry = { kind: 'room'; row: RoomListItem }
  | { kind: 'published'; row: MyPublishedConversation }

export function mergePublishedConversationList(rooms: RoomListItem[], published: MyPublishedConversation[], query = '', hiddenOwnedIds: string[] = []): ConversationListEntry[] {
  const hidden = new Set(hiddenOwnedIds)
  const byId = new Map<string, ConversationListEntry>()
  for (const row of published) byId.set(row.id, { kind: 'published', row })
  for (const row of rooms) {
    // Prefer owner projection over a canonical Room named after the AI.
    const existing = byId.get(row.id)
    if (existing?.kind === 'published' && existing.row.role === 'owner') continue
    byId.set(row.id, { kind: 'room', row })
  }
  const normalized = query.trim().toLocaleLowerCase()
  const activity = (entry: ConversationListEntry) => Date.parse(entry.kind === 'room'
    ? entry.row.latestMessage?.createdAt ?? entry.row.updatedAt : entry.row.lastActivityAt) || 0
  return [...byId.values()].filter((entry) => !hidden.has(entry.row.id) && (!normalized || (entry.kind === 'room' ? entry.row.name
    : `${entry.row.displayName} ${entry.row.visitorName ?? ''}`).toLocaleLowerCase().includes(normalized)))
    .sort((left, right) => {
      const leftPin = left.kind === 'room' ? left.row.pinnedAt : null
      const rightPin = right.kind === 'room' ? right.row.pinnedAt : null
      return Number(Boolean(rightPin)) - Number(Boolean(leftPin))
        || (leftPin && rightPin ? Date.parse(rightPin) - Date.parse(leftPin) : 0)
        || activity(right) - activity(left) || left.row.id.localeCompare(right.row.id)
    })
}
