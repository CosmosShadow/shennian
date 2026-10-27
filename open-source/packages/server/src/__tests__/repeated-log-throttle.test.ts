// @covers open-source/packages/server/src/relay/repeated-log-throttle.ts

import { describe, expect, it } from 'vitest'
import { RepeatedLogThrottle } from '../relay/repeated-log-throttle.js'

describe('repeated log throttle', () => {
  it('logs the first occurrence and emits a later suppression summary', () => {
    const throttle = new RepeatedLogThrottle(1_000, 10_000)

    expect(throttle.take('machine-1', 1_000)).toEqual({ shouldLog: true, suppressed: 0 })
    expect(throttle.take('machine-1', 1_100)).toEqual({ shouldLog: false, suppressed: 1 })
    expect(throttle.take('machine-1', 1_200)).toEqual({ shouldLog: false, suppressed: 2 })
    expect(throttle.take('machine-1', 2_100)).toEqual({ shouldLog: true, suppressed: 2 })
  })

  it('keeps independent rejection keys separate', () => {
    const throttle = new RepeatedLogThrottle(1_000, 10_000)

    expect(throttle.take('machine-1', 1_000).shouldLog).toBe(true)
    expect(throttle.take('machine-2', 1_100).shouldLog).toBe(true)
  })
})
