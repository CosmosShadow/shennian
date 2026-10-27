// @arch docs/features/managed-agent-restricted-runtime.md
// @test src/__tests__/session-mode-ui.test.ts

import { Alert, Platform } from 'react-native'

export type ConfirmChoiceCopy = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
}

/** Cautionary confirmation shared by agent settings: cancel keeps the current choice. */
export function confirmChoice(copy: ConfirmChoiceCopy, proceed: () => void) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${copy.title}\n\n${copy.message}`)) proceed()
    return
  }
  Alert.alert(copy.title, copy.message, [
    { text: copy.cancelLabel, style: 'cancel' },
    { text: copy.confirmLabel, onPress: proceed },
  ])
}
