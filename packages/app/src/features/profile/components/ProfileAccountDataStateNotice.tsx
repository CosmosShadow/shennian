// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/desktop-page-state-coverage.test.ts

import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { SettingsAccountUiState } from '../settingsAccountUiState'
import { styles } from '../styles'

export function ProfileAccountDataStateNotice({
  state,
  retry,
}: {
  state: SettingsAccountUiState
  retry: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (state === 'ready') return null
  if (state === 'initial-loading') {
    return (
      <View
        testID="desktop-settings-initial-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={t('loading')}
        style={styles.accountDataStateNotice}
      >
        <ActivityIndicator size="small" color={colors.brand} />
        <Text style={[styles.accountDataStateText, { color: colors.textSecondary }]}>
          {t('loading')}
        </Text>
      </View>
    )
  }

  if (state === 'empty') {
    return (
      <View testID="desktop-settings-account-data-empty" style={styles.accountDataStateNotice}>
        <Text style={[styles.accountDataStateText, { color: colors.textSecondary }]}>
          {t('no_machines')} · {t('devices_empty_hint')}
        </Text>
      </View>
    )
  }

  const failed = state === 'recoverable-error'
  return (
    <View
      testID={
        failed ? 'desktop-settings-account-data-error' : 'desktop-settings-account-data-offline'
      }
      accessibilityRole={failed ? 'alert' : 'text'}
      style={[styles.accountDataStateNotice, { backgroundColor: colors.surfaceHover }]}
    >
      <Text style={[styles.accountDataStateText, { color: colors.textSecondary }]}>
        {t(failed ? 'account_security_load_failed' : 'machines_cached_offline_title')}
      </Text>
      {failed ? (
        <Pressable
          testID="desktop-settings-account-data-retry"
          accessibilityRole="button"
          accessibilityLabel={t('retry')}
          onPress={() => void retry()}
        >
          <Text style={[styles.accountDataStateAction, { color: colors.brand }]}>{t('retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
