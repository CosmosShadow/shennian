// @covers src/features/chat/utils/chatKeyboardGeometry.ts
// @covers src/features/chat/screens/ChatScreen.tsx
// @covers src/features/steward/StewardScreen.tsx
import { describe, expect, it } from 'vitest'
import { chatKeyboardVerticalOffset } from '../features/chat/utils/chatKeyboardGeometry'

describe('Steward keyboard screen coordinates', () => {
  it('keeps the composer above the iOS keyboard when the parent owns the top safe area', () => {
    const parentTop = 62, frameHeight = 812, keyboardTop = 538
    const offset = chatKeyboardVerticalOffset(true, parentTop)
    const avoidedHeight = frameHeight - (keyboardTop - offset)
    expect(parentTop + frameHeight - avoidedHeight).toBe(keyboardTop)
  })
  it('also accounts for the parent top inset on Android without adding a header height', () => {
    expect(chatKeyboardVerticalOffset(true, 24)).toBe(24)
  })
  it('keeps independent chats unchanged and bounds invalid inset input', () => {
    expect(chatKeyboardVerticalOffset(false, 62)).toBe(0)
    expect(chatKeyboardVerticalOffset(true, 0)).toBe(0)
    expect(chatKeyboardVerticalOffset(true, -5)).toBe(0)
    expect(chatKeyboardVerticalOffset(true, Number.NaN)).toBe(0)
  })
})
