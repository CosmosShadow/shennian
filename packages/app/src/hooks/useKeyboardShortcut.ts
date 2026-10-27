// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/keyboard-shortcuts.test.ts

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { registerShortcutHandler, type ShortcutCombo } from './keyboardShortcuts'

type ShortcutHandler = () => void

export function useKeyboardShortcut(
  combo: ShortcutCombo,
  enabled: boolean,
  onShortcut: ShortcutHandler,
): void {
  const handlerRef = useRef(onShortcut)
  handlerRef.current = onShortcut

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined
    return registerShortcutHandler(combo, () => handlerRef.current(), enabled)
  }, [combo.key, combo.metaOrCtrl, combo.shift, combo.allowEditable, combo.ignoreWidgets, enabled])
}
