// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/upgrade/engine.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate,
  clearUpgradeFailure,
  findPackageJson,
  getUpgradeRetryDelayMs,
  isUpgradeVersionInCooldown,
  readUpgradeFailures,
  recordUpgradeFailure,
  acquireUpgradeLock,
  npmExecOptionsForPlatform,
  resolveNpmGlobalPrefixFromPackageJson,
  rollbackToExactVersion,
} from '../upgrade/engine'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-upgrade-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  delete process.env.SHENNIAN_HOME
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('upgrade engine version helpers', () => {
  it('finds the package manifest from a compiled package file path', () => {
    const root = makeTempDir()
    const compiledDir = path.join(root, 'dist', 'src', 'upgrade')
    fs.mkdirSync(compiledDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'shennian',
      version: '0.2.13',
    }))

    expect(findPackageJson(path.join(compiledDir, 'engine.js'))).toBe(path.join(root, 'package.json'))
  })

  it('ignores non-shennian manifests while walking upward', () => {
    const root = makeTempDir()
    const compiledDir = path.join(root, 'dist', 'src', 'upgrade')
    fs.mkdirSync(compiledDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'other-package',
      version: '1.0.0',
    }))

    expect(findPackageJson(path.join(compiledDir, 'engine.js'))).toBeNull()
  })

  it('derives the active npm prefix instead of trusting whichever npm is first in PATH', () => {
    expect(resolveNpmGlobalPrefixFromPackageJson(
      '/Users/test/.npm-global/lib/node_modules/shennian/package.json',
      'darwin',
    )).toBe('/Users/test/.npm-global')
    expect(resolveNpmGlobalPrefixFromPackageJson(
      String.raw`C:\Users\test\AppData\Roaming\npm\node_modules\shennian\package.json`,
      'win32',
    )).toBe(String.raw`C:\Users\test\AppData\Roaming\npm`)
    expect(resolveNpmGlobalPrefixFromPackageJson('/workspace/open-source/packages/cli/package.json', 'linux'))
      .toBeNull()
  })

  it('checks updates against the daemon startup version when provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.2.29' }),
    })))

    await expect(checkForUpdate('0.2.27')).resolves.toEqual({
      hasUpdate: true,
      current: '0.2.27',
      latest: '0.2.29',
      changeType: 'patch',
    })
  })
})

describe('upgrade failure cooldown helpers', () => {
  it('uses bounded exponential retry delays for failed versions', () => {
    expect(getUpgradeRetryDelayMs(1)).toBe(5 * 60_000)
    expect(getUpgradeRetryDelayMs(2)).toBe(30 * 60_000)
    expect(getUpgradeRetryDelayMs(3)).toBe(2 * 60 * 60_000)
    expect(getUpgradeRetryDelayMs(4)).toBe(6 * 60 * 60_000)
    expect(getUpgradeRetryDelayMs(99)).toBe(6 * 60 * 60_000)
  })

  it('records cooldown for the failed version only', () => {
    const root = makeTempDir()
    process.env.SHENNIAN_HOME = root
    const now = 1_777_710_000_000

    const first = recordUpgradeFailure('0.2.15', 'workspace protocol', now)
    expect(first.failureCount).toBe(1)
    expect(first.nextRetryAt).toBe(now + 5 * 60_000)

    expect(isUpgradeVersionInCooldown('0.2.15', now + 60_000)).toBe(true)
    expect(isUpgradeVersionInCooldown('0.2.16', now + 60_000)).toBe(false)
    expect(isUpgradeVersionInCooldown('0.2.15', now + 6 * 60_000)).toBe(false)

    const second = recordUpgradeFailure('0.2.15', 'still bad', now + 6 * 60_000)
    expect(second.failureCount).toBe(2)
    expect(second.nextRetryAt).toBe(now + 6 * 60_000 + 30 * 60_000)

    clearUpgradeFailure('0.2.15')
    expect(readUpgradeFailures().versions['0.2.15']).toBeUndefined()
  })
})

describe('upgrade atomicity', () => {
  it('launches npm.cmd through the Windows shell to avoid spawn EINVAL', () => {
    expect(npmExecOptionsForPlatform('win32', 30_000)).toEqual({
      timeout: 30_000,
      windowsHide: true,
      shell: true,
    })
    expect(npmExecOptionsForPlatform('darwin', 30_000).shell).toBe(false)
  })

  it('prevents overlapping upgrades and recovers a stale lock', () => {
    const root = makeTempDir()
    const lockPath = path.join(root, 'upgrade.lock')
    const first = acquireUpgradeLock(lockPath, { now: 1000, pid: 11, isProcessAlive: () => true })
    expect(() => acquireUpgradeLock(lockPath, { now: 1001, pid: 12, isProcessAlive: () => true }))
      .toThrow('already running')
    first.release()

    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99, createdAt: 1 }))
    const recovered = acquireUpgradeLock(lockPath, {
      now: 11 * 60_000,
      pid: 12,
      isProcessAlive: () => false,
    })
    recovered.release()
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('rolls back by reinstalling and verifying the exact npm version', async () => {
    const install = vi.fn(async () => {})
    const verify = vi.fn(async () => {})
    await rollbackToExactVersion('1.2.3', { install, verify })
    expect(install).toHaveBeenCalledWith('1.2.3')
    expect(verify).toHaveBeenCalledWith('1.2.3')
  })
})
