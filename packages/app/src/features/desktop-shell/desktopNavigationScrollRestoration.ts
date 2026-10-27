// @arch docs/design/desktop/unified-desktop-control.md#窗口与状态协议设计约束非新增-wire
// @test ../../__tests__/desktop-navigation-scroll-restoration.test.ts

/**
 * Coordinates one sidebar scroll restoration without trusting measurements made
 * by a loading skeleton. The hook owns the actual FlatList; this class keeps the
 * lifecycle deterministic and independently testable.
 */
export class DesktopNavigationScrollRestoration {
  private accountId: string
  private ready: boolean
  private contentMeasured = false
  private viewportMeasured = false
  private viewportHeight: number | null = null
  private restored = false
  private resizing = false

  constructor(accountId: string, ready: boolean) {
    this.accountId = accountId
    this.ready = ready
  }

  update(accountId: string, ready: boolean): void {
    if (this.accountId !== accountId) {
      this.accountId = accountId
      this.ready = ready
      this.contentMeasured = false
      this.viewportMeasured = false
      this.viewportHeight = null
      this.restored = false
      this.resizing = false
      return
    }
    if (this.ready === ready) return
    this.ready = ready
    this.restored = false
    // Content measured while data was loading belongs to the skeleton/partial
    // tree. Require the ready tree to report its own size before restoring.
    if (ready) this.contentMeasured = false
  }

  markContentMeasured(accountId: string): void {
    if (accountId !== this.accountId) return
    this.contentMeasured = true
  }

  markViewportMeasured(accountId: string, height?: number): void {
    if (accountId !== this.accountId) return
    if (height !== undefined && Number.isFinite(height) && height > 0) {
      if (this.viewportHeight !== null && Math.abs(this.viewportHeight - height) >= 1) this.restored = false
      this.viewportHeight = height
    }
    this.viewportMeasured = true
  }

  takeOffset(accountId: string, offset: number): number | null {
    if (
      accountId !== this.accountId ||
      !this.ready ||
      this.resizing ||
      this.restored ||
      !this.contentMeasured ||
      !this.viewportMeasured
    ) return null
    this.restored = true
    return offset
  }

  acceptsScroll(accountId: string): boolean {
    return accountId === this.accountId && this.restored && !this.resizing
  }

  beginViewportResize(accountId: string): void {
    if (accountId !== this.accountId) return
    this.resizing = true
    this.restored = false
  }

  endViewportResize(accountId: string): void {
    if (accountId !== this.accountId) return
    this.resizing = false
  }
}

/** Native resize can clamp scrollTop without a user scroll. Keep the preferred
 * position while the taller viewport cannot display it, so shrinking restores it. */
export function isDesktopNavigationResizeClamp(offset: number, preferred: number, contentHeight: number, viewportHeight: number): boolean {
  if (![offset, preferred, contentHeight, viewportHeight].every(Number.isFinite) || viewportHeight <= 0) return false
  const maximum = Math.max(0, contentHeight - viewportHeight)
  return preferred > maximum + 1 && Math.abs(offset - maximum) < 1
}
