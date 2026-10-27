// @arch docs/architecture/data-sync.md#1.6-History-Fetch
// @test src/__tests__/chat-visible-window.test.ts

import type { ChatMessage } from '@shennian/shared'

export function mergeVisibleChatMessages(
  currentMessages: ChatMessage[],
  incomingMessages: ChatMessage[],
) {
  const incomingIds = new Set(incomingMessages.map((message) => message.id))
  const latestIncomingTs = incomingMessages.reduce(
    (latest, message) => Math.max(latest, message.ts),
    Number.NEGATIVE_INFINITY,
  )
  const protectedLocalUsers = currentMessages.filter(
    (message) =>
      message.role === 'user' &&
      !incomingIds.has(message.id) &&
      (message.status !== undefined || message.ts > latestIncomingTs),
  )
  const hasOverlap = currentMessages.some((message) => incomingIds.has(message.id))
  const hasLoadedEarlierWindow =
    currentMessages.length > 0 &&
    incomingMessages.length > 0 &&
    currentMessages[0].ts < incomingMessages[0].ts

  if (!hasOverlap || !hasLoadedEarlierWindow) {
    return [...incomingMessages, ...protectedLocalUsers].sort((left, right) => left.ts - right.ts)
  }

  return [
    ...currentMessages.filter((message) => !incomingIds.has(message.id)),
    ...incomingMessages,
  ].sort((left, right) => left.ts - right.ts)
}
