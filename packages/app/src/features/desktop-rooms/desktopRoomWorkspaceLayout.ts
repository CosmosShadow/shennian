// @arch docs/design/desktop/unified-desktop-control.md#群聊工作区本轮推荐方案
// @test ../../__tests__/desktop-room-workspace.test.ts

/** Two usable 360px panes, measured after the sidebar is removed. */
export const DESKTOP_ROOM_SPLIT_BREAKPOINT = 720
export const DESKTOP_ROOM_HEADER_HEIGHT = 44

export type DesktopRoomWorkspaceMode = 'split' | 'single'

export type DesktopRoomSurfaceState = {
  publicVisible: boolean
  privateVisible: boolean
  publicActive: boolean
  privateActive: boolean
}

export function getDesktopRoomWorkspaceMode(
  viewportWidth: number,
  hasOwnedAgents: boolean,
): DesktopRoomWorkspaceMode {
  return viewportWidth >= DESKTOP_ROOM_SPLIT_BREAKPOINT && hasOwnedAgents ? 'split' : 'single'
}

export function getDesktopRoomSurfaceState(
  mode: DesktopRoomWorkspaceMode,
  privatePaneSelected: boolean,
): DesktopRoomSurfaceState {
  if (mode === 'split') {
    return {
      publicVisible: true,
      privateVisible: true,
      publicActive: true,
      privateActive: true,
    }
  }
  return {
    publicVisible: !privatePaneSelected,
    privateVisible: privatePaneSelected,
    publicActive: !privatePaneSelected,
    privateActive: privatePaneSelected,
  }
}

export function resolveDesktopRoomAgentSession(
  sessionIds: string[],
  requestedSessionId: string | null,
): string | null {
  if (requestedSessionId && sessionIds.includes(requestedSessionId)) return requestedSessionId
  return null
}

/**
 * The wide layout always shows a private pane, so it opens on the first own
 * Agent unless a valid one was chosen. The narrow layout stays on the public room.
 */
export function resolveDesktopRoomDisplayedSession(
  sessionIds: string[],
  requestedSessionId: string | null,
  wide: boolean,
): string | null {
  return (
    resolveDesktopRoomAgentSession(sessionIds, requestedSessionId) ??
    (wide ? (sessionIds[0] ?? null) : null)
  )
}

export function getDesktopRoomPrivateCandidate(
  sessionIds: string[],
  selectedSessionId: string | null,
): string | null {
  return resolveDesktopRoomAgentSession(sessionIds, selectedSessionId) ?? sessionIds[0] ?? null
}

export function nextDesktopRoomAgentMenuIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return current < 0 ? 0 : (current + 1) % count
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return current < 0 ? count - 1 : (current - 1 + count) % count
  }
  return null
}

export function clampDesktopSplitWidth(width: number, available: number, minimum: number): number {
  return Math.max(minimum, Math.min(width, Math.max(minimum, available - 360)))
}
