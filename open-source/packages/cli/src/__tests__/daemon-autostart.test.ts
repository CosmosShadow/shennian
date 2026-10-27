// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/commands/daemon.ts
// @covers open-source/packages/cli/src/commands/daemon-state.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildWindowsLauncherCommand,
  buildWindowsScheduledTaskCommands,
  buildWindowsScheduledTaskSuspendCommands,
  buildWindowsScheduledTaskXml,
  buildWindowsStartupVbs,
  buildDaemonSpawnOptions,
  buildMacLaunchdPlist,
  buildSystemdUnit,
  canReuseRunningDaemonForStart,
  captureEnvForService,
  clearDaemonPidIfOwner,
  getLaunchdServiceTarget,
  getUnsupportedDaemonSourceError,
  getMacBackgroundItemNotice,
  getDaemonStatus,
  getCurrentProcessDaemonLauncher,
  isEphemeralCliPath,
  isAutoStartServicePresent,
  isIsolatedDaemonE2eInstance,
  isSafeSnapshotEnvKey,
  isShennianRunServiceCommand,
  inferDaemonLauncherFromCommand,
  installService,
  recordStartedDaemon,
  reloadLaunchdAgent,
  removeLegacyMacBackgroundApp,
  writeDaemonPid,
  shouldReplaceRunningDaemon,
  shouldDiscoverGlobalDaemonProcesses,
  shouldInstallPlatformService,
  suspendWindowsScheduledTask,
  registerDaemonCommand,
  resolveServiceLaunchSpec,
  type ServiceLaunchSpec,
} from '../commands/daemon'
import { isDaemonReadyStatus, waitForDaemonReadyStatus } from '../commands/daemon-start-wait'
import { registerWindowsScheduledTask } from '../commands/daemon-windows'
import { isDaemonProcessRunning, parseWindowsDaemonProcessJson } from '../commands/daemon-process'
import { saveEnvSnapshot } from '../commands/daemon-service-spec'
import { trimDaemonLogFile } from '../daemon-log'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execSync: vi.fn(actual.execSync), execFileSync: vi.fn(actual.execFileSync) }
})

describe('daemon auto-start helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(childProcess.execSync).mockReset()
    vi.mocked(childProcess.execFileSync).mockReset()
  })

  it('returns machine-readable daemon status fields', () => {
    const status = getDaemonStatus()

    expect(status).toEqual(expect.objectContaining({
      running: expect.any(Boolean),
      stale: expect.any(Boolean),
      launcher: expect.any(String),
      platform: expect.any(String),
      shennianDir: expect.any(String),
      pidFile: expect.stringContaining('daemon.pid'),
      logFile: expect.stringContaining('daemon.log'),
    }))
  })

  it('reports the active daemon version, never a stale or legacy PID record version', () => {
    let record: string = JSON.stringify({ pid: 43210, version: '0.1.2', launcher: 'desktop-managed' })
    vi.spyOn(fs, 'readFileSync').mockImplementation((target) => String(target).endsWith('daemon.pid') ? record : '{}')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no discovered process') })
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined)
    expect(getDaemonStatus()).toMatchObject({ running: true, daemonVersion: '0.1.2' })
    kill.mockImplementation(() => { throw Object.assign(new Error('process exited'), { code: 'ESRCH' }) })
    expect(getDaemonStatus()).toMatchObject({ running: false, stale: true })
    expect(getDaemonStatus()).not.toHaveProperty('daemonVersion')
    record = '43210'
    kill.mockReturnValue(true)
    expect(getDaemonStatus()).not.toHaveProperty('daemonVersion')
    expect(unlink).not.toHaveBeenCalled()
  })

  it.each(['EPERM', 'EACCES'])('preserves a live daemon PID and version when a process probe returns %s', (code) => {
    const record = JSON.stringify({ pid: 43210, version: '0.4.70', launcher: 'desktop-managed' })
    vi.spyOn(fs, 'readFileSync').mockImplementation((target) => String(target).endsWith('daemon.pid') ? record : '{}')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('access denied'), { code }) })
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

    expect(getDaemonStatus({ cleanupStale: true })).toMatchObject({
      running: true, stale: false, pid: 43210, daemonVersion: '0.4.70',
    })
    expect(unlink).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['EPERM', false], ['EACCES', false], ['EPERM', true], ['EACCES', true],
  ] as const)('uses a completed read-only Windows query after %s, active=%s', (code, running) => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code }) })
    vi.mocked(childProcess.execFileSync).mockReturnValue(JSON.stringify({ pid: 303, queryCompleted: true, running }))
    expect(isDaemonProcessRunning(303)).toBe(running)
    expect(childProcess.execFileSync).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', expect.stringContaining("-Filter 'ProcessId = 303' -ErrorAction Stop"),
    ], expect.objectContaining({ timeout: 5000, windowsHide: true }))
  })

  it.each([
    '', '{}', '{broken',
    JSON.stringify({ pid: 303, running: false }),
    JSON.stringify({ pid: 404, queryCompleted: true, running: false }),
    JSON.stringify({ pid: 303, queryCompleted: true, running: 'false' }),
  ])('does not interpret an incomplete Windows query as process death: %s', (raw) => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    vi.mocked(childProcess.execFileSync).mockReturnValue(raw)
    expect(isDaemonProcessRunning(303)).toBe(true)
  })

  it.each(['ETIMEDOUT', 'EACCES'])('keeps the owner alive/unknown when the Windows query fails with %s', (code) => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    vi.mocked(childProcess.execFileSync).mockImplementation(() => { throw Object.assign(new Error('query failed'), { code }) })
    expect(isDaemonProcessRunning(303)).toBe(true)
  })

  it('does not query Windows for a healthy process, known ESRCH, or another platform', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    expect(isDaemonProcessRunning(303)).toBe(true)
    kill.mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) })
    expect(isDaemonProcessRunning(303)).toBe(false)
    kill.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(isDaemonProcessRunning(303)).toBe(true)
    kill.mockImplementation(() => { throw new Error('unknown probe failure') })
    expect(isDaemonProcessRunning(303)).toBe(true)
    expect(childProcess.execFileSync).not.toHaveBeenCalled()
  })

  it('treats npx cache paths as ephemeral', () => {
    const npxScript = `${os.tmpdir()}/_npx/3f4f/node_modules/shennian/dist/bin/shennian.js`
    const stableScript = '/Users/demo/.npm-global/lib/node_modules/shennian/dist/bin/shennian.js'

    expect(isEphemeralCliPath(npxScript)).toBe(true)
    expect(isEphemeralCliPath(stableScript)).toBe(false)
  })

  it('records every newly started daemon as an independent Client', () => {
    expect(getCurrentProcessDaemonLauncher()).toBe('global-cli')
  })

  it('skips global daemon discovery for an explicit non-default E2E home', () => {
    expect(isIsolatedDaemonE2eInstance(
      { SHENNIAN_E2E_ISOLATED_DAEMON: '1', SHENNIAN_HOME: '/tmp/shennian-e2e-1' },
      '/tmp/shennian-e2e-1',
      '/tmp',
    )).toBe(true)
    expect(isIsolatedDaemonE2eInstance(
      { SHENNIAN_E2E_ISOLATED_DAEMON: '1', SHENNIAN_HOME: '/Users/demo/.shennian' },
      '/Users/demo/.shennian',
      '/tmp',
      '/Users/demo/.shennian',
    )).toBe(false)
    expect(isIsolatedDaemonE2eInstance(
      { SHENNIAN_E2E_ISOLATED_DAEMON: '1', SHENNIAN_HOME: '/Users/demo/.shennian-e2e' },
      '/Users/demo/.shennian-e2e',
      '/tmp',
      '/Users/demo/.shennian',
    )).toBe(true)
    expect(isIsolatedDaemonE2eInstance(
      { SHENNIAN_HOME: '/tmp/shennian-e2e-1' },
      '/tmp/shennian-e2e-1',
      '/tmp',
    )).toBe(false)

    expect(shouldDiscoverGlobalDaemonProcesses(
      { SHENNIAN_E2E_ISOLATED_DAEMON: '1', SHENNIAN_HOME: '/Users/demo/.shennian-e2e' },
      '/Users/demo/.shennian-e2e',
    )).toBe(false)
    expect(shouldInstallPlatformService(
      { SHENNIAN_E2E_ISOLATED_DAEMON: '1', SHENNIAN_HOME: '/Users/demo/.shennian-e2e' },
      '/Users/demo/.shennian-e2e',
    )).toBe(false)
    expect(shouldInstallPlatformService(
      { SHENNIAN_HOME: '/Users/demo/.shennian-e2e' },
      '/Users/demo/.shennian-e2e',
    )).toBe(true)
  })

  it('prefers the current script when the install path is stable', () => {
    vi.spyOn(os, 'tmpdir').mockReturnValue('/tmp')
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => target === '/usr/local/lib/node_modules/shennian/dist/bin/shennian.js')

    expect(resolveServiceLaunchSpec({
      nodeExec: '/usr/local/bin/node',
      scriptPath: '/usr/local/lib/node_modules/shennian/dist/bin/shennian.js',
      shennianCommandPath: '/usr/local/bin/shennian',
      npxPath: '/usr/local/bin/npx',
    })).toEqual({
      command: '/usr/local/bin/node',
      args: ['/usr/local/lib/node_modules/shennian/dist/bin/shennian.js', 'run-service'],
      mode: 'direct',
    })
  })

  it('leaves Docker service management to the container while retaining process discovery', () => {
    vi.stubEnv('SHENNIAN_DAEMON_SUPERVISOR', 'docker')
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    const write = vi.spyOn(fs, 'writeFileSync')
    expect(installService({ quiet: true })).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(childProcess.execSync).not.toHaveBeenCalled()
    expect(shouldDiscoverGlobalDaemonProcesses({ SHENNIAN_DAEMON_SUPERVISOR: 'docker' }, '/data/shennian')).toBe(true)
    expect(shouldInstallPlatformService({}, '/data/shennian')).toBe(true)
    expect(shouldInstallPlatformService({ SHENNIAN_DAEMON_SUPERVISOR: 'unknown' }, '/data/shennian')).toBe(true)
  })

  it('falls back to the global shim when the current script path is ephemeral', () => {
    expect(resolveServiceLaunchSpec({
      nodeExec: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: `${os.tmpdir()}\\_npx\\abc\\node_modules\\shennian\\dist\\bin\\shennian.js`,
      shennianCommandPath: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd',
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
    })).toEqual({
      command: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd',
      args: ['run-service'],
      mode: 'global-shim',
    })
  })

  it('uses the exact ephemeral package only for an explicitly isolated release smoke', () => {
    const previous = process.env.SHENNIAN_E2E_ISOLATED_DAEMON
    process.env.SHENNIAN_E2E_ISOLATED_DAEMON = '1'
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const scriptPath = `${os.tmpdir()}\\_npx\\release-smoke\\node_modules\\shennian\\dist\\bin\\shennian.js`
    try {
      expect(resolveServiceLaunchSpec({
        nodeExec: 'C:\\Program Files\\nodejs\\node.exe',
        scriptPath,
        shennianCommandPath: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd',
      })).toEqual({
        command: 'C:\\Program Files\\nodejs\\node.exe',
        args: [scriptPath, 'run-service'],
        mode: 'direct',
      })
    } finally {
      if (previous === undefined) delete process.env.SHENNIAN_E2E_ISOLATED_DAEMON
      else process.env.SHENNIAN_E2E_ISOLATED_DAEMON = previous
    }
  })

  it('falls back to the global shim when the compiled script path is missing', () => {
    expect(resolveServiceLaunchSpec({
      nodeExec: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\demo\\shennian-win-cli\\packages\\cli\\bin\\shennian.js',
      shennianCommandPath: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd',
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
    })).toEqual({
      command: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd',
      args: ['run-service'],
      mode: 'global-shim',
    })
  })

  it('falls back to npx when no stable install path exists', () => {
    expect(resolveServiceLaunchSpec({
      nodeExec: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: `${os.tmpdir()}\\_npx\\abc\\node_modules\\shennian\\dist\\bin\\shennian.js`,
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
    })).toEqual({
      command: 'C:\\Program Files\\nodejs\\npx.cmd',
      args: ['--yes', 'shennian', 'run-service'],
      mode: 'npx',
    })
  })

  it('builds a hidden Windows launcher command with quoted paths', () => {
    const spec: ServiceLaunchSpec = {
      command: 'C:\\Program Files\\nodejs\\npx.cmd',
      args: ['--yes', 'shennian', 'run-service'],
      mode: 'npx',
    }

    expect(buildWindowsLauncherCommand(spec, 'C:\\Users\\demo\\.shennian\\daemon.log')).toContain(
      'call "C:\\Program Files\\nodejs\\npx.cmd" "--yes" "shennian" "run-service" >> "C:\\Users\\demo\\.shennian\\daemon.log" 2>&1',
    )
    expect(buildWindowsLauncherCommand(spec, 'C:\\Users\\demo\\.shennian\\daemon.log')).toContain(
      'if not defined SHENNIAN_HOME set "SHENNIAN_HOME=%~dp0."',
    )
  })

  it('builds daemon spawn options with a hidden Windows console', () => {
    const options = buildDaemonSpawnOptions({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"shennian.cmd run-service"'],
      windowsVerbatimArguments: true,
    }, 42, { PATH: 'C:\\Windows\\System32' })

    expect(options).toEqual(expect.objectContaining({
      detached: true,
      stdio: ['ignore', 42, 42],
      env: { PATH: 'C:\\Windows\\System32' },
      windowsHide: true,
      windowsVerbatimArguments: true,
    }))
  })

  it('kickstarts the macOS launchd agent after loading it', () => {
    const commands: string[] = []

    expect(reloadLaunchdAgent((command) => {
      commands.push(command)
    })).toBe(true)

    expect(commands).toHaveLength(5)
    expect(commands[0]).toBe(`launchctl enable "${getLaunchdServiceTarget()}"`)
    expect(commands[1]).toContain(`launchctl bootout "${getLaunchdServiceTarget()}"`)
    expect(commands[2]).toContain('launchctl bootstrap "gui/')
    expect(commands[3]).toBe(`launchctl kickstart -k "${getLaunchdServiceTarget()}"`)
    expect(commands[4]).toBe(`launchctl print "${getLaunchdServiceTarget()}"`)
  })

  it('runs the macOS launchd agent directly through Node.js', () => {
    const plist = buildMacLaunchdPlist({
      launch: {
        command: '/usr/local/bin/node',
        args: ['/usr/local/lib/node_modules/shennian/dist/bin/shennian.js', 'run-service'],
        mode: 'direct',
      },
    })

    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<string>/usr/local/lib/node_modules/shennian/dist/bin/shennian.js</string>')
    expect(plist).not.toContain('AssociatedBundleIdentifiers')
    expect(plist).not.toContain('ShennianClientLauncher')
  })

  it('explains the macOS background item name without changing other platforms', () => {
    expect(getMacBackgroundItemNotice('darwin')).toContain('Node.js Foundation')
    expect(getMacBackgroundItemNotice('darwin')).toContain('Shennian Client')
    expect(getMacBackgroundItemNotice('linux')).toBeNull()
    expect(getMacBackgroundItemNotice('win32')).toBeNull()
  })

  it('removes the retired macOS background identity app during migration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-background-app-'))
    const app = path.join(root, 'Shennian.app')
    fs.mkdirSync(app)

    removeLegacyMacBackgroundApp(app)

    expect(fs.existsSync(app)).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('falls back to legacy load plus kickstart when launchd bootstrap fails', () => {
    const commands: string[] = []

    expect(reloadLaunchdAgent((command) => {
      commands.push(command)
      if (command.includes('launchctl bootstrap')) throw new Error('bootstrap failed')
    })).toBe(true)

    expect(commands).toHaveLength(8)
    expect(commands[3]).toBe(`launchctl enable "${getLaunchdServiceTarget()}"`)
    expect(commands[4]).toContain('launchctl unload')
    expect(commands[5]).toContain('launchctl load -w')
    expect(commands[6]).toBe(`launchctl kickstart -k "${getLaunchdServiceTarget()}"`)
    expect(commands[7]).toBe(`launchctl print "${getLaunchdServiceTarget()}"`)
  })

  it('does not report launchd registration success when the loaded job is absent', () => {
    expect(reloadLaunchdAgent((command) => {
      if (command.includes('launchctl print')) throw new Error('service not found')
    })).toBe(false)
  })

  it('does not restart a deliberately stopped systemd service', () => {
    expect(buildSystemdUnit()).toContain('Restart=on-failure')
    expect(buildSystemdUnit()).not.toContain('Restart=always')
  })

  it('trims daemon logs to the configured recent lines', () => {
    const dir = fs.mkdtempSync(`${os.tmpdir()}${os.platform() === 'win32' ? '\\' : '/'}shennian-log-`)
    const logFile = `${dir}${os.platform() === 'win32' ? '\\' : '/'}daemon.log`
    fs.writeFileSync(logFile, Array.from({ length: 10 }, (_, index) => `line-${index}`).join('\n') + '\n')

    expect(trimDaemonLogFile(logFile, { maxLines: 3, maxBytes: 1024 })).toBe(true)
    expect(fs.readFileSync(logFile, 'utf8')).toBe('line-7\nline-8\nline-9\n')

    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('builds a launcher vbs that runs the launcher hidden', () => {
    expect(buildWindowsStartupVbs('C:\\Users\\demo\\.shennian\\autostart.cmd')).toContain(
      'shell.Run Chr(34) & "C:\\Users\\demo\\.shennian\\autostart.cmd" & Chr(34), 0, False',
    )
  })

  it('builds a headless Windows scheduled task with boot, logon and wake triggers', () => {
    const xml = buildWindowsScheduledTaskXml({
      userId: 'DESKTOP\\demo',
      command: 'C:\\Windows\\System32\\wscript.exe',
      arguments: ['"C:\\Users\\demo\\.shennian\\autostart.vbs"'],
    })

    expect(xml).toContain('<BootTrigger>')
    expect(xml).toContain('<Delay>PT15S</Delay>')
    expect(xml).toContain('<LogonTrigger>')
    expect(xml).toContain('<EventTrigger>')
    expect(xml).toContain('Microsoft-Windows-Power-Troubleshooter')
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>')
    expect(xml).toContain('<RestartOnFailure>')
    expect(xml).toContain('<LogonType>S4U</LogonType>')
    expect(xml).toContain('<WakeToRun>true</WakeToRun>')
    expect(xml).not.toContain('<LogonType>InteractiveToken</LogonType>')
    expect(xml).toContain('<Command>C:\\Windows\\System32\\wscript.exe</Command>')
    expect(xml).toContain('&quot;C:\\Users\\demo\\.shennian\\autostart.vbs&quot;')
  })

  it('replaces legacy Windows tasks and can start the headless task on demand', () => {
    expect(buildWindowsScheduledTaskCommands({
      taskName: 'ShennianAgent',
      xmlPath: 'C:\\Users\\demo\\.shennian\\autostart.xml',
    })).toEqual({
      create: 'schtasks /create /tn "ShennianAgent" /xml "C:\\Users\\demo\\.shennian\\autostart.xml" /f',
      run: 'schtasks /run /tn "ShennianAgent"',
    })
  })

  it('reports the original Windows task registration failure instead of starting detached', () => {
    const input = { taskName: 'ShennianAgent', xmlPath: 'C:\\Users\\demo\\.shennian\\autostart.xml' }
    const create = vi.fn(() => {
      throw Object.assign(new Error('Command failed'), { status: 5, stderr: 'Access is denied.' })
    })
    expect(() => registerWindowsScheduledTask(input, create)).toThrow(
      'windows_autostart_registration_failed:create (exit 5): Access is denied.',
    )
    expect(create).toHaveBeenCalledTimes(1)

    let calls = 0
    expect(() => registerWindowsScheduledTask(input, () => {
      calls += 1
      if (calls === 2) throw new Error('The task could not be started.')
    })).toThrow('windows_autostart_registration_failed:run: The task could not be started.')
    expect(calls).toBe(2)
  })

  it('writes BOM-prefixed UTF-16LE task bytes with Unicode intact', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-task-encoding-'))
    const xmlPath = path.join(directory, '任务.xml')
    const writeFile = fs.writeFileSync.bind(fs)
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.stubEnv('USERDOMAIN', '测试电脑')
    vi.stubEnv('USERNAME', '中文用户')
    vi.stubEnv('SystemRoot', 'C:\\Windows 中文')
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
      if (String(target).endsWith('autostart.xml')) writeFile(xmlPath, data, options)
    })
    vi.mocked(childProcess.execSync).mockReturnValue('')
    try {
      expect(installService({ quiet: true })).toBe(true)
      const bytes = fs.readFileSync(xmlPath)
      expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
      const xml = bytes.subarray(2).toString('utf16le')
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-16"?>')
      expect(xml).toContain('<UserId>测试电脑\\中文用户</UserId>')
      expect(xml).toContain('C:\\Windows 中文')
      expect(xml).toContain('<LogonType>S4U</LogonType>')
      expect(write).toHaveBeenCalledWith(expect.stringContaining('autostart.xml'), `\ufeff${xml}`, 'utf16le')
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })

  it('disables and ends the Windows task before restarting its daemon', () => {
    expect(buildWindowsScheduledTaskSuspendCommands('ShennianAgent')).toEqual({
      disable: 'schtasks /change /tn "ShennianAgent" /disable',
      end: 'schtasks /end /tn "ShennianAgent"',
    })

    const commands: string[] = []
    suspendWindowsScheduledTask('ShennianAgent', (command) => {
      commands.push(command)
      if (command.includes('/disable')) throw new Error('task is already disabled')
    })
    expect(commands).toEqual([
      'schtasks /change /tn "ShennianAgent" /disable',
      'schtasks /end /tn "ShennianAgent"',
    ])
  })

  it('uses a real Windows temp directory for service env defaults', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(os, 'tmpdir').mockReturnValue('C:\\Users\\demo\\AppData\\Local\\Temp')
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\demo')
    vi.spyOn(os, 'userInfo').mockReturnValue({ username: 'demo' } as ReturnType<typeof os.userInfo>)
    delete process.env.USERPROFILE
    delete process.env.HOMEDRIVE
    delete process.env.HOMEPATH
    delete process.env.USERNAME
    delete process.env.TMPDIR
    delete process.env.TEMP
    delete process.env.TMP

    const env = captureEnvForService()
    expect(env.USERPROFILE).toBe('C:\\Users\\demo')
    expect(env.HOMEDRIVE).toBe('C:')
    expect(env.HOMEPATH).toBe('\\Users\\demo')
    expect(env.USERNAME).toBe('demo')
    expect(env.TMPDIR).toBe('C:\\Users\\demo\\AppData\\Local\\Temp')
    expect(env.TEMP).toBe('C:\\Users\\demo\\AppData\\Local\\Temp')
    expect(env.TMP).toBe('C:\\Users\\demo\\AppData\\Local\\Temp')
  })

  it('preserves desktop server env for managed global CLI runtime', () => {
    const previous = {
      SHENNIAN_DESKTOP_SERVER_URL: process.env.SHENNIAN_DESKTOP_SERVER_URL,
      SHENNIAN_HOME: process.env.SHENNIAN_HOME,
      SHENNIAN_NATIVE_FUSION_DISABLED: process.env.SHENNIAN_NATIVE_FUSION_DISABLED,
      SHENNIAN_WECHAT_CHANNEL_HELPER_DIR: process.env.SHENNIAN_WECHAT_CHANNEL_HELPER_DIR,
    }
    try {
      process.env.SHENNIAN_DESKTOP_SERVER_URL = 'https://shennian.net'
      process.env.SHENNIAN_HOME = '/Users/demo/.shennian'
      process.env.SHENNIAN_NATIVE_FUSION_DISABLED = '1'
      process.env.SHENNIAN_WECHAT_CHANNEL_HELPER_DIR = '/Applications/Shennian.app/Contents/Resources/wechat-channel/macos'

      const env = captureEnvForService()
      expect(env.PATH).toContain('/usr/local/bin')
      expect(env.PATH).toContain('/.local/bin')
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.SHENNIAN_DESKTOP_CLI_SCRIPT).toBeUndefined()
      expect(env.SHENNIAN_DESKTOP_CLI_BRIDGE).toBeUndefined()
      expect(env.SHENNIAN_DESKTOP_SERVER_URL).toBe('https://shennian.net')
      expect(env.SHENNIAN_HOME).toBe('/Users/demo/.shennian')
      expect(env.SHENNIAN_NATIVE_FUSION_DISABLED).toBe('1')
      expect(env.SHENNIAN_WECHAT_CHANNEL_HELPER_DIR).toBe('/Applications/Shennian.app/Contents/Resources/wechat-channel/macos')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('does not persist agent provider credentials in service env snapshots', () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY
    const previousOpenai = process.env.OPENAI_API_KEY

    process.env.ANTHROPIC_API_KEY = 'old-anthropic-key'
    process.env.OPENAI_API_KEY = 'old-openai-key'

    try {
      const serviceEnv = captureEnvForService()
      expect(serviceEnv.ANTHROPIC_API_KEY).toBeUndefined()
      expect(serviceEnv.OPENAI_API_KEY).toBeUndefined()
      expect(isSafeSnapshotEnvKey('ANTHROPIC_API_KEY')).toBe(false)
      expect(isSafeSnapshotEnvKey('OPENAI_API_KEY')).toBe(false)
      expect(isSafeSnapshotEnvKey('SHENNIAN_DESKTOP_CLI_SCRIPT')).toBe(false)
      expect(isSafeSnapshotEnvKey('SHENNIAN_DESKTOP_CLI_BRIDGE')).toBe(false)
      expect(isSafeSnapshotEnvKey('SHENNIAN_WECHAT_CHANNEL_HELPER_DIR')).toBe(true)
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previousAnthropic
      if (previousOpenai === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenai
    }
  })

  it('records launcher ownership without pre-writing daemon.pid', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

    recordStartedDaemon(12345)

    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining('daemon.pid'), expect.anything())
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('daemon-launcher.json'),
      expect.stringContaining('"launcher"'),
    )
  })

  it('writes owned daemon pid metadata and only the owner may clear it', () => {
    const writes = new Map<string, string>()
    const unlinked: string[] = []
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data) => {
      writes.set(String(target), String(data))
    })
    vi.spyOn(fs, 'readFileSync').mockImplementation((target) => {
      const data = writes.get(String(target))
      if (data == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return data
    })
    vi.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
      unlinked.push(String(target))
      writes.delete(String(target))
    })

    writeDaemonPid(12345, 'instance-a', { version: '0.2.99', launcher: 'global-cli' })
    clearDaemonPidIfOwner(12345, 'instance-b')
    expect(unlinked).toHaveLength(0)

    clearDaemonPidIfOwner(12345, 'instance-a')
    expect(unlinked.some((item) => item.endsWith('daemon.pid'))).toBe(true)
  })

  it('replaces adopted and older independent daemons but keeps the current owned daemon', () => {
    const running = { pid: 123, running: true, adopted: false, launcher: 'global-cli' as const }
    expect(shouldReplaceRunningDaemon(running, { version: '0.3.11' }, '0.3.11')).toBe(false)
    expect(shouldReplaceRunningDaemon(running, { version: '0.3.10' }, '0.3.11')).toBe(true)
    expect(shouldReplaceRunningDaemon(running, {}, '0.3.11')).toBe(true)
    expect(shouldReplaceRunningDaemon({ ...running, adopted: true }, { version: '0.3.11' }, '0.3.11')).toBe(true)
    expect(shouldReplaceRunningDaemon({ ...running, running: false }, {}, '0.3.11')).toBe(false)
  })

  it('reuses a healthy current daemon without rewriting an installed auto-start service', () => {
    const healthy = {
      pid: 123,
      running: true,
      stale: false,
      remoteAccessDisabled: false,
      adopted: false,
      launcher: 'global-cli' as const,
    }

    expect(canReuseRunningDaemonForStart(
      healthy,
      {},
      true,
      { version: '0.4.0' },
      '0.4.0',
    )).toBe(true)

    expect(canReuseRunningDaemonForStart(
      healthy,
      { api: 'https://shennian.net' },
      true,
      { version: '0.4.0' },
      '0.4.0',
    )).toBe(false)
    expect(canReuseRunningDaemonForStart(
      healthy,
      {},
      false,
      { version: '0.4.0' },
      '0.4.0',
    )).toBe(false)
    expect(canReuseRunningDaemonForStart(
      { ...healthy, remoteAccessDisabled: true },
      {},
      true,
      { version: '0.4.0' },
      '0.4.0',
    )).toBe(false)
    expect(canReuseRunningDaemonForStart(
      healthy,
      {},
      true,
      { version: '0.3.40' },
      '0.4.0',
    )).toBe(false)
  })

  it('fails closed for a legacy Desktop-managed daemon without replacing or reusing it', () => {
    const desktopManaged = {
      pid: 123,
      running: true,
      stale: false,
      remoteAccessDisabled: false,
      adopted: true,
      launcher: 'desktop-managed' as const,
    }

    expect(getUnsupportedDaemonSourceError(desktopManaged)).toBe(
      'unsupported_daemon_source:desktop-managed',
    )
    expect(shouldReplaceRunningDaemon(desktopManaged, { version: '0.3.40' }, '0.4.0')).toBe(false)
    expect(canReuseRunningDaemonForStart(
      desktopManaged,
      {},
      false,
      { version: '0.3.40' },
      '0.4.0',
    )).toBe(false)

    expect(getUnsupportedDaemonSourceError({ ...desktopManaged, running: false })).toBeNull()
  })

  it('recognizes only complete platform auto-start installations', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync')
    existsSpy.mockImplementation((target) => (
      !String(target).endsWith('autostart.xml') && !String(target).endsWith('Shennian.app')
    ))

    expect(isAutoStartServicePresent('darwin')).toBe(true)
    expect(isAutoStartServicePresent('linux')).toBe(true)
    expect(isAutoStartServicePresent('win32')).toBe(false)
  })

  it('waits for async daemon startup to publish a running pid before returning status', () => {
    let now = 0
    let reads = 0
    const statuses = [
      { running: false, stale: false, pid: null },
      { running: false, stale: false, pid: null },
      { running: true, stale: false, pid: 12345 },
    ]

    const status = waitForDaemonReadyStatus(() => ({
      ...statuses[Math.min(reads++, statuses.length - 1)],
      remoteAccessDisabled: false,
      launcher: 'global-cli' as const,
      platform: 'win32' as const,
      shennianDir: 'C:\\Users\\demo\\.shennian',
      pidFile: 'C:\\Users\\demo\\.shennian\\daemon.pid',
      logFile: 'C:\\Users\\demo\\.shennian\\daemon.log',
    }), {
      timeoutMs: 5_000,
      intervalMs: 500,
      now: () => now,
      sleep: (ms) => { now += ms },
    })

    expect(status.running).toBe(true)
    expect(status.pid).toBe(12345)
    expect(reads).toBe(3)
  })

  it('returns the latest stopped status after daemon startup wait times out', () => {
    let now = 0
    let reads = 0

    const status = waitForDaemonReadyStatus(() => {
      reads += 1
      return {
        running: false,
        stale: reads > 1,
        pid: reads > 1 ? 2222 : null,
        remoteAccessDisabled: false,
        launcher: 'unknown' as const,
        platform: 'win32' as const,
        shennianDir: 'C:\\Users\\demo\\.shennian',
        pidFile: 'C:\\Users\\demo\\.shennian\\daemon.pid',
        logFile: 'C:\\Users\\demo\\.shennian\\daemon.log',
      }
    }, {
      timeoutMs: 1_000,
      intervalMs: 400,
      now: () => now,
      sleep: (ms) => { now += ms },
    })

    expect(status.running).toBe(false)
    expect(status.stale).toBe(true)
    expect(status.pid).toBe(2222)
    expect(reads).toBeGreaterThan(1)
  })

  it('waits for a new daemon instance after launchd replaces a running process', () => {
    let now = 0
    let reads = 0
    const status = waitForDaemonReadyStatus(() => ({
      running: true,
      stale: false,
      pid: reads > 0 ? 23456 : 12345,
      instanceId: reads++ > 0 ? 'new-instance' : 'old-instance',
      remoteAccessDisabled: false,
      launcher: 'global-cli' as const,
      platform: 'darwin' as const,
      shennianDir: '/Users/demo/.shennian',
      pidFile: '/Users/demo/.shennian/daemon.pid',
      logFile: '/Users/demo/.shennian/daemon.log',
    }), {
      excludedInstanceId: 'old-instance',
      timeoutMs: 5_000,
      intervalMs: 500,
      now: () => now,
      sleep: (ms) => { now += ms },
    })

    expect(status.instanceId).toBe('new-instance')
    expect(status.pid).toBe(23456)
    expect(reads).toBe(2)
  })

  it('does not mistake a discovered pre-init process for a ready daemon', () => {
    expect(isDaemonReadyStatus({ running: true, stale: false, adopted: true })).toBe(false)
    expect(isDaemonReadyStatus({ running: true, stale: false, adopted: false })).toBe(true)
    expect(isDaemonReadyStatus({ running: false, stale: false })).toBe(false)
    expect(isDaemonReadyStatus({
      running: true, stale: false, adopted: false, instanceId: 'old-instance',
    }, 'old-instance')).toBe(false)
  })

  it('detects real run-service commands without matching parent shell scripts', () => {
    expect(isShennianRunServiceCommand('/usr/local/bin/node /Users/demo/.npm-global/lib/node_modules/shennian/dist/bin/shennian.js run-service')).toBe(true)
    expect(isShennianRunServiceCommand('node /Users/demo/.local/node/bin/shennian run-service --api http://127.0.0.1:9')).toBe(true)
    expect(isShennianRunServiceCommand('C:\\Users\\simpl\\.shennian\\node\\node.exe C:\\Users\\simpl\\.shennian\\node\\node_modules\\shennian\\dist\\bin\\shennian.js run-service')).toBe(true)
    expect(isShennianRunServiceCommand('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\shennian\\dist\\bin\\shennian.js" run-service')).toBe(true)
    expect(isShennianRunServiceCommand('/Users/demo/.npm-global/bin/shennian run-service')).toBe(true)
    expect(isShennianRunServiceCommand('C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd run-service')).toBe(true)
    expect(isShennianRunServiceCommand('/usr/local/bin/npx --yes shennian run-service')).toBe(true)
    const windowsUpdater = '"C:\\nvm4w\\nodejs\\node.exe" "C:\\Users\\simpl\\.shennian\\runtime\\updater\\versions\\1-offline\\updater-worker.js" "--service" "C:\\Users\\simpl\\.shennian\\runtime\\updater" "C:\\nvm4w\\nodejs\\node_modules\\shennian\\dist\\bin\\shennian.js" "run-service"'
    expect(isShennianRunServiceCommand(windowsUpdater)).toBe(true)
    expect(inferDaemonLauncherFromCommand(windowsUpdater)).toBe('global-cli')
    const desktopRunner = '"C:\\Program Files\\Shennian\\ShennianClient.exe" "C:\\Program Files\\Shennian\\resources\\cli-bridge.js" "C:\\Program Files\\Shennian\\resources\\daemon\\dist\\bin\\shennian.js" "run-service"'
    expect(isShennianRunServiceCommand(desktopRunner)).toBe(true)
    expect(inferDaemonLauncherFromCommand(desktopRunner)).toBe('desktop-managed')
    expect(isShennianRunServiceCommand('zsh -c ps ax | grep "[s]hennian.*run-service"')).toBe(false)
    expect(isShennianRunServiceCommand('zsh -c node -e "setInterval(() => {}, 1000)" /tmp/dist/bin/shennian.js run-service')).toBe(false)
  })

  it('parses Windows process rows for orphan run-service adoption', () => {
    const raw = JSON.stringify([
      {
        ProcessId: 7300,
        CommandLine: 'C:\\Users\\simpl\\.shennian\\node\\node.exe C:\\Users\\simpl\\.shennian\\node\\node_modules\\shennian\\dist\\bin\\shennian.js run-service',
      },
      {
        ProcessId: 7301,
        CommandLine: 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process"',
      },
    ])

    expect(parseWindowsDaemonProcessJson(`${raw}\n#< CLIXML progress`, 999)).toEqual([7300])
    expect(parseWindowsDaemonProcessJson(raw, 7300)).toEqual([])
    expect(parseWindowsDaemonProcessJson(JSON.stringify({
      ProcessId: 42,
      CommandLine: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\shennian.cmd run-service',
    }), 999)).toEqual([42])
  })

  it('exposes top-level service commands and hides deprecated daemon group from help', () => {
    const program = new Command()
    program.name('shennian').exitOverride()
    registerDaemonCommand(program)

    const help = program.helpInformation()
    expect(help).toContain('start')
    expect(help).toContain('stop')
    expect(help).toContain('status')
    expect(help).toContain('logs')
    expect(help).not.toContain('restart')
    expect(help).not.toContain('daemon')
    expect(program.commands.find((command) => command.name() === 'daemon')).toBeDefined()

    const logsHelp = program.commands.find((command) => command.name() === 'logs')?.helpInformation() ?? ''
    expect(logsHelp).toContain('--lines')
    expect(logsHelp).not.toContain('--json')

    const startHelp = program.commands.find((command) => command.name() === 'start')?.helpInformation() ?? ''
    expect(startHelp).toContain('--api')

    const daemonStartHelp = program.commands
      .find((command) => command.name() === 'daemon')
      ?.commands.find((command) => command.name() === 'start')
      ?.helpInformation() ?? ''
    expect(daemonStartHelp).toContain('--api')
  })

  it('persists only the selected Codex executable as harmless service configuration', () => {
    vi.stubEnv('SHENNIAN_CODEX_PATH', 'C:\\Users\\demo\\AI Tools\\codex.exe')
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined)
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)
    saveEnvSnapshot()
    const snapshot = JSON.parse(String(write.mock.calls.find(([target]) => String(target).endsWith('env.json'))?.[1]))
    expect(snapshot.SHENNIAN_CODEX_PATH).toBe(process.env.SHENNIAN_CODEX_PATH)
    expect(snapshot.PATH).toBe(process.env.PATH)
    expect(captureEnvForService().SHENNIAN_CODEX_PATH).toBe(snapshot.SHENNIAN_CODEX_PATH)
    expect(snapshot).not.toHaveProperty('OPENAI_API_KEY')
  })

})
