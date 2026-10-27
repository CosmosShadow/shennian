// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/desktop-chat-controller.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatScrollPosition } from '../chat/utils/scrollPositionStorage'
import { desktopShellWindowState } from '../desktop-shell/desktopShellWindowState'

export function useDesktopChatScrollState({
  chatLoading,
  currentUserId,
  hasMoreMessages,
  loadOlderMessages,
  loadingOlder,
  onWorkspaceScrollPositionChange,
  sessionId,
  workspaceInitialScrollPosition,
}: {
  chatLoading: boolean
  currentUserId: string | null
  hasMoreMessages: boolean
  loadOlderMessages: () => Promise<unknown>
  loadingOlder: boolean
  onWorkspaceScrollPositionChange?: (position: ChatScrollPosition) => void
  sessionId: string
  workspaceInitialScrollPosition?: ChatScrollPosition | null
}) {
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [initialScrollPosition, setInitialScrollPosition] = useState<
    ChatScrollPosition | null | undefined
  >(undefined)
  const [scrollCommand, setScrollCommand] = useState<{
    action: 'top' | 'bottom'
    id: number
  } | null>(null)

  useEffect(() => {
    if (workspaceInitialScrollPosition !== undefined) {
      setInitialScrollPosition(workspaceInitialScrollPosition)
      return
    }
    setInitialScrollPosition(
      currentUserId
        ? desktopShellWindowState.getReadingPosition(currentUserId, {
            kind: 'session',
            id: sessionId,
          })
        : null,
    )
  }, [currentUserId, sessionId, workspaceInitialScrollPosition])

  const historyRequest = useRef<Promise<unknown> | null>(null)
  const handleScrollState = useCallback(
    (dist: number, scrollingUp: boolean, scrollTop?: number, distanceFromTop?: number) => {
      setShowScrollBtn(dist > 150)
      if (
        typeof distanceFromTop === 'number' &&
        // Start the SQLite expansion only when the user is actually nearing
        // the retained window. The previous 1600px threshold interrupted an
        // ordinary upward gesture with a full history merge well before top.
        distanceFromTop < 640 &&
        scrollingUp &&
        !historyRequest.current &&
        hasMoreMessages &&
        !loadingOlder &&
        !chatLoading
      ) {
        const request = loadOlderMessages()
        historyRequest.current = request
        void request.catch(() => {}).finally(() => {
          if (historyRequest.current === request) historyRequest.current = null
        })
      }
      if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop)) return
      const position = { scrollTop, distanceFromBottom: dist, savedAt: Date.now() }
      onWorkspaceScrollPositionChange?.(position)
      if (currentUserId) {
        desktopShellWindowState.setReadingPosition(
          currentUserId,
          { kind: 'session', id: sessionId },
          position,
        )
      }
    },
    [
      chatLoading,
      currentUserId,
      hasMoreMessages,
      loadOlderMessages,
      loadingOlder,
      onWorkspaceScrollPositionChange,
      sessionId,
    ],
  )

  return {
    handleScrollState,
    initialScrollPosition,
    scrollCommand,
    setScrollCommand,
    showScrollBtn,
  }
}
