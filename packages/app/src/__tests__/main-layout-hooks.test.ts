/**
 * @covers app/(main)/_layout.tsx
 * @covers app/(main)/index.tsx
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMainLayoutSource(): string {
  return readFileSync(resolve(__dirname, '../../app/(main)/_layout.tsx'), 'utf-8')
}

function readRootLayoutSource(): string {
  return readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf-8')
}

function readI18nSource(): string {
  return readFileSync(resolve(__dirname, '../config/i18n.ts'), 'utf-8')
}

function readAuthLayoutSource(): string {
  return readFileSync(resolve(__dirname, '../../app/(auth)/_layout.tsx'), 'utf-8')
}

function readHomeSource(): string {
  return readFileSync(resolve(__dirname, '../../app/(main)/index.tsx'), 'utf-8')
}

function readSidebarSource(): string {
  return readFileSync(resolve(__dirname, '../features/desktop-shell/DesktopSidebar.tsx'), 'utf-8')
}

function normalizeWhitespace(source: string): string {
  return source.replace(/\s+/g, ' ')
}

describe('MainLayout hook ordering', () => {
  it('calls useTheme before the auth redirect guard', () => {
    const source = readMainLayoutSource()
    const themeHookIndex = source.indexOf('const { colors, isDark } = useTheme()')
    const redirectGuardIndex = source.indexOf('if (!isAuthenticated)')

    expect(themeHookIndex).toBeGreaterThan(-1)
    expect(redirectGuardIndex).toBeGreaterThan(-1)
    expect(themeHookIndex).toBeLessThan(redirectGuardIndex)
  })

  it('uses themed native stack backgrounds to avoid dark-mode transition flashes', () => {
    expect(readRootLayoutSource()).toContain('contentStyle: { backgroundColor: colors.bg }')
    expect(readMainLayoutSource()).toContain('contentStyle: { backgroundColor: colors.bg }')
    expect(readAuthLayoutSource()).toContain('contentStyle: { backgroundColor: colors.bg }')
  })

  it('keeps the mobile home frame quiet while cached sessions hydrate', () => {
    const source = readHomeSource()

    expect(source).toContain('const machinesRemoteResolved = useMachinesStore')
    expect(normalizeWhitespace(source)).toContain(
      'sessions.length === 0 && machines.length === 0 && (loading || !machinesRemoteResolved)',
    )
    expect(source).toContain('<View style={styles.initialPlaceholder} />')
    expect(source).not.toContain('ActivityIndicator')
  })

  it('renders synchronized projects even when their conversation list is empty', () => {
    const source = readHomeSource()

    expect(source).toContain(') : projects.length === 0 ? (')
    expect(source).not.toContain(') : sessions.length === 0 ? (')
    expect(source).toContain('data={projects}')
  })

  it('keeps public Web hydration stable while Desktop restores language before first render', () => {
    expect(readI18nSource()).toContain("return 'zh'")
    expect(readI18nSource()).toContain("const DESKTOP_LANGUAGE_STORAGE_KEY = 'shennian:language'")
    expect(readI18nSource()).toContain('isDesktopControlSurfaceEnabled()')
    expect(readI18nSource()).toContain("return readWebLanguagePreference() ?? 'zh'")
    expect(readI18nSource()).toContain("const WEB_LANGUAGE_COOKIE = 'shennian_language_v2'")
    expect(readRootLayoutSource()).toContain('window.requestAnimationFrame')
    expect(readRootLayoutSource()).toContain('isDesktopControlSurfaceEnabled()')
    expect(readRootLayoutSource()).toContain('readWebLanguagePreference()')
    expect(readRootLayoutSource()).toContain('void i18n.changeLanguage(saved)')
  })

  it('keeps the authenticated main layout mounted while offline', () => {
    const source = readMainLayoutSource()

    expect(source).toContain("pathname: '/(auth)/login'")
    expect(source).toContain('params: { redirect }')
    expect(source).toContain('roomAuthRedirectPathname(pathname, browserPathname)')
    expect(source).not.toContain("networkStatus === 'offline') return <Redirect")
    expect(source).not.toContain('<OfflineBanner />')
    expect(source).not.toContain("backgroundColor: '#ef4444'")
    expect(source).not.toContain('planRequired')
    expect(source).not.toContain('getBillingOverview')
  })

  it('consumes command/control N without opening a global Desktop new-session flow', () => {
    const source = readFileSync(resolve(__dirname, '../features/desktop-shell/DesktopMainLayout.tsx'), 'utf8')
    expect(source).toContain("{ key: 'n', metaOrCtrl: true, allowEditable: true }")
    expect(source).not.toContain('handleContextNewSessionShortcut')
    expect(source).not.toContain('createSession')
    expect(readMainLayoutSource()).toContain('desktopControlSurface: false')
  })

  it('temporarily hides the home header voice entry while keeping project creation available', () => {
    const source = readHomeSource()
    const activeSource = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(activeSource).not.toContain('testID="home-open-voice-chief"')
    expect(activeSource).not.toContain('icon="call-outline"')
    expect(activeSource).toContain('trailing={')
    expect(source).not.toContain('/(main)/steward')
    expect(source).toContain('testID="home-open-machine-picker"')
    expect(source).not.toContain('floatingVoiceWrap')
    expect(source).not.toContain('floatingVoiceBtn')
    expect(source).not.toContain('floatingVoiceBottom')
    expect(source).toContain('paddingBottom: 12')
    expect(source).toContain('icon="add"')
    expect(source).not.toContain('name="add-circle-outline"')
  })

  it('keeps Desktop connection state out of the navigation tree', () => {
    expect(normalizeWhitespace(readSidebarSource())).not.toContain('showConnectionIndicator')
    expect(readMainLayoutSource()).not.toContain('<MobileRootTabBar')
    expect(readMainLayoutSource()).toContain('screenLayout={renderMobileRootScreen}')
    expect(readHomeSource()).not.toContain('<WorkspaceSwitcher')
    expect(readHomeSource()).not.toContain('new Animated.Value(showConnectionIndicator ? 0 : 1)')
    expect(readSidebarSource()).not.toContain('<ConnectionStatusIndicator')
  })
})
