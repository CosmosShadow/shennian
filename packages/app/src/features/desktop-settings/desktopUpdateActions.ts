// @arch docs/features/desktop-settings-information-architecture.md#版本与更新
// @test src/__tests__/desktop-update-ui.test.ts

import type { DesktopUpdateOperation } from '../desktop-control/hooks/useDesktopUpdateState'
import type { DesktopUpdateState } from '../desktop-control/types'

export type DesktopUpdateActionId =
  | 'check'
  | 'download'
  | 'retry-check'
  | 'retry-download'
  | 'install-on-quit'
  | 'install-later'
  | 'install-now'

export function formatDesktopUpdateSize(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) {
    const megabytes = bytes / (1024 * 1024)
    return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`
  }
  const gigabytes = bytes / (1024 * 1024 * 1024)
  return `${gigabytes >= 10 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`
}

export function getDesktopUpdateActionIds(input: {
  state: DesktopUpdateState | null
  operation: DesktopUpdateOperation | null
  retryOperation: 'check' | 'download'
  confirmingRestart: boolean
}): DesktopUpdateActionId[] {
  if (
    input.operation ||
    input.state?.status === 'checking' ||
    input.state?.status === 'downloading' ||
    input.state?.status === 'verifying'
  ) {
    return []
  }
  if (!input.state || input.state.status === 'idle' || input.state.status === 'not-available') {
    return ['check']
  }
  if (input.state.status === 'available') return ['download']
  if (input.state.status === 'error') return [`retry-${input.retryOperation}`]
  if (input.state.status !== 'downloaded') return []
  if (input.confirmingRestart) return ['install-later', 'install-now']
  return input.state.installOnExit ? ['install-now'] : ['install-on-quit', 'install-now']
}
