// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/desktop-page-state-coverage.test.ts

import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { roomConversationStyles as styles } from '../RoomConversationScreen.styles'

export type RoomHistoryLoadStateValue = 'idle' | 'loading' | 'failed'

export function RoomHistoryLoadState({
  state,
  retry,
}: {
  state: RoomHistoryLoadStateValue
  retry: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (state === 'idle') return null
  if (state === 'loading') {
    return (
      <View
        testID="room-history-loading"
        accessibilityRole="progressbar"
        accessibilityLabel={t('loading')}
        style={[styles.loadOlder, { backgroundColor: colors.surfaceHover }]}
      >
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    )
  }

  return (
    <View
      testID="room-history-load-failed"
      accessibilityRole="alert"
      style={[styles.loadOlder, { backgroundColor: colors.surfaceHover }]}
    >
      <Text style={[styles.loadOlderText, { color: colors.textSecondary }]}>
        {t('spaces_load_failed')}
      </Text>
      <Pressable
        testID="room-history-retry"
        accessibilityRole="button"
        accessibilityLabel={t('retry')}
        onPress={() => void retry()}
      >
        <Text style={[styles.loadOlderText, { color: colors.brand }]}>{t('retry')}</Text>
      </Pressable>
    </View>
  )
}
