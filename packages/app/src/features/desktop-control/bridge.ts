// @arch docs/architecture/desktop/unified-desktop.md
// @test packages/app/src/__tests__/desktop-control-bridge.test.ts

import { Platform } from 'react-native'
import type { DesktopBridge, DesktopControlAvailability } from './types'

type DesktopWindow = Window & {
  shennianDesktop?: DesktopBridge
}

export function getDesktopControlBridge(): DesktopBridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null

  const desktopWindow = window as DesktopWindow
  return desktopWindow.shennianDesktop ?? null
}

export function getDesktopControlAvailability(): DesktopControlAvailability {
  const bridge = getDesktopControlBridge()
  return {
    available: Boolean(bridge),
    bridge,
  }
}
