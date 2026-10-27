// @arch docs/features/network-rooms/ui.md#七智能体内部对话与群聊的平级切换
// @test src/__tests__/room-agent-navigation.test.ts

const INLINE_ROOM_DETAILS_BREAKPOINT = 900

export function usesInlineRoomDetails(viewportWidth: number): boolean {
  return viewportWidth >= INLINE_ROOM_DETAILS_BREAKPOINT
}

export function getRoomWorkspacePageIndex(
  sessionIds: string[],
  activeSessionId: string | null,
): number {
  if (!activeSessionId) return 0
  const agentIndex = sessionIds.indexOf(activeSessionId)
  return agentIndex < 0 ? 0 : agentIndex + 1
}

export function getRoomWorkspaceSessionIdAtPage(
  sessionIds: string[],
  pageIndex: number,
): string | null {
  if (pageIndex <= 0) return null
  return sessionIds[Math.min(pageIndex - 1, sessionIds.length - 1)] ?? null
}

export function getRoomWorkspaceHeaderDetailsTarget(
  desktop: boolean,
  activeSessionId: string | null,
): 'room' | 'agent' {
  return !desktop && activeSessionId ? 'agent' : 'room'
}
