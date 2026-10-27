import { RecoverableSection } from '../src/components/RecoverableSection'
import { renderRecoverableScreen } from '../src/components/RecoverableScreen'
import { DownloadFeedbackHost } from '../src/components/DownloadFeedback'
// @arch docs/features/desktop-appearance-language-preferences.md

import '../src/polyfills/nativeRuntime'
import '../src/features/personal-modules/locationTracking'
import { useEffect, useRef, useState } from 'react'
import { NicknameSetupPrompt } from '../src/features/auth/components/NicknameSetupPrompt'
import { Stack } from 'expo-router'
import Head from 'expo-router/head'
import * as WebBrowser from 'expo-web-browser'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Platform, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../src/config/auth'
import { validateStoredSession } from '../src/config/authSession'
import { usePushNotifications } from '../src/hooks/usePushNotifications'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { useTheme } from '../src/hooks/useTheme'
import { getNativeStatusBarOptions } from '../src/theme/nativeStatusBar'
import { hydrateLaunchStorage } from '../src/utils/launchStorage'
import { initAppLogReporter } from '../src/config/log'
import { hydrateChatDraftStorage } from '../src/features/chat/utils/draftStorage'
import { hydrateChatOutboundStorage } from '../src/features/chat/utils/outboundStorage'
import { hydrateRoomDraftStorage } from '../src/features/rooms/roomDraftStorage'
import { hydrateProjectPrefs } from '../src/features/projects/utils/projectPrefs'
import { readWebLanguagePreference } from '../src/config/i18n'
import { hydrateInstallationId } from '../src/features/auth/utils/installation'
import { db } from '../src/storage/db'
import { clearRoomListSnapshots } from '../src/features/rooms/roomListCache'
import { clearAgentListSnapshots } from '../src/features/agents/agentListCache'
import { hydrateProfileDevices } from '../src/config/profileDevices'
import { isDesktopControlSurfaceEnabled } from '../src/utils/controlSurfaceLayout'
import { isInitialAppReady } from '../src/features/desktop-onboarding/desktopStartupReadiness'
import { hydrateMobileRootTabPreference } from '../src/components/mobileRootTabPreference'

initAppLogReporter()

export default function RootLayout() {
  const isServer = typeof window === 'undefined'
  const isWeb = Platform.OS === 'web'
  const isSingleRoomWeb =
    isWeb &&
    !isServer &&
    /^\/spaces\/[^/]+\/?$/.test(window.location.pathname)
  const isDesktopSurface = isWeb && isDesktopControlSurfaceEnabled()
  const [ready, setReady] = useState(() => isInitialAppReady({
    server: isServer,
    web: isWeb,
    desktop: isDesktopSurface,
    singleRoomWeb: isSingleRoomWeb,
  }))
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage)
  const accountId = useAuthStore((s) => s.user?.id ?? null)
  const previousAccountId = useRef<string | null>(null)
  const { t, i18n } = useTranslation()
  usePushNotifications()

  useEffect(() => {
    if (isWeb) return
    const previous = previousAccountId.current
    previousAccountId.current = accountId
    if (!previous || previous === accountId) return
    clearRoomListSnapshots()
    clearAgentListSnapshots()
    void db.clearAll()
  }, [accountId, isWeb])

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      typeof window === 'undefined' ||
      isDesktopControlSurfaceEnabled()
    ) return
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = readWebLanguagePreference()
        if (saved && saved !== i18n.language) {
          void i18n.changeLanguage(saved)
        }
      } catch {
        // Storage may be unavailable in privacy-restricted browser contexts.
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [i18n])

  useEffect(() => {
    if (isSingleRoomWeb) return
    WebBrowser.maybeCompleteAuthSession()
  }, [isSingleRoomWeb])

  useEffect(() => {
    if (isSingleRoomWeb) {
      setReady(true)
      return
    }
    if (isWeb) {
      loadFromStorage()
        .catch(() => {})
        .finally(() => setReady(true))
      return
    }
    let mounted = true
    const loadAuth = async () => {
      await Promise.all([loadFromStorage(), hydrateInstallationId()])
      await hydrateProfileDevices(useAuthStore.getState().user?.id)
      validateStoredSession().catch(() => {})
    }

    Promise.all([
      loadAuth(),
      hydrateLaunchStorage(),
      hydrateChatDraftStorage(),
      hydrateChatOutboundStorage(),
      hydrateRoomDraftStorage(),
      hydrateProjectPrefs(),
      hydrateMobileRootTabPreference(),
    ]).catch((err) => {
      console.warn('App startup hydration failed', err)
    }).finally(() => {
      if (mounted) setReady(true)
    })

    return () => {
      mounted = false
    }
  }, [isWeb, loadFromStorage])

  const { colors, isDark } = useTheme()

  if (!ready) return <View style={[styles.root, { backgroundColor: colors.bg }]} />

  return (
    <ErrorBoundary>
      {Platform.OS === 'web' && (
        <Head>
          <title>{t('app_name')}</title>
        </Head>
      )}
      <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
        <Stack
          screenLayout={renderRecoverableScreen}
          screenOptions={{
            ...getNativeStatusBarOptions(isDark),
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <RecoverableSection scope="overlays"><NicknameSetupPrompt /></RecoverableSection>
        <RecoverableSection scope="overlays"><DownloadFeedbackHost /></RecoverableSection>
      </GestureHandlerRootView>
    </ErrorBoundary>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
