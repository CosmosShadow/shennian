// @arch docs/features/desktop-local-first-client.md#43-上一-stable-远程入口兼容
// @test ../../../scripts/__tests__/web-lite-route-root.test.mjs

import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../src/hooks/useTheme'

const DOWNLOAD_URL = 'https://shennian.net/#downloads'
const SUPPORT_URL = 'https://shennian.net/support'

export default function LegacyDesktopCompatibilityPage() {
  const { t } = useTranslation()
  const { colors } = useTheme()

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.content}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.mark, { backgroundColor: colors.brandLight }]}
        >
          <Text style={[styles.markText, { color: colors.brand }]}>念</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('legacy_desktop_upgrade_title')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('legacy_desktop_upgrade_body')}
        </Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {t('legacy_desktop_upgrade_safety')}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('legacy_desktop_upgrade_action')}
          onPress={() => void Linking.openURL(DOWNLOAD_URL)}
          style={({ pressed }) => [
            styles.primaryAction,
            { backgroundColor: pressed ? colors.brandDark : colors.brand },
          ]}
        >
          <Text style={[styles.primaryActionText, { color: colors.bg }]}>
            {t('legacy_desktop_upgrade_action')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('legacy_desktop_upgrade_support')}
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          style={styles.secondaryAction}
        >
          <Text style={[styles.secondaryActionText, { color: colors.brand }]}>
            {t('legacy_desktop_upgrade_support')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 560,
    width: '100%',
  },
  mark: {
    alignItems: 'center',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    marginBottom: 24,
    width: 48,
  },
  markText: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  title: { fontSize: 28, fontWeight: '700', lineHeight: 36, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, marginTop: 16, textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
  primaryAction: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 32,
    minHeight: 48,
    paddingHorizontal: 24,
    width: '100%',
  },
  primaryActionText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryActionText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
})
