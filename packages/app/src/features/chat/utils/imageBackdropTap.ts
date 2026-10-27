// @arch docs/architecture/app/chat-attachments-preview.md#同一消息多图浏览
// @test src/__tests__/image-gallery.test.ts

type Size = { width: number; height: number }
type Touch = { pageX: number; pageY: number; locationX: number; locationY: number }

/** Image pixels (including transparent/white pixels) never count as backdrop. */
export function isImageBackdrop(point: { x: number; y: number }, viewport: Size, image: Size) {
  if (
    ![viewport.width, viewport.height, image.width, image.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return false
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height)
  const left = (viewport.width - image.width * scale) / 2
  const top = (viewport.height - image.height * scale) / 2
  return (
    point.x >= 0 &&
    point.x <= viewport.width &&
    point.y >= 0 &&
    point.y <= viewport.height &&
    (point.x < left ||
      point.x > viewport.width - left ||
      point.y < top ||
      point.y > viewport.height - top)
  )
}

/** Observe touches without claiming the responder from native zoom/paging gestures. */
export function createImageBackdropTap() {
  let start: (Touch & { time: number }) | null = null
  return {
    cancel() {
      start = null
    },
    start(touch: Touch, count: number, eligible: boolean, time = Date.now()) {
      // A second finger permanently cancels this sequence, even after it lifts.
      start = !start && count === 1 && eligible ? { ...touch, time } : null
    },
    move(touch: Touch, count: number) {
      if (
        start &&
        (count !== 1 || Math.hypot(touch.pageX - start.pageX, touch.pageY - start.pageY) > 8)
      ) {
        start = null
      }
    },
    end(touch: Touch, remaining: number, eligible: boolean, time = Date.now()) {
      const first = start
      start = null
      return (
        !!first &&
        remaining === 0 &&
        eligible &&
        time - first.time <= 350 &&
        Math.hypot(touch.pageX - first.pageX, touch.pageY - first.pageY) <= 8
      )
    },
  }
}
