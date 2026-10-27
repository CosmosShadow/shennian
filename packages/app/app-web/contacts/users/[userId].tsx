// @arch docs/features/network-rooms/core-data-and-security-decisions.md
// The browser entry only hands a person link to the native app.

import { useEffect, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import Head from 'expo-router/head'
import { useTranslation } from 'react-i18next'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../../src/hooks/useTheme'
import { getMobileAppDownloadUrl } from '../../../src/platform/mobileAppDownload'

const USER_ID = /^[A-Za-z0-9_-]{8,64}$/

const copy = {
  zh: {
    title: '神念个人资料',
    intro: '这是一个神念个人资料链接。请在神念 App 中打开，登录后查看对方分享的资料，再决定是否保存为联系人。',
    open: '在神念 App 中打开',
    install: '尚未安装？下载神念 App，安装后重新打开此链接。',
    ios: '下载 iPhone 版',
    android: '下载 Android 版',
    invalid: '这个个人资料链接无效。',
    openFailed: '无法打开神念 App。请先安装 App，再重新打开此链接。',
    privacy: '浏览器不会读取个人资料或保存联系人，也不会展示手机号、私有对话或该用户的 AI 列表。',
  },
  en: {
    title: 'Shennian profile',
    intro: 'This is a Shennian profile link. Open it in the Shennian app, sign in to view the details this person shared, then decide whether to save them as a contact.',
    open: 'Open in the Shennian app',
    install: 'Need the app? Install it, then open this link again.',
    ios: 'Download for iPhone',
    android: 'Download for Android',
    invalid: 'This profile link is invalid.',
    openFailed: 'Could not open the Shennian app. Install it, then open this link again.',
    privacy: 'The browser does not load profiles or save contacts. It does not show phone numbers, private conversations, or this person’s AI list.',
  },
} as const

export default function PersonalIdentityWebRoute() {
  const params = useLocalSearchParams<{ userId: string }>()
  const userId = typeof params.userId === 'string' ? params.userId : ''
  const { i18n } = useTranslation()
  const t = i18n.language.startsWith('zh') ? copy.zh : copy.en
  const { colors } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const validUserId = USER_ID.test(userId)
  const invalidUserId = Boolean(userId && userId !== '[userId]' && !validUserId)

  useEffect(() => { setMounted(true) }, [])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Head>
        <title>{t.title} · Shennian</title>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Head>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.brand, { color: colors.brand }]}>Shennian · 神念</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t.title}</Text>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>{t.intro}</Text>
        {mounted && invalidUserId ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{t.invalid}</Text> : null}
        {mounted && validUserId ? <Pressable accessibilityRole="link"
          style={[styles.primary, { backgroundColor: colors.brand }]}
          onPress={() => void Linking.openURL(`shennian:///contacts/users/${encodeURIComponent(userId)}`)
            .catch(() => setOpenFailed(true))}>
          <Text style={styles.primaryText}>{t.open}</Text>
        </Pressable> : null}
        {openFailed ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{t.openFailed}</Text> : null}
        <View style={styles.downloads}>
          <Text style={[styles.intro, { color: colors.textSecondary }]}>{t.install}</Text>
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
  )
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 32 },
  card: { width: '100%', maxWidth: 600, borderWidth: 1, borderRadius: 18, padding: 24, gap: 18 },
  brand: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 27, fontWeight: '700' },
  intro: { fontSize: 14, lineHeight: 21 },
  primary: { alignSelf: 'stretch', minHeight: 48, borderRadius: 12,
    paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  downloads: { gap: 5 },
  downloadLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  privacy: { fontSize: 12, lineHeight: 18 },
})
