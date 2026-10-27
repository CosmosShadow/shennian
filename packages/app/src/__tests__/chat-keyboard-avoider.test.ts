// @arch docs/architecture/app/chat-composer-keyboard.md
// @covers packages/app/src/features/chat/screens/ChatScreen.tsx
// @covers packages/app/src/features/personal-modules/PersonalScheduleScreen.tsx
// @covers packages/app/src/features/rooms/RoomConversationScreen.tsx
// @covers packages/app/src/features/rooms/RoomWorkspaceScreen.tsx

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSource = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), 'utf8')

const chatScreenSource = () => readSource('../features/chat/screens/ChatScreen.tsx')
const roomConversationSource = () => readSource('../features/rooms/RoomConversationScreen.tsx')
const roomWorkspaceSource = () => readSource('../features/rooms/RoomWorkspaceScreen.tsx')
const composerInsetSource = () => readSource('../features/chat/hooks/useComposerBottomInset.ts')
const rootLayoutSource = () => readSource('../../app/_layout.tsx')

describe('chat keyboard avoider OTA compatibility', () => {
  it('uses the React Native KeyboardAvoidingView in chat instead of the native keyboard-controller component', () => {
    const source = chatScreenSource()

    expect(source).toMatch(
      /import\s*\{[\s\S]*?KeyboardAvoidingView[\s\S]*?\}\s*from 'react-native'/,
    )
    expect(source).toMatch(/import\s*\{[\s\S]*?Platform[\s\S]*?\}\s*from 'react-native'/)
    expect(source).not.toContain("KeyboardAvoidingView } from 'react-native-keyboard-controller'")
    const schedule = readSource('../features/personal-modules/PersonalScheduleScreen.tsx')
    expect(schedule).not.toContain('react-native-keyboard-controller')
    expect(schedule).toMatch(/import\s*\{[\s\S]*?KeyboardAvoidingView[\s\S]*?\}\s*from 'react-native'/)
  })

  it('keeps the native root layout free of react-native-keyboard-controller for OTA safety', () => {
    expect(rootLayoutSource()).not.toContain('react-native-keyboard-controller')
  })

  it('gives Room conversations the same native keyboard avoider and safe-area behavior', () => {
    const source = roomConversationSource()

    expect(source).toMatch(
      /import\s*\{[\s\S]*?KeyboardAvoidingView[\s\S]*?\}\s*from 'react-native'/,
    )
    expect(source).toContain("Platform.OS === 'android' ? 'height' : 'padding'")
    expect(source).toContain('useSafeAreaInsets()')
    expect(source).toContain('useComposerBottomInset(insets.bottom)')
    expect(source).toContain(
      "keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}",
    )
    expect(source).toContain('keyboardShouldPersistTaps="handled"')
    expect(source).toContain('onFocus={handleComposerFocus}')
    expect(source).toContain('scrollToLatest(false, true)')
  })

  it('lets the mobile Room workspace own keyboard avoidance for both embedded pages', () => {
    const workspace = roomWorkspaceSource()

    expect(workspace).toMatch(
      /import\s*\{[\s\S]*?KeyboardAvoidingView[\s\S]*?\}\s*from 'react-native'/,
    )
    expect(workspace).toContain("Platform.OS === 'android' ? 'height' : 'padding'")
    expect(workspace).toContain(
      '<KeyboardAvoidingView behavior={keyboardAvoidingBehavior} style={styles.mobileBody}>',
    )
    expect(chatScreenSource()).toContain(
      "!embedded && (Platform.OS === 'ios' || Platform.OS === 'android')",
    )
    expect(roomConversationSource()).toContain(
      "!embedded && (Platform.OS === 'ios' || Platform.OS === 'android')",
    )
  })

  it('only compacts the safe-area inset when a software keyboard is actually visible', () => {
    const source = composerInsetSource()

    expect(source).toContain('Keyboard.addListener(showEvent, () => setKeyboardVisible(true))')
    expect(source).toContain('Keyboard.addListener(hideEvent, () => setKeyboardVisible(false))')
    expect(source).toContain('return keyboardVisible ? 8 : safeAreaBottom || 8')
    expect(chatScreenSource()).toContain('bottomInset={composerBottomInset}')
    expect(roomConversationSource()).not.toContain('inputFocused ? 8')
  })
})
