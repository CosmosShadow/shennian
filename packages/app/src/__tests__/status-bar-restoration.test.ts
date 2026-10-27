// @covers packages/app/src/theme/nativeStatusBar.ts
// @covers packages/app/app.json
import { describe, expect, it } from 'vitest'
import { getNativeStatusBarOptions } from '../theme/nativeStatusBar'
import app from '../../app.json'

describe('native screen status bar ownership', () => {
  it('keeps dark and light pages readable through repeated theme changes', () => {
    for (const dark of [false, true, false, true]) {
      expect(getNativeStatusBarOptions(dark)).toEqual({
        statusBarStyle: dark ? 'light' : 'dark',
        statusBarHidden: false,
        statusBarAnimation: 'none',
      })
    }
  })

  it('does not leak a screen override into subsequent screens', () => {
    const previous = getNativeStatusBarOptions(true)
    previous.statusBarHidden = true
    previous.statusBarStyle = 'dark'
    expect(getNativeStatusBarOptions(true)).toMatchObject({
      statusBarStyle: 'light', statusBarHidden: false,
    })
  })

  it('builds a controller-owned iOS shell in a separate compatibility slot', () => {
    expect(app.expo.ios.infoPlist.UIViewControllerBasedStatusBarAppearance).toBe(true)
    expect(app.expo.ios.runtimeVersion).toBe('0.5.0')
    expect(app.expo.runtimeVersion).toBe('0.5.0')
  })
})
