// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-composer-controls.test.ts

/** Focus blank composer space without intercepting text selection or toolbar controls. */
export function focusDesktopComposerBlankArea(
  event: { target: unknown; nativeEvent: { button: number }; preventDefault(): void },
  focus: () => void,
): void {
  if (event.nativeEvent.button !== 0) return
  const target = event.target as Element | null
  if (!target?.closest || target.closest(
    'button, a, input, textarea, select, summary, [role="button"], [role="menu"], [role="menuitem"], [role="combobox"], [contenteditable="true"]',
  )) return
  // Prevent the pointer's default action from immediately blurring the newly focused input.
  event.preventDefault()
  focus()
}

/** Only keyboard-visible focus should draw a control ring after modal/picker focus restoration. */
export function isDesktopComposerFocusVisible(target: unknown): boolean {
  return (target as HTMLElement | null)?.matches?.(':focus-visible') ?? false
}

type DesktopComposerFocusDocument = {
  activeElement: unknown
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

/**
 * Keep a composer's visual text focus aligned with the browser's single active element.
 * React Native Web focus/blur callbacks can be skipped when focus crosses embedded panes
 * or returns from a system file picker, so every document focus transition also clears
 * stale sibling-composer state.
 */
export function observeDesktopComposerInputFocus(
  input: HTMLTextAreaElement,
  onFocusedChange: (focused: boolean) => void,
  ownerDocument: DesktopComposerFocusDocument = document,
): () => void {
  const syncFromFocusIn = (event: Event) => onFocusedChange(event.target === input)
  const clearFromFocusOut = (event: Event) => {
    if (event.target === input) onFocusedChange(false)
  }

  onFocusedChange(ownerDocument.activeElement === input)
  ownerDocument.addEventListener('focusin', syncFromFocusIn)
  ownerDocument.addEventListener('focusout', clearFromFocusOut)
  return () => {
    ownerDocument.removeEventListener('focusin', syncFromFocusIn)
    ownerDocument.removeEventListener('focusout', clearFromFocusOut)
  }
}
