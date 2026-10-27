// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/attachment-download.test.ts
/** Multi-image horizontal drags page normally; only the left edge closes them. */
export function shouldCloseImageSwipe(gesture: { dx: number; dy: number; x0: number; numberActiveTouches: number }, count: number) {
  return gesture.numberActiveTouches <= 1 && gesture.dx >= 64 &&
    gesture.dx > Math.abs(gesture.dy) * 2 && (count <= 1 || gesture.x0 <= 28)
}
