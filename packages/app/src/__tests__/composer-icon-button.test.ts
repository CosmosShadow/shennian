// @covers packages/app/src/features/chat/components/ComposerIconButton.tsx
import { describe, expect, it, vi } from 'vitest'
import type { Colors } from '../hooks/useTheme'
vi.mock('react-native', () => ({
  Pressable: 'Pressable', View: 'View', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value },
}))
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Feather' }))
import { ComposerIconButton } from '../features/chat/components/ComposerIconButton'
const colors = { brand: '#2464eb', surfaceHover: '#eeeeee', textSecondary: '#666666', textTertiary: '#999999', error: '#ee3333' } as Colors
function button(options: Partial<Parameters<typeof ComposerIconButton>[0]> = {}) {
  return ComposerIconButton({ icon: 'arrow-up', accessibilityLabel: 'Send', colors, ...options })
}
describe('composer action appearance and behavior', () => {
  it.each(['mic', 'arrow-up', 'square'] as const)('shares geometry without a separate outline: %s', icon => {
    const element = button({ icon })
    const target = Object.assign({}, ...element.props.style({ pressed: false }))
    const circle = Object.assign({}, ...element.props.children.props.style)
    expect(target).toMatchObject({ width: 48, height: 48, flexShrink: 0 })
    expect(circle).toMatchObject({ width: 36, height: 36, borderRadius: 18 })
    expect(circle.borderWidth).toBeUndefined()
    expect(element.props.children.props.children.props).toMatchObject({ name: icon, size: 20 })
  })
  it('distinguishes primary send from neutral voice and disabled send', () => {
    for (const [options, background, foreground] of [
      [{ emphasized: true }, colors.brand, '#fff'],
      [{ icon: 'mic' as const }, colors.surfaceHover, colors.textSecondary],
      [{ disabled: true }, colors.surfaceHover, colors.textTertiary],
      [{ error: true, icon: 'mic' as const }, `${colors.error}10`, colors.error],
    ] as const) {
      const element = button(options)
      expect(Object.assign({}, ...element.props.children.props.style).backgroundColor).toBe(background)
      expect(element.props.children.props.children.props.color).toBe(foreground)
    }
  })
  it.each([{ disabled: true }, { busy: true }])('blocks duplicate or unavailable actions: %o', state => {
    const onPress = vi.fn(), element = button({ ...state, onPress })
    element.props.onPress?.({})
    expect(onPress).not.toHaveBeenCalled()
    expect(element.props.accessibilityState.disabled).toBe(true)
    expect(element.props.accessibilityLabel).toBe('Send')
  })
  it('preserves a single activation and visible pressed feedback', () => {
    const onPress = vi.fn(), element = button({ onPress })
    element.props.onPress({})
    expect(onPress).toHaveBeenCalledOnce()
    expect(Object.assign({}, ...element.props.style({ pressed: true })).opacity).toBe(0.5)
    expect(button({ busy: true, emphasized: true }).props.children.props.children.type).toBe('ActivityIndicator')
  })
})
