// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-share.test.ts
// @test tests/e2e/web/scoped-room-dialogs.spec.ts

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { resolveRoomShare, type RoomSharePolicy } from '../roomShare'
import { RoomInviteQr } from './RoomInviteQr'
import { RoomShareLink } from './RoomShareLink'

export function RoomShareContent({ roomName, roomUrl, inviteUrl, joinPolicy, loading, onRetry, compact = false }: {
  roomName: string
  roomUrl: string
  inviteUrl: string
  joinPolicy: RoomSharePolicy
  loading: boolean
  onRetry: () => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const share = resolveRoomShare(roomUrl, inviteUrl, joinPolicy)
  if (loading && joinPolicy !== 'closed') return <ActivityIndicator color={colors.brand} />
  if (!share) return (
    <View style={styles.error}>
      <Text accessibilityRole="alert" style={{ color: colors.error }}>{t('spaces_manage_load_failed')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
        <Text style={{ color: colors.brand }}>{t('retry')}</Text>
      </Pressable>
    </View>
  )
  return (
    <View testID="room-share-content" style={styles.content}>
      <RoomInviteQr
        key={`qr:${share.url}`}
        value={share.url}
        roomName={roomName}
        purpose={share.purpose}
        hint={t(share.hintKey)}
      />
      <RoomShareLink roomName={roomName} key={share.url} url={share.url} purpose={share.purpose} compact={compact} />
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  error: { alignItems: 'center', paddingVertical: 24 },
  retry: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
})
