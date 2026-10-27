// @arch docs/architecture/app/chat-composer-keyboard.md
// @covers packages/app/src/features/chat/components/ChatComposer.tsx
// @covers packages/app/src/features/chat/components/ComposerInputCard.tsx
// @covers packages/app/src/features/chat/components/ComposerVoiceControl.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insertPlainComposerNewline } from '../features/chat/utils/composerNewline'

describe('ChatComposer web newline handling', () => {
  it('inserts only a plain newline after an ordered-list line', () => {
    const current = '1. reproduce the bug'
    const next = insertPlainComposerNewline(current, current.length, current.length)

    expect(next.value).toBe('1. reproduce the bug\n')
    expect(next.value).not.toContain('\n2. ')
    expect(next.cursor).toBe(current.length + 1)
  })

  it('preserves normal newline behavior and replaces selected text', () => {
    const next = insertPlainComposerNewline('hello selected world', 6, 14)

    expect(next.value).toBe('hello \n world')
    expect(next.cursor).toBe(7)
  })

  it('keeps the listening waveform compact without clipping the composer menu', () => {
    const composer = readFileSync(
      resolve(__dirname, '../features/chat/components/ChatComposer.tsx'),
      'utf-8',
    )
    const voiceControl = readFileSync(
      resolve(__dirname, '../features/chat/components/ComposerVoiceControl.tsx'),
      'utf-8',
    )
    const inputCard = readFileSync(
      resolve(__dirname, '../features/chat/components/ComposerInputCard.tsx'),
      'utf-8',
    )
    const actions = readFileSync(
      resolve(__dirname, '../features/chat/hooks/useChatComposerActions.tsx'),
      'utf-8',
    )

    expect(composer).toContain('<ComposerVoiceControl')
    expect(voiceControl).toContain('listeningIndicator')
    expect(voiceControl).toMatch(
      /listeningIndicator:\s*\{[\s\S]*?width: 104,[\s\S]*?marginLeft: 8,/,
    )
    const toolbarLeft = inputCard.match(/toolbarLeft:\s*\{([\s\S]*?)\n {2}\},/)?.[1]
    expect(toolbarLeft).toBeDefined()
    expect(toolbarLeft).not.toContain('overflow:')
    expect(actions).toContain('maxWidth: isDesktop ? 180 : 132,')
    expect(actions).toContain('maxWidth: isDesktop ? 120 : 96,')
  })

  it('keeps long voice drafts scrollable, and tapping the text area interrupts dictation', () => {
    const composer = readFileSync(resolve(__dirname, '../features/chat/components/ChatComposer.tsx'), 'utf8')
    const roomComposer = readFileSync(resolve(__dirname, '../features/rooms/components/RoomComposer.tsx'), 'utf8')
    const card = readFileSync(resolve(__dirname, '../features/chat/components/ComposerInputCard.tsx'), 'utf8')

    expect(composer).toContain(
      "if (voicePhase === 'listening' || voicePhase === 'refining') void onVoiceCancel()",
    )
    expect(roomComposer).toContain('editable')
    expect(card).toMatch(/multiline\s+maxLength=\{maxLength\}\s+scrollEnabled/)
    expect(card).not.toContain('scrollEnabled={Platform.OS ===')
  })
})

// @covers packages/app/src/features/published-agents/composerKeyboard.ts
import { shouldSendOnEnter } from '../features/published-agents/composerKeyboard'
it('sends with Enter, preserves Shift+Enter and protects IME confirmation', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }
  expect(shouldSendOnEnter(enter)).toBe(true)
  expect(shouldSendOnEnter({ ...enter, shiftKey: true })).toBe(false)
  expect(shouldSendOnEnter({ ...enter, isComposing: true })).toBe(false)
  expect(shouldSendOnEnter({ ...enter, keyCode: 229 })).toBe(false)
  expect(shouldSendOnEnter({ ...enter, key: 'a' })).toBe(false)
})
