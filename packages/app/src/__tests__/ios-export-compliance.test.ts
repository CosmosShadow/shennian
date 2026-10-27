// @arch deploy/ios/README.md
// @covers packages/app/app.json

import { describe, expect, it } from 'vitest'
import appJson from '../../app.json'

describe('iOS export compliance config', () => {
  it('declares that the app does not use non-exempt encryption', () => {
    expect(appJson.expo.ios?.config?.usesNonExemptEncryption).toBe(false)
  })
})
