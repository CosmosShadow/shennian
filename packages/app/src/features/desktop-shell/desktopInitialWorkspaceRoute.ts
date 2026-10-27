// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-sidebar-width.test.ts

export function getDesktopInitialWorkspaceRoute(initialSessionId: string | null): string {
  return initialSessionId ? `/(main)/chat/${initialSessionId}` : '/(main)/machines'
}
