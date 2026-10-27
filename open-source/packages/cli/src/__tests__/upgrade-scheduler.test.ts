// @covers open-source/packages/cli/src/upgrade/scheduler.ts

import { describe, expect, it, vi } from 'vitest'
import {
  AutoUpgradeScheduler,
  deterministicRolloutBucket,
  isAutomaticPatchAllowed,
} from '../upgrade/scheduler.js'

const openPolicy = {
  automaticPatchEnabled: true,
  rolloutPercentage: 100,
  pausedVersions: [],
  blockedVersions: [],
  blockedCurrentVersions: [],
  killSwitch: false,
  releaseLevel: 'normal' as const,
  maxIdleWaitMs: 30 * 60_000,
  requiredCapabilities: [],
  externalUpdaterEnabled: true,
}

describe('AutoUpgradeScheduler', () => {
  it('always polls for required updates without creating duplicate timers', () => {
    const setTimer = vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setTimeout>)
    const clearTimer = vi.fn()
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle: true, reasons: [] }),
      startUpgrade: vi.fn(), setTimeout: setTimer, clearTimeout: clearTimer,
    })

    scheduler.start()
    scheduler.start()
    expect(setTimer).toHaveBeenCalledTimes(1)
    scheduler.setPolicy('none')
    expect(clearTimer).not.toHaveBeenCalled()
    scheduler.setPolicy('patch')
    scheduler.setPolicy('patch')
    expect(setTimer).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'failure'])('resamples 5–15 minute intervals after each %s and stops cleanly', async (outcome) => {
    vi.useFakeTimers()
    const random = vi.fn().mockReturnValue(0.5).mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.999999)
    const checkForUpdate = vi.fn(async () => {
      if (outcome === 'failure') throw new Error('network unavailable')
      return { hasUpdate: false as const }
    })
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle: true, reasons: [] }), startUpgrade: vi.fn(),
      checkForUpdate, random,
    })
    try {
      scheduler.start()
      scheduler.start()
      await vi.advanceTimersByTimeAsync(29_999)
      expect(checkForUpdate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(checkForUpdate).toHaveBeenCalledTimes(1)
      for (const [index, delay] of [5 * 60_000, 10 * 60_000, 15 * 60_000 - 1].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(checkForUpdate).toHaveBeenCalledTimes(index + 1)
        await vi.advanceTimersByTimeAsync(1)
        expect(checkForUpdate).toHaveBeenCalledTimes(index + 2)
      }
      expect(random).toHaveBeenCalledTimes(4)
      scheduler.stop()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(checkForUpdate).toHaveBeenCalledTimes(4)
    } finally {
      scheduler.stop()
      vi.useRealTimers()
    }
  })

  it('only installs patch releases while the daemon is idle and official policy allows it', async () => {
    const startUpgrade = vi.fn()
    let idle = false
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle, reasons: idle ? [] : ['active-agent-turn'] }),
      startUpgrade,
      checkForUpdate: async () => ({ hasUpdate: true, current: '1.2.3', latest: '1.2.4', changeType: 'patch' }),
      fetchReleasePolicy: async () => openPolicy,
      inCooldown: () => false,
    })
    scheduler.setPolicy('patch')
    await scheduler.runOnce()
    expect(startUpgrade).not.toHaveBeenCalled()

    idle = true
    await scheduler.runOnce()
    expect(startUpgrade).toHaveBeenCalledWith('1.2.4', false)
  })

  it('fails closed for minor releases, kill switch, blocked and paused versions', async () => {
    expect(isAutomaticPatchAllowed({ ...openPolicy, killSwitch: true }, 'm', '1.2.3', '1.2.4')).toBe(false)
    expect(isAutomaticPatchAllowed({ ...openPolicy, blockedVersions: ['1.2.4'] }, 'm', '1.2.3', '1.2.4')).toBe(false)
    expect(isAutomaticPatchAllowed({ ...openPolicy, pausedVersions: ['1.2.3'] }, 'm', '1.2.3', '1.2.4')).toBe(false)
  })

  it('assigns a stable rollout bucket', () => {
    expect(deterministicRolloutBucket('machine-1')).toBe(deterministicRolloutBucket('machine-1'))
    expect(deterministicRolloutBucket('machine-1')).toBeGreaterThanOrEqual(0)
    expect(deterministicRolloutBucket('machine-1')).toBeLessThan(100)
  })

  it('never interrupts a busy normal client, even beyond the server idle deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    let idle = false
    const startUpgrade = vi.fn()
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle, reasons: idle ? [] : ['active-agent-turn'] }), startUpgrade,
      checkForUpdate: async () => ({ hasUpdate: true, current: '1.2.3', latest: '1.2.4', changeType: 'patch' }),
      fetchReleasePolicy: async () => ({ ...openPolicy, maxIdleWaitMs: 5000 }),
      inCooldown: () => false,
    })
    scheduler.setPolicy('patch')
    await scheduler.runOnce()
    expect(startUpgrade).not.toHaveBeenCalled()
    try {
      for (const elapsed of [5000, 31 * 60_000, 24 * 60 * 60_000]) {
        vi.setSystemTime(1000 + elapsed)
        await scheduler.runOnce()
        expect(startUpgrade).not.toHaveBeenCalled()
      }
      idle = true
      await scheduler.runOnce()
      expect(startUpgrade).toHaveBeenCalledExactlyOnceWith('1.2.4', false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies required upgrades even when ordinary auto patch is disabled and busy', async () => {
    const startUpgrade = vi.fn()
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle: false, reasons: ['active-agent-turn'] }), startUpgrade,
      checkForUpdate: async () => ({ hasUpdate: true, current: '1.2.3', latest: '1.3.0', changeType: 'minor' }),
      fetchReleasePolicy: async () => ({ ...openPolicy, releaseLevel: 'required' }),
      inCooldown: () => false,
    })
    scheduler.setPolicy('none')
    await scheduler.runOnce()
    expect(startUpgrade).toHaveBeenCalledWith('1.3.0', true)
  })

  it('uses protocol, data epoch and required capabilities—not matching delivery versions', async () => {
    const startUpgrade = vi.fn()
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      sessionSyncProtocolVersion: 2, dataEpoch: 4, advertisedCapabilities: ['run-recovery'],
      updaterProtocolVersion: 1,
      getIdleState: () => ({ idle: false, reasons: ['active-agent-turn'] }), startUpgrade,
      checkForUpdate: async () => ({ hasUpdate: true, current: '1.2.3', latest: '9.0.0', changeType: 'major' }),
      fetchReleasePolicy: async () => ({
        ...openPolicy,
        automaticPatchEnabled: false,
        minimumSessionSyncProtocolVersion: 3,
        minimumDataEpoch: 4,
        requiredCapabilities: ['run-recovery', 'updater-v1'],
      }),
      inCooldown: () => false,
    })
    scheduler.setPolicy('none')
    await scheduler.runOnce()
    expect(startUpgrade).toHaveBeenCalledWith('9.0.0', true)
  })

  it('lets the server pause helper adoption and require an updater protocol', async () => {
    const startUpgrade = vi.fn()
    let externalUpdaterEnabled = false
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '1.2.3', machineId: 'machine-1', serverUrl: 'https://shennian.net',
      updaterProtocolVersion: 1,
      getIdleState: () => ({ idle: true, reasons: [] }), startUpgrade,
      checkForUpdate: async () => ({ hasUpdate: true, current: '1.2.3', latest: '1.2.4', changeType: 'patch' }),
      fetchReleasePolicy: async () => ({
        ...openPolicy, externalUpdaterEnabled, minimumUpdaterProtocolVersion: 2,
      }),
      inCooldown: () => false,
    })
    scheduler.setPolicy('patch')
    await scheduler.runOnce()
    expect(startUpgrade).not.toHaveBeenCalled()
    externalUpdaterEnabled = true
    await scheduler.runOnce()
    expect(startUpgrade).toHaveBeenCalledWith('1.2.4', true)
  })
})
