// @arch docs/features/desktop-independent-client.md
// @test ../../__tests__/desktop-client-missing-card.test.ts

import type { DesktopBridge } from '../desktop-control/types'

export const DESKTOP_CLIENT_INSTALL_GUIDE_URL = 'https://shennian.net/install.md'

export async function openDesktopClientInstallGuide(
  bridge: DesktopBridge,
  url: string = DESKTOP_CLIENT_INSTALL_GUIDE_URL,
): Promise<boolean> {
  if (!bridge.app?.openExternal) return false
  const result = await bridge.app.openExternal({ url })
  return result.ok
}
