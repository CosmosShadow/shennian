// @arch open-source/docs/cli-runtime.md
// @covers src/commands/config.ts
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerConfigCommand } from '../commands/config.js'
import { loadConfig, saveConfig } from '../config/index.js'

let directory: string
beforeEach(() => {
  const base = path.join(os.tmpdir(), 'shennian-tests/unit')
  fs.mkdirSync(base, { recursive: true })
  directory = fs.mkdtempSync(path.join(base, 'config-binding-'))
  vi.stubEnv('SHENNIAN_HOME', directory)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(directory, { recursive: true, force: true })
})
function setCloud() {
  const program = new Command()
  registerConfigCommand(program)
  return program.parseAsync(['node', 'shennian', 'config', 'set', 'server', 'cn'])
}
describe('config server binding', () => {
  it('rejects cloud config changes on a paired self-hosted installation without changing stored credentials', async () => {
    const original = { serverUrl: 'https://company.example', machineToken: 'fixture-token', machineId: 'fixture-machine' }
    saveConfig(original)
    await expect(setCloud()).rejects.toThrow('already bound to another server')
    expect(loadConfig()).toEqual(original)
  })
  it('permits cloud selection before pairing', async () => {
    await setCloud()
    expect(loadConfig().serverUrl).toBe('https://shennian.net')
  })
})
