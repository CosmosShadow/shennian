// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-conversation-screen.test.ts

import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { roomConversationStyles as styles } from '../RoomConversationScreen.styles'

export type RoomLoadStateValue = 'loading' | 'ready' | 'forbidden' | 'failed'

export function RoomLoadState({
  state,
  retry,
}: {
  state: RoomLoadStateValue
  retry: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={[styles.loadState, { backgroundColor: colors.bg }]}>
      {state === 'loading' ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <Ionicons
            name={state === 'forbidden' ? 'lock-closed-outline' : 'cloud-offline-outline'}
            size={38}
            color={colors.textTertiary}
          />
          <Text style={[styles.loadTitle, { color: colors.text }]}>
            {t(state === 'forbidden' ? 'spaces_no_permission' : 'spaces_load_failed')}
          </Text>
          {state === 'failed' ? (
            <Pressable onPress={() => void retry()}>
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  )
}
