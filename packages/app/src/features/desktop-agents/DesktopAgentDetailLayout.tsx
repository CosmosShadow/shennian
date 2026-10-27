// @arch docs/design/desktop/unified-desktop-control.md
// @test src/__tests__/desktop-machine-agent-layout.test.ts

import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

type DetailHeaderProps = {
  title: string
  backLabel: string
  onBack?: () => void
}

export function DesktopAgentDetailHeader({
  title,
  backLabel,
  onBack,
}: DetailHeaderProps) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState<'back' | 'edit' | null>(null)
  return (
    <View
      testID="desktop-agent-detail-header"
      style={[styles.header, { borderBottomColor: colors.border }]}
      {...{ dataSet: { desktopDrag: 'true' } }}
    >
      {onBack ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ? 'back' : null)}
        onBlur={() => setFocused(null)}
        style={({ pressed }) => [
          styles.back,
          { borderWidth: 1, borderColor: focused === 'back' ? colors.brand : 'transparent' },
          pressed && styles.pressed,
        ]}
        onPress={onBack}
      >
        <Ionicons
          name="arrow-back"
          size={desktopControlMetrics.iconGlyphSize}
          color={colors.text}
        />
      </Pressable> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

    </View>
  )
}

export const desktopAgentDetailStyles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingBottom: 44,
  },
  empty: { minHeight: 180 },
})

const styles = StyleSheet.create({
  header: {
    minHeight: desktopControlMetrics.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    gap: 10,
  },
  back: {
    width: desktopControlMetrics.iconButtonSize,
    height: desktopControlMetrics.iconButtonSize,
    borderRadius: desktopControlMetrics.radiusControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: desktopTypography.windowTitle,
  primaryAction: {
    minHeight: desktopControlMetrics.standardControlHeight,
    borderRadius: desktopControlMetrics.radiusControl,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: { ...desktopTypography.control, fontWeight: '600' },
  pressed: { opacity: 0.62 },
})
