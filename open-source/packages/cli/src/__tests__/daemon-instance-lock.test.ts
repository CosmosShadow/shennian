// @covers open-source/packages/cli/src/commands/daemon-instance-lock.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireDaemonInstanceLock } from '../commands/daemon-instance-lock.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: vi.fn() }
})

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(childProcess.execFileSync).mockReset()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function lockPath(): string {
  const parent = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'shennian-daemon-lock-'))
  roots.push(root)
  return path.join(root, 'daemon.instance.lock')
}

describe('daemon instance lock', () => {
  it('reclaims a persisted self PID after container restart but rejects an in-process duplicate', () => {
    const file = lockPath()
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, instanceId: 'previous-container' }))
    const lock = acquireDaemonInstanceLock({ lockPath: file, instanceId: 'current-container', isProcessAlive: () => true })
    expect(lock.acquired).toBe(true)
    expect(acquireDaemonInstanceLock({ lockPath: file, instanceId: 'duplicate', isProcessAlive: () => true }))
      .toEqual({ acquired: false, ownerPid: process.pid })
    if (lock.acquired) lock.release()
    expect(fs.existsSync(file)).toBe(false)
  })
  it('allows only one live daemon owner and releases only its own record', () => {
    const file = lockPath()
    const first = acquireDaemonInstanceLock({ lockPath: file, instanceId: 'first', pid: 101, isProcessAlive: () => true })
    expect(first.acquired).toBe(true)
    expect(acquireDaemonInstanceLock({ lockPath: file, instanceId: 'second', pid: 202, isProcessAlive: () => true }))
      .toEqual({ acquired: false, ownerPid: 101 })
    if (first.acquired) first.release()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('atomically reclaims a dead owner record', () => {
    const file = lockPath()
    fs.writeFileSync(file, JSON.stringify({ pid: 303, instanceId: 'dead' }))
    const lock = acquireDaemonInstanceLock({ lockPath: file, instanceId: 'replacement', pid: 404, isProcessAlive: () => false })
    expect(lock.acquired).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ pid: 404, instanceId: 'replacement' })
    if (lock.acquired) lock.release()
  })

  it('reclaims a terminated high-privilege owner only after a successful read-only query', () => {
    const file = lockPath()
    fs.writeFileSync(file, JSON.stringify({ pid: 303, instanceId: 'terminated' }))
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    vi.mocked(childProcess.execFileSync).mockReturnValue(JSON.stringify({ pid: 303, queryCompleted: true, running: false }))
    const lock = acquireDaemonInstanceLock({ lockPath: file, instanceId: 'replacement', pid: 404 })
    expect(lock.acquired).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ pid: 404, instanceId: 'replacement' })
    if (lock.acquired) lock.release()
  })

  it.each(['active', 'query-failed', 'incomplete'])('preserves a Windows lock whose owner is %s', (state) => {
    const file = lockPath(), content = JSON.stringify({ pid: 303, instanceId: 'owner' })
    fs.writeFileSync(file, content)
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      if (state === 'query-failed') throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
      return state === 'active' ? JSON.stringify({ pid: 303, queryCompleted: true, running: true }) : ''
    })
    expect(acquireDaemonInstanceLock({ lockPath: file, instanceId: 'contender', pid: 404 }))
      .toEqual({ acquired: false, ownerPid: 303 })
    expect(fs.readFileSync(file, 'utf8')).toBe(content)
  })

  it('reports a dead-owner lock cleanup EACCES instead of saying another daemon is running', () => {
    const file = lockPath(), content = JSON.stringify({ pid: 303, instanceId: 'dead' })
    fs.writeFileSync(file, content)
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    expect(() => acquireDaemonInstanceLock({ lockPath: file, instanceId: 'contender', pid: 404, isProcessAlive: () => false }))
      .toThrow('daemon_instance_lock_cleanup_failed: EACCES')
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(file, 'utf8')).toBe(content)
  })

  it('preserves EACCES when the ownership re-read fails during cleanup', () => {
    const file = lockPath(), content = JSON.stringify({ pid: 303, instanceId: 'dead' })
    fs.writeFileSync(file, content)
    const readFile = fs.readFileSync.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFileSync').mockImplementation((target, options) => {
      if (String(target) === file && ++reads === 2) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return readFile(target, options)
    })
    const unlink = vi.spyOn(fs, 'unlinkSync')
    expect(() => acquireDaemonInstanceLock({ lockPath: file, instanceId: 'contender', pid: 404, isProcessAlive: () => false }))
      .toThrow(expect.objectContaining({ message: 'daemon_instance_lock_cleanup_failed: EACCES', code: 'EACCES' }))
    expect(unlink).not.toHaveBeenCalled()
    expect(readFile(file, 'utf8')).toBe(content)
  })

  it('does not unlink a new owner installed while the former owner was being checked', () => {
    const file = lockPath()
    fs.writeFileSync(file, JSON.stringify({ pid: 303, instanceId: 'dead' }))
    const replacement = { pid: 505, instanceId: 'new-owner' }
    const unlink = vi.spyOn(fs, 'unlinkSync')
    const lock = acquireDaemonInstanceLock({
      lockPath: file, instanceId: 'contender', pid: 404,
      isProcessAlive: (pid) => {
        if (pid === 303) { fs.writeFileSync(file, JSON.stringify(replacement)); return false }
        return true
      },
    })
    expect(lock).toEqual({ acquired: false, ownerPid: 505 })
    expect(unlink).not.toHaveBeenCalled()
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(replacement)
  })

  it('fails closed on a fresh partial record and reclaims it only after the stale threshold', () => {
    const file = lockPath()
    fs.writeFileSync(file, '{not-json')
    const modifiedAt = fs.statSync(file).mtimeMs
    expect(acquireDaemonInstanceLock({
      lockPath: file,
      instanceId: 'contender',
      pid: 404,
      now: () => modifiedAt + 100,
    })).toEqual({ acquired: false, ownerPid: null })

    const replacement = acquireDaemonInstanceLock({
      lockPath: file,
      instanceId: 'replacement',
      pid: 505,
      now: () => modifiedAt + 5_001,
    })
    expect(replacement.acquired).toBe(true)
    if (replacement.acquired) replacement.release()
  })
})
