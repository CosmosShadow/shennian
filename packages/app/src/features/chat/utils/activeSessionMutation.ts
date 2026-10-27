// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-active-session-mutation.test.ts

import { useChatStore } from '@shennian/shared'

type ChatStoreState = ReturnType<typeof useChatStore.getState>

/**
 * The chat store is shared by every conversation screen. Async work started
 * in a previous screen may finish after navigation, so it may only update the
 * store while its originating conversation is still active.
 */
export function mutateActiveChatSession(
  sessionId: string,
  mutate: (state: ChatStoreState) => void,
): boolean {
  const state = useChatStore.getState()
  if (state.sessionId !== sessionId) return false
  mutate(state)
  return true
}
