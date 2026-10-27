// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/escape-key.test.ts

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { registerEscapeHandler } from './escapeKey'

type EscapeHandler = () => void

export function useEscapeKey(
  enabled: boolean,
  onEscape: EscapeHandler,
  options: { includeEditable?: boolean } = {},
): void {
  const handlerRef = useRef(onEscape)
  handlerRef.current = onEscape

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined

    const cleanup = registerEscapeHandler(() => handlerRef.current(), enabled, options)
    return cleanup
  }, [enabled, options.includeEditable])
}
