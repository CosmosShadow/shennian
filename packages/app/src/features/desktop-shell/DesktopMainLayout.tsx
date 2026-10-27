// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-main-layout.test.ts
import { useState } from 'react'
import { Redirect, Slot, usePathname, useRouter } from 'expo-router'
import { Alert, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { AttachSheet } from '../../components/sheets'
import { DesktopCreateProjectSheet } from '../desktop-projects/DesktopCreateProjectSheet'
import { DesktopProjectLaunchSheet } from '../desktop-launch/DesktopProjectLaunchSheet'
import { KeyboardShortcutsSheet } from '../../components/KeyboardShortcutsSheet'
import { isDesktopControlSurfaceEnabled } from '../../utils/controlSurfaceLayout'
import { roomAuthRedirectPathname } from '../rooms/roomWebDeepLink'
import { DesktopWorkspaceLayout } from './DesktopWorkspaceLayout'
import {
  DesktopShellControllerError,
  DesktopShellControllerProvider,
  useDesktopShellController,
} from './DesktopShellController'

/** The complete browser route tree is a packaged Desktop surface, never a Web-lite fallback. */
export default function DesktopMainLayout() {
  if (!isDesktopControlSurfaceEnabled()) throw new Error('Desktop runtime is required for this workspace')
  return (
    <DesktopShellControllerProvider>
      <DesktopAccountWorkspace />
    </DesktopShellControllerProvider>
  )
}

function DesktopAccountWorkspace() {
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const { colors } = useTheme()
  const { t } = useTranslation()
  const pathname = usePathname()
  const router = useRouter()
  const shell = useDesktopShellController()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useKeyboardShortcut({ key: '/', metaOrCtrl: true }, true, () => setShortcutsOpen(true))
  // Consume the native browser new-window key. New tasks belong to their project's explicit + action.
  useKeyboardShortcut({ key: 'n', metaOrCtrl: true, allowEditable: true }, true, () => {})
  if (!isAuthenticated) {
    const browserPathname = typeof window === 'undefined' ? undefined : window.location.pathname
    const redirect = roomAuthRedirectPathname(pathname, browserPathname)
    return <Redirect href={{ pathname: '/(auth)/login', params: { redirect } }} />
  }
  const deleteSession = async (id: string) => {
    try {
      await shell.deleteSession(id)
      if (pathname === `/chat/${id}` || pathname === `/(main)/chat/${id}`) router.replace('/(main)')
    } catch (error) {
      Alert.alert(
        t('delete_session_failed'),
        error instanceof DesktopShellControllerError && error.code === 'OFFLINE'
          ? t('delete_session_offline')
          : error instanceof Error ? error.message : String(error),
      )
    }
  }
  return (
      <View testID="desktop-main-workspace" style={{ flex: 1, backgroundColor: colors.bg }}>
        <style>{'[data-testid="desktop-main-workspace"] { -webkit-font-smoothing: antialiased; }'}</style>
        <DesktopWorkspaceLayout onDeleteSession={deleteSession}>
          <Slot />
        </DesktopWorkspaceLayout>
        <DesktopCreateProjectSheet />
        <AttachSheet />
        <DesktopProjectLaunchSheet />
        <KeyboardShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </View>
  )
}
