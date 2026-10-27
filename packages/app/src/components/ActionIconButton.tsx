// @arch docs/design/components.md#5-按钮
// @test src/__tests__/action-icon-button.test.ts
import { type ReactNode, type Ref } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../hooks/useTheme'
import { ActionIcon } from './ActionIcon'

export type ActionIconButtonProps = Omit<
  PressableProps,
  'children' | 'accessibilityRole' | 'accessibilityState'
> & {
  icon: keyof typeof Ionicons.glyphMap | 'back' | 'more'
  label: string
  color?: string
  busy?: boolean
  expanded?: boolean
  children?: ReactNode
  ref?: Ref<View>
  surface?: boolean
}

/** One geometry and interaction contract for icon actions, including navigation. */
export function ActionIconButton({
  icon,
  label,
  color,
  disabled = false,
  busy = false,
  expanded,
  style,
  children,
  onPress,
  ref,
  surface = false,
  ...props
}: ActionIconButtonProps) {
  const { colors } = useTheme()
  const foreground = color ?? colors.text
  const blocked = disabled || busy
  const action =
    icon === 'back' || icon === 'chevron-back' || icon === 'arrow-back'
      ? 'back'
      : icon === 'add'
        ? 'add'
        : icon === 'more' || icon === 'ellipsis-horizontal'
          ? 'more'
          : icon === 'refresh' || icon === 'refresh-outline'
            ? 'refresh'
            : null
  return (
    <Pressable
      {...props}
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy, expanded }}
      disabled={blocked}
      onPress={blocked ? undefined : onPress}
      style={(state) => [
        styles.button,
        children ? styles.withLabel : null,
        surface ? { backgroundColor: colors.surface, borderRadius: 24 } : null,
        typeof style === 'function' ? style(state) : style,
        styles.target,
        { opacity: blocked ? 0.35 : state.pressed ? 0.5 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : action ? (
        <ActionIcon name={action} size={24} color={foreground} />
      ) : (
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={24}
          color={foreground}
        />
      )}
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  withLabel: { width: 'auto', gap: 8 },
  target: { minWidth: 48, minHeight: 48 },
})
