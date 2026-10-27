// @covers open-source/packages/cli/src/fs/atomic-rename.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function files() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-atomic-rename-'))
  roots.push(root)
  const from = path.join(root, 'state.json.tmp')
  const to = path.join(root, 'state.json')
  fs.writeFileSync(from, 'new')
  fs.writeFileSync(to, 'old')
  return { from, to }
}

function failing(code: string, times: number) {
  const real = fs.renameSync.bind(fs)
  let remaining = times
  return vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (remaining-- > 0) throw Object.assign(new Error(`simulated ${code}`), { code })
    real(from, to)
  })
}

describe('renameSyncWithRetry', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries a transient Windows %s until the rename succeeds', (code) => {
    const { from, to } = files()
    const sleep = vi.fn()
    const rename = failing(code, 2)
    renameSyncWithRetry(from, to, { platform: 'win32', sleep })
    expect(rename).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[10], [20]])
    expect(fs.readFileSync(to, 'utf8')).toBe('new')
    expect(fs.existsSync(from)).toBe(false)
  })

  it('gives up after a bounded number of attempts and rethrows the original error', () => {
    const { from, to } = files()
    const sleep = vi.fn()
    const rename = failing('EPERM', Number.POSITIVE_INFINITY)
    expect(() => renameSyncWithRetry(from, to, { platform: 'win32', sleep })).toThrow(/simulated EPERM/)
    expect(rename).toHaveBeenCalledTimes(8)
    expect(sleep.mock.calls.reduce((total, [ms]) => total + (ms as number), 0)).toBeLessThan(2_000)
    expect(fs.readFileSync(to, 'utf8')).toBe('old')
  })

  it.each(['ENOSPC', 'ENOENT', 'EXDEV'])('does not retry non-transient %s on Windows', (code) => {
    const { from, to } = files()
    const sleep = vi.fn()
    const rename = failing(code, 1)
    expect(() => renameSyncWithRetry(from, to, { platform: 'win32', sleep })).toThrow()
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'linux'] as const)('never retries on %s, where EPERM is a real permission error', (platform) => {
    const { from, to } = files()
    const sleep = vi.fn()
    const rename = failing('EPERM', 1)
    expect(() => renameSyncWithRetry(from, to, { platform, sleep })).toThrow(/simulated EPERM/)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('renames normally when nothing is locked', () => {
    const { from, to } = files()
    renameSyncWithRetry(from, to)
    expect(fs.readFileSync(to, 'utf8')).toBe('new')
  })
})
