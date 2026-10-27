// @covers packages/app/src/features/landing/landingViewport.ts

import { describe, expect, it } from 'vitest'
import { resolveLandingViewport } from '../features/landing/landingViewport'

describe('landing viewport', () => {
  it('prefers the browser viewport so a stale React Native width cannot select the phone layout', () => {
    expect(
      resolveLandingViewport({ width: 390, height: 844 }, { width: 1440, height: 900 }),
    ).toEqual({ width: 1440, height: 900 })
  })

  it('falls back to the React Native viewport outside a browser', () => {
    expect(resolveLandingViewport({ width: 390, height: 844 }, null)).toEqual({
      width: 390,
      height: 844,
    })
  })
})
