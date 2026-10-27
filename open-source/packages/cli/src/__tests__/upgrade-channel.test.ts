// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/upgrade/channel.ts
// @covers open-source/packages/cli/src/upgrade/engine.ts
// @covers open-source/packages/cli/src/commands/upgrade.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { getUpgradeChannel, getUpgradeDistTag, setUpgradeChannel } from '../upgrade/channel.js'
import { checkForUpdate, fetchLatestVersion } from '../upgrade/engine.js'
import { registerUpgradeCommand } from '../commands/upgrade.js'
import { AutoUpgradeScheduler } from '../upgrade/scheduler.js'

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-unit-'))
  vi.stubEnv('SHENNIAN_HOME', home)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})
describe('machine-local upgrade channel', () => {
  const distribution = (channel: 'stable' | 'preview', version = '0.4.34') => ({
    schemaVersion: 1, channel, version,
    artifact: {
      url: 'https://oss.example/shennian.tgz', size: 123,
      integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
    },
  })
  it('defaults to stable; changes persist without modifying identity config', () => {
    const config = path.join(home, 'config.json')
    fs.writeFileSync(config, '{"fixture":"untouched"}')
    expect(getUpgradeChannel()).toBe('stable')
    expect(getUpgradeDistTag()).toBe('latest')
    setUpgradeChannel('preview')
    expect(getUpgradeChannel()).toBe('preview')
    expect(JSON.parse(fs.readFileSync(path.join(home, 'upgrade-channel.json'), 'utf8')).channel).toBe('preview')
    expect(fs.readFileSync(config, 'utf8')).toBe('{"fixture":"untouched"}')
    expect(getUpgradeDistTag()).toBe('next')
    setUpgradeChannel('stable')
    expect(getUpgradeDistTag()).toBe('latest')
  })
  it('rejects invalid values without changing the existing choice; corrupt config fails closed', () => {
    setUpgradeChannel('preview')
    expect(() => setUpgradeChannel('next')).toThrow('stable or preview')
    expect(getUpgradeChannel()).toBe('preview')
    fs.writeFileSync(path.join(home, 'upgrade-channel.json'), '{}')
    expect(getUpgradeChannel).toThrow('Cannot read upgrade channel')
    setUpgradeChannel('stable')
    expect(getUpgradeChannel()).toBe('stable')
  })
  it('resolves the selected registry tag on each check and never downgrades', async () => {
    const fetcher = vi.fn()
      .mockResolvedValue({ ok: true, json: async () => ({ version: '0.4.34' }) })
    vi.stubGlobal('fetch', fetcher)
    await fetchLatestVersion()
    expect(String(fetcher.mock.calls[0][0])).toBe('https://registry.npmjs.org/shennian/latest')
    setUpgradeChannel('preview')
    expect(await checkForUpdate('0.4.33')).toMatchObject({ hasUpdate: true, latest: '0.4.34' })
    expect(String(fetcher.mock.calls[1][0])).toBe('https://registry.npmjs.org/shennian/next')
    setUpgradeChannel('stable')
    expect(await checkForUpdate('0.4.35')).toEqual({ hasUpdate: false })
  })
  it('uses the authenticated Shennian API only after npm discovery fails', async () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
      machineToken: 'machine-token', serverUrl: 'https://shennian.net',
    }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => distribution('stable') })
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchLatestVersion()).toBe('0.4.34')
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://registry.npmjs.org/shennian/latest',
      'https://shennian.net/api/releases/cli?channel=stable',
    ])
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: { Accept: 'application/json', Authorization: 'Bearer machine-token' },
    })
  })
  it('does not fall back to latest when next is missing or unavailable', async () => {
    setUpgradeChannel('preview')
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ machineToken: 'machine-token' }))
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchLatestVersion()).rejects.toThrow('404')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://registry.npmjs.org/shennian/next',
      'https://shennian.net/api/releases/cli?channel=preview',
    ])
    fetcher.mockRejectedValue(new Error('offline'))
    await expect(fetchLatestVersion()).rejects.toThrow('offline')
  })
  it.each([undefined, 'oops', '0.4.34-beta.1'])('rejects unsupported registry versions: %s', async (version) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) }))
    await expect(fetchLatestVersion()).rejects.toThrow('unsupported CLI version')
  })
  it('scheduler uses preview discovery but still honors the server kill switch', async () => {
    setUpgradeChannel('preview')
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.4.34' }) })
    vi.stubGlobal('fetch', fetcher)
    const startUpgrade = vi.fn()
    let killSwitch = true
    const scheduler = new AutoUpgradeScheduler({
      currentVersion: '0.4.33', machineId: 'unit', serverUrl: 'https://shennian.net',
      getIdleState: () => ({ idle: true, reasons: [] }), startUpgrade,
      inCooldown: () => false,
      fetchReleasePolicy: async () => ({
        automaticPatchEnabled: true, rolloutPercentage: 100, pausedVersions: [],
        blockedVersions: [], blockedCurrentVersions: [], killSwitch,
        releaseLevel: 'normal', maxIdleWaitMs: 1000, requiredCapabilities: [], externalUpdaterEnabled: true,
      }),
    })
    scheduler.setPolicy('patch')
    await scheduler.runOnce()
    expect(String(fetcher.mock.calls[0][0])).toBe('https://registry.npmjs.org/shennian/next')
    expect(startUpgrade).not.toHaveBeenCalled()
    killSwitch = false
    await scheduler.runOnce()
    expect(startUpgrade).toHaveBeenCalledWith('0.4.34', false)
  })
  it('channel command only persists configuration; never calls the registry or installs', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = new Command()
    registerUpgradeCommand(program)
    await program.parseAsync(['upgrade', '--channel', 'preview'], { from: 'user' })
    expect(getUpgradeChannel()).toBe('preview')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(program.parseAsync(['upgrade', '--channel', 'stable', '--to', '0.4.34'], { from: 'user' })).rejects.toThrow('cannot be combined')
    expect(getUpgradeChannel()).toBe('preview')
  })
})
