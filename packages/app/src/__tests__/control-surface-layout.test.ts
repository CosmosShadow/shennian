// @covers packages/app/src/utils/controlSurfaceLayout.ts

import { describe, expect, it } from 'vitest'
import {
  getControlSurfaceEntryMode,
  isAccountReplicaSyncEnabled,
  isDesktopControlSurfaceEnabled,
} from '../utils/controlSurfaceLayout'

describe('control surface layout', () => {
  it('keeps the current control surface on the mobile navigation stack', () => {
    expect(isDesktopControlSurfaceEnabled()).toBe(false)
    expect(isDesktopControlSurfaceEnabled('mobile')).toBe(false)
  })

  it('requires a future desktop entry point to opt in explicitly', () => {
    expect(isDesktopControlSurfaceEnabled('desktop')).toBe(true)
  })

  it('runs account replicas for explicit Desktop web renderers but not ordinary Web', () => {
    expect(isAccountReplicaSyncEnabled('web', 'desktop')).toBe(true)
    expect(isAccountReplicaSyncEnabled('web', 'mobile')).toBe(false)
    expect(isAccountReplicaSyncEnabled('ios', 'mobile')).toBe(true)
  })

  it('enables desktop only through the explicit build mode', () => {
    const previous = process.env.EXPO_PUBLIC_SHENNIAN_CONTROL_SURFACE
    process.env.EXPO_PUBLIC_SHENNIAN_CONTROL_SURFACE = 'desktop'
    try {
      expect(getControlSurfaceEntryMode()).toBe('desktop')
      expect(isDesktopControlSurfaceEnabled()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_SHENNIAN_CONTROL_SURFACE
      else process.env.EXPO_PUBLIC_SHENNIAN_CONTROL_SURFACE = previous
    }
  })
})
