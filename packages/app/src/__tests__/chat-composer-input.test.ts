// @arch docs/architecture/app/chat-composer-keyboard.md
// @covers packages/app/src/features/chat/utils/composerInput.ts

import { describe, expect, it } from 'vitest'
import {
  hasSendableComposerContent,
  resolveComposerInputChange,
} from '../features/chat/utils/composerInput'

describe('chat composer input utils', () => {
  it('ignores a full stale replay even before React commits the cleared value', () => {
    expect(
      resolveComposerInputChange({
        nextValue: '如果 codex 本身就是以工具调用为结束，那我觉得就不用解决它，就这样显示吧',
        pendingClearedValue:
          '如果 codex 本身就是以工具调用为结束，那我觉得就不用解决它，就这样显示吧',
      }),
    ).toBe('ignore-stale-replay')
  })

  it('keeps the stale-replay guard through the empty callback emitted by native clear', () => {
    expect(
      resolveComposerInputChange({
        nextValue: '',
        pendingClearedValue: 'sent text',
      }),
    ).toBe('keep-clear-guard')
  })

  it('accepts new typing and releases the stale-replay guard', () => {
    expect(
      resolveComposerInputChange({
        nextValue: 'new message',
        pendingClearedValue: 'sent text',
      }),
    ).toBe('accept')
  })

  it('does nothing when there is no pending cleared value', () => {
    expect(
      resolveComposerInputChange({
        nextValue: 'hello',
        pendingClearedValue: null,
      }),
    ).toBe('accept')
  })

  it('allows sending when the composer has uploaded attachments but no visible text', () => {
    expect(hasSendableComposerContent('', 1)).toBe(true)
    expect(hasSendableComposerContent('   ', 2)).toBe(true)
    expect(hasSendableComposerContent('   ', 0)).toBe(false)
  })
})
