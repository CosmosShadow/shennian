// @arch docs/design/desktop/unified-desktop-control.md#键盘与无障碍
// @test ../../__tests__/desktop-settings-focus.test.ts

type FocusTarget = { focus(): void }

export type DesktopAccountConfirmation = 'logout' | 'delete' | null
export type DesktopAccountFocusTarget =
  | 'confirmation'
  | 'delete-progress'
  | 'logout-trigger'
  | 'delete-trigger'
  | null

/** Restores the edit trigger after the inline nickname editor is removed. */
export function focusDesktopNicknameEditTrigger(target: unknown): boolean {
  return focusDesktopSettingsTarget(target)
}

export function focusDesktopSettingsTarget(target: unknown): boolean {
  const focusTarget = target as FocusTarget | null
  if (typeof focusTarget?.focus !== 'function') return false
  focusTarget.focus()
  return true
}

/** Keeps focus inside an inline confirmation and restores its exact trigger on close. */
export function resolveDesktopAccountFocusTarget(
  previous: DesktopAccountConfirmation,
  current: DesktopAccountConfirmation,
  deleting: boolean,
): DesktopAccountFocusTarget {
  if (deleting) return 'delete-progress'
  if (current) return 'confirmation'
  if (previous === 'logout') return 'logout-trigger'
  if (previous === 'delete') return 'delete-trigger'
  return null
}
