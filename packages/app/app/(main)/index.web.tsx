// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../src/__tests__/desktop-shell-controller.test.ts
import { Redirect } from 'expo-router'
import { isDesktopControlSurfaceEnabled } from '../../src/utils/controlSurfaceLayout'
import { roomIdFromWebPathname } from '../../src/features/rooms/roomWebDeepLink'
import { useDesktopShellController } from '../../src/features/desktop-shell/DesktopShellController'
import { getDesktopInitialWorkspaceRoute } from '../../src/features/desktop-shell/desktopInitialWorkspaceRoute'
import { desktopShellWindowState } from '../../src/features/desktop-shell/desktopShellWindowState'
import { useAuthStore } from '../../src/config/auth'
import {
  readDesktopCrashRecoveryRoute,
  resolveDesktopRecoveryHref,
} from '../../src/utils/desktopCrashRecovery'

export default function DesktopHomeRoute() {
  if (!isDesktopControlSurfaceEnabled()) {
    const roomId = typeof window === 'undefined' ? null : roomIdFromWebPathname(window.location.pathname)
    return roomId ? <Redirect href={{ pathname: '/spaces/[roomId]', params: { roomId } }} /> : <Redirect href="/(auth)/login" />
  }
  return <DesktopInitialConversation />
}

function DesktopInitialConversation() {
  const { initialSessionId } = useDesktopShellController()
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const recoveryHref = accountId ? resolveDesktopRecoveryHref(
    desktopShellWindowState.get(accountId).href,
    readDesktopCrashRecoveryRoute({ enabled: true, accountId }),
  ) : null
  return <Redirect href={(recoveryHref ?? getDesktopInitialWorkspaceRoute(initialSessionId)) as never} />
}
