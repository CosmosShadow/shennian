// @covers open-source/packages/server/src/relay/machine-connection-rate-limit.ts

import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMachineConnectionRateLimitKey,
  checkMachineConnectionRateLimit,
  resetMachineConnectionRateLimitForTest,
} from '../relay/machine-connection-rate-limit.js'

describe('machine connection rate limit', () => {
  afterEach(() => {
    resetMachineConnectionRateLimitForTest()
  })

  it('allows attempts up to the configured window limit', () => {
    const config = { windowMs: 60_000, maxAttempts: 2 }

    expect(checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 1_000, config).allowed).toBe(true)
    expect(checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 2_000, config).allowed).toBe(true)
  })

  it('rejects reconnect storms for the same machine and IP', () => {
    const config = { windowMs: 60_000, maxAttempts: 2 }

    checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 1_000, config)
    checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 2_000, config)
    const decision = checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 3_000, config)

    expect(decision.allowed).toBe(false)
    expect(decision.attempts).toBe(3)
    expect(decision.retryAfterMs).toBe(58_000)
  })

  it('separates buckets by machine and IP', () => {
    const config = { windowMs: 60_000, maxAttempts: 1 }

    checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 1_000, config)
    checkMachineConnectionRateLimit('machine-2', '1.2.3.4', 2_000, config)
    const sameMachineDifferentIp = checkMachineConnectionRateLimit('machine-1', '5.6.7.8', 3_000, config)

    expect(sameMachineDifferentIp.allowed).toBe(true)
    expect(buildMachineConnectionRateLimitKey('machine-1', '5.6.7.8')).toBe('machine-1:5.6.7.8')
  })

  it('resets the bucket after the window expires', () => {
    const config = { windowMs: 10_000, maxAttempts: 1 }

    checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 1_000, config)
    const afterWindow = checkMachineConnectionRateLimit('machine-1', '1.2.3.4', 12_000, config)

    expect(afterWindow.allowed).toBe(true)
    expect(afterWindow.attempts).toBe(1)
  })
})
