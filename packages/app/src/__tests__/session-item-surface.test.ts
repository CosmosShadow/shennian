// @arch docs/architecture/app/modular-features.md#会话列表
// @covers packages/app/src/features/session-list/sessionItemSurface.ts

import { describe, expect, it } from 'vitest'
import type { Colors } from '../hooks/useTheme'
import { getSessionItemSurfaceColor } from '../features/session-list/sessionItemSurface'

const colors = {
  bg: '#ffffff',
  avatarGroupBg: '#E2E4E5',
  surface: '#ffffff',
  surfaceHover: '#f5f5f5',
  border: '#e5e7eb',
  text: '#111827',
  textSecondary: '#4b5563',
  textTertiary: '#9ca3af',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#2563eb',
  brandDark: '#1d4ed8',
  brandLight: '#dbeafe',
  navigationSelected: '#4776A1',
  ownMessage: 'rgba(59,130,246,0.08)',
  error: '#ef4444',
  errorText: '#b91c1c',
  success: '#22c55e',
  successText: '#15803d',
  warning: '#f59e0b',
  warningText: '#92400e',
} satisfies Colors

describe('session item surface', () => {
  it('does not let external channels change the normal row background', () => {
    expect(getSessionItemSurfaceColor({ colors, isDark: false })).toBe('transparent')
    expect(getSessionItemSurfaceColor({ colors, isDark: false, hasExternalChannel: true })).toBe('transparent')
  })

  it('uses the regular pinned background even when a session has an external channel', () => {
    const regularPinned = getSessionItemSurfaceColor({ colors, isDark: false, isPinned: true })
    const externalPinned = getSessionItemSurfaceColor({
      colors,
      isDark: false,
      isPinned: true,
      hasExternalChannel: true,
    })

    expect(externalPinned).toBe(regularPinned)
    expect(externalPinned).toBe('#f0f0f0')
  })

  it('uses the regular active background even when a session has an external channel', () => {
    expect(getSessionItemSurfaceColor({ colors, isDark: false, isActive: true, hasExternalChannel: true })).toBe(
      '#2563eb26',
    )
  })
})
