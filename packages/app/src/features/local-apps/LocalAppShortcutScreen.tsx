// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { LocalApp } from '@shennian/wire'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useGoBack } from '../../hooks/useGoBack'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { getApiBaseUrl } from '../../config/api'
import { localAppsClient, runtimeUrl } from './client'
import { localAppErrorKey } from './errors'
import { resolveAppShortcut } from './shortcuts'
import { LocalAppView } from './LocalAppView'

export default function LocalAppShortcutScreen() {
  const { machineId, appId } = useLocalSearchParams<{ machineId: string; appId: string }>()
  const userId = useAuthStore((s) => s.user?.id)
  const close = useGoBack('/(main)/features')
  const { t } = useTranslation(),
    { colors } = useTheme()
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{
    key: string
    app?: LocalApp
    url?: string
    error?: string
  } | null>(null)
  const key = JSON.stringify([userId, machineId, appId, retry])
  useEffect(() => {
    let active = true
    const live = () => active && useAuthStore.getState().user?.id === userId
    void (async () => {
      try {
        if (!userId || typeof machineId !== 'string' || typeof appId !== 'string')
          throw new Error('invalid_app')
        const result = await resolveAppShortcut(machineId, appId, localAppsClient, live)
        if (result && live())
          setState({ key, app: result.app, url: runtimeUrl(getApiBaseUrl(), result.runtimePath) })
      } catch (error) {
        if (live()) setState({ key, error: localAppErrorKey(error) })
      }
    })()
    return () => {
      active = false
    }
  }, [key, userId, machineId, appId])
  const current = state?.key === key ? state : null
  if (current?.app && current.url)
    return (
      <LocalAppView
        key={key}
        app={current.app}
        machineId={machineId}
        url={current.url}
        onClose={close}
      />
    )
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppPageHeader title={t('content_entry')} onBack={close} />
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}
      >
        {current?.error ? (
          <>
            <Text style={{ color: colors.textSecondary }}>{t(current.error)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRetry((value) => value + 1)}
              style={{ padding: 12 }}
            >
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.brand} />
        )}
      </View>
    </SafeAreaView>
  )
}
