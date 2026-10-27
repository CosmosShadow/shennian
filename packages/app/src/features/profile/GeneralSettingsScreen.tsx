// @arch docs/features/free-growth-phase.md
// @test src/__tests__/profile-settings-structure.test.ts
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { persistWebLanguagePreference } from '../../config/i18n'
import { ChatFontSizeSettingRow } from './components/ChatFontSizeSettingRow'
import { styles } from './styles'

export default function GeneralSettingsScreen() {
  const router = useRouter()
  const { t, i18n } = useTranslation()
  const { colors, mode, isDark, setTheme } = useTheme()
  const themeLabel =
    mode === 'light' ? t('theme_light') : mode === 'dark' ? t('theme_dark') : t('theme_system')
  const cycleTheme = () => {
    setTheme(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light')
  }
  const toggleLang = async () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    await i18n.changeLanguage(next)
    if (Platform.OS === 'web') {
      persistWebLanguagePreference(next)
    } else {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default
        await AsyncStorage.setItem('lang', next)
      } catch {
        // Keep the existing in-memory language change if local persistence fails.
      }
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <AppPageHeader title={t('settings_general')} onBack={() => router.back()} />
      <ScrollView
        testID="general-settings-scroll-view"
        style={{ backgroundColor: isDark ? colors.bg : colors.surfaceHover }}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          {t('settings_display_section')}
        </Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.groupedSurface }]}>
          <ChatFontSizeSettingRow />
          <Pressable
            testID="settings-theme"
            accessibilityRole="button"
            style={[styles.subRow, { borderTopColor: colors.border }]}
            onPress={cycleTheme}
          >
            <Ionicons
              name={mode === 'light' ? 'sunny-outline' : mode === 'dark' ? 'moon-outline' : 'desktop-outline'}
              size={20}
              color={colors.textSecondary}
            />
            <Text style={[styles.rowLabel, { color: colors.text }]}>{t('theme')}</Text>
            <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{themeLabel}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            testID="settings-language"
            accessibilityRole="button"
            style={[styles.subRow, { borderTopColor: colors.border }]}
            onPress={() => void toggleLang()}
          >
            <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>{t('language')}</Text>
            <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
              {i18n.language === 'zh' ? t('lang_zh') : t('lang_en')}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            testID="settings-home-entries"
            accessibilityRole="button"
            style={[styles.subRow, { borderTopColor: colors.border }]}
            onPress={() => router.push('/(main)/home-settings')}
          >
            <Ionicons name="reorder-three-outline" size={20} color={colors.textSecondary} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>{t('mobile_home_settings')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
        <Text style={[styles.generalHint, { color: colors.textSecondary }]}>
          {t('settings_appearance_device_hint')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}
