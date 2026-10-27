// @covers src/commands/logout.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfigPath, loadConfig, saveConfig } from '../config/index.js'

const { stop } = vi.hoisted(() => ({ stop: vi.fn() }))
vi.mock('node:util', () => ({ promisify: () => stop }))
import { logout, registerLogoutCommand } from '../commands/logout.js'

describe('logout', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-logout-test-'))
    vi.stubEnv('SHENNIAN_HOME', home)
    stop.mockReset().mockImplementation(async (_executable, args) => ({
      stdout: JSON.stringify({ running: args[1] === 'status', remoteAccessDisabled: true }),
    }))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    process.exitCode = 0
  })

  it('stops before clearing all Shennian credentials and preserves user data across repeated logout', async () => {
    const settings = { defaultModel: 'model', apiKeys: { provider: 'keep' }, autoUpgrade: 'patch' as const }
    saveConfig({ ...settings, machineId: 'machine', machineToken: 'secret', accountNamespaceId: 'account', accessToken: 'access', refreshToken: 'refresh' })
    fs.writeFileSync(path.join(home, 'history.json'), 'history')
    stop.mockImplementationOnce(async () => {
      expect(loadConfig().machineToken).toBe('secret')
      return { stdout: JSON.stringify({ running: true, remoteAccessDisabled: true }) }
    })
    await logout()
    await logout()
    expect(loadConfig()).toEqual(settings)
    expect(fs.readFileSync(path.join(home, 'history.json'), 'utf8')).toBe('history')
    expect(stop).toHaveBeenCalledWith(process.execPath, [expect.stringContaining('/bin/shennian.js'), 'stop', '--json'], expect.objectContaining({ windowsHide: true }))
  })

  it.each([
    { running: true, remoteAccessDisabled: true },
    { running: false, remoteAccessDisabled: false },
    { running: false, remoteAccessDisabled: true, error: 'stop failed' },
  ])('preserves credentials when stop is incomplete: %j', async (status) => {
    saveConfig({ machineToken: 'secret' })
    stop.mockImplementation(async (_executable, args) => ({
      stdout: JSON.stringify(args[1] === 'status' ? { running: true } : status),
    }))
    await expect(logout()).rejects.toThrow()
    expect(loadConfig().machineToken).toBe('secret')
  })

  it('does not overwrite a corrupt config or create one on an unpaired machine', async () => {
    await logout()
    expect(fs.existsSync(getConfigPath())).toBe(false)
    fs.writeFileSync(getConfigPath(), '{broken')
    await expect(logout()).rejects.toThrow()
    expect(fs.readFileSync(getConfigPath(), 'utf8')).toBe('{broken')
  })

  it('reports a structured failure and nonzero exit code without leaking subprocess output', async () => {
    stop.mockRejectedValue(new Error('secret child output'))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = new Command()
    registerLogoutCommand(program)
    await program.parseAsync(['logout', '--json'], { from: 'user' })
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ ok: false, error: 'logout_failed' })
    expect(JSON.stringify(output.mock.calls)).not.toContain('secret')
  })

  it('reports success as a single JSON object', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = new Command()
    registerLogoutCommand(program)
    await program.parseAsync(['logout', '--json'], { from: 'user' })
    expect(output).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ ok: true })
  })

  it('does not stop an already paused service again', async () => {
    stop.mockResolvedValue({ stdout: JSON.stringify({ running: false, remoteAccessDisabled: true }) })
    saveConfig({ machineToken: 'secret' })
    await logout()
    expect(loadConfig()).toEqual({})
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop.mock.calls[0][1][1]).toBe('status')
  })
})
