// @covers src/native-fusion/config.ts

import { describe, expect, it } from 'vitest'
import { isNativeFusionEnabled } from '../native-fusion/config.js'

describe('native fusion config', () => {
  it('enables native fusion by default', () => {
    expect(isNativeFusionEnabled({})).toBe(true)
  })

  it('allows explicit disable for tests or emergency rollback', () => {
    expect(isNativeFusionEnabled({ SHENNIAN_NATIVE_FUSION_DISABLED: '1' })).toBe(false)
  })
})
