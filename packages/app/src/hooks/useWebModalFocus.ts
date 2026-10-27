// @arch docs/design/accessibility-and-review.md#4-键盘与焦点
// @test packages/app/src/__tests__/web-modal-focus.test.ts

import { useEffect, useRef, type RefObject } from 'react'
import { Platform } from 'react-native'
import {
  focusWebModal,
  restoreWebModalFocus,
  trapWebModalTabKey,
  type FocusContainer,
} from '../utils/webModalFocus'

type Focusable = {
  focus?: () => void
}

export function useWebModalFocus({
  visible,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  suspended = false,
}: {
  visible: boolean
  containerRef: RefObject<unknown>
  initialFocusRef?: RefObject<unknown>
  returnFocusRef?: RefObject<unknown>
  suspended?: boolean
}): void {
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !visible) return

    const returnTarget = (returnFocusRef?.current ?? document.activeElement) as Focusable | null
    const frame = requestAnimationFrame(() => {
      if (suspendedRef.current) return
      const container = containerRef.current as FocusContainer | null
      const initialTarget = initialFocusRef?.current as Focusable | null
      focusWebModal(container, initialTarget)
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspendedRef.current) return
      trapWebModalTabKey(event, containerRef.current as FocusContainer | null)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      restoreWebModalFocus(returnTarget)
    }
  }, [containerRef, initialFocusRef, returnFocusRef, visible])
}
