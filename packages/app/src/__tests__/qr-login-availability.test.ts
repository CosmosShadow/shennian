// @arch docs/architecture/app/modular-features.md#登录-feature
// @covers packages/app/src/features/auth/utils/qrLoginAvailability.ts

import { describe, expect, it } from 'vitest'
import { canShowQrLogin } from '../features/auth/utils/qrLoginAvailability'

describe('QR login availability', () => {
  it('never offers QR login in native mobile apps', () => {
    expect(canShowQrLogin('ios', 1179, false)).toBe(false)
    expect(canShowQrLogin('android', 1080, false)).toBe(false)
  })

  it('hides QR login in narrow mobile web viewports', () => {
    expect(canShowQrLogin('web', 430, false)).toBe(false)
    expect(canShowQrLogin('web', 767, false)).toBe(false)
  })

  it('keeps QR login on desktop web and in the desktop shell', () => {
    expect(canShowQrLogin('web', 768, false)).toBe(true)
    expect(canShowQrLogin('web', 430, true)).toBe(true)
  })
})
