// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/chat-background-history-loading.test.ts
import { useContext, useRef } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { useChatStore } from '@shennian/shared'
import { RoomWorkspaceActivityContext } from '../../rooms/RoomWorkspaceActivityContext'

/** Keep a covered conversation's rendered body intact while a child owns the shared store. */
export function useRetainedChatPresentation<T extends { sessionId: string; chatLoading: boolean }>(props: T): T {
  const focused = useIsFocused()
  const active = useContext(RoomWorkspaceActivityContext)
  const storeSessionId = useChatStore((store) => store.sessionId)
  const retained = useRef<T | null>(null)
  const ownsBody = storeSessionId === props.sessionId
  if (retained.current?.sessionId !== props.sessionId) retained.current = null
  if (focused && active && ownsBody && !props.chatLoading) retained.current = props
  return retained.current && (!focused || !active || !ownsBody || props.chatLoading) ? retained.current : props
}
