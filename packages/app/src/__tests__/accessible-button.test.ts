// @covers packages/app/src/components/AccessibleButton.tsx
// Also exercises react-native-web Pressable keyboard mapping used by Electron.

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Pressable: 'Pressable' }))

import { AccessibleButton } from '../components/AccessibleButton'

type KeyboardListener = (event: PressEvent) => void
type PressEvent = {
  altKey: boolean
  currentTarget: ElementStub
  defaultPrevented: boolean
  key: string
  nativeEvent: { pageX: number; pageY: number; type: string }
  persist: ReturnType<typeof vi.fn>
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
  target: ElementStub
}
type ElementStub = {
  getAttribute: (name: string) => string | null
  tagName: string
}

const require = createRequire(import.meta.url)
const reactNativeWebRoot = dirname(require.resolve('react-native-web/package.json'))
const PressResponder = require(
  resolve(reactNativeWebRoot, 'dist/cjs/modules/usePressEvents/PressResponder.js'),
) as new (config: {
  disabled?: boolean
  onPress?: (event: PressEvent) => void
}) => {
  getEventHandlers(): {
    onClick(event: PressEvent): void
    onKeyDown(event: PressEvent): void
  }
  reset(): void
}

function renderButton(options: {
  busy?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const element = AccessibleButton({
    accessibilityLabel: 'Switch language',
    busy: options.busy,
    disabled: options.disabled,
    onPress: () => options.onPress(),
  })

  return element.props as {
    accessibilityLabel: string
    accessibilityRole: string
    accessibilityState: { busy: boolean; disabled: boolean }
    disabled: boolean
    onPress?: (event: PressEvent) => void
  }
}

function createHarness(props: ReturnType<typeof renderButton>) {
  const listeners = new Map<string, KeyboardListener>()
  const documentStub = {
    addEventListener: vi.fn((type: string, listener: KeyboardListener) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn((type: string, listener: KeyboardListener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    }),
  }
  vi.stubGlobal('document', documentStub)

  const target: ElementStub = {
    getAttribute: (name) => (name === 'role' ? props.accessibilityRole : null),
    tagName: 'DIV',
  }
  const responder = new PressResponder({ disabled: props.disabled, onPress: props.onPress })
  const handlers = responder.getEventHandlers()

  const event = (key: string, type = 'keydown'): PressEvent => {
    const value = {
      altKey: false,
      currentTarget: target,
      defaultPrevented: false,
      key,
      nativeEvent: { pageX: 0, pageY: 0, type },
      persist: vi.fn(),
      preventDefault: vi.fn(() => {
        value.defaultPrevented = true
      }),
      stopPropagation: vi.fn(),
      target,
    }
    return value
  }

  return {
    click() {
      handlers.onClick(event('', 'click'))
    },
    key(key: string, keyDownCount = 1) {
      const down = event(key)
      for (let index = 0; index < keyDownCount; index += 1) handlers.onKeyDown(down)
      const up = event(key, 'keyup')
      listeners.get('keyup')?.(up)
      return { down, up }
    },
    responder,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AccessibleButton', () => {
  it.each(['Enter', ' '])('activates exactly once for %s', (key) => {
    const onPress = vi.fn()
    const props = renderButton({ onPress })
    const harness = createHarness(props)

    harness.key(key)

    expect(props.accessibilityRole).toBe('button')
    expect(onPress).toHaveBeenCalledTimes(1)
    harness.responder.reset()
  })

  it('prevents Space scrolling while leaving Enter default behavior to the responder', () => {
    const props = renderButton({ onPress: vi.fn() })
    const harness = createHarness(props)

    const space = harness.key(' ')
    const enter = harness.key('Enter')

    expect(space.down.preventDefault).toHaveBeenCalledOnce()
    expect(enter.down.preventDefault).not.toHaveBeenCalled()
    harness.responder.reset()
  })

  it('keeps click equivalent to one keyboard activation', () => {
    const onPress = vi.fn()
    const props = renderButton({ onPress })
    const harness = createHarness(props)

    harness.click()

    expect(onPress).toHaveBeenCalledTimes(1)
    harness.responder.reset()
  })

  it('does not repeat activation when a held Space key emits repeated keydown events', () => {
    const onPress = vi.fn()
    const props = renderButton({ onPress })
    const harness = createHarness(props)

    harness.key(' ', 3)

    expect(onPress).toHaveBeenCalledTimes(1)
    harness.responder.reset()
  })

  it.each([
    { busy: false, disabled: true },
    { busy: true, disabled: false },
  ])('blocks click and keyboard activation for $busy/$disabled state', (state) => {
    const onPress = vi.fn()
    const props = renderButton({ ...state, onPress })
    const harness = createHarness(props)

    harness.click()
    const space = harness.key(' ')
    const enter = harness.key('Enter')

    expect(props.accessibilityState).toEqual({ busy: state.busy, disabled: true })
    expect(onPress).not.toHaveBeenCalled()
    expect(space.down.preventDefault).not.toHaveBeenCalled()
    expect(enter.down.preventDefault).not.toHaveBeenCalled()
    harness.responder.reset()
  })

  it('ignores Escape without changing button availability', () => {
    const onPress = vi.fn()
    const props = renderButton({ onPress })
    const harness = createHarness(props)

    const escape = harness.key('Escape')

    expect(onPress).not.toHaveBeenCalled()
    expect(escape.down.preventDefault).not.toHaveBeenCalled()
    expect(props.disabled).toBe(false)
    harness.responder.reset()
  })
})
