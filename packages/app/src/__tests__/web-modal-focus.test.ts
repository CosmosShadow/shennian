// @covers packages/app/src/hooks/useWebModalFocus.ts
// @covers packages/app/src/utils/webModalFocus.ts
// @covers packages/app/src/features/desktop-shell/DesktopDialog.tsx

import { describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode } from 'react'
import { DesktopDialog } from '../features/desktop-shell/DesktopDialog'

const dialogHooks = vi.hoisted(() => ({ escape: vi.fn() }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (value: unknown) => ({ current: value }),
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
}))
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Feather' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../hooks/useEscapeKey', () => ({ useEscapeKey: dialogHooks.escape }))
vi.mock('../hooks/useWebModalFocus', () => ({ useWebModalFocus: () => undefined }))
import {
  focusWebModal,
  getWebModalFocusableElements,
  restoreWebModalFocus,
  trapWebModalTabKey,
  type WebModalTabEvent,
} from '../utils/webModalFocus'

function createFixture(count: number) {
  const elements = Array.from({ length: count }, () => ({ focus: vi.fn() }))
  const container = {
    focus: vi.fn(),
    contains: (target: unknown) => elements.includes(target as (typeof elements)[number]),
    querySelectorAll: vi.fn(() => elements),
  }
  return { container, elements }
}

describe('Desktop dialog dismissal', () => {
  it('does not close a parent again on the keyup that follows closing its child', () => {
    const parentClose = vi.fn(),
      childClose = vi.fn()
    const render = (onClose: () => void, suspended = false) =>
      DesktopDialog({ title: 'Dialog', children: null, onClose, suspended })
    render(parentClose, true)
    let [enabled, escape] = dialogHooks.escape.mock.calls.at(-1)!
    expect(enabled).toBe(false)
    escape()
    expect(parentClose).not.toHaveBeenCalled()
    render(childClose)
    ;[enabled, escape] = dialogHooks.escape.mock.calls.at(-1)!
    expect(enabled).toBe(true)
    escape()
    expect(childClose).toHaveBeenCalledOnce()
    const restoredParent = render(parentClose)
    expect(restoredParent.props.onRequestClose).toBeUndefined()
    expect(parentClose).not.toHaveBeenCalled()
    ;[enabled, escape] = dialogHooks.escape.mock.calls.at(-1)!
    expect(enabled).toBe(true)
    escape()
    expect(parentClose).toHaveBeenCalledOnce()
  })
  it('blocks every dismissal path while busy, exposes the reason, and unlocks after completion', () => {
    const onClose = vi.fn()
    for (const busy of [false, true, false]) {
      onClose.mockClear()
      const tree = DesktopDialog({ title: 'Rename Mac', onClose, busy, children: 'draft' })
      const nodes: Array<Record<string, any>> = []
      const visit = (node: ReactNode) =>
        Children.forEach(node, (child) => {
          if (!isValidElement<{ children?: ReactNode }>(child)) return
          nodes.push(child.props)
          visit(child.props.children)
        })
      visit(tree)
      const button = nodes.find((props) => props.accessibilityLabel === 'close')!
      expect(button.disabled).toBe(busy)
      expect(button.accessibilityState).toEqual({ disabled: busy })
      expect(button.accessibilityHint).toBe(busy ? 'desktop_dialog_busy' : undefined)
      expect(nodes.some((props) => props.accessibilityLiveRegion === 'polite')).toBe(busy)
      expect(tree.props.onRequestClose).toBeUndefined()
      nodes.find((props) => props.importantForAccessibility === 'no-hide-descendants')!.onPress()
      button.onPress()
      const [enabled, escape, options] = dialogHooks.escape.mock.calls.at(-1)!
      expect(enabled).toBe(true)
      expect(options).toEqual({ includeEditable: true })
      escape()
      expect(onClose).toHaveBeenCalledTimes(busy ? 0 : 3)
    }
  })
})

function createTabEvent(
  target: unknown,
  options: { shiftKey?: boolean; defaultPrevented?: boolean } = {},
): WebModalTabEvent {
  return {
    key: 'Tab',
    target,
    shiftKey: options.shiftKey,
    defaultPrevented: options.defaultPrevented,
    preventDefault: vi.fn(),
  }
}

describe('web modal focus containment', () => {
  it('moves focus to the safe initial action and restores the invoking control', () => {
    const fixture = createFixture(2)
    const safeAction = { focus: vi.fn() }
    const invokingControl = { focus: vi.fn() }

    expect(focusWebModal(fixture.container, safeAction)).toBe(safeAction)
    expect(safeAction.focus).toHaveBeenCalledOnce()
    expect(fixture.elements[0]?.focus).not.toHaveBeenCalled()

    expect(restoreWebModalFocus(invokingControl)).toBe(true)
    expect(invokingControl.focus).toHaveBeenCalledOnce()
    expect(invokingControl.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('falls back to the first action and safely handles an unfocusable return target', () => {
    const fixture = createFixture(2)

    expect(focusWebModal(fixture.container, {})).toBe(fixture.elements[0])
    expect(fixture.elements[0]?.focus).toHaveBeenCalledOnce()
    expect(restoreWebModalFocus({})).toBe(false)
  })

  it('keeps ordinary Tab movement inside the browser', () => {
    const { container, elements } = createFixture(3)
    const event = createTabEvent(elements[1])

    expect(trapWebModalTabKey(event, container)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(elements.every((element) => element.focus.mock.calls.length === 0)).toBe(true)
  })

  it('wraps Tab from the last control to the first control', () => {
    const { container, elements } = createFixture(3)
    const event = createTabEvent(elements[2])

    expect(trapWebModalTabKey(event, container)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(elements[0]?.focus).toHaveBeenCalledOnce()
  })

  it('wraps Shift+Tab from the first control to the last control', () => {
    const { container, elements } = createFixture(3)
    const event = createTabEvent(elements[0], { shiftKey: true })

    expect(trapWebModalTabKey(event, container)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(elements[2]?.focus).toHaveBeenCalledOnce()
  })

  it('recovers focus that escaped the modal and handles an empty modal', () => {
    const fixture = createFixture(2)
    const escapedEvent = createTabEvent({})

    expect(trapWebModalTabKey(escapedEvent, fixture.container)).toBe(true)
    expect(fixture.elements[0]?.focus).toHaveBeenCalledOnce()

    const emptyFixture = createFixture(0)
    const emptyEvent = createTabEvent({})
    expect(trapWebModalTabKey(emptyEvent, emptyFixture.container)).toBe(true)
    expect(emptyFixture.container.focus).toHaveBeenCalledOnce()
  })

  it('ignores unrelated or already-handled keyboard events', () => {
    const { container } = createFixture(2)
    const enterEvent = { ...createTabEvent({}), key: 'Enter' }
    const handledEvent = createTabEvent({}, { defaultPrevented: true })

    expect(trapWebModalTabKey(enterEvent, container)).toBe(false)
    expect(trapWebModalTabKey(handledEvent, container)).toBe(false)
  })

  it('returns only focusable descendants exposed by the container', () => {
    const focusable = { focus: vi.fn() }
    const inert = {}
    const container = { querySelectorAll: () => [focusable, inert] }

    expect(getWebModalFocusableElements(container)).toEqual([focusable])
  })
})
