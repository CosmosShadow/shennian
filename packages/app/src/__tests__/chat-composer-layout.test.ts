// @covers packages/app/src/features/chat/utils/composerLayout.ts

import { describe, expect, it } from 'vitest'
import {
  COMPOSER_TEXT_INPUT_MAX_HEIGHT,
  COMPOSER_TEXT_INPUT_MIN_HEIGHT,
  clampComposerTextInputHeight,
  resolveComposerTextInputHeight,
  resolveComposerInputStyleHeight,
} from '../features/chat/utils/composerLayout'

describe('chat composer layout utils', () => {
  it('lets iOS intrinsically size nonempty text instead of locking out content-size events', () => {
    expect(resolveComposerInputStyleHeight('ios', 'short', 30)).toBeUndefined()
    expect(resolveComposerInputStyleHeight('ios', 'long wrapping text', 104)).toBeUndefined()
    expect(resolveComposerInputStyleHeight('ios', '', 30)).toBe(30)
    expect(resolveComposerInputStyleHeight('android', 'wrapped text', 84)).toBe(84)
    expect(resolveComposerInputStyleHeight('web', '', 30)).toBeUndefined()
  })
  it('clamps the native multiline input height into a stable range', () => {
    expect(clampComposerTextInputHeight(12)).toBe(COMPOSER_TEXT_INPUT_MIN_HEIGHT)
    expect(clampComposerTextInputHeight(78.2)).toBe(79)
    expect(clampComposerTextInputHeight(999)).toBe(COMPOSER_TEXT_INPUT_MAX_HEIGHT)
  })

  it('handles non-finite values gracefully', () => {
    expect(clampComposerTextInputHeight(NaN)).toBe(COMPOSER_TEXT_INPUT_MIN_HEIGHT)
    expect(clampComposerTextInputHeight(Infinity)).toBe(COMPOSER_TEXT_INPUT_MIN_HEIGHT)
  })

  it('starts with one line and resets cleared multiline content to one line', () => {
    expect(resolveComposerTextInputHeight({ contentHeight: 24, value: '你好 hello', compact: false })).toBe(30)
    expect(
      resolveComposerTextInputHeight({ contentHeight: 116, value: '', compact: false }),
    ).toBe(30)
    expect(
      resolveComposerTextInputHeight({ contentHeight: 116, value: 'next', compact: false }),
    ).toBe(104)
  })

  it('preserves multiline editing before the native measurement catches up', () => {
    expect(resolveComposerTextInputHeight({ contentHeight: 24, value: 'a\nb\nc\nd', compact: false })).toBe(84)
    expect(resolveComposerTextInputHeight({ contentHeight: 24, value: '', compact: false })).toBe(30)
    expect(resolveComposerTextInputHeight({ contentHeight: 24, value: 'a\n'.repeat(20), compact: false })).toBe(104)
  })

  it('grows to five lines and shrinks again as native wrapped content changes', () => {
    const value = '中文与 English 自动折行，不依赖显式换行'
    expect([24, 44, 64, 84, 104, 124, 84, 44, 24].map((contentHeight) =>
      resolveComposerTextInputHeight({ contentHeight, value, compact: false }),
    )).toEqual([30, 44, 64, 84, 104, 104, 84, 44, 30])
  })

  it('expands each explicit newline up to the same five-line cap', () => {
    expect([1, 2, 3, 4, 5, 6].map((lines) =>
      resolveComposerTextInputHeight({ contentHeight: 24, value: Array(lines).fill('行').join('\n'), compact: false }),
    )).toEqual([30, 44, 64, 84, 104, 104])
  })

  it('uses the compact composer height range', () => {
    expect(
      resolveComposerTextInputHeight({ contentHeight: 12, value: 'a', compact: true }),
    ).toBe(24)
    expect(
      resolveComposerTextInputHeight({ contentHeight: 120, value: 'a', compact: true }),
    ).toBe(96)
  })

  it('keeps five full lines when a caller supplies a larger reading line height', () => {
    const resolve = (value: string, contentHeight: number) =>
      resolveComposerTextInputHeight({ value, contentHeight, compact: false, lineHeight: 25 })
    expect(resolve('', 129)).toBe(30)
    expect(resolve('一行', 29)).toBe(30)
    expect(resolve('一\n二', 29)).toBe(54)
    expect(resolve('一\n二\n三\n四\n五', 29)).toBe(129)
    expect(resolve('wrapped text', 154)).toBe(129)
    expect(resolve('短文本', 29)).toBe(30)
  })
})
