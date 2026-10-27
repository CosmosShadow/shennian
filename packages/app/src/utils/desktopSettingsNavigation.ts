// @arch docs/design/desktop/unified-desktop-control.md#可点击导航原型
// @test ../__tests__/desktop-settings-navigation.test.ts

import { isDesktopSettingsPathname } from '../features/desktop-shell/desktopRouteRegistry'

const STORAGE_KEY = 'shennian.desktop.settingsReturn.v1'
const DEFAULT_WORKSPACE_HREF = '/(main)'
const DEFAULT_RETURN_FOCUS_TEST_ID = 'sidebar-open-settings'

let memoryReturnHref: string | null = null

export function isDesktopSettingsPath(pathname: string): boolean {
  return isDesktopSettingsPathname(pathname)
}

export function normalizeDesktopWorkspaceHref(href: string | null | undefined): string | null {
  const value = href?.trim()
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  const pathname = value.split(/[?#]/, 1)[0]
  if (isDesktopSettingsPath(pathname)) return null
  return value
}

export function captureDesktopSettingsReturnLocation(href: string): void {
  const normalized = normalizeDesktopWorkspaceHref(href)
  if (!normalized) return
  memoryReturnHref = normalized
  try {
    window.sessionStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    // Memory still preserves the current renderer session in restricted environments.
  }
}

export function getDesktopSettingsReturnLocation(): string {
  if (memoryReturnHref) return memoryReturnHref
  try {
    const stored = normalizeDesktopWorkspaceHref(window.sessionStorage.getItem(STORAGE_KEY))
    if (stored) {
      memoryReturnHref = stored
      return stored
    }
  } catch {
    // Fall through to the stable workspace root.
  }
  return DEFAULT_WORKSPACE_HREF
}

export function readDesktopWindowHref(pathname: string): string {
  if (typeof window === 'undefined') return pathname
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function resolveDesktopSettingsReturnFocusTestId(
  testId: string | null | undefined,
): string {
  const value = testId?.trim()
  return value && value.length <= 256 && /^[A-Za-z0-9._:~-]+$/.test(value)
    ? value
    : DEFAULT_RETURN_FOCUS_TEST_ID
}

export function resetDesktopSettingsReturnLocationForTests(): void {
  memoryReturnHref = null
}
