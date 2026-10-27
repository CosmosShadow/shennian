// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-overlay-geometry.test.ts

export type VoiceChiefOverlayPoint = { x: number; y: number }
export type VoiceChiefOverlayViewport = { width: number; height: number }
export type VoiceChiefOverlaySize = { width: number; height: number }

export const VOICE_CHIEF_OVERLAY_EDGE = 18
export const VOICE_CHIEF_COLLAPSED_SIZE = 72

export function getVoiceChiefOverlaySize(
  viewport: VoiceChiefOverlayViewport,
): VoiceChiefOverlaySize {
  const availableWidth = Math.max(1, viewport.width - VOICE_CHIEF_OVERLAY_EDGE * 2)
  const availableHeight = Math.max(1, viewport.height - VOICE_CHIEF_OVERLAY_EDGE * 2)
  return {
    width: Math.min(VOICE_CHIEF_COLLAPSED_SIZE, availableWidth),
    height: Math.min(VOICE_CHIEF_COLLAPSED_SIZE, availableHeight),
  }
}

export function clampVoiceChiefOverlayPosition(
  point: VoiceChiefOverlayPoint,
  viewport: VoiceChiefOverlayViewport,
  size: VoiceChiefOverlaySize,
): VoiceChiefOverlayPoint {
  const maxX = Math.max(
    VOICE_CHIEF_OVERLAY_EDGE,
    viewport.width - size.width - VOICE_CHIEF_OVERLAY_EDGE,
  )
  const maxY = Math.max(
    VOICE_CHIEF_OVERLAY_EDGE,
    viewport.height - size.height - VOICE_CHIEF_OVERLAY_EDGE,
  )
  return {
    x: Math.min(Math.max(point.x, VOICE_CHIEF_OVERLAY_EDGE), maxX),
    y: Math.min(Math.max(point.y, VOICE_CHIEF_OVERLAY_EDGE), maxY),
  }
}

export function getDefaultVoiceChiefOverlayPosition(
  viewport: VoiceChiefOverlayViewport,
  size: VoiceChiefOverlaySize,
): VoiceChiefOverlayPoint {
  return clampVoiceChiefOverlayPosition(
    { x: viewport.width - size.width - VOICE_CHIEF_OVERLAY_EDGE, y: 80 },
    viewport,
    size,
  )
}

export function snapVoiceChiefOverlayPosition(
  point: VoiceChiefOverlayPoint,
  viewport: VoiceChiefOverlayViewport,
  size: VoiceChiefOverlaySize,
): VoiceChiefOverlayPoint {
  const current = clampVoiceChiefOverlayPosition(point, viewport, size)
  const x =
    current.x + size.width / 2 > viewport.width / 2
      ? viewport.width - size.width - VOICE_CHIEF_OVERLAY_EDGE
      : VOICE_CHIEF_OVERLAY_EDGE
  return clampVoiceChiefOverlayPosition({ x, y: current.y }, viewport, size)
}
