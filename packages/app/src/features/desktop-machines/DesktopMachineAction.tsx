// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-detail.test.ts
import { useState, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, type View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function DesktopMachineAction({
  label,
  onPress,
  disabled = false,
  destructive = false,
  expanded,
  compact = false,
  primary = false,
  actionRef,
}: {
  label: string
  onPress(): void
  disabled?: boolean
  destructive?: boolean
  expanded?: boolean
  compact?: boolean
  primary?: boolean
  actionRef?: RefObject<View | null>
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, expanded }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.action,
        compact && styles.compact,
        {
          borderColor: primary ? colors.brand : focused ? colors.brand : colors.border,
          backgroundColor: primary
            ? hovered || pressed
              ? colors.brandDark
              : colors.brand
            : hovered || pressed
              ? colors.surfaceHover
              : colors.bg,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: primary ? '#ffffff' : destructive ? colors.error : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 14,
  },
  compact: { marginTop: 0, minHeight: desktopControlMetrics.standardControlHeight, alignSelf: 'flex-start' },
  label: { ...desktopTypography.control, textAlign: 'center' },
})
