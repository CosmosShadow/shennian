// @arch docs/features/free-growth-phase.md
// @test src/__tests__/landing-viewport.test.ts

export interface LandingViewport {
  width: number
  height: number
}

function isUsableDimension(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function readBrowserViewport(): LandingViewport | null {
  if (typeof window === 'undefined') return null

  const documentWidth =
    typeof document === 'undefined' ? undefined : document.documentElement.clientWidth
  const documentHeight =
    typeof document === 'undefined' ? undefined : document.documentElement.clientHeight
  const width = isUsableDimension(documentWidth) ? documentWidth : window.innerWidth
  const height = isUsableDimension(documentHeight) ? documentHeight : window.innerHeight

  return isUsableDimension(width) && isUsableDimension(height) ? { width, height } : null
}

export function resolveLandingViewport(
  nativeViewport: LandingViewport,
  browserViewport: LandingViewport | null,
): LandingViewport {
  return browserViewport ?? nativeViewport
}
