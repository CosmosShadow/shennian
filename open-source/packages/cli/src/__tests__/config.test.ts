// @arch open-source/docs/cli-runtime.md
// @covers src/config/index.ts

import { Command } from 'commander'
import { registerConfigCommand } from '../commands/config.js'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  getConfigPath,
  loadConfig,
  normalizeAutoUpgradePolicy,
  saveConfig,
  type ShennianConfig,
} from '../config/index.js'

let tmpDir: string
let origHome: string | undefined
let origShennianHome: string | undefined

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-test-'))
  origHome = process.env.HOME
  origShennianHome = process.env.SHENNIAN_HOME
  process.env.HOME = tmpDir
  process.env.SHENNIAN_HOME = path.join(tmpDir, '.shennian')
})

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME
  else process.env.HOME = origHome
  if (origShennianHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = origShennianHome
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadConfig / saveConfig', () => {
  it('returns empty config when no file exists', async () => {
    const configFile = getConfigPath()

    expect(fs.existsSync(configFile)).toBe(false)

    const config = loadConfig()
    expect(config).toEqual({})
  })

  it('saves and loads config correctly', () => {
    const config: ShennianConfig = {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-4',
      machineId: 'test-machine',
      accountNamespaceId: 'a'.repeat(64),
    }

    saveConfig(config)

    const loaded = loadConfig()
    expect(loaded.defaultProvider).toBe('anthropic')
    expect(loaded.defaultModel).toBe('claude-4')
    expect(loaded.machineId).toBe('test-machine')
    expect(loaded.accountNamespaceId).toBe('a'.repeat(64))
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(getConfigPath())).mode & 0o777).toBe(0o700)
      expect(fs.statSync(getConfigPath()).mode & 0o777).toBe(0o600)
    }
  })

  it('loads UTF-8 BOM config files written by PowerShell on Windows', () => {
    const configFile = getConfigPath()
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, `\ufeff${JSON.stringify({
      machineId: 'windows-machine',
      machineToken: 'machine-token',
      serverUrl: 'https://shennian.net',
    })}`, 'utf8')

    const loaded = loadConfig()

    expect(loaded.machineId).toBe('windows-machine')
    expect(loaded.machineToken).toBe('machine-token')
    expect(loaded.serverUrl).toBe('https://shennian.net')
  })

  it('resolves SHENNIAN_HOME at load time', () => {
    saveConfig({ machineId: 'home-a' })
    const homeA = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = path.join(tmpDir, '.shennian-alt')
    saveConfig({ machineId: 'home-b' })

    expect(loadConfig().machineId).toBe('home-b')
    process.env.SHENNIAN_HOME = homeA
    expect(loadConfig().machineId).toBe('home-a')
  })

  it('returns empty config on invalid JSON', () => {
    const configFile = getConfigPath()

    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, 'not-json{{{')

    const config = loadConfig()
    expect(config).toEqual({})
  })
})

describe('normalizeAutoUpgradePolicy', () => {
  it('enables safe patch updates when the user has never chosen a policy', () => {
    expect(normalizeAutoUpgradePolicy(undefined)).toBe('patch')
  })

  it('preserves an explicit opt-out and the supported patch policy', () => {
    expect(normalizeAutoUpgradePolicy('none')).toBe('none')
    expect(normalizeAutoUpgradePolicy('patch')).toBe('patch')
  })

  it('keeps legacy and invalid policies disabled', () => {
    expect(normalizeAutoUpgradePolicy('minor')).toBe('none')
    expect(normalizeAutoUpgradePolicy(null)).toBe('none')
  })
})

// @covers open-source/packages/cli/src/commands/config.ts
it('keeps extracted config commands functional and secrets redacted', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const command = new Command(); registerConfigCommand(command)
    await command.parseAsync(['node', 'unit', 'config', 'set', 'server', 'cn'])
    expect(loadConfig().serverUrl).toBe('https://shennian.net')
    saveConfig({ ...loadConfig(), accessToken: 'unit-private-token' })
    output.mockClear()
    await command.parseAsync(['node', 'unit', 'config', 'show'])
    expect(JSON.stringify(output.mock.calls)).not.toContain('unit-private-token')
  } finally { output.mockRestore() }
})
