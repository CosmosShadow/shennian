// @covers packages/app/src/features/voice-chief/overlayGeometry.ts

import { describe, expect, it } from 'vitest'
import {
  clampVoiceChiefOverlayPosition,
  getDefaultVoiceChiefOverlayPosition,
  getVoiceChiefOverlaySize,
  snapVoiceChiefOverlayPosition,
} from '../features/voice-chief/overlayGeometry'

describe('Native call floating geometry', () => {
  it('shrinks the floating call to the live window instead of overflowing it', () => {
    expect(getVoiceChiefOverlaySize({ width: 390, height: 420 })).toEqual({
      width: 72,
      height: 72,
    })
    expect(getVoiceChiefOverlaySize({ width: 60, height: 80 })).toEqual({
      width: 24,
      height: 44,
    })
  })

  it('re-clamps a saved position when the window becomes smaller', () => {
    const viewport = { width: 800, height: 600 }
    const size = getVoiceChiefOverlaySize(viewport)
    expect(clampVoiceChiefOverlayPosition({ x: 900, y: -20 }, viewport, size)).toEqual({
      x: 710,
      y: 18,
    })
  })

  it('opens near the top-right and snaps a drag to the closest horizontal edge', () => {
    const viewport = { width: 1200, height: 800 }
    const size = getVoiceChiefOverlaySize(viewport)
    expect(getDefaultVoiceChiefOverlayPosition(viewport, size)).toEqual({ x: 1110, y: 80 })
    expect(snapVoiceChiefOverlayPosition({ x: 620, y: 140 }, viewport, size)).toEqual({
      x: 1110,
      y: 140,
    })
    expect(snapVoiceChiefOverlayPosition({ x: 40, y: 140 }, viewport, size)).toEqual({
      x: 18,
      y: 140,
    })
  })

})
