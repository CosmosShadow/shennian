// @arch docs/architecture/app/modular-features.md#会话列表
// @test packages/app/src/__tests__/session-item-surface.test.ts

import type { Colors } from '../../hooks/useTheme'
import { getPinnedSurfaceColor, getPressedSurfaceColor } from './pinnedPalette'

type SessionItemSurfaceInput = {
  colors: Colors
  isDark: boolean
  isPinned?: boolean
  isActive?: boolean
  isPressed?: boolean
  hasExternalChannel?: boolean
}

export function getSessionItemSurfaceColor({
  colors,
  isDark,
  isPinned = false,
  isActive = false,
  isPressed = false,
}: SessionItemSurfaceInput): string {
  if (isActive) return `${colors.brand}26`
  if (isPressed) return getPressedSurfaceColor(colors, isDark)
  if (isPinned) return getPinnedSurfaceColor(colors, isDark)
  return 'transparent'
}
