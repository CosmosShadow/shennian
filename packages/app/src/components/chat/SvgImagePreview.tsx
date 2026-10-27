// @arch docs/architecture/app/chat-attachments-preview.md#预览缓存策略
// @test src/__tests__/native-image-preview-cache.test.ts

import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Platform, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

/** Render SVG as an image, never as an executable inline document. */
export function SvgImagePreview({ uri, label }: { uri: string; label: string }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [source, setSource] = useState<{ uri: string; data: string } | null>(null)
  const [failedUri, setFailedUri] = useState<string | null>(null)
  useEffect(() => {
    if (Platform.OS === 'web') return
    let cancelled = false
    setFailedUri(null)
    void (async () => {
      let data = uri
      if (uri.startsWith('file:') || uri.startsWith('content:')) {
        const { File } = await import('expo-file-system')
        data = `data:image/svg+xml;base64,${await new File(uri).base64()}`
      }
      if (!cancelled) setSource({ uri, data })
    })().catch(() => {
      if (!cancelled) setFailedUri(uri)
    })
    return () => {
      cancelled = true
    }
  }, [uri])

  if (Platform.OS === 'web') {
    return (
      <Image source={{ uri }} accessibilityLabel={label} resizeMode="contain" style={{ flex: 1 }} />
    )
  }
  if (failedUri === uri) {
    return <Text style={{ color: colors.errorText }}>{t('spaces_attachment_preview_failed')}</Text>
  }
  if (source?.uri !== uri) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel={t('loading')} />
      </View>
    )
  }
  const escaped = source.data.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<style>html,body{margin:0;width:100%;height:100%;background:${colors.bg}}img{width:100%;height:100%;object-fit:contain}</style>
</head><body><img src="${escaped}"></body></html>`
  return (
    <WebView
      accessibilityLabel={label}
      source={{ html, baseUrl: 'about:blank' }}
      originWhitelist={['about:blank']}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
      onError={() => setFailedUri(uri)}
      style={{ flex: 1, backgroundColor: colors.bg }}
    />
  )
}
