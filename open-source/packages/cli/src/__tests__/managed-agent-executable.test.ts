// @covers src/security/managed-agent-executable.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fingerprintNativeExecutable,
  resolveManagedAgentExecutableIdentity,
} from '../security/managed-agent-executable.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('managed Agent executable identity', () => {
  it('hashes the exact real file selected by a native command spec', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-agent-executable-'))
    tempDirs.push(directory)
    const executable = path.join(directory, 'codex-real')
    const alias = path.join(directory, 'codex')
    const contents = Buffer.from('exact executable bytes')
    fs.writeFileSync(executable, contents)
    fs.symlinkSync(executable, alias)

    expect(fingerprintNativeExecutable(alias)).toBe(
      `sha256:${crypto.createHash('sha256').update(contents).digest('hex')}`,
    )
    expect(resolveManagedAgentExecutableIdentity({
      command: 'codex', args: [], display: 'codex', kind: 'native', path: alias,
    }, { platform: 'darwin' })).toEqual({
      platform: 'darwin',
      isWsl: false,
      executableFingerprint: `sha256:${crypto.createHash('sha256').update(contents).digest('hex')}`,
    })
  })

  it('hashes the resolved Agent inside WSL instead of hashing wsl.exe', () => {
    const digest = 'a'.repeat(64)
    const wslSpawn = vi.fn(() => ({ status: 0, stdout: `${digest}  /usr/bin/codex\n` }))

    expect(resolveManagedAgentExecutableIdentity({
      command: 'codex', args: [], display: 'codex', kind: 'wsl-bridge', path: 'wsl.exe',
    }, { platform: 'win32', wslSpawn })).toEqual({
      platform: 'linux',
      isWsl: true,
      executableFingerprint: `sha256:${digest}`,
    })
    expect(wslSpawn).toHaveBeenCalledWith('wsl.exe', [
      '-e',
      'sh',
      '-lc',
      expect.stringContaining("command -v -- 'codex'"),
    ])
  })

  it('returns no fingerprint when the exact native or WSL executable cannot be proven', () => {
    expect(fingerprintNativeExecutable('/definitely/missing/codex')).toBeUndefined()
    expect(resolveManagedAgentExecutableIdentity({
      command: 'codex', args: [], display: 'codex', kind: 'wsl-bridge', path: 'wsl.exe',
    }, {
      platform: 'win32',
      wslSpawn: () => ({ status: 127, stdout: '' }),
    })).toEqual({ platform: 'linux', isWsl: true })
  })
})
