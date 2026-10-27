// @arch docs/features/network-rooms/ui.md#七智能体内部对话与群聊的平级切换
// @test src/__tests__/room-navigation.test.ts

import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import type { LinkedRoomBindingView } from '../types'

export function LinkedRoomEntry({
  binding,
  loadFailed,
  onOpen,
  onRepair,
  onRetry,
}: {
  binding: LinkedRoomBindingView | null
  loadFailed: boolean
  onOpen: () => void
  onRepair: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  if (!binding && !loadFailed) return null
  if (!binding) {
    return (
      <Pressable
        testID="chat-linked-room-retry"
        style={[styles.row, styles.borderedRow, { borderBottomColor: colors.border }]}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Feather name="refresh-cw" size={14} color={colors.textTertiary} />
        <Text style={[styles.secondary, { color: colors.textSecondary }]}>
          {t('spaces_linked_load_failed')}
        </Text>
      </Pressable>
    )
  }

  const openable =
    binding.status !== 'detached' &&
    binding.status !== 'pending_approval' &&
    binding.room.status !== 'deleted'
  const stateLabel = binding.status === 'detached'
    ? t('spaces_binding_detached')
    : binding.status === 'pending_approval'
      ? t('spaces_binding_pending')
      : null

  return (
    <View style={{ borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <Pressable
        testID="chat-linked-room-entry"
        style={styles.row}
        onPress={openable ? onOpen : undefined}
        accessibilityRole={openable ? 'button' : undefined}
        accessibilityLabel={t('spaces_linked_accessibility', { name: binding.room.name })}
      >
        <View style={[styles.icon, { backgroundColor: colors.surfaceHover }]}>
          <Feather name="users" size={14} color={colors.brand} />
        </View>
        <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
          {t('spaces_linked_room', { name: binding.room.name })}
        </Text>
        {stateLabel ? (
          <Text style={[styles.state, { color: colors.error }]}>{stateLabel}</Text>
        ) : (
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        )}
      </Pressable>
      {binding.status === 'detached' ? (
        <View testID="chat-binding-repair-notice" style={styles.repairNotice}>
          <Text style={[styles.repairText, { color: colors.textSecondary }]}>
            {t('spaces_binding_repair_hint')}
          </Text>
          <Pressable
            testID="chat-binding-repair-action"
            onPress={onRepair}
            accessibilityRole="button"
          >
            <Text style={[styles.repairAction, { color: colors.brand }]}>
              {t('spaces_binding_repair_open_room')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 40,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  borderedRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  icon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  secondary: { flex: 1, fontSize: 12, lineHeight: 17 },
  state: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  repairNotice: {
    paddingHorizontal: 51,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  repairText: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16 },
  repairAction: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
})
