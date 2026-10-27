// @arch docs/architecture/desktop/unified-desktop.md
// @test ../../__tests__/desktop-sidebar-virtualization.test.ts

/**
 * Whether the window uses the macOS hidden-inset title bar (see
 * packages/desktop/src/main/window-chrome.ts). Only then does the renderer own
 * the title-bar row; other platforms keep the native frame and menu bar.
 */
export function isMacDesktopChrome(userAgent?: string): boolean {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return /Macintosh|Mac OS X/i.test(agent)
}
