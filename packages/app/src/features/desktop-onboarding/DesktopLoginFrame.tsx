// @arch docs/features/desktop-login-and-first-use.md
// @test ../../__tests__/desktop-login-and-first-use.test.ts

import type { ReactNode } from 'react'
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AccessibleButton } from '../../components/AccessibleButton'
import type { Colors } from '../../hooks/useTheme'
import { getDesktopEntryIntent } from './desktopEntryState'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

const logoSource = require('../../../public/logo-192.png')

type Props = {
  children: ReactNode
  colors: Colors
  height: number
  redirectTo: string
  title: string
  onToggleLanguage: () => void | Promise<void>
  onOpenPrivacy: () => void
}

export function DesktopLoginFrame({
  children,
  colors,
  height,
  redirectTo,
  title,
  onToggleLanguage,
  onOpenPrivacy,
}: Props) {
  const { t, i18n } = useTranslation()
  const intent = getDesktopEntryIntent(redirectTo)
  const intentKey = intent.kind === 'room'
    ? 'desktop_login_continue_room'
    : intent.kind === 'machine-invite'
      ? 'desktop_login_continue_machine_invite'
      : intent.kind === 'authorization'
        ? 'desktop_login_continue_authorization'
        : null

  return (
    <View testID="desktop-login-surface" style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        style={styles.topBar}
        {...{ dataSet: { desktopDrag: 'true' } }}
      >
        <AccessibleButton
          accessibilityLabel={i18n.language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
          style={[styles.languageButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          onPress={() => void onToggleLanguage()}
          {...{ dataSet: { desktopNoDrag: 'true' } }}
        >
          <Text style={[styles.languageText, { color: colors.text }]}>
            {i18n.language === 'zh' ? '中文 / EN' : 'EN / 中文'}
          </Text>
        </AccessibleButton>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, height < 640 && styles.contentCompact]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.panel}>
          <View style={styles.logoFrame}><Image source={logoSource} style={styles.logo} /></View>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('desktop_login_subtitle')}
          </Text>
          {intentKey ? (
            <View
              testID="desktop-login-intent"
              accessibilityLiveRegion="polite"
              style={[styles.intent, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}
            >
              <Text style={[styles.intentText, { color: colors.textSecondary }]}>{t(intentKey)}</Text>
            </View>
          ) : null}
          <View style={styles.form}>{children}</View>
          <Text style={[styles.legal, { color: colors.textSecondary }]}>
            {t('login_legal_prefix')}
            <Text accessibilityRole="link" style={{ color: colors.brand }} onPress={onOpenPrivacy}>
              {t('privacy_title')}
            </Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  topBar: { position: 'absolute', zIndex: 2, top: 0, left: 0, right: 0, height: desktopControlMetrics.headerHeight, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  languageButton: { minHeight: desktopControlMetrics.compactControlHeight, minWidth: desktopControlMetrics.compactControlHeight, paddingHorizontal: 12, borderRadius: desktopControlMetrics.radiusControl, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  languageText: desktopTypography.control,
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40 },
  contentCompact: { justifyContent: 'flex-start', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 24 },
  panel: { width: '100%', maxWidth: 420 },
  logoFrame: { width: 52, height: 52, borderRadius: 13, alignSelf: 'center', overflow: 'hidden', marginBottom: 16 },
  logo: { width: 52, height: 52 },
  title: { ...desktopTypography.pageTitle, textAlign: 'center' },
  subtitle: { marginTop: 5, ...desktopTypography.body, textAlign: 'center' },
  intent: { minHeight: 44, marginTop: 20, paddingHorizontal: 14, paddingVertical: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, justifyContent: 'center' },
  intentText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  form: { width: '100%', marginTop: 24 },
  legal: { marginTop: 24, fontSize: 12, lineHeight: 18, textAlign: 'center' },
})
