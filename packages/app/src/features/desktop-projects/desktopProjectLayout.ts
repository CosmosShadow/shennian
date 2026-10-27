// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-main-workspaces.test.ts

export function resolveDesktopProjectDensity(width: number): 'regular' | 'compact' {
  return width < 720 ? 'compact' : 'regular'
}

export function resolveDesktopProjectStatePlacement(
  state: 'pending' | 'ready' | 'empty' | 'offline' | 'forbidden' | 'error',
  sessionCount: number,
): { fullNotice: boolean; cachedNotice: boolean } {
  const fullNotice =
    state === 'pending' ||
    state === 'empty' ||
    state === 'forbidden' ||
    ((state === 'offline' || state === 'error') && sessionCount === 0)
  return {
    fullNotice,
    cachedNotice: !fullNotice && sessionCount > 0 && (state === 'offline' || state === 'error'),
  }
}
