// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/connection-status-indicator.test.ts

import type { Colors } from '../hooks/useTheme'

export type ConnectionStatusIndicatorSize = 'regular' | 'compact'

const METRICS = {
  regular: {
    spinnerSize: 18,
    strokeWidth: 1.8,
    textSize: 15,
    textWeight: '600' as const,
    gap: 8,
  },
  compact: {
    spinnerSize: 15,
    strokeWidth: 1.6,
    textSize: 14,
    textWeight: '500' as const,
    gap: 7,
  },
}

export function getConnectionStatusIndicatorMetrics(size: ConnectionStatusIndicatorSize) {
  return METRICS[size]
}

export function getConnectionStatusIndicatorPalette(colors: Colors, isDark: boolean) {
  return {
    textColor: isDark ? 'rgba(250,250,250,0.88)' : 'rgba(28,28,30,0.84)',
    trackColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.16)',
    arcColor: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(60,60,67,0.42)',
    fallbackColor: isDark ? colors.textSecondary : colors.textTertiary,
  }
}
