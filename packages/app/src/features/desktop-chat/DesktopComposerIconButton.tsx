// @arch docs/design/desktop/unified-desktop-control.md
// @test src/__tests__/desktop-composer-controls.test.ts

import Feather from '@expo/vector-icons/Feather'
import { useState, type ReactNode, type RefObject } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import {
  DESKTOP_COMPOSER_HIT_SIZE,
  DESKTOP_COMPOSER_ICON_SIZE,
  DESKTOP_COMPOSER_VISUAL_RADIUS,
  DESKTOP_COMPOSER_VISUAL_SIZE,
  resolveDesktopComposerControlState,
  type DesktopComposerControlColors,
} from './desktopComposerControlState'
import { isDesktopComposerFocusVisible } from './desktopComposerFocus'

type InteractionState = {
  hovered?: boolean
  focused?: boolean
  pressed?: boolean
}

export function DesktopComposerIconButton({
  accessibilityHint,
  accessibilityLabel,
  busy = false,
  colors,
  disabled = false,
  icon,
  onPress,
  actionRef,
  selected = false,
  testID,
  variant = 'plain',
}: {
  accessibilityHint?: string
  accessibilityLabel: string
  busy?: boolean
  colors: DesktopComposerControlColors
  disabled?: boolean
  icon: keyof typeof Feather.glyphMap
  onPress?: () => void
  actionRef?: RefObject<View | null>
  selected?: boolean
  testID?: string
  variant?: 'plain' | 'neutral' | 'primary'
}) {
  const [focusVisible, setFocusVisible] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...{ title: accessibilityLabel }}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy, disabled, selected }}
      disabled={disabled || busy}
      onPress={onPress}
      onFocus={(event) => setFocusVisible(isDesktopComposerFocusVisible(event.nativeEvent.target))}
      onBlur={() => setFocusVisible(false)}
      style={(rawState) => {
        const state = rawState as InteractionState
        const visual = resolveDesktopComposerControlState({
          colors,
          disabled: disabled || busy,
          focused: focusVisible,
          hovered: state.hovered,
          pressed: state.pressed,
          selected,
          variant,
        })
        return [
          styles.hitTarget,
          { backgroundColor: visual.frameColor },
        ]
      }}
    >
      {(rawState) => {
        const state = rawState as InteractionState
        const visual = resolveDesktopComposerControlState({
          colors,
          disabled: disabled || busy,
          focused: focusVisible,
          hovered: state.hovered,
          pressed: state.pressed,
          selected,
          variant,
        })
        return (
          <View
            pointerEvents="none"
            style={[
              styles.visual,
              {
                backgroundColor: visual.backgroundColor,
                borderColor: visual.borderColor,
                opacity: visual.opacity,
              },
              variant === 'primary' && styles.primaryVisual,
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={visual.iconColor} />
            ) : (
              <Feather name={icon} size={DESKTOP_COMPOSER_ICON_SIZE} color={visual.iconColor} />
            )}
          </View>
        )
      }}
    </Pressable>
  )
}

export function DesktopComposerTextButton({
  accessibilityLabel,
  children,
  colors,
  disabled = false,
  maxWidth,
  onPress,
  selected = false,
  testID,
}: {
  accessibilityLabel: string
  children: ReactNode
  colors: DesktopComposerControlColors
  disabled?: boolean
  maxWidth: number
  onPress?: () => void
  selected?: boolean
  testID?: string
}) {
  const [focusVisible, setFocusVisible] = useState(false)
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onFocus={(event) => setFocusVisible(isDesktopComposerFocusVisible(event.nativeEvent.target))}
      onBlur={() => setFocusVisible(false)}
      style={[styles.textHitTarget, { maxWidth }]}
    >
      {(rawState) => {
        const state = rawState as InteractionState
        const visual = resolveDesktopComposerControlState({
          colors,
          disabled,
          focused: focusVisible,
          hovered: state.hovered,
          pressed: state.pressed,
          selected,
        })
        return (
          <View
            pointerEvents="none"
            style={[
              styles.textVisual,
              {
                backgroundColor: visual.backgroundColor,
                borderColor: visual.borderColor,
                opacity: visual.opacity,
              },
            ]}
          >
            {children}
          </View>
        )
      }}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hitTarget: {
    width: DESKTOP_COMPOSER_HIT_SIZE,
    height: DESKTOP_COMPOSER_HIT_SIZE,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visual: {
    width: DESKTOP_COMPOSER_VISUAL_SIZE,
    height: DESKTOP_COMPOSER_VISUAL_SIZE,
    borderRadius: DESKTOP_COMPOSER_VISUAL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryVisual: {
    borderRadius: DESKTOP_COMPOSER_VISUAL_SIZE / 2,
  },
  textHitTarget: {
    minHeight: DESKTOP_COMPOSER_HIT_SIZE,
    minWidth: DESKTOP_COMPOSER_HIT_SIZE,
    flexShrink: 1,
    justifyContent: 'center',
  },
  textVisual: {
    minHeight: DESKTOP_COMPOSER_VISUAL_SIZE,
    borderRadius: DESKTOP_COMPOSER_VISUAL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 0,
  },
})
