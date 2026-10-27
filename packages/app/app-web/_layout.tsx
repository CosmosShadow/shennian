// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md#p5删除完整-web-专用代码
// @test ../../../scripts/__tests__/web-lite-route-root.test.mjs

import '../src/polyfills/nativeRuntime'
import { useEffect } from 'react'
import { NicknameSetupPrompt } from '../src/features/auth/components/NicknameSetupPrompt'
import { Stack } from 'expo-router'
import Head from 'expo-router/head'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { LightweightWebErrorBoundary } from '../src/components/LightweightWebErrorBoundary'
import { readWebLanguagePreference } from '../src/config/i18n'
import { useTheme } from '../src/hooks/useTheme'

export default function LightweightWebRootLayout() {
  const { t, i18n } = useTranslation()
  const { colors, isDark } = useTheme()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = readWebLanguagePreference()
    if (saved && saved !== i18n.language) void i18n.changeLanguage(saved)
  }, [i18n])

  return (
    <LightweightWebErrorBoundary>
      <Head>
        <title>{t('app_name')}</title>
      </Head>
      <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} hidden={false} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <NicknameSetupPrompt />
      </GestureHandlerRootView>
    </LightweightWebErrorBoundary>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
