// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/commands/daemon-process.ts
// @covers open-source/packages/cli/src/commands/daemon-state.ts
// @covers open-source/packages/cli/src/commands/daemon-instance-lock.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDaemonProcessInCurrentNamespace, isDaemonProcessRunning } from '../commands/daemon-process'
import { findRunningDaemonProcessIds, getDaemonStatus } from '../commands/daemon-state'
import { acquireDaemonInstanceLock } from '../commands/daemon-instance-lock'

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), execSync: vi.fn(),
}))

describe('Linux daemon PID namespace ownership', () => {
  afterEach(() => vi.restoreAllMocks())

  function namespaces(foreignPid = 22555) {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(fs, 'readlinkSync').mockImplementation((target) =>
      String(target) === `/proc/${foreignPid}/ns/pid` ? 'pid:[container]' : 'pid:[host]')
  }

  it('does not probe or adopt a visible Docker daemon from another PID namespace', () => {
    namespaces()
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(isDaemonProcessRunning(22555)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
    vi.mocked(childProcess.execSync).mockReturnValue([
      '22555 /usr/local/bin/node /usr/lib/node_modules/shennian/dist/bin/shennian.js run-service',
      '30001 /usr/bin/node /usr/lib/node_modules/shennian/dist/bin/shennian.js run-service',
    ].join('\n'))
    expect(findRunningDaemonProcessIds()).toEqual([30001])
  })

  it('treats an already adopted foreign PID as stale, not a running host daemon', () => {
    namespaces()
    vi.spyOn(fs, 'readFileSync').mockImplementation((target) =>
      String(target).endsWith('daemon.pid') ? JSON.stringify({ pid: 22555, adopted: true }) : '{}')
    vi.mocked(childProcess.execSync).mockReturnValue('')
    const unlink = vi.spyOn(fs, 'unlinkSync')
    const kill = vi.spyOn(process, 'kill')
    expect(getDaemonStatus()).toMatchObject({ running: false, stale: true, pid: 22555 })
    expect(kill).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('recovers a lock referencing a foreign PID without signalling that process', () => {
    namespaces()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-namespace-'))
    const lockPath = path.join(dir, 'instance.lock')
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 22555, instanceId: 'foreign' }))
      const kill = vi.spyOn(process, 'kill')
      const lock = acquireDaemonInstanceLock({ lockPath, instanceId: 'host' })
      expect(lock.acquired).toBe(true)
      expect(kill).not.toHaveBeenCalled()
      if (lock.acquired) lock.release()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('still protects live host daemons and preserves inspection failures', () => {
    namespaces()
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(isDaemonProcessRunning(30001)).toBe(true)
    expect(kill).toHaveBeenCalledWith(30001, 0)
    vi.mocked(fs.readlinkSync).mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    expect(isDaemonProcessRunning(22555)).toBe(true)
    expect(kill).toHaveBeenCalledWith(22555, 0)
    kill.mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) })
    expect(isDaemonProcessRunning(22555)).toBe(false)
  })

  it.each(['darwin', 'win32'] as const)('does not inspect procfs on %s', (platform) => {
    vi.spyOn(os, 'platform').mockReturnValue(platform)
    const readlink = vi.spyOn(fs, 'readlinkSync')
    expect(isDaemonProcessInCurrentNamespace(22555)).toBe(true)
    expect(readlink).not.toHaveBeenCalled()
  })
})
