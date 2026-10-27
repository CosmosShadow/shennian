// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/desktop-pointer-events.test.ts

import { Platform } from 'react-native'

type PointerEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

export function getDesktopPointerEventTarget(): PointerEventTarget | null {
  if (Platform.OS !== 'web') return null
  if (typeof window === 'undefined') return null
  if (
    typeof window.addEventListener !== 'function' ||
    typeof window.removeEventListener !== 'function'
  ) {
    return null
  }
  return window
}
