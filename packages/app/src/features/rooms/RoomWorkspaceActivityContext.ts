// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/agent-participation-navigation.test.ts
import { createContext } from 'react'

/** A temporary settings panel covers, but never unmounts, its message surface. */
export const RoomWorkspaceActivityContext = createContext(true)

export function isChatScreenActive(
  routeFocused: boolean,
  workspaceActive: boolean,
  workspaceOwnsRouteActivity = false,
): boolean {
  return workspaceActive && (routeFocused || workspaceOwnsRouteActivity)
}
