// @arch docs/design/accessibility-and-review.md#4-键盘与焦点
// @test packages/app/src/__tests__/accessible-button.test.ts

import type { ComponentProps } from 'react'
import { Pressable } from 'react-native'

type PressableProps = ComponentProps<typeof Pressable>

export type AccessibleButtonProps = Omit<
  PressableProps,
  'accessibilityRole' | 'accessibilityState' | 'disabled'
> & {
  busy?: boolean
  disabled?: boolean
}

/**
 * Keeps React Native and React Native Web button semantics aligned.
 *
 * RN Web's Pressable responder owns Enter/Space activation and prevents Space
 * from scrolling when the rendered element has role="button". Do not add a
 * second key handler here: it would race the responder's keyup activation.
 */
export function AccessibleButton({
  busy = false,
  disabled = false,
  onPress,
  ...props
}: AccessibleButtonProps) {
  const blocked = disabled || busy

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: blocked }}
      disabled={blocked}
      onPress={blocked ? undefined : onPress}
    />
  )
}
