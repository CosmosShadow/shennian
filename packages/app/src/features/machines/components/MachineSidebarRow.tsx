// @arch docs/design/desktop/unified-desktop-control.md
// @test src/__tests__/desktop-machine-sidebar.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine, RelayConnectivityPhase } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMachinePresentationState } from '../../../hooks/useMachinePresentationState'
import { useTheme } from '../../../hooks/useTheme'
import { desktopTypography } from '../../desktop-shell/desktopDesignTokens'

export function MachineSidebarRow({
  machine,
  relayPhase,
  active,
  onPress,
  compact = false,
}: {
  machine: Machine
  relayPhase: RelayConnectivityPhase | null
  active: boolean
  onPress: () => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const secondaryText = Platform.OS === 'web' && !isDark ? '#4b4b4b' : colors.textSecondary
  const tertiaryText = Platform.OS === 'web' && !isDark ? '#6b6b6b' : colors.textTertiary
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const state = useMachinePresentationState(machine.online, relayPhase)
  const statusLabel =
    state === 'online'
      ? t('machine_online')
      : state === 'reconnecting'
        ? t('machine_reconnecting')
        : state === 'offline'
          ? t('machine_offline')
          : t('unknown')
  const statusColor =
    state === 'online'
      ? colors.success
      : state === 'reconnecting'
        ? colors.warning
        : tertiaryText

  return (
    <Pressable
      testID={`sidebar-machine-${machine.id}`}
      style={({ pressed }) => [
        styles.row,
        compact && styles.compactRow,
        {
          backgroundColor: active
            ? colors.selectionBackground
            : pressed
              ? colors.surfaceHover
              : hovered
                ? colors.surfaceHover
                : 'transparent',
          borderColor: focused ? colors.brand : 'transparent',
        },
      ]}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${machine.name}, ${statusLabel}`}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name="desktop-outline" size={16} color={secondaryText} />
      <Text
        style={[styles.name, compact && styles.compactName, { color: colors.text }]}
        numberOfLines={1}
      >
        {machine.name}
      </Text>
      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      <Text
        style={[
          styles.statusLabel,
          compact && styles.compactStatus,
          { color: tertiaryText },
        ]}
        numberOfLines={1}
      >
        {statusLabel}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    marginRight: 8,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactRow: { minHeight: 32, paddingLeft: 12, paddingRight: 8, gap: 7 },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  compactName: { ...desktopTypography.sidebarItem, fontWeight: '500' },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    maxWidth: 80,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  compactStatus: desktopTypography.caption,
})
