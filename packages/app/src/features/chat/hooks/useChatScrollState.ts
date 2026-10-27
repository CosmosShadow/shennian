// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-scroll-position-storage.test.ts
import { useCallback, useEffect, useState } from 'react'
import { getChatScrollPosition, hydrateChatScrollPositionStorage, saveChatScrollPosition,
  type ChatScrollPosition } from '../utils/scrollPositionStorage'

export function useChatScrollState({ sessionId, workspaceInitialScrollPosition,
  onWorkspaceScrollPositionChange, chatLoading, hasMoreMessages, loadOlderMessages, loadingOlder }: {
  sessionId: string; workspaceInitialScrollPosition?: ChatScrollPosition | null;
  onWorkspaceScrollPositionChange?: (position: ChatScrollPosition) => void;
  chatLoading: boolean; hasMoreMessages: boolean; loadOlderMessages: () => Promise<void>; loadingOlder: boolean;
}) {
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [initialScrollPosition, setInitialScrollPosition] = useState<ChatScrollPosition | null | undefined>(undefined)
  useEffect(() => {
    if (workspaceInitialScrollPosition !== undefined) {
      setInitialScrollPosition(workspaceInitialScrollPosition)
      return
    }
    let cancelled = false
    setInitialScrollPosition(undefined)
    void hydrateChatScrollPositionStorage().finally(() => {
      if (cancelled) return
      setInitialScrollPosition(getChatScrollPosition(sessionId))
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, workspaceInitialScrollPosition])

  const handleScrollState = useCallback(
    (dist: number, _scrollingUp: boolean, scrollTop?: number, distanceFromTop?: number) => {
      setShowScrollBtn(dist > 150)
      if (
        typeof distanceFromTop === 'number' &&
        distanceFromTop < 240 &&
        hasMoreMessages &&
        !loadingOlder &&
        !chatLoading
      ) {
        void loadOlderMessages()
      }
      if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop)) return
      const position = {
        scrollTop,
        distanceFromBottom: dist,
        savedAt: Date.now(),
      }
      onWorkspaceScrollPositionChange?.(position)
      saveChatScrollPosition(sessionId, position)
    },
    [
      chatLoading,
      hasMoreMessages,
      loadOlderMessages,
      loadingOlder,
      onWorkspaceScrollPositionChange,
      sessionId,
    ],
  )

  return { showScrollBtn, initialScrollPosition, handleScrollState }
}
