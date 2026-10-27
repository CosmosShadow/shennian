// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-workspace-form.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, ScrollView } from 'react-native'

const HEADER_HEIGHT = 48
const KEYBOARD_GAP = 16

export function useAgentWorkspaceKeyboardScroll(safeAreaTop: number) {
  const scrollRef = useRef<ScrollView>(null)
  const focusedFieldRef = useRef<unknown>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const scrollFocusedFieldIntoView = useCallback(() => {
    const target = focusedFieldRef.current
    if (!target) return
    scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
      target,
      safeAreaTop + HEADER_HEIGHT + KEYBOARD_GAP,
      true,
    )
  }, [safeAreaTop])

  useEffect(() => {
    const showing = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        if (Platform.OS === 'ios') setKeyboardHeight(event.endCoordinates.height)
      },
    )
    const shown = Keyboard.addListener('keyboardDidShow', scrollFocusedFieldIntoView)
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    )
    return () => {
      showing.remove()
      shown.remove()
      hidden.remove()
    }
  }, [scrollFocusedFieldIntoView])

  useEffect(() => {
    if (keyboardHeight <= 0) return
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(scrollFocusedFieldIntoView)
    })
    return () => cancelAnimationFrame(frame)
  }, [keyboardHeight, scrollFocusedFieldIntoView])

  const revealFocusedField = useCallback(
    (target: unknown) => {
      focusedFieldRef.current = target
      if (Keyboard.isVisible()) requestAnimationFrame(scrollFocusedFieldIntoView)
    },
    [scrollFocusedFieldIntoView],
  )

  return { scrollRef, revealFocusedField, keyboardHeight }
}
