/**
 * @covers app/_layout.tsx
 * @covers packages/app/src/config/authSession.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRootLayoutSource(): string {
  return readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf-8')
}

describe('RootLayout auth session validation', () => {
  it('restores local auth before startup is marked ready', () => {
    const source = readRootLayoutSource()
    const loadIndex = source.indexOf('Promise.all([loadFromStorage(), hydrateInstallationId()])')
    const readyIndex = source.indexOf('if (mounted) setReady(true)')

    expect(loadIndex).toBeGreaterThan(-1)
    expect(readyIndex).toBeGreaterThan(-1)
    expect(loadIndex).toBeLessThan(readyIndex)
  })

  it('does not block app startup on remote session validation', () => {
    const source = readRootLayoutSource()
    const loadIndex = source.indexOf('Promise.all([loadFromStorage(), hydrateInstallationId()])')
    const validateIndex = source.indexOf('validateStoredSession().catch(() => {})')
    const readyIndex = source.indexOf('if (mounted) setReady(true)')

    expect(loadIndex).toBeGreaterThan(-1)
    expect(validateIndex).toBeGreaterThan(-1)
    expect(readyIndex).toBeGreaterThan(-1)
    expect(loadIndex).toBeLessThan(validateIndex)
    expect(validateIndex).toBeLessThan(readyIndex)
    expect(source).not.toContain('await validateStoredSession()')
  })

  it('hydrates the signed-in device cache before the first native frame', () => {
    const source = readRootLayoutSource()
    const authIndex = source.indexOf('await Promise.all([loadFromStorage(), hydrateInstallationId()])')
    const devicesIndex = source.indexOf('await hydrateProfileDevices(useAuthStore.getState().user?.id)')
    const readyIndex = source.indexOf('if (mounted) setReady(true)')

    expect(devicesIndex).toBeGreaterThan(authIndex)
    expect(devicesIndex).toBeLessThan(readyIndex)
  })

  it('does not update startup state after the root layout unmounts', () => {
    const source = readRootLayoutSource()

    expect(source).toContain('let mounted = true')
    expect(source).toContain('if (mounted) setReady(true)')
    expect(source).toContain('mounted = false')
  })

  it('keeps a theme-colored first frame while native storage hydrates', () => {
    const source = readRootLayoutSource()

    expect(source).toContain(
      'if (!ready) return <View style={[styles.root, { backgroundColor: colors.bg }]} />',
    )
    expect(source).not.toContain('if (!ready) return null')
  })
})
