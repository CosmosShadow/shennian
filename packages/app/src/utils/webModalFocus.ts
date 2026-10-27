// @arch docs/design/accessibility-and-review.md#4-键盘与焦点
// @test packages/app/src/__tests__/web-modal-focus.test.ts

export type Focusable = {
  focus?: (options?: { preventScroll?: boolean }) => void
}

export type FocusContainer = Focusable & {
  contains?: (target: unknown) => boolean
  querySelectorAll?: (selectors: string) => ArrayLike<Focusable>
}

export type WebModalTabEvent = {
  key: string
  shiftKey?: boolean
  defaultPrevented?: boolean
  target?: unknown
  preventDefault: () => void
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function getWebModalFocusableElements(container: FocusContainer | null): Focusable[] {
  if (!container?.querySelectorAll) return []
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => typeof element.focus === 'function',
  )
}

export function focusWebModal(
  container: FocusContainer | null,
  initialTarget?: Focusable | null,
): Focusable | null {
  const target =
    typeof initialTarget?.focus === 'function'
      ? initialTarget
      : (getWebModalFocusableElements(container)[0] ?? container)
  if (typeof target?.focus !== 'function') return null
  target.focus()
  return target
}

export function restoreWebModalFocus(target?: Focusable | null): boolean {
  if (typeof target?.focus !== 'function') return false
  target.focus({ preventScroll: true })
  return true
}

export function trapWebModalTabKey(
  event: WebModalTabEvent,
  container: FocusContainer | null,
): boolean {
  if (event.key !== 'Tab' || event.defaultPrevented) return false

  const focusable = getWebModalFocusableElements(container)
  if (focusable.length === 0) {
    event.preventDefault()
    container?.focus?.()
    return true
  }

  const currentIndex = focusable.indexOf(event.target as Focusable)
  const shouldWrapBackward = !!event.shiftKey && currentIndex <= 0
  const shouldWrapForward = !event.shiftKey && currentIndex === focusable.length - 1
  const focusEscaped = currentIndex < 0 || container?.contains?.(event.target) === false

  if (!shouldWrapBackward && !shouldWrapForward && !focusEscaped) return false

  event.preventDefault()
  const target = shouldWrapBackward ? focusable[focusable.length - 1] : focusable[0]
  target?.focus?.()
  return true
}
