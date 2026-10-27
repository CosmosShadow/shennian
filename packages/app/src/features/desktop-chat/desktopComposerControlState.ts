export const DESKTOP_COMPOSER_HIT_SIZE = 44
export const DESKTOP_COMPOSER_VISUAL_SIZE = 30
export const DESKTOP_COMPOSER_ICON_SIZE = 16
export const DESKTOP_COMPOSER_VISUAL_RADIUS = 8

export type DesktopComposerControlColors = {
  brand: string
  border: string
  surface: string
  surfaceHover: string
  textSecondary: string
  textTertiary: string
}

export type DesktopComposerPrimaryAction =
  | { kind: 'send'; enabled: boolean }
  | { kind: 'reconnect'; enabled: true }

export type DesktopComposerKeyboardAction = 'none' | 'newline' | 'submit'

export function resolveDesktopComposerKeyboardAction(input: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
}): DesktopComposerKeyboardAction {
  if (input.key !== 'Enter' || input.altKey || input.isComposing) return 'none'
  if (input.shiftKey) return input.metaKey || input.ctrlKey ? 'none' : 'newline'
  return 'submit'
}

export function resolveDesktopComposerPrimaryAction(input: {
  canSend: boolean
  reconnectAvailable: boolean
}): DesktopComposerPrimaryAction {
  if (input.canSend) return { kind: 'send', enabled: true }
  if (input.reconnectAvailable) return { kind: 'reconnect', enabled: true }
  return { kind: 'send', enabled: false }
}

export function resolveDesktopComposerControlState(input: {
  colors: DesktopComposerControlColors
  disabled?: boolean
  focused?: boolean
  hovered?: boolean
  pressed?: boolean
  selected?: boolean
  variant?: 'plain' | 'neutral' | 'primary'
}) {
  const { colors } = input
  const variant = input.variant ?? 'plain'
  const primary = variant === 'primary' && !input.disabled
  const highlighted = input.selected || input.hovered || input.pressed

  let backgroundColor = 'transparent'
  if (primary) {
    backgroundColor = input.pressed ? `${colors.brand}d9` : colors.brand
  } else if (input.disabled || variant === 'neutral') {
    backgroundColor = colors.surface
  } else if (highlighted) {
    backgroundColor = colors.surfaceHover
  }

  return {
    frameColor: input.focused ? `${colors.brand}18` : 'transparent',
    backgroundColor,
    borderColor: input.focused
      ? colors.brand
      : variant === 'neutral'
        ? colors.border
        : 'transparent',
    iconColor: primary
      ? '#fff'
      : input.disabled
        ? colors.textTertiary
        : input.selected
          ? colors.brand
          : colors.textSecondary,
    opacity: input.disabled ? 0.58 : 1,
  }
}
