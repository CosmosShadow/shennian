// @arch docs/design/components.md#7-输入框与聊天输入区
// @test src/__tests__/composer-icon-button.test.ts
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import type { Colors } from '../../../hooks/useTheme'

type Props = Omit<PressableProps, 'children' | 'style' | 'accessibilityRole' | 'accessibilityState'> & {
  icon: 'mic' | 'arrow-up' | 'square'
  colors: Colors
  emphasized?: boolean
  busy?: boolean
  error?: boolean
}

/** Shared circular appearance; the separate 48pt target does not shrink with the glyph. */
export function ComposerIconButton({ icon, colors, emphasized = false, busy = false, error = false, disabled = false, onPress, ...props }: Props) {
  const blocked = disabled || busy
  const foreground = emphasized ? '#fff' : error ? colors.error : disabled ? colors.textTertiary : colors.textSecondary
  return <Pressable {...props} accessibilityRole="button" accessibilityState={{ disabled: blocked, busy }}
    disabled={blocked} onPress={blocked ? undefined : onPress}
    style={({ pressed }) => [styles.target, { opacity: pressed ? 0.5 : 1 }]}>
    <View style={[styles.circle, { backgroundColor: emphasized ? colors.brand : error ? `${colors.error}10` : colors.surfaceHover }]}>
      {busy ? <ActivityIndicator size="small" color={foreground} /> : <Feather name={icon} size={20} color={foreground} />}
    </View>
  </Pressable>
}
const styles = StyleSheet.create({
  target: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
