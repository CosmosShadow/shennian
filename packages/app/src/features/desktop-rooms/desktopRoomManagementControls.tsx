// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-room-management.test.ts

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { desktopRoomManagementStyles as styles } from './desktopRoomManagementStyles'

export function Section({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme()
  return (
    <View testID={testID} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {children}
    </View>
  )
}
export function DesktopRow({
  testID,
  disabled = false,
  expanded,
  label,
  value,
  onPress,
}: {
  testID?: string
  disabled?: boolean
  expanded?: boolean
  label: string
  value?: string
  onPress?(): void
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled: disabled || !onPress, expanded }}
      disabled={disabled || !onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: colors.border,
          opacity: disabled ? 0.5 : 1,
          backgroundColor: onPress && (hovered || pressed) ? colors.surfaceHover : 'transparent',
        },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.rowLabel, { flex: 1, minWidth: 0, color: colors.text }]}>{label}</Text>
      {value ? (
        <Text style={[styles.rowValue, { color: colors.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
    </Pressable>
  )
}
export function ChoiceRow<T extends string | number>({
  groupLabel,
  disabled,
  values,
  current,
  label,
  onChoose,
  testIDPrefix,
}: {
  groupLabel: string
  disabled: boolean
  values: readonly T[]
  current: T
  label(value: T): string
  onChoose(value: T): void
  testIDPrefix?: string
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState<T | null>(null)
  const choicesRef = useRef<View>(null)
  const choose = (value: T) => {
    if (!disabled && value !== current) onChoose(value)
  }
  return (
    <View
      ref={choicesRef}
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      style={[styles.choices, { borderBottomColor: colors.border }]}
      {...{
        onKeyDown: (event: KeyboardEvent) => {
          const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
          const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          event.stopPropagation()
          if (disabled || values.length === 0) return
          const index = Math.max(0, values.indexOf(focused ?? current))
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? values.length - 1
                : (index + (forward ? 1 : -1) + values.length) % values.length
          ;(choicesRef.current as unknown as HTMLElement | null)
            ?.querySelectorAll<HTMLElement>('[role="radio"]')
            [next]?.focus()
          choose(values[next])
        },
      }}
    >
      {values.map((value) => (
        <Pressable
          key={value}
          testID={testIDPrefix ? `${testIDPrefix}-${value}` : undefined}
          accessibilityRole="radio"
          accessibilityLabel={label(value)}
          accessibilityState={{ checked: value === current, disabled }}
          aria-checked={value === current}
          aria-disabled={disabled}
          disabled={disabled}
          onFocus={() => setFocused(value)}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => [
            styles.choice,
            {
              opacity: disabled ? 0.5 : 1,
              backgroundColor: value === current || pressed ? colors.surfaceHover : 'transparent',
              borderColor: focused === value ? colors.brand : 'transparent',
            },
          ]}
          onPress={() => choose(value)}
        >
          <Text style={[desktopTypography.control, { color: colors.text }]}>{label(value)}</Text>
          {value === current ? <Ionicons name="checkmark" size={16} color={colors.brand} /> : null}
        </Pressable>
      ))}
    </View>
  )
}
