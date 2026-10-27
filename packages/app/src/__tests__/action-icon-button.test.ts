// @covers packages/app/src/components/ActionIconButton.tsx
import { describe, expect, it, vi } from 'vitest'
import type { PressableStateCallbackType, ViewStyle } from 'react-native'

vi.mock('react-native', () => ({
  Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicon' }))
vi.mock('../components/ActionIcon', () => ({ ActionIcon: 'ActionIcon' }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { text: '#111', surface: '#fff' } }) }))
import { ActionIconButton } from '../components/ActionIconButton'

function button(options: Partial<Parameters<typeof ActionIconButton>[0]> = {}) {
  return ActionIconButton({ icon: 'more', label: 'More actions', onPress: vi.fn(), ...options })
}

function appearance(element: ReturnType<typeof button>, pressed: boolean) {
  return Object.assign({}, ...element.props.style({ pressed } as PressableStateCallbackType)) as ViewStyle
}

describe('shared action controls', () => {
  it.each([{ disabled: true }, { busy: true }])('blocks activation while unavailable: %o', (state) => {
    const onPress = vi.fn()
    const element = button({ ...state, onPress })
    element.props.onPress?.({})
    expect(onPress).not.toHaveBeenCalled()
    expect(element.props.disabled).toBe(true)
    expect(element.props.accessibilityState.disabled).toBe(true)
    expect(element.props.accessibilityLabel).toBe('More actions')
  })

  it('keeps the menu state, ref, and long press when migrated from a private button', () => {
    const onPress = vi.fn(), onLongPress = vi.fn(), ref = { current: null }
    const element = button({ expanded: true, ref, onPress, onLongPress })
    element.props.onPress?.({})
    element.props.onLongPress?.({})
    expect(onPress).toHaveBeenCalledOnce()
    expect(onLongPress).toHaveBeenCalledOnce()
    expect(element.props.ref).toBe(ref)
    expect(element.props.accessibilityState.expanded).toBe(true)
  })

  it('preserves a reachable target and pressed feedback despite an old compact style', () => {
    const element = button({ style: { width: 26, height: 26, opacity: 0.94 } })
    expect(appearance(element, false)).toMatchObject({ minWidth: 48, minHeight: 48, opacity: 1 })
    expect(appearance(element, true)).toMatchObject({ minWidth: 48, minHeight: 48, opacity: 0.5 })
  })
})
