// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test ../__tests__/control-surface-layout.test.ts

export type ControlSurfaceEntryMode = 'mobile' | 'desktop'

export function getControlSurfaceEntryMode(): ControlSurfaceEntryMode {
  return process.env.EXPO_PUBLIC_SHENNIAN_CONTROL_SURFACE === 'desktop' ? 'desktop' : 'mobile'
}

/**
 * The complete control surface currently has one supported information architecture:
 * the mobile stack used by iOS and Android. A future desktop product must opt in
 * through its own entry point instead of being inferred from viewport width.
 */
export function isDesktopControlSurfaceEnabled(
  entryMode: ControlSurfaceEntryMode = getControlSurfaceEntryMode(),
): boolean {
  return entryMode === 'desktop'
}

/** Full-account replicas run on native mobile and the explicit Desktop shell, never ordinary Web. */
export function isAccountReplicaSyncEnabled(
  platform: string,
  entryMode: ControlSurfaceEntryMode = getControlSurfaceEntryMode(),
): boolean {
  return platform !== 'web' || entryMode === 'desktop'
}
