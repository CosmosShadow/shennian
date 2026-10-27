// @covers open-source/packages/cli/src/commands/daemon.ts
// @covers open-source/packages/cli/src/session/handlers/remote-access.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearRemoteAccessDisabled,
  isRemoteAccessDisabled,
  prepareRemoteAccessPause,
  stopPreparedRemoteAccessService,
  registerDaemonCommand,
} from '../commands/daemon.js'
import { handleRemoteAccessPause } from '../session/handlers/remote-access.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execSync: vi.fn(), execFileSync: vi.fn(() => '[]'), spawn: vi.fn() }
})

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(childProcess.execSync).mockReset()
  vi.mocked(childProcess.spawn).mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('remote access pause', () => {
  function stubLifecycleFilesystem(launcher = 'global-cli') {
    const record = { pid: 43210, instanceId: 'owned-instance', version: '0.4.70', launcher }
    let paused = true
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(fs, 'readFileSync').mockImplementation((file) => /daemon\.pid$|daemon-launcher\.json$/.test(String(file))
      ? JSON.stringify(record) : '{}')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'lstatSync').mockImplementation((file) => {
      if (String(file).endsWith('remote-access.disabled') && !paused) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return {} as fs.Stats
    })
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)
    vi.spyOn(fs, 'openSync').mockReturnValue(42)
    vi.spyOn(fs, 'writeSync').mockReturnValue(0)
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => undefined)
    vi.spyOn(fs, 'closeSync').mockImplementation(() => undefined)
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { paused = true })
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (String(file).endsWith('remote-access.disabled')) paused = false
    })
    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true })
    return { output, unlink, isPaused: () => paused }
  }

  it('returns nonzero error JSON and retains metadata when a live daemon cannot be stopped', async () => {
    const previousExitCode = process.exitCode
    const { output, unlink } = stubLifecycleFilesystem()
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) })
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => { throw new Error('task access denied') })
    const command = new Command()
    registerDaemonCommand(command)
    try {
      await command.parseAsync(['stop', '--json'], { from: 'user' })
      expect(process.exitCode).toBe(1)
      expect(JSON.parse(output.join(''))).toMatchObject({
        running: true, remoteAccessDisabled: true, daemonVersion: '0.4.70', error: 'daemon_shutdown_ipc_failed',
      })
      expect(unlink.mock.calls.some(([file]) => /daemon\.pid$|daemon-launcher\.json$/.test(String(file)))).toBe(false)
    } finally { process.exitCode = previousExitCode }
  })

  it.each(['SIGTERM', 'SIGKILL', 'timeout'])('rejects replacement of an incompatible live daemon after %s failure', async (failure) => {
    const previousExitCode = process.exitCode
    const { output, unlink, isPaused } = stubLifecycleFilesystem('global-cli')
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => { clock += 1000; return clock })
    vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === failure) throw Object.assign(new Error(`kill ${failure} EPERM`), { code: 'EPERM' })
      return true
    })
    const execute = vi.spyOn(childProcess, 'execSync').mockReturnValue('')
    const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('unexpected replacement spawn') })
    const command = new Command()
    registerDaemonCommand(command)
    try {
      await command.parseAsync(['start', '--json'], { from: 'user' })
      expect(process.exitCode).toBe(1)
      expect(JSON.parse(output.join(''))).toMatchObject({
        running: true, pid: 43210, remoteAccessDisabled: true, launcher: 'global-cli',
        error: `daemon_replacement_failed: ${failure === 'timeout' ? 'daemon_stop_timeout' : `kill ${failure} EPERM`}`,
      })
      expect(isPaused()).toBe(true)
      expect(kill).toHaveBeenCalledWith(43210, failure === 'SIGTERM' ? 'SIGTERM' : 'SIGKILL')
      expect(execute.mock.calls.some(([command]) => String(command).includes('schtasks'))).toBe(false)
      expect(spawn).not.toHaveBeenCalled()
      expect(unlink.mock.calls.some(([file]) => /daemon\.pid$|daemon-launcher\.json$/.test(String(file)))).toBe(false)
    } finally { process.exitCode = previousExitCode }
  })

  it.each([false, true])('keeps repeated pause truthful when no daemon runs and task disable fails=%s', async (taskFails) => {
    const previousExitCode = process.exitCode
    process.exitCode = 0
    const { output } = stubLifecycleFilesystem()
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('process exited'), { code: 'ESRCH' }) })
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => {
      if (taskFails) throw new Error('task access denied')
      return ''
    })
    const command = new Command()
    registerDaemonCommand(command)
    try {
      await command.parseAsync(['stop', '--json'], { from: 'user' })
      await command.parseAsync(['stop', '--json'], { from: 'user' })
      expect(process.exitCode).toBe(taskFails ? 1 : 0)
      expect(output).toHaveLength(2)
      for (const json of output) {
        const status = JSON.parse(json)
        expect(status).toMatchObject({ running: false, remoteAccessDisabled: true })
        if (taskFails) expect(status.error).toBe('task access denied')
        else expect(status).not.toHaveProperty('error')
      }
    } finally { process.exitCode = previousExitCode }
  })

  it('does not discard ownership or report success when the daemon survives both stop waits', async () => {
    const previousExitCode = process.exitCode
    const { output, unlink } = stubLifecycleFilesystem()
    vi.useFakeTimers()
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.spyOn(childProcess, 'execSync').mockReturnValue('')
    const command = new Command()
    registerDaemonCommand(command)
    try {
      const stopped = command.parseAsync(['stop', '--json'], { from: 'user' })
      await vi.advanceTimersByTimeAsync(8000)
      await stopped
      expect(process.exitCode).toBe(1)
      expect(JSON.parse(output.join(''))).toMatchObject({
        running: true, remoteAccessDisabled: true, daemonVersion: '0.4.70', error: 'daemon_stop_timeout',
      })
      expect(kill).toHaveBeenCalledWith(43210, 'SIGKILL')
      expect(unlink.mock.calls.some(([file]) => /daemon\.pid$|daemon-launcher\.json$/.test(String(file)))).toBe(false)
    } finally { process.exitCode = previousExitCode }
  })

  it('fails closed when the durable pause marker cannot be inspected', () => {
    const lstat = vi.spyOn(fs, 'lstatSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })

    expect(isRemoteAccessDisabled()).toBe(true)
    lstat.mockRestore()
  })

  it('fails closed when an explicit resume cannot remove the durable pause marker', () => {
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })

    expect(() => clearRemoteAccessDisabled()).toThrow('permission denied')
    unlink.mockRestore()
  })

  it('treats a missing pause marker as already resumed', () => {
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    })

    expect(() => clearRemoteAccessDisabled()).not.toThrow()
    unlink.mockRestore()
  })

  it('keeps restart fail-closed so only the explicit start command can clear the lock', () => {
    const source = fs.readFileSync(path.join(__dirname, '../commands/daemon.ts'), 'utf8')
    const restart = source.slice(
      source.indexOf('async function daemonRestart'),
      source.indexOf('function daemonStatus'),
    )

    expect(restart).toContain('initialStatus.remoteAccessDisabled')
    expect(restart).toContain('remote_access_disabled_use_shennian_start')
    expect(restart.indexOf('initialStatus.remoteAccessDisabled')).toBeLessThan(
      restart.indexOf('installService()'),
    )
  })

  it.each([
    ['darwin', 'launchctl disable'],
    ['linux', 'systemctl --user disable shennian'],
    ['win32', 'schtasks /change'],
  ] as const)('durably writes the lock before disabling %s autostart', (platform, commandPart) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-pause-'))
    temporaryDirectories.push(directory)
    const markerFile = path.join(directory, 'remote-access.disabled')
    const events: string[] = []

    const result = prepareRemoteAccessPause({
      disabledAt: '2026-09-05T12:00:00.000Z',
      markerFile,
      platform,
      servicePresent: true,
      execCommand: (command) => {
        expect(fs.readFileSync(markerFile, 'utf8')).toBe('2026-09-05T12:00:00.000Z')
        events.push(command)
      },
    })

    expect(result).toEqual({
      disabledAt: '2026-09-05T12:00:00.000Z',
      autoStartDisabled: true,
    })
    expect(events[0]).toContain(commandPart)
    expect(fs.statSync(markerFile).mode & 0o777).toBe(0o600)
  })

  it('reports local commit, flushes the app response, and only then shuts down', async () => {
    const order: string[] = []
    const client = {
      sendBufferedEvent: vi.fn(async () => {
        order.push('server-ack')
        return {
          type: 'res',
          id: 'remote-access-paused-request-1',
          ok: true,
          payload: { remoteAccessDisabledAt: '2026-09-05T12:00:01.000Z' },
        }
      }),
      sendResAndWait: vi.fn(async () => {
        order.push('app-response-flushed')
      }),
    }
    const controller = {
      prepare: vi.fn(() => {
        order.push('local-lock')
        return { disabledAt: '2026-09-05T12:00:00.000Z', autoStartDisabled: true }
      }),
      isDisabled: vi.fn(() => true),
      shutdownAfterResponse: vi.fn(() => order.push('shutdown')),
    }

    await handleRemoteAccessPause(client as never, controller, {
      type: 'req',
      id: 'request-1',
      method: 'machine.remote-access.pause',
      params: {},
    })

    expect(order).toEqual(['local-lock', 'server-ack', 'app-response-flushed', 'shutdown'])
    expect(client.sendResAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'request-1',
        ok: true,
        payload: { remoteAccessDisabledAt: '2026-09-05T12:00:01.000Z' },
      }),
    )
  })

  it.each([
    ['darwin', 'launchctl bootout'],
    ['linux', 'systemctl --user stop shennian'],
    ['win32', 'schtasks /end'],
  ] as const)(
    'stops the active %s service after the response can be flushed',
    (platform, commandPart) => {
      const commands: string[] = []
      expect(
        stopPreparedRemoteAccessService({
          platform,
          servicePresent: true,
          execCommand: (command) => commands.push(command),
        }),
      ).toEqual({ serviceStopped: true })
      expect(commands).toHaveLength(1)
      expect(commands[0]).toContain(commandPart)
    },
  )

  it('fails closed and exits when platform autostart cannot be disabled after the lock', async () => {
    const client = {
      sendBufferedEvent: vi.fn(),
      sendResAndWait: vi.fn(async () => {}),
    }
    const controller = {
      prepare: vi.fn(() => ({
        disabledAt: '2026-09-05T12:00:00.000Z',
        autoStartDisabled: false,
        autoStartError: 'denied',
      })),
      isDisabled: vi.fn(() => true),
      shutdownAfterResponse: vi.fn(),
    }

    await handleRemoteAccessPause(client as never, controller, {
      type: 'req',
      id: 'request-2',
      method: 'machine.remote-access.pause',
      params: {},
    })

    expect(client.sendBufferedEvent).not.toHaveBeenCalled()
    expect(client.sendResAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'request-2',
        ok: false,
        error: expect.stringContaining('autostart_disable_failed'),
      }),
    )
    expect(controller.shutdownAfterResponse).toHaveBeenCalledOnce()
  })
})
