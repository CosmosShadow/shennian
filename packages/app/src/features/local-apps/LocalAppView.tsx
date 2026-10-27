// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import WebView from 'react-native-webview'
import type { LocalApp } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { localAppErrorKey } from './errors'
import { localAppsClient } from './client'
import { createPageServiceBridge } from './bridge'
export function LocalAppView({
  app,
  machineId,
  url,
  onClose,
}: {
  app: LocalApp
  machineId: string
  url: string
  onClose(): void
}) {
  const web = useRef<WebView>(null),
    { colors } = useTheme(),
    { t } = useTranslation()
  const token = useAuthStore((s) => s.token),
    userId = useAuthStore((s) => s.user?.id)
  const [loading, setLoading] = useState(true),
    [failure, setFailure] = useState<string | null>(null)
  const source = useRef({ uri: url, headers: { Authorization: `Bearer ${token}` } }).current
  const prefix = url.match(/^(.+\/runtime\/[a-f0-9]{48}\/)/)?.[1] ?? url
  const bridge = useMemo(
    () =>
      createPageServiceBridge(app, machineId, {
        alive: () => useAuthStore.getState().user?.id === userId,
        call: (input) => localAppsClient.service(machineId, input),
        deliver: (id, result) =>
          web.current?.injectJavaScript(
            `window.__shennianLocalResult(${JSON.stringify(id)},${JSON.stringify(result)});true;`,
          ),
      }),
    [app, machineId, userId],
  )
  useEffect(() => () => bridge.dispose(), [bridge])
  // Component is keyed by runtime URL + account. No private WebView survives switching.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppPageHeader
        title={app.title}
        hideDivider
        backTestID="local-app-back"
        onBack={() => {
          bridge.dispose()
          onClose()
        }}
        trailing={
          <HeaderIconButton
            icon="refresh-outline"
            label={t('local_refresh')}
            testID="local-app-refresh"
            onPress={() => web.current?.reload()}
          />
        }
      />
      <View style={{ flex: 1 }}>
        <WebView
          ref={web}
          source={source}
          incognito
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          javaScriptEnabled
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={false}
          originWhitelist={['https://*']}
          allowFileAccess={false}
          mixedContentMode="never"
          onShouldStartLoadWithRequest={(r) => r.url.startsWith(prefix)}
          onMessage={(event) => {
            if (event.nativeEvent.url.startsWith(prefix))
              void bridge.receive(event.nativeEvent.data)
          }}
          onLoadStart={() => {
            bridge.invalidate()
            setLoading(true)
            setFailure(null)
          }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            setFailure('local_unavailable')
          }}
          onHttpError={(e) => {
            if (e.nativeEvent.url === url && e.nativeEvent.statusCode >= 400)
              setFailure(localAppErrorKey({ status: e.nativeEvent.statusCode }))
          }}
          injectedJavaScriptBeforeContentLoaded={`(()=>{const apply=()=>{document.documentElement?.style.setProperty('--shennian-safe-top','0px');document.documentElement?.style.setProperty('--shennian-safe-bottom','0px');};apply();document.addEventListener('DOMContentLoaded',apply,{once:true});})();true;`}
        />
        {(loading || failure) && (
          <View
            style={{
              position: 'absolute',
              top: 12,
              alignSelf: 'center',
              backgroundColor: colors.surface,
              borderRadius: 18,
              padding: 12,
            }}
          >
            {failure ? (
              <Text style={{ color: colors.text }}>{t(failure)}</Text>
            ) : (
              <ActivityIndicator color={colors.brand} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}
