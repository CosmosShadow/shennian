// @arch docs/design/components.md#6-列表行与选择控件
// @test src/__tests__/session-mode-ui.test.ts

import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../hooks/useTheme'
import { mobileTypography } from '../theme/mobileTypography'

/** Compact visible border inside a full, non-overlapping touch target. */
export function ChoiceChip(props: {
  label: string
  desktop?: boolean
  selected: boolean
  disabled?: boolean
  unavailable?: boolean
  accessibilityHint?: string
  testID?: string
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      {...(Platform.OS === 'web' ? { 'aria-checked': props.selected, 'aria-disabled': Boolean(props.disabled) } : {})}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.target,
        (props.disabled || props.unavailable) && styles.unavailable,
        pressed && styles.pressed,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.border,
          {
            borderColor: props.desktop ? colors.border : props.selected ? colors.brand : colors.border,
            backgroundColor: props.selected ? props.desktop ? colors.selectionBackground : `${colors.brand}0A` : colors.bg,
          },
        ]}
      />
      <Text style={[styles.label, { color: props.desktop ? colors.text : props.selected ? colors.brand : colors.text }]}>
        {props.label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  target: {
    minHeight: Platform.OS === 'web' ? 32 : Platform.OS === 'android' ? 48 : 44,
    maxWidth: '100%',
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    borderRadius: 10,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    top: Platform.OS === 'web' ? 0 : 4,
    bottom: Platform.OS === 'web' ? 0 : 4,
    borderWidth: 1,
    borderRadius: 10,
  },
  label: Platform.OS === 'web'
    ? { fontSize: 13, lineHeight: 18, fontWeight: '400' }
    : mobileTypography.secondary,
  unavailable: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
})
