// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-scroll-position-storage.test.ts

import { Platform } from 'react-native'

export type ChatScrollPosition = {
  scrollTop: number
  distanceFromBottom: number
  savedAt: number
}

const LEGACY_CHAT_SCROLL_POSITIONS_KEY = 'shennian:chatScrollPositions'

/**
 * Scroll positions are intentionally session-local. Keep this async API while
 * callers migrate so entering a conversation always resolves to the latest message.
 */
export async function hydrateChatScrollPositionStorage(): Promise<void> {}

export function getChatScrollPosition(_sessionId: string): ChatScrollPosition | null {
  return null
}

export function saveChatScrollPosition(
  _sessionId: string,
  _position: { scrollTop: number; distanceFromBottom: number },
): void {}

export async function clearAllChatScrollPositions(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LEGACY_CHAT_SCROLL_POSITIONS_KEY, '{}')
    }
    return
  }

  try {
    const mod = await import('@react-native-async-storage/async-storage')
    await mod.default.setItem(LEGACY_CHAT_SCROLL_POSITIONS_KEY, '{}')
  } catch {
    // Legacy cleanup is best-effort and must not block account reset.
  }
}
