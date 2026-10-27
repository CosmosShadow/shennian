// @arch docs/architecture/launch-config.md

import { Platform, Pressable, Text, StyleSheet } from 'react-native'
import { getAgentDisplayName } from '@shennian/shared'
import type { AgentType } from '@shennian/wire'
import { useTheme } from '../hooks/useTheme'
import { mobileTypography } from '../theme/mobileTypography'

type Props = {
  agent: AgentType
  displayName?: string
  selected: boolean
  onPress: () => void
  disabled?: boolean
}

export function AgentBadge({ agent, displayName, selected, onPress, disabled }: Props) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        s.badge,
        selected
          ? { backgroundColor: colors.brand + '10', borderColor: colors.brand + '55' }
          : { backgroundColor: colors.bg, borderColor: colors.border },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
    >
      <Text style={[s.text, { color: selected ? colors.brand : colors.text }]}>
        {getAgentDisplayName(agent, displayName)}
      </Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  badge: {
    ...(Platform.OS !== 'web' && { minHeight: Platform.OS === 'android' ? 48 : 44, justifyContent: 'center' as const }),
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  text: { fontSize: 12, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
})
