// @arch docs/design/components.md
import type { PropsWithChildren } from 'react'
import { Platform, View, type ViewProps } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { useTheme } from '../../hooks/useTheme'

// Existing OTA shells do not contain ExpoGlassEffect. Never evaluate its JS entry
// (which requires a native view at import time) unless the native module is present.
const glassModule = Platform.OS === 'ios' ? requireOptionalNativeModule<{
  isLiquidGlassAvailable: boolean; isGlassEffectAPIAvailable: boolean
}>('ExpoGlassEffect') : null
const GlassView = glassModule?.isLiquidGlassAvailable && glassModule.isGlassEffectAPIAvailable
  ? (require('expo-glass-effect') as typeof import('expo-glass-effect')).GlassView : null

export function GlassSurface({ children, style, ...props }: PropsWithChildren<ViewProps>) {
  const { isDark } = useTheme()
  if (GlassView) return <GlassView {...props} glassEffectStyle="regular" isInteractive tintColor={isDark ? 'rgba(28,30,34,0.65)' : 'rgba(255,255,255,0.65)'} colorScheme={isDark ? 'dark' : 'light'} style={style}>{children}</GlassView>
  return <View {...props} style={[{ backgroundColor: isDark ? 'rgba(30,32,36,0.94)' : 'rgba(255,255,255,0.94)' }, style]}>{children}</View>
}
