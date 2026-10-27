// @covers packages/app/src/hooks/useEscapeKey.ts
// @covers packages/app/src/hooks/escapeKey.ts

import {
  dispatchEscapeKey,
  getEscapeStackSizeForTest,
  isEscapeEditableTarget,
  registerEscapeHandler,
  resetEscapeHandlersForTest,
} from '../hooks/escapeKey'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('escape key overlay handling', () => {
  beforeEach(() => {
    resetEscapeHandlersForTest()
  })

  afterEach(() => {
    resetEscapeHandlersForTest()
  })

  it('closes only the topmost visible detail or modal', () => {
    const calls: string[] = []
    const cleanupDetails = registerEscapeHandler(() => calls.push('details'), true)
    const cleanupDialog = registerEscapeHandler(() => calls.push('dialog'), true)

    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchEscapeKey(event)).toBe(true)
    expect(calls).toEqual(['dialog'])
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)

    cleanupDialog()
    expect(dispatchEscapeKey({ key: 'Escape' })).toBe(true)
    expect(calls).toEqual(['dialog', 'details'])

    cleanupDetails()
    expect(getEscapeStackSizeForTest()).toBe(0)
  })

  it('does nothing when no visible detail or modal is registered', () => {
    registerEscapeHandler(() => {
      throw new Error('disabled handler should not run')
    }, false)

    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchEscapeKey(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
  })

  it('does not close while typing in editable targets', () => {
    const calls: string[] = []
    registerEscapeHandler(() => calls.push('closed'), true)

    const textInputTarget = { tagName: 'INPUT' }
    const textareaTarget = { tagName: 'textarea' }
    const contentEditableTarget = { isContentEditable: true }
    const nestedEditableTarget = {
      tagName: 'SPAN',
      closest: vi.fn((selector: string) => (selector.includes('contenteditable') ? {} : null)),
    }

    expect(isEscapeEditableTarget(textInputTarget)).toBe(true)
    expect(isEscapeEditableTarget(textareaTarget)).toBe(true)
    expect(isEscapeEditableTarget(contentEditableTarget)).toBe(true)
    expect(isEscapeEditableTarget(nestedEditableTarget)).toBe(true)

    expect(dispatchEscapeKey({ key: 'Escape', target: textInputTarget })).toBe(false)
    expect(dispatchEscapeKey({ key: 'Escape', target: textareaTarget })).toBe(false)
    expect(dispatchEscapeKey({ key: 'Escape', target: contentEditableTarget })).toBe(false)
    expect(dispatchEscapeKey({ key: 'Escape', target: nestedEditableTarget })).toBe(false)
    expect(calls).toEqual([])
  })

  it('lets an explicitly owning dialog close from an editable target', () => {
    const calls: string[] = []
    registerEscapeHandler(() => calls.push('closed'), true, { includeEditable: true })
    const event = {
      key: 'Escape',
      target: { tagName: 'INPUT' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchEscapeKey(event)).toBe(true)
    expect(calls).toEqual(['closed'])
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })
})
