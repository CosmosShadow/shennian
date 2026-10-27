// @arch docs/architecture/mobile-navigation.md
import { useState } from 'react'
import { Alert, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { mobileFeatures } from '../../components/mobileFeatureRegistry'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { styles } from '../profile/styles'
import { useHomePreviews } from './useHomePreviews'
import { HomeEntryRow } from './HomeEntryRow'
import { DEFAULT_HOME_ENTRIES, HOME_ENTRY_KEYS, saveHomeEntry, useHomeEntries } from './homeEntryPreference'

export default function HomeSettingsScreen() {
  const router = useRouter()
  const accountId = useAuthStore(state => state.user?.id)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { entries, hydrated } = useHomeEntries(accountId)
  const previews = useHomePreviews(DEFAULT_HOME_ENTRIES)
  const [saving, setSaving] = useState(false)
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
    <AppPageHeader title={t('mobile_home_settings')} onBack={() => router.canGoBack() ? router.back() : router.replace('/(main)/(tabs)/settings')} />
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={[styles.settingsGroup, { backgroundColor: colors.groupedSurface }]}>
        {HOME_ENTRY_KEYS.map(key => {
          const feature = mobileFeatures.find(item => item.key === key)!
          return <HomeEntryRow key={key} entryKey={key} preview={previews[key]} accessory={
            <Switch testID={`home-entry-switch-${key}`} accessibilityLabel={t(feature.label)}
              value={entries[key]} disabled={!hydrated || saving || !accountId}
              onValueChange={enabled => {
                if (!accountId || saving) return
                setSaving(true)
                void saveHomeEntry(accountId, key, enabled).catch(() => Alert.alert(t('error_unknown'), t('mobile_navigation_save_failed')))
                  .finally(() => setSaving(false))
              }} />
          } />
        })}
      </View>
      <Text style={[styles.generalHint, { color: colors.textSecondary }]}>{t('mobile_home_settings_hint')}</Text>
    </ScrollView>
  </SafeAreaView>
}
