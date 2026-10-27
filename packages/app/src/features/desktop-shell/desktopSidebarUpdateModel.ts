// @arch docs/architecture/desktop/unified-desktop.md#8-更新
// @test ../../__tests__/desktop-sidebar-update-button.test.ts
import type { DesktopUpdateState } from '../desktop-control/types'

export function desktopSidebarUpdatePresentation(state: DesktopUpdateState | null, busy: boolean) {
  const status = state?.status
  return {
    visible: status === 'available' || status === 'downloading' || status === 'verifying' || status === 'downloaded',
    disabled: busy || status === 'downloading' || status === 'verifying',
    label: status === 'downloaded' ? 'desktop_sidebar_update_ready' : status === 'verifying' ? 'desktop_sidebar_update_verifying' : status === 'downloading' ? 'desktop_sidebar_update_downloading' : 'desktop_sidebar_update_download',
    percent: state?.status === 'downloading' ? Math.round(Math.min(100, Math.max(0, Number.isFinite(state.percent) ? state.percent : 0))) : undefined,
  }
}

/** Only downloads or opens settings. Installation is deliberately not a dependency. */
export function createDesktopSidebarUpdateAction(deps: {
  state(): DesktopUpdateState | null
  download(): Promise<DesktopUpdateState | null>
  openUpdates(): void
  busy(value: boolean): void
  failed(): void
}) {
  let active = false, pending = false, epoch = 0
  return {
    start() { active = true; epoch++; deps.busy(pending) },
    stop() { active = false; epoch++ },
    async press() {
      if (!active || pending) return
      const status = deps.state()?.status
      if (status === 'downloaded') { deps.openUpdates(); return }
      if (status !== 'available') return
      pending = true; const generation = epoch; deps.busy(true)
      try {
        const result = await deps.download()
        if (active && generation === epoch && (!result || result.status === 'error')) deps.failed()
      } catch {
        if (active && generation === epoch) deps.failed()
      } finally {
        pending = false
        if (active) deps.busy(false)
      }
    },
  }
}
