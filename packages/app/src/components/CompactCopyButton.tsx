// @arch docs/design/components.md#5-按钮
// @test src/__tests__/compact-copy-button.test.ts

import { Pressable, StyleSheet } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../hooks/useTheme'

type CompactCopyButtonProps = {
  copied: boolean
  label: string
  copiedLabel: string
  onPress: () => void
}

export function CompactCopyButton({ copied, label, copiedLabel, onPress }: CompactCopyButtonProps) {
  const { colors } = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? copiedLabel : label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.brandLight,
          opacity: pressed ? 0.68 : 1,
        },
      ]}
    >
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={colors.brand} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
})
