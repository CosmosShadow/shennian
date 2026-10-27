// @arch docs/design/desktop/unified-desktop-control.md#窗口与状态协议设计约束非新增-wire
// @test ../../__tests__/desktop-file-panel-state.test.ts
import { clampFilePanelWidth, getDefaultFilePanelWidth } from '../chat/utils/filePanelWidthStorage'
import { desktopShellWindowState, type DesktopShellWindowStateStore } from './desktopShellWindowState'

/** sessionStorage belongs to this renderer window; each account has its own preference. */
export class DesktopFilePanelState {
  constructor(private readonly windowState: DesktopShellWindowStateStore) {}
  preference(accountId: string): number | null {
    return this.windowState.get(accountId).panels.fileWidth
  }
  displayedWidth(accountId: string, availableWidth: number): number {
    const preferred = this.preference(accountId)
    return preferred === null ? getDefaultFilePanelWidth(availableWidth) : clampFilePanelWidth(preferred, availableWidth)
  }
  saveUserWidth(accountId: string, width: number): void {
    this.windowState.setFilePanelWidth(accountId, width)
  }
}

/** One drag scope is invalidated by account, viewport or presentation changes. */
export class DesktopFilePanelResize {
  private drag: { startX: number; startWidth: number; width: number; moved: boolean } | null = null
  constructor(private readonly state: DesktopFilePanelState, private readonly accountId: string,
    private readonly availableWidth: number, private readonly narrow: boolean, private readonly isCurrent: () => boolean) {}
  start(clientX: number, panelWidth: number): boolean {
    if (!this.accountId || this.narrow || !this.isCurrent() || !Number.isFinite(clientX)) return false
    this.drag = { startX: clientX, startWidth: panelWidth, width: panelWidth, moved: false }
    return true
  }
  move(clientX: number): number | null {
    if (!this.drag || !this.isCurrent() || !Number.isFinite(clientX)) return null
    const width = clampFilePanelWidth(this.drag.startWidth - (clientX - this.drag.startX), this.availableWidth)
    this.drag.moved ||= width !== this.drag.startWidth
    this.drag.width = width
    return width
  }
  finish(): void {
    const drag = this.drag
    this.drag = null
    if (drag?.moved && this.isCurrent()) this.state.saveUserWidth(this.accountId, drag.width)
  }
  cancel(): void { this.drag = null }
}

export const desktopFilePanelState = new DesktopFilePanelState(desktopShellWindowState)

export function bindDesktopFilePanelPointerEvents(target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  handlers: { move: (event: PointerEvent) => void; finish: () => void; cancel: () => void }): () => void {
  const detach = () => {
    target.removeEventListener('pointermove', handlers.move)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', cancel)
  }
  const finish = () => { detach(); handlers.finish() }
  const cancel = () => { detach(); handlers.cancel() }
  target.addEventListener('pointermove', handlers.move)
  target.addEventListener('pointerup', finish, { once: true })
  target.addEventListener('pointercancel', cancel, { once: true })
  return detach
}
