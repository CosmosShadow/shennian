// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/list-item-actions-modal.test.ts

export function desktopListMenuPosition(
  anchor: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  menu: { width: number; height: number },
) {
  const below = anchor.y + anchor.height + 4
  const top = below + menu.height <= viewport.height - 8 ? below : anchor.y - menu.height - 4
  return {
    left: Math.max(
      8,
      Math.min(anchor.x + anchor.width - menu.width, viewport.width - menu.width - 8),
    ),
    top: Math.max(8, Math.min(top, viewport.height - menu.height - 8)),
  }
}
