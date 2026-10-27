// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/upgrade-channel.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveShennianPath } from '../config/index.js'

export type UpgradeChannel = 'stable' | 'preview'

/** Separate from identity config: selecting a channel must never rewrite pairing data. */
export function getUpgradeChannel(): UpgradeChannel {
  try {
    const value = JSON.parse(fs.readFileSync(resolveShennianPath('upgrade-channel.json'), 'utf8'))
    if (value?.schemaVersion !== 1 || !['stable', 'preview'].includes(value.channel)) {
      throw new Error('invalid upgrade channel configuration')
    }
    return value.channel
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'stable'
    throw new Error('Cannot read upgrade channel; use shennian upgrade --channel stable to repair it')
  }
}

export function setUpgradeChannel(channel: string): void {
  if (channel !== 'stable' && channel !== 'preview') throw new Error('Upgrade channel must be stable or preview')
  const file = resolveShennianPath('upgrade-channel.json')
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, channel }) + '\n', { flag: 'wx', mode: 0o600 })
    const fd = fs.openSync(temp, 'r+')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(file), 'r')
      try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
    }
  } finally {
    try { fs.unlinkSync(temp) } catch { /* Already renamed. */ }
  }
}

export function getUpgradeDistTag(): 'latest' | 'next' {
  // Read for every check: a running daemon observes CLI changes without restarting.
  return getUpgradeChannel() === 'preview' ? 'next' : 'latest'
}
