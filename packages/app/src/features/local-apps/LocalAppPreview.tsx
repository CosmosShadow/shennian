// @arch docs/architecture/local-apps.md
import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { getApiBaseUrl } from '../../config/api'
import { useTheme } from '../../hooks/useTheme'
import { localAppsClient, runtimeUrl } from './client'

/** A separate, noninteractive runtime with no native service bridge or account cookies. */
export function LocalAppPreview({ machineId, appId, revision, width }: { machineId: string; appId: string; revision: string; width: number }) {
  const token = useAuthStore(s => s.token), userId = useAuthStore(s => s.user?.id)
  const { colors } = useTheme(), { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false); setLoading(true)
    void localAppsClient.runtime(machineId, appId).then(runtime => {
      if (active && useAuthStore.getState().user?.id === userId) setUrl(runtimeUrl(getApiBaseUrl(), runtime.runtimePath))
    }).catch(() => { if (active) { setFailed(true); setLoading(false) } })
    return () => { active = false }
  }, [machineId, appId, revision, userId, token])
  const prefix = url?.match(/^(.+\/runtime\/[a-f0-9]{48}\/)/)?.[1]
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flex: 1, overflow: 'hidden', backgroundColor: colors.surface }}>
    {url && !failed && <View style={{ width: 375, height: 495, transform: [{ scale: width / 375 }], transformOrigin: 'top left' }}>
      <WebView key={url} source={{ uri: url, headers: { Authorization: `Bearer ${token}` } }}
        incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} javaScriptEnabled
        scrollEnabled={false} javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false}
        allowsInlineMediaPlayback={false} mediaPlaybackRequiresUserAction allowFileAccess={false} mixedContentMode="never"
        originWhitelist={['https://*']} onShouldStartLoadWithRequest={r => Boolean(prefix && r.url.startsWith(prefix))}
        onLoadEnd={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false) }}
        onHttpError={e => { if (e.nativeEvent.url === url && e.nativeEvent.statusCode >= 400) { setFailed(true); setLoading(false) } }}
        style={{ flex: 1, backgroundColor: colors.surface }} />
    </View>}
    {(loading || failed) && <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {failed ? <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>{t('local_preview_unavailable')}</Text> : <ActivityIndicator color={colors.textMuted} />}
    </View>}
  </View>
}
