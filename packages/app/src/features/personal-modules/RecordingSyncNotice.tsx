// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { Alert, Pressable, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'

export function RecordingSyncNotice({
  syncError,
  archiveError,
  assistanceAvailable,
  assist,
  retry,
}: {
  syncError: string | null
  archiveError: string | null
  assistanceAvailable: boolean | null
  assist: boolean
  retry: () => void
}) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const error =
    syncError ||
    archiveError ||
    (assist && assistanceAvailable === false ? 'assistance_unavailable' : null)
  if (!error) return null
  const message = t(`personal_error_${error}`, { defaultValue: t('personal_action_failed') })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={() =>
        Alert.alert(t('personal_recording_sync'), message, [
          { text: t('cancel'), style: 'cancel' },
          { text: t('retry'), onPress: retry },
        ])
      }
      style={({ pressed }) => ({
        paddingHorizontal: 20,
        paddingVertical: 16,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ ...mobileTypography.body, color: colors.textSecondary }}>
        {message} · {t('retry')}
      </Text>
    </Pressable>
  )
}
