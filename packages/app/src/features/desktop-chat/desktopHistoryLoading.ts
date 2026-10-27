// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test src/__tests__/desktop-room-conversation-model.test.ts

/** Let the loading state commit and paint before a large local history merge starts. */
export function waitForDesktopHistoryLoadingPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
