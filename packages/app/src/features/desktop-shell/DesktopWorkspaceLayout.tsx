import { DesktopScrollbarStyles } from './DesktopScrollbarStyles'
// @arch docs/design/desktop/unified-desktop-control.md

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { useGlobalSearchParams, usePathname } from 'expo-router'
import { useDesktopNavigationRouter as useRouter } from './useDesktopNavigationRouter'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { DesktopSidebar } from './DesktopSidebar'
import { DesktopSidebarResizeHandle } from './DesktopSidebarResizeHandle'
import { desktopShellWindowState } from './desktopShellWindowState'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import {
  DesktopProjectFilesControllerProvider,
  useDesktopProjectFilesController,
} from '../desktop-files/DesktopProjectFilesController'
import { DesktopProjectFilePreviewPanel } from '../desktop-files/DesktopProjectFilePreviewPanel'
import {
  isDesktopWorkspaceRoot,
  recordDesktopCrashRecoveryRoute,
} from '../../utils/desktopCrashRecovery'
import {
  captureDesktopSettingsReturnLocation,
  isDesktopSettingsPath,
  readDesktopWindowHref,
  resolveDesktopSettingsReturnFocusTestId,
} from '../../utils/desktopSettingsNavigation'
import {
  DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH,
  getCompactDesktopSidebarWidth,
  getDesktopSidebarWidth,
  shouldUseCompactDesktopNavigation,
} from './desktopSidebarWidth'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { getDesktopControlBridge } from '../desktop-control/bridge'
import { desktopControlMetrics } from './desktopDesignTokens'

const desktopRailDragStyle: ViewStyle & { WebkitAppRegion?: 'drag' } = {
  WebkitAppRegion: 'drag',
}
const desktopNoDragStyle: ViewStyle & { WebkitAppRegion?: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
}

type Props = {
  children: ReactNode
  onDeleteSession?: (id: string) => void
}

export function DesktopWorkspaceLayout({ children, onDeleteSession }: Props) {
  const pathname = usePathname()
  const routeParams = useGlobalSearchParams()
  const routeParamsKey = JSON.stringify(routeParams)
  const currentHref = readDesktopWindowHref(pathname)
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const settingsOpen = isDesktopSettingsPath(pathname)
  const lastWorkspaceHref = useRef({
    accountId,
    href: settingsOpen ? (desktopShellWindowState.get(accountId ?? '').href ?? '/') : currentHref,
  })
  const settingsWasOpen = useRef(settingsOpen)
  const lastWorkspaceFocusTestId = useRef<string | null>(null)

  useEffect(() => {
    if (settingsOpen || typeof document === 'undefined') return
    const rememberWorkspaceFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const testId = target.dataset.testid
      if (testId) lastWorkspaceFocusTestId.current = testId
    }
    document.addEventListener('focusin', rememberWorkspaceFocus)
    return () => document.removeEventListener('focusin', rememberWorkspaceFocus)
  }, [settingsOpen])
  useEffect(() => {
    if (settingsOpen) {
      const href =
        lastWorkspaceHref.current.accountId === accountId
          ? lastWorkspaceHref.current.href
          : (desktopShellWindowState.get(accountId ?? '').href ?? '/')
      captureDesktopSettingsReturnLocation(href)
      return
    }
    const frame = requestAnimationFrame(() => {
      lastWorkspaceHref.current = { accountId, href: readDesktopWindowHref(pathname) }
    })
    return () => cancelAnimationFrame(frame)
  }, [accountId, pathname, routeParamsKey, settingsOpen])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const wasOpen = settingsWasOpen.current
    settingsWasOpen.current = settingsOpen
    const testId = settingsOpen
      ? 'desktop-settings-back'
      : wasOpen
        ? resolveDesktopSettingsReturnFocusTestId(lastWorkspaceFocusTestId.current)
        : null
    if (!testId) return
    const frame = requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-testid]')).find(
        (candidate) => candidate.dataset.testid === testId,
      )
      const fallback = document.querySelector<HTMLElement>('[data-testid="sidebar-open-settings"]')
      const focusTarget = target ?? fallback
      focusTarget?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [settingsOpen])

  useEffect(() => {
    if (!accountId || settingsOpen || isDesktopWorkspaceRoot(pathname)) return
    // Expo Router publishes pathname before history updates window.location.
    // Read the final URL on the next frame so a navigation never saves the page
    // that was just left. Global params also make same-path selection changes rerun.
    const frame = requestAnimationFrame(() => {
      const href = readDesktopWindowHref(pathname)
      desktopShellWindowState.recordLocation(accountId, href)
      recordDesktopCrashRecoveryRoute(href, {
        enabled: true,
        accountId,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [accountId, pathname, routeParamsKey, settingsOpen])

  return (
    <DesktopProjectFilesControllerProvider>
      <DesktopWorkspaceSurface settingsOpen={settingsOpen} onDeleteSession={onDeleteSession}>
        {children}
      </DesktopWorkspaceSurface>
    </DesktopProjectFilesControllerProvider>
  )
}

function DesktopWorkspaceSurface({
  children,
  settingsOpen,
  onDeleteSession,
}: Props & { settingsOpen: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const router = useRouter()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const pathname = usePathname()
  const projectFiles = useDesktopProjectFilesController()
  const compactNavigation = shouldUseCompactDesktopNavigation(width)
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false)
  const sidebarVisible = useSyncExternalStore(
    desktopShellWindowState.subscribe,
    () => desktopShellWindowState.get(accountId).navigation.sidebarVisible,
    () => desktopShellWindowState.get(accountId).navigation.sidebarVisible,
  )
  const previousSidebarVisible = useRef(sidebarVisible)
  const previewOpen = Boolean(projectFiles.state.preview) && !settingsOpen
  const previewAsMain = previewOpen && width < 1120
  const preferredWidth = useSyncExternalStore(desktopShellWindowState.subscribe,
    () => desktopShellWindowState.get(accountId).panels.navigationWidth ?? null,
    () => desktopShellWindowState.get(accountId).panels.navigationWidth ?? null)
  const [widthPreview, setWidthPreview] = useState<{ accountId: string; viewport: number; width: number } | null>(null)
  const sidebarWidth = getDesktopSidebarWidth(width,
    widthPreview?.accountId === accountId && widthPreview.viewport === width ? widthPreview.width : preferredWidth)
  useEffect(() => setWidthPreview(null), [accountId, width, sidebarVisible, settingsOpen])
  const compactSidebarWidth = getCompactDesktopSidebarWidth(width)
  const showWorkspaceNavigation = !settingsOpen
  const closeCompactNavigation = useCallback(() => {
    setCompactNavigationOpen(false)
    if (typeof document === 'undefined') return
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="desktop-navigation-toggle"]')?.focus()
    })
  }, [])
  const toggleWorkspaceNavigation = useCallback(() => {
    if (settingsOpen) return
    if (compactNavigation) {
      setCompactNavigationOpen((open) => !open)
      return
    }
    desktopShellWindowState.updateNavigation(accountId, (navigation) => ({
      ...navigation,
      sidebarVisible: !navigation.sidebarVisible,
    }))
  }, [accountId, compactNavigation, settingsOpen])

  useEffect(() => {
    const bridge = getDesktopControlBridge()
    return bridge?.app?.subscribeCommands?.((event) => {
      if (event.command === 'open-settings') {
        router.navigate('/(main)/profile')
        return
      }
      if (event.command === 'toggle-sidebar') toggleWorkspaceNavigation()
    })
  }, [router, toggleWorkspaceNavigation])

  useEffect(() => {
    if (!compactNavigation) setCompactNavigationOpen(false)
  }, [compactNavigation])

  useEffect(() => {
    if (compactNavigation) setCompactNavigationOpen(false)
  }, [compactNavigation, pathname])

  useEffect(() => {
    const wasVisible = previousSidebarVisible.current
    previousSidebarVisible.current = sidebarVisible
    if (
      compactNavigation ||
      settingsOpen ||
      wasVisible === sidebarVisible ||
      typeof document === 'undefined'
    )
      return
    const frame = requestAnimationFrame(() => {
      const selector = sidebarVisible
        ? '[data-testid="desktop-workspace-sidebar"] [aria-selected="true"]'
        : '[data-testid="desktop-navigation-toggle"]'
      document.querySelector<HTMLElement>(selector)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [compactNavigation, settingsOpen, sidebarVisible])

  useEscapeKey(compactNavigation && compactNavigationOpen, closeCompactNavigation)

  return (
    <View style={styles.container}>
      <DesktopScrollbarStyles />
      {showWorkspaceNavigation && !compactNavigation && sidebarVisible ? (
        <View
          testID="desktop-workspace-sidebar"
          style={[styles.sidebarVisible, { width: sidebarWidth }]}
        >
          <DesktopSidebar key={accountId} width={sidebarWidth} onDeleteSession={onDeleteSession} />
          <DesktopSidebarResizeHandle
            key={`${accountId}:${width}`}
            width={sidebarWidth}
            windowWidth={width}
            onPreview={value => setWidthPreview(value === null ? null : { accountId, viewport: width, width: value })}
            onCommit={value => desktopShellWindowState.setNavigationWidth(accountId, value)}
          />
        </View>
      ) : null}
      {showWorkspaceNavigation && (compactNavigation || !sidebarVisible) ? (
        <View
          testID="desktop-navigation-rail"
          style={[
            styles.compactNavigationRail,
            {
              width: DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH,
              backgroundColor: colors.sidebarBackground,
              borderRightColor: colors.border,
            },
            desktopRailDragStyle,
          ]}
        >
          <Pressable
            testID="desktop-navigation-toggle"
            style={({ pressed }) => [
              styles.compactNavigationToggle,
              { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
              desktopNoDragStyle,
            ]}
            onPress={toggleWorkspaceNavigation}
            accessibilityRole="button"
            accessibilityLabel={
              (compactNavigation ? compactNavigationOpen : sidebarVisible)
                ? t('desktop_hide_navigation')
                : t('desktop_show_navigation')
            }
            accessibilityState={{
              expanded: compactNavigation ? compactNavigationOpen : sidebarVisible,
            }}
          >
            <Ionicons
              name={compactNavigationOpen ? 'close-outline' : 'menu-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
      ) : null}
      <View
        testID={settingsOpen ? 'desktop-settings-surface' : 'desktop-workspace-surface'}
        style={[
          styles.content,
          { backgroundColor: colors.bg },
          previewAsMain ? styles.contentHidden : null,
        ]}
        accessibilityElementsHidden={previewAsMain}
        importantForAccessibility={previewAsMain ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {previewOpen ? (
        <View style={previewAsMain ? styles.previewMain : styles.previewSide}>
          <DesktopProjectFilePreviewPanel />
        </View>
      ) : null}
      {showWorkspaceNavigation && compactNavigation && compactNavigationOpen ? (
        <>
          <Pressable
            testID="desktop-navigation-dismiss"
            style={[styles.compactNavigationScrim, { left: DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH }]}
            onPress={closeCompactNavigation}
            accessibilityRole="button"
            accessibilityLabel={t('desktop_hide_navigation')}
          />
          <View
            testID="desktop-workspace-sidebar"
            accessibilityViewIsModal
            style={[
              styles.compactNavigationOverlay,
              {
                left: DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH,
                width: compactSidebarWidth,
                shadowColor: colors.text,
              },
            ]}
          >
            <DesktopSidebar
              key={accountId}
              width={compactSidebarWidth}
              onDeleteSession={onDeleteSession}
            />
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  sidebarVisible: { flexShrink: 0, minHeight: 0, alignSelf: 'stretch' },
  contentHidden: { display: 'none' },
  previewSide: { width: 480, maxWidth: '44%', flexShrink: 0 },
  previewMain: { flex: 1, minWidth: 0 },
  compactNavigationRail: {
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: desktopControlMetrics.headerHeight,
    borderRightWidth: StyleSheet.hairlineWidth,
    zIndex: 50,
  },
  compactNavigationToggle: {
    width: 44,
    height: 44,
    marginTop: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactNavigationScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
  compactNavigationOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 40,
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 18,
  },
})
