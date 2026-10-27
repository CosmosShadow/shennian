// @arch docs/features/published-agent-direct-conversations.md
// Publication management uses the signed-in native app, not generic Web login.

import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../src/hooks/useTheme'
import { getMobileAppDownloadUrl } from '../src/platform/mobileAppDownload'

const copy = {
  zh: {
    title: '发布我的 AI',
    intro: '请在神念 App 中打开你拥有的 AI，进入发布设置。登录后可检查运行条件、设置公开介绍与额度，再确认发布。',
    install: '尚未安装神念 App？',
    ios: '下载 iPhone 版', android: '下载 Android 版',
    privacy: '浏览器不提供账号登录或 AI 发布管理。公开链接仍可在浏览器中与已发布的 AI 对话。',
  },
  en: {
    title: 'Publish my AI',
    intro: 'Open an AI you own in the Shennian app and go to its publication settings. After signing in, check runtime readiness, set its public profile and message limit, then confirm publication.',
    install: 'Need the Shennian app?',
    ios: 'Download for iPhone', android: 'Download for Android',
    privacy: 'The browser does not provide account sign-in or AI publication management. Public AI links still open one-to-one conversations in the browser.',
  },
} as const

export default function PublishRoute() {
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const { colors } = useTheme()
  return <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
    <Head><title>{t.title} · Shennian</title><meta name="robots" content="noindex,nofollow" /></Head>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.brand, { color: colors.brand }]}>Shennian · 神念</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t.title}</Text>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>{t.intro}</Text>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>{t.install}</Text>
      <View style={styles.downloads}>
        <Pressable accessibilityRole="link" style={styles.downloadLink}
          onPress={() => void Linking.openURL(getMobileAppDownloadUrl('ios'))}>
          <Text style={{ color: colors.brand }}>{t.ios}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" style={styles.downloadLink}
          onPress={() => void Linking.openURL(getMobileAppDownloadUrl('android'))}>
          <Text style={{ color: colors.brand }}>{t.android}</Text>
        </Pressable>
      </View>
      <Text style={[styles.privacy, { color: colors.textSecondary }]}>{t.privacy}</Text>
    </View>
  </ScrollView>
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 32 },
  card: { width: '100%', maxWidth: 600, borderWidth: 1, borderRadius: 18, padding: 24, gap: 18 },
  brand: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 27, fontWeight: '700' },
  intro: { fontSize: 14, lineHeight: 21 },
  downloads: { gap: 5 },
  downloadLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  privacy: { fontSize: 12, lineHeight: 18 },
})
