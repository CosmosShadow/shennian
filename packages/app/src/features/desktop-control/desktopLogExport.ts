// @arch docs/features/desktop-local-first-client.md#63-本机-daemon-管理
// @test packages/app/src/__tests__/desktop-log-export.test.ts

import type { DesktopBridge } from './types'

export type DesktopLogExportStatus = 'unavailable' | 'canceled' | 'exported'

/**
 * Diagnostic exports stay behind Electron main's save dialog and redaction
 * boundary. The renderer receives only the outcome it needs for UI feedback.
 */
export async function requestDesktopLogExport(
  bridge: Pick<DesktopBridge, 'openLog'> | null,
): Promise<DesktopLogExportStatus> {
  if (!bridge?.openLog) return 'unavailable'
  const result = await bridge.openLog()
  return result.canceled ? 'canceled' : 'exported'
}

export async function revealDesktopLogExport(
  bridge: Pick<DesktopBridge, 'revealLog'> | null,
): Promise<boolean> {
  if (!bridge?.revealLog) return false
  return (await bridge.revealLog()).revealed
}
