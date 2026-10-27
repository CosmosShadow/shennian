// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-selection-ai.test.ts

export type SelectionOverlayRect = {
  x: number
  y: number
  width: number
  height: number
}

export type ViewportRect = {
  left: number
  top: number
}

export const TOP_LEVEL_VIEWPORT_ORIGIN: ViewportRect = { left: 0, top: 0 }

export function mapSelectionRectToOverlay(
  selectionRect: SelectionOverlayRect,
  sourceViewport: ViewportRect,
  overlayViewport: ViewportRect,
): SelectionOverlayRect {
  return {
    x: sourceViewport.left - overlayViewport.left + selectionRect.x,
    y: sourceViewport.top - overlayViewport.top + selectionRect.y,
    width: selectionRect.width,
    height: selectionRect.height,
  }
}
