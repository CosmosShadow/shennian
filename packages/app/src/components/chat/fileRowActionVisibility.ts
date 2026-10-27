// @arch docs/features/desktop-action-discoverability.md
// @test src/__tests__/file-row-action-discoverability.test.ts

export function shouldShowFileRowActions(options: {
  hovered: boolean
  focusWithin: boolean
  web: boolean
}): boolean {
  return !options.web || options.hovered || options.focusWithin
}
