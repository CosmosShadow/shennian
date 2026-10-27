// @covers open-source/packages/shared/src/i18n/en.ts
// @covers open-source/packages/shared/src/i18n/zh.ts

import { describe, expect, it } from 'vitest'
import en from '../i18n/en'
import zh from '../i18n/zh'

describe('reasoning effort i18n', () => {
  it('keeps English and Chinese reasoning effort labels in sync', () => {
    for (const key of [
      'reasoning_effort',
      'reasoning_effort_low',
      'reasoning_effort_medium',
      'reasoning_effort_high',
      'reasoning_effort_xhigh',
      'reasoning_effort_ultra',
      'reasoning_effort_max',
    ] as const) {
      expect(en[key]).toBeTruthy()
      expect(zh[key]).toBeTruthy()
    }
  })
})
