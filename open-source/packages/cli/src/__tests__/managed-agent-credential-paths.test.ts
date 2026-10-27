// @covers src/security/managed-agent-credential-paths.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'

const cleanup: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const entry of cleanup.splice(0)) fs.rmSync(entry, { recursive: true, force: true })
})

describe('managed Agent credential roots', () => {
  it('protects both a configured symlink alias and its canonical target', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-credential-root-'))
    cleanup.push(parent)
    const target = path.join(parent, 'canonical')
    const alias = path.join(parent, 'configured')
    fs.mkdirSync(target)
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', alias)

    expect(resolveProtectedShennianDirectories()).toEqual(
      expect.arrayContaining([path.resolve(alias), fs.realpathSync(target)]),
    )
  })

  it('fails closed for a dangling configured symlink', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-credential-root-'))
    cleanup.push(parent)
    const alias = path.join(parent, 'configured')
    fs.symlinkSync(path.join(parent, 'missing'), alias, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', alias)

    expect(() => resolveProtectedShennianDirectories()).toThrow(
      'managed_agent_credential_root_unavailable',
    )
  })
})
