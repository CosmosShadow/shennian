import { ActionIcon } from '../src/components/ActionIcon'
// @arch docs/features/free-growth-phase.md
// @test src/__tests__/privacy-simplification.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { Link, Redirect } from 'expo-router'
import { createElement, useCallback } from 'react'
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { ContactOptions } from '../src/features/contact/ContactOptions'

const AMBIENT_IMAGE = '/landing/shennian-ambient-v2.webp'
const SUPPORT_EMAIL = 'lichenarthurdata@gmail.com'

const COPY = {
  zh: {
    language: 'EN',
    languageLabel: 'Switch to English',
    eyebrow: '支持',
    title: '需要帮助？',
    description: '查看安装、配对、群聊、语音通话与远程接管指南，或直接联系我们。',
    guideTitle: '使用指南',
    guideDescription: '选择手机或桌面版，连接电脑、准备 AI 并开始使用。',
    privacyTitle: '隐私与账号',
    privacyDescription: '了解数据处理、保留期限与账号注销。',
    emailTitle: '邮件支持',
    back: '返回神念首页',
  },
  en: {
    language: '中',
    languageLabel: '切换到中文',
    eyebrow: 'SUPPORT',
    title: 'How can we help?',
    description:
      'Find help for setup, pairing, rooms, voice calls, and remote Agent control—or contact us directly.',
    guideTitle: 'User guide',
    guideDescription: 'Choose mobile or desktop, connect a computer, prepare an AI and get started.',
    privacyTitle: 'Privacy and account',
    privacyDescription: 'Review data handling, retention, and account deletion.',
    emailTitle: 'Email support',
    back: 'Back to Shennian',
  },
} as const

export default function SupportPage() {
  if (Platform.OS !== 'web') return <Redirect href="/" />
  return <SupportContent />
}

function SupportContent() {
  const { i18n } = useTranslation()
  const { width } = useWindowDimensions()
  const isPhone = width < 640
  const language = i18n.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const copy = COPY[language]

  const toggleLanguage = useCallback(() => {
    const next = language === 'zh' ? 'en' : 'zh'
    void i18n.changeLanguage(next)
    try {
      localStorage.setItem('lang', next)
    } catch {
      // Language still changes when browser storage is unavailable.
    }
  }, [i18n, language])

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {createElement('img', {
          src: AMBIENT_IMAGE,
          alt: '',
          'aria-hidden': true,
          draggable: false,
          style: {
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            objectPosition: 'center center',
          },
        })}
        <View style={[StyleSheet.absoluteFillObject, styles.backgroundWash]} />
      </View>

      <View style={[styles.header, isPhone && styles.headerPhone]}>
        <Link href="/landing" style={styles.brandLink}>
          <Text style={styles.brand}>神念</Text>
        </Link>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.languageLabel}
          onPress={toggleLanguage}
          style={({ pressed }) => [styles.languageButton, pressed && styles.pressed]}
        >
          <Text style={styles.languageText}>{copy.language}</Text>
        </Pressable>
      </View>

      <View style={[styles.content, isPhone && styles.contentPhone]}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={[styles.title, isPhone && styles.titlePhone]}>{copy.title}</Text>
          <Text style={styles.description}>{copy.description}</Text>
        </View>

        <View style={[styles.panel, isPhone && styles.panelPhone]}>
          <View style={styles.linksColumn}>
            <SupportLink
              href="/docs"
              icon="book-outline"
              title={copy.guideTitle}
              description={copy.guideDescription}
            />
            <SupportLink
              href="/privacy"
              icon="shield-checkmark-outline"
              title={copy.privacyTitle}
              description={copy.privacyDescription}
            />
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              style={({ pressed }) => [styles.supportLink, pressed && styles.pressed]}
            >
              <View style={styles.linkIcon}>
                <Ionicons name="mail-outline" size={22} color="#4262B4" />
              </View>
              <View style={styles.linkCopy}>
                <Text style={styles.linkTitle}>{copy.emailTitle}</Text>
                <Text style={styles.linkDescription}>{SUPPORT_EMAIL}</Text>
              </View>
              <Ionicons name="arrow-up-outline" size={18} color="#8390AD" />
            </Pressable>
          </View>

          <ContactOptions />
        </View>

        <Link href="/landing" style={styles.backLink}>
          <ActionIcon name="back" color="#4262B4" />
          <Text style={styles.backText}>{copy.back}</Text>
        </Link>
      </View>
    </ScrollView>
  )
}

function SupportLink({
  href,
  icon,
  title,
  description,
}: {
  href: '/docs' | '/privacy'
  icon: 'book-outline' | 'shield-checkmark-outline'
  title: string
  description: string
}) {
  return (
    <Link href={href} style={styles.supportLink}>
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={22} color="#4262B4" />
      </View>
      <View style={styles.linkCopy}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#8390AD" />
    </Link>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F7FF' },
  rootContent: { minHeight: '100dvh' as never },
  backgroundWash: {
    backgroundImage:
      'linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(248,251,255,0.86) 46%, rgba(232,241,255,0.72) 100%)',
  } as never,
  header: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  headerPhone: { paddingHorizontal: 20, paddingTop: 20 },
  brandLink: { textDecorationLine: 'none' },
  brand: { color: '#17213D', fontSize: 21, lineHeight: 28, fontWeight: '800', letterSpacing: 0.5 },
  languageButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(53, 83, 153, 0.16)',
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageText: { color: '#344970', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  content: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 82,
    paddingBottom: 48,
    zIndex: 1,
  },
  contentPhone: { paddingHorizontal: 20, paddingTop: 54 },
  intro: { maxWidth: 680, marginBottom: 34 },
  eyebrow: {
    color: '#4262B4',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    color: '#111A31',
    fontSize: 48,
    lineHeight: 58,
    fontWeight: '800',
    letterSpacing: -1.2,
    marginTop: 10,
  },
  titlePhone: { fontSize: 38, lineHeight: 46 },
  description: { color: '#53617E', fontSize: 18, lineHeight: 29, marginTop: 14, maxWidth: 640 },
  panel: {
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(57, 84, 144, 0.12)',
    borderRadius: 28,
    padding: 28,
    boxShadow: '0 24px 70px rgba(38, 63, 119, 0.12)',
    gap: 24,
  } as never,
  panelPhone: { borderRadius: 22, padding: 18 },
  linksColumn: { gap: 12 },
  supportLink: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(242,246,255,0.78)',
    textDecorationLine: 'none',
  },
  linkIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E7EEFF',
  },
  linkCopy: { flex: 1, minWidth: 0 },
  linkTitle: { color: '#17213D', fontSize: 17, lineHeight: 23, fontWeight: '700' },
  linkDescription: { color: '#66738E', fontSize: 14, lineHeight: 21, marginTop: 3 },
  backLink: {
    alignSelf: 'flex-start',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 26,
    paddingVertical: 10,
    textDecorationLine: 'none',
  },
  backText: { color: '#4262B4', fontSize: 14, lineHeight: 20, fontWeight: '700' },
})
