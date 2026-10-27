// @covers packages/app/src/hooks/keyboardShortcuts.ts
// @covers packages/app/src/hooks/useKeyboardShortcut.ts
// @covers packages/app/src/features/sessions/projectSessionShortcuts.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchShortcutKey,
  getShortcutStackSizeForTest,
  isShortcutEditableTarget,
  matchesShortcut,
  registerShortcutHandler,
  resetShortcutHandlersForTest,
} from '../hooks/keyboardShortcuts'
import { shouldEnableProjectSessionShortcuts } from '../features/sessions/projectSessionShortcuts'

describe('keyboard shortcut handling', () => {
  beforeEach(() => resetShortcutHandlersForTest())
  afterEach(() => resetShortcutHandlersForTest())

  it('does not navigate behind an open overlay before its focus has settled', () => {
    const getClientRects = vi.fn(() => [{}])
    vi.stubGlobal('document', { querySelectorAll: () => [{ getClientRects }] })
    try {
      const event = { key: 'ArrowDown', target: { tagName: 'BUTTON' } }
      expect(matchesShortcut(event, { key: 'arrowdown', ignoreWidgets: true })).toBe(false)
      getClientRects.mockReturnValue([])
      expect(matchesShortcut(event, { key: 'arrowdown', ignoreWidgets: true })).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('matches command/control shortcuts and prevents browser defaults', () => {
    const calls: string[] = []
    registerShortcutHandler({ key: 'r', metaOrCtrl: true }, () => calls.push('refresh'))

    const event = {
      key: 'r',
      metaKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchShortcutKey(event)).toBe(true)
    expect(calls).toEqual(['refresh'])
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('uses stack order so the most recent list handles j/k first', () => {
    const calls: string[] = []
    const cleanupSidebar = registerShortcutHandler({ key: 'j' }, () => calls.push('sidebar'))
    const cleanupDrawer = registerShortcutHandler({ key: 'j' }, () => calls.push('drawer'))

    expect(dispatchShortcutKey({ key: 'j' })).toBe(true)
    expect(calls).toEqual(['drawer'])

    cleanupDrawer()
    expect(dispatchShortcutKey({ key: 'j' })).toBe(true)
    expect(calls).toEqual(['drawer', 'sidebar'])

    cleanupSidebar()
    expect(getShortcutStackSizeForTest()).toBe(0)
  })

  it('does not trigger navigation shortcuts while typing in editable targets', () => {
    const inputTarget = { tagName: 'INPUT' }
    const textareaTarget = { tagName: 'textarea' }
    const contentEditableTarget = { isContentEditable: true }

    expect(isShortcutEditableTarget(inputTarget)).toBe(true)
    expect(isShortcutEditableTarget(textareaTarget)).toBe(true)
    expect(isShortcutEditableTarget(contentEditableTarget)).toBe(true)
    expect(matchesShortcut({ key: 'j', target: inputTarget }, { key: 'j' })).toBe(false)
    expect(
      matchesShortcut({ key: 'ArrowDown', target: textareaTarget }, { key: 'arrowdown' }),
    ).toBe(false)
  })

  it('lets focused widgets consume their keys without switching the Desktop session behind them', () => {
    const navigate = vi.fn()
    registerShortcutHandler({ key: 'arrowdown', ignoreWidgets: true }, navigate)
    const target = {
      closest: (selector: string) => (selector.includes('[role="menu"]') ? {} : null),
    }
    const event = { key: 'ArrowDown', target, preventDefault: vi.fn() }
    expect(dispatchShortcutKey(event)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(dispatchShortcutKey({ key: 'ArrowDown', target: { closest: () => null } })).toBe(true)
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('allows composer-owned command enter while keeping global editable shortcuts guarded', () => {
    const inputTarget = { tagName: 'TEXTAREA' }

    expect(
      matchesShortcut(
        { key: 'Enter', metaKey: true, target: inputTarget },
        { key: 'enter', metaOrCtrl: true, allowEditable: true },
      ),
    ).toBe(true)
    expect(
      matchesShortcut(
        { key: 'Enter', metaKey: true, target: inputTarget },
        { key: 'enter', metaOrCtrl: true },
      ),
    ).toBe(false)
  })

  it('can opt in to editable targets for browser-default overrides like command r', () => {
    const inputTarget = { tagName: 'INPUT' }
    const calls: string[] = []
    registerShortcutHandler({ key: 'r', metaOrCtrl: true, allowEditable: true }, () =>
      calls.push('refresh'),
    )

    expect(dispatchShortcutKey({ key: 'r', ctrlKey: true, target: inputTarget })).toBe(true)
    expect(calls).toEqual(['refresh'])
  })

  it('leaves j/k and arrow scrolling unclaimed in managed Agent Chat', () => {
    const sessions = [
      { id: 'ordinary', agentIdentityId: null },
      { id: 'managed', agentIdentityId: 'agent-1' },
    ]
    const enabled = shouldEnableProjectSessionShortcuts('/chat/managed', sessions)
    const calls: string[] = []
    if (enabled) {
      registerShortcutHandler({ key: 'arrowdown' }, () => calls.push('project-next'))
    }
    const event = { key: 'ArrowDown', preventDefault: vi.fn(), stopPropagation: vi.fn() }

    expect(enabled).toBe(false)
    expect(dispatchShortcutKey(event)).toBe(false)
    expect(calls).toEqual([])
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('keeps Project shortcuts enabled only for a known ordinary Chat', () => {
    const sessions = [
      { id: 'ordinary', agentIdentityId: null },
      { id: 'ordinary-longer', agentIdentityId: 'agent-1' },
    ]

    expect(shouldEnableProjectSessionShortcuts('/chat/ordinary', sessions)).toBe(true)
    expect(shouldEnableProjectSessionShortcuts('/chat/ordinary-longer', sessions)).toBe(false)
    expect(shouldEnableProjectSessionShortcuts('/chat/not-loaded-yet', sessions)).toBe(false)
    expect(shouldEnableProjectSessionShortcuts('/projects/machine/workdir', sessions)).toBe(true)
  })
})
