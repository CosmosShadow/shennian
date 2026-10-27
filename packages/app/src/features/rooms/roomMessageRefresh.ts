// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-message-refresh.test.ts

import type { RoomMessageView } from '@shennian/wire'

type MessagePage = { messages: RoomMessageView[]; hasMore: boolean }
type ReadPage = (
  roomId: string,
  query: { before?: string; after?: string; limit: number },
) => Promise<MessagePage>

// A cached viewport is already usable. Catch up after its newest sequence rather
// than replacing its window with the latest 50 (which can discard history/gaps).
export async function loadRoomMessageRefresh(
  readPage: ReadPage,
  roomId: string,
  before: string,
  cachedSequence?: string,
): Promise<MessagePage> {
  if (!cachedSequence) return readPage(roomId, { before, limit: 50 })

  const messages: RoomMessageView[] = []
  let after = cachedSequence
  while (true) {
    const page = await readPage(roomId, { after, limit: 50 })
    messages.push(...page.messages)
    const next = page.messages[page.messages.length - 1]?.sequence
    if (!page.hasMore || !next || BigInt(next) <= BigInt(after)) break
    after = next
  }
  // This is forward catch-up, not a claim about the older-history boundary.
  return { messages, hasMore: false }
}
