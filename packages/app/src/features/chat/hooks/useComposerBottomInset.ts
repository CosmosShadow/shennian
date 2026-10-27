// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/chat-keyboard-avoider.test.ts

import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export function useComposerBottomInset(safeAreaBottom: number): number {
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'web') return

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true))
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false))

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  if (Platform.OS === 'web') return 8
  return keyboardVisible ? 8 : safeAreaBottom || 8
}
