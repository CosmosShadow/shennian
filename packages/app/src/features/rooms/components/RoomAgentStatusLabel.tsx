// @arch docs/features/network-rooms/ui.md#二成员信息架构
// @test src/__tests__/room-agent-status-label.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import type { CompactAgentParticipation } from '@shennian/shared/agent-participation'
import type { StyleProp, ViewStyle } from 'react-native'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme, type Colors } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getRoomAgentStatusPresentation } from './roomAgentStatusPresentation'

export function RoomAgentStatusLabel({
  participation,
  label,
  style,
}: {
  participation: CompactAgentParticipation
  label?: string
  style?: StyleProp<ViewStyle>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const presentation = getRoomAgentStatusPresentation(participation)
  const color = colors[presentation.colorToken as keyof Colors]

  return (
    <View style={[styles.root, style]}>
      <View style={styles.icon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name={presentation.icon} size={16} color={color} />
      </View>
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {label ?? t(presentation.labelKey)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  icon: { width: 18, alignItems: 'center', justifyContent: 'center' },
  text: Platform.OS === 'web'
    ? { fontSize: 13, lineHeight: 19, fontWeight: '400' }
    : mobileTypography.secondary,
})
