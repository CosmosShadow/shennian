export const DESKTOP_SIDEBAR_MIN_WIDTH = 220
export const DESKTOP_SIDEBAR_DEFAULT_WIDTH = 280
export const DESKTOP_SIDEBAR_MAX_WIDTH = 320
export const DESKTOP_COMPACT_NAVIGATION_BREAKPOINT = 800
// The rail also owns macOS traffic-light space; 48px overlaps the content header.
export const DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH = 80

export function getDesktopSidebarWidth(windowWidth: number, preferred?: number | null): number {
  if (typeof preferred === 'number' && Number.isFinite(preferred)) {
    return Math.min(Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, preferred), DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, windowWidth - 560))
  }
  if (windowWidth >= 1600) return DESKTOP_SIDEBAR_MAX_WIDTH
  if (windowWidth >= 1440) return 300
  if (windowWidth >= 1200) return DESKTOP_SIDEBAR_DEFAULT_WIDTH
  return DESKTOP_SIDEBAR_MIN_WIDTH
}

export function shouldUseCompactDesktopNavigation(windowWidth: number): boolean {
  return windowWidth < DESKTOP_COMPACT_NAVIGATION_BREAKPOINT
}

export function getCompactDesktopSidebarWidth(windowWidth: number): number {
  return Math.max(
    0,
    Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, windowWidth - DESKTOP_COMPACT_NAVIGATION_RAIL_WIDTH),
  )
}
