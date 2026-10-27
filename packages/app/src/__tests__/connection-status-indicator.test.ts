/**
 * @covers src/components/ConnectionStatusIndicator.tsx
 */

import { describe, expect, it } from 'vitest'
import {
  getConnectionStatusIndicatorMetrics,
  getConnectionStatusIndicatorPalette,
} from '../components/connectionStatusIndicator.helpers'

const lightColors = {
  bg: '#ffffff',
  avatarGroupBg: '#E2E4E5',
  surface: '#fafafa',
  surfaceHover: '#f5f5f5',
  border: '#f0f0f0',
  text: '#111111',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#4f46e5',
  brandDark: '#4338ca',
  brandLight: '#eef2ff',
  navigationSelected: '#4776A1',
  ownMessage: 'rgba(59,130,246,0.08)',
  error: '#ef4444',
  errorText: '#b91c1c',
  success: '#22c55e',
  successText: '#15803d',
  warning: '#f59e0b',
  warningText: '#92400e',
}

const darkColors = {
  bg: '#0a0a0a',
  avatarGroupBg: '#303234',
  surface: '#171717',
  surfaceHover: '#262626',
  border: '#262626',
  text: '#fafafa',
  textSecondary: '#a3a3a3',
  textTertiary: '#737373',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#818cf8',
  brandDark: '#6366f1',
  brandLight: '#1e1b4b',
  navigationSelected: '#85ADCE',
  ownMessage: 'rgba(96,165,250,0.12)',
  error: '#f87171',
  errorText: '#f87171',
  success: '#4ade80',
  successText: '#4ade80',
  warning: '#fbbf24',
  warningText: '#fbbf24',
}

describe('connection status indicator', () => {
  it('uses larger metrics for the mobile header variant', () => {
    const regular = getConnectionStatusIndicatorMetrics('regular')
    const compact = getConnectionStatusIndicatorMetrics('compact')

    expect(regular.spinnerSize).toBeGreaterThan(compact.spinnerSize)
    expect(regular.textSize).toBeGreaterThan(compact.textSize)
    expect(regular.gap).toBeGreaterThan(compact.gap)
  })

  it('raises contrast for dark mode while keeping a softer light mode palette', () => {
    const light = getConnectionStatusIndicatorPalette(lightColors, false)
    const dark = getConnectionStatusIndicatorPalette(darkColors, true)

    expect(light.textColor).toBe('rgba(28,28,30,0.84)')
    expect(light.arcColor).toBe('rgba(60,60,67,0.42)')
    expect(dark.textColor).toBe('rgba(250,250,250,0.88)')
    expect(dark.trackColor).toBe('rgba(255,255,255,0.14)')
  })
})
