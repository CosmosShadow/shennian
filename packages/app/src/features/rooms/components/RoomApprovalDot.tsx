// @arch docs/features/network-rooms/ui.md#入群审批提醒
// @test src/__tests__/room-approval-counts.test.ts

import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { useRoomApprovalCount } from '../useRoomApprovalCount'

export function RoomApprovalDot({
  roomId,
  canApprove = true,
  overlay = false,
}: {
  roomId?: string
  canApprove?: boolean
  overlay?: boolean
}) {
  const count = useRoomApprovalCount(roomId, canApprove)
  const { colors } = useTheme()
  const { t } = useTranslation()
  if (!count) return null
  return (
    <View
      testID={`room-approval-dot-${roomId ?? 'all'}`}
      accessible
      accessibilityLabel={t('spaces_pending_requests')}
      pointerEvents="none"
      style={[styles.dot, overlay && styles.overlay, { backgroundColor: colors.error }]}
    />
  )
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0, marginHorizontal: 4 },
  overlay: { position: 'absolute', top: 3, right: 0, marginHorizontal: 0 },
})
