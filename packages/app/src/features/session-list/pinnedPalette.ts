import type { Colors } from '../../hooks/useTheme'

export function getPinnedSurfaceColor(colors: Colors, isDark: boolean): string {
  return isDark ? `${colors.surfaceHover}` : '#f0f0f0'
}

export function getPressedSurfaceColor(colors: Colors, isDark: boolean): string {
  return isDark ? `${colors.surfaceHover}` : '#e3e3e3'
}
