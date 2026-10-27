// @covers open-source/packages/server/src/relay/machine-version-gate.ts

import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMachineVersionQuarantineKey,
  checkMachineCliVersion,
  checkMachineVersionQuarantine,
  clearMachineVersionQuarantine,
  MIN_MACHINE_CLI_VERSION,
  recordMachineVersionBlock,
  resetMachineVersionQuarantineForTest,
} from '../relay/machine-version-gate.js'

describe('machine CLI version gate', () => {
  afterEach(() => {
    resetMachineVersionQuarantineForTest()
  })

  it('rejects missing and invalid versions', () => {
    expect(checkMachineCliVersion(null).allowed).toBe(false)
    expect(checkMachineCliVersion(undefined).allowed).toBe(false)
    expect(checkMachineCliVersion('0.0.0').allowed).toBe(false)
    expect(checkMachineCliVersion('dev').allowed).toBe(false)
  })

  it('rejects versions older than the minimum upload-trimming release', () => {
    expect(checkMachineCliVersion('0.2.74')).toMatchObject({
      allowed: false,
      minVersion: MIN_MACHINE_CLI_VERSION,
      reason: 'cli-version-too-old',
    })
    expect(checkMachineCliVersion('0.1.35').allowed).toBe(false)
  })

  it('allows the minimum version and newer versions', () => {
    expect(checkMachineCliVersion(MIN_MACHINE_CLI_VERSION).allowed).toBe(true)
    expect(checkMachineCliVersion(`v${MIN_MACHINE_CLI_VERSION}`).allowed).toBe(true)
    expect(checkMachineCliVersion('0.4.0').allowed).toBe(true)
    expect(checkMachineCliVersion('0.4.11').allowed).toBe(true)
    expect(checkMachineCliVersion('0.3.41').allowed).toBe(false)
  })

  it('quarantines repeated blocked machine versions by machine and IP', () => {
    const config = { windowMs: 60_000, maxAttempts: 2, quarantineMs: 3_600_000 }

    expect(recordMachineVersionBlock('machine-1', '1.2.3.4', 1_000, config)).toMatchObject({
      quarantined: false,
      attempts: 1,
    })
    const blocked = recordMachineVersionBlock('machine-1', '1.2.3.4', 2_000, config)

    expect(blocked).toMatchObject({
      quarantined: true,
      attempts: 2,
      retryAfterMs: 3_600_000,
    })
    expect(checkMachineVersionQuarantine('machine-1', '1.2.3.4', 3_000)).toMatchObject({
      quarantined: true,
      attempts: 2,
      retryAfterMs: 3_599_000,
    })
    expect(buildMachineVersionQuarantineKey('machine-1', '1.2.3.4')).toBe('machine-1:1.2.3.4')
  })

  it('releases quarantined machines after the quarantine window', () => {
    const config = { windowMs: 60_000, maxAttempts: 1, quarantineMs: 10_000 }

    recordMachineVersionBlock('machine-1', '1.2.3.4', 1_000, config)

    expect(checkMachineVersionQuarantine('machine-1', '1.2.3.4', 5_000).quarantined).toBe(true)
    expect(checkMachineVersionQuarantine('machine-1', '1.2.3.4', 12_000).quarantined).toBe(false)
  })

  it('clears quarantine when a machine later connects with an allowed version', () => {
    const config = { windowMs: 60_000, maxAttempts: 1, quarantineMs: 10_000 }

    recordMachineVersionBlock('machine-1', '1.2.3.4', 1_000, config)
    expect(checkMachineVersionQuarantine('machine-1', '1.2.3.4', 2_000).quarantined).toBe(true)

    clearMachineVersionQuarantine('machine-1', '1.2.3.4')

    expect(checkMachineVersionQuarantine('machine-1', '1.2.3.4', 3_000)).toMatchObject({
      quarantined: false,
      attempts: 0,
    })
  })
})
