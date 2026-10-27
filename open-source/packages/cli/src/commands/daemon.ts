// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts

import chalk from 'chalk'
import { readCliDistribution } from '../runtime-distribution.js'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import os from 'node:os'
import { execSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { loadConfig, resolveShennianPath, saveConfig } from '../config/index.js'
import {
  buildWindowsLauncherCommand,
  buildWindowsScheduledTaskXml,
  buildWindowsStartupVbs,
  escapeXml,
  isWindowsCmdScript,
  quoteCmdArg,
  quoteSystemdArg,
  registerWindowsScheduledTask,
  suspendWindowsScheduledTask,
} from './daemon-windows.js'
import { isDaemonReadyStatus, waitForDaemonReadyStatus } from './daemon-start-wait.js'
import { checkDaemonIpcHealth } from './daemon-ipc-health.js'
import { requestWindowsDaemonSelfStop } from './daemon-stop-ipc.js'
import { compareVersions, getCurrentVersion } from '../upgrade/engine.js'
export {
  buildWindowsLauncherCommand,
  buildWindowsScheduledTaskCommands,
  buildWindowsScheduledTaskSuspendCommands,
  buildWindowsScheduledTaskXml,
  buildWindowsStartupVbs,
  suspendWindowsScheduledTask,
} from './daemon-windows.js'
export { inferDaemonLauncherFromCommand, isShennianRunServiceCommand } from './daemon-process.js'

import { SHENNIAN_DIR, PID_FILE, LOG_FILE, REMOTE_ACCESS_DISABLED_FILE, readPidRecord, clearDaemonLauncher, shouldDiscoverGlobalDaemonProcesses, getPlatform, isRunning, waitForPidExitSync, isRemoteAccessDisabled, clearRemoteAccessDisabled, recordStartedDaemon, findRunningDaemonProcessIds, shouldInstallPlatformService, getDaemonStatus, type Platform, type DaemonStatus } from './daemon-state.js'
import { isEphemeralCliPath, resolveServiceLaunchSpec, captureEnvForService, saveEnvSnapshot, type ServiceLaunchSpec, type DetachedLaunchSpec } from './daemon-service-spec.js'
export { isRemoteAccessDisabled, clearRemoteAccessDisabled, getCurrentProcessDaemonLauncher, createDaemonInstanceId, writeDaemonPid, clearDaemonPidIfOwner, writeDaemonLauncher, clearDaemonLauncher, recordStartedDaemon, findRunningDaemonProcessIds, isIsolatedDaemonE2eInstance, shouldDiscoverGlobalDaemonProcesses, shouldInstallPlatformService, getDaemonStatus, type DaemonStatus } from './daemon-state.js'
export { isSafeSnapshotEnvKey, isEphemeralCliPath, resolveServiceLaunchSpec, captureEnvForService, saveEnvSnapshot, type ServiceLaunchSpec, type DetachedLaunchSpec } from './daemon-service-spec.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHENNIAN_SCRIPT = path.resolve(__dirname, '../../bin/shennian.js')
const NODE_EXEC = process.execPath

export type RemoteAccessPausePreparation = {
  disabledAt: string
  autoStartDisabled: boolean
  autoStartError?: string
}

type RemoteAccessPauseOptions = {
  disabledAt?: string
  markerFile?: string
  platform?: Platform
  servicePresent?: boolean
  execCommand?: (command: string) => void
}

export type RemoteAccessServiceStopResult = {
  serviceStopped: boolean
  error?: string
}

function writeRemoteAccessDisabledMarker(markerFile: string, disabledAt: string): void {
  const directory = path.dirname(markerFile)
  const temporaryFile = `${markerFile}.${process.pid}.${randomUUID()}.tmp`
  fs.mkdirSync(directory, { recursive: true })
  let fileDescriptor: number | null = null
  try {
    fileDescriptor = fs.openSync(temporaryFile, 'w', 0o600)
    fs.writeSync(fileDescriptor, disabledAt, undefined, 'utf8')
    fs.fsyncSync(fileDescriptor)
    fs.closeSync(fileDescriptor)
    fileDescriptor = null
    renameSyncWithRetry(temporaryFile, markerFile)
    try {
      const directoryDescriptor = fs.openSync(directory, 'r')
      try {
        fs.fsyncSync(directoryDescriptor)
      } finally {
        fs.closeSync(directoryDescriptor)
      }
    } catch {
      // Some platforms do not support fsync on directories; the file itself is durable.
    }
  } finally {
    if (fileDescriptor !== null) fs.closeSync(fileDescriptor)
    try {
      fs.unlinkSync(temporaryFile)
    } catch {
      // The atomic rename already consumed the temporary file.
    }
  }
}

/**
 * Engage the same durable remote-access lock used by `shennian stop` without
 * terminating the current daemon. Remote pause needs the live socket long
 * enough to report the committed state and flush its response.
 */
export function prepareRemoteAccessPause(
  options: RemoteAccessPauseOptions = {},
): RemoteAccessPausePreparation {
  const disabledAt = options.disabledAt ?? new Date().toISOString()
  const markerFile = options.markerFile ?? REMOTE_ACCESS_DISABLED_FILE
  const platform = options.platform ?? getPlatform()
  const servicePresent = options.servicePresent ?? (
    shouldInstallPlatformService() && isAutoStartServicePresent(platform)
  )
  const execCommand =
    options.execCommand ??
    ((command: string) => {
      execSync(command, { stdio: 'pipe', windowsHide: true })
    })

  writeRemoteAccessDisabledMarker(markerFile, disabledAt)
  if (!servicePresent) return { disabledAt, autoStartDisabled: true }

  try {
    if (platform === 'darwin') {
      execCommand(`launchctl disable "${getLaunchdServiceTarget()}"`)
    } else if (platform === 'linux') {
      execCommand('systemctl --user disable shennian')
    } else {
      execCommand(`schtasks /change /tn "${WINDOWS_TASK_NAME}" /disable`)
    }
    return { disabledAt, autoStartDisabled: true }
  } catch (error) {
    return {
      disabledAt,
      autoStartDisabled: false,
      autoStartError: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Stop the already-running platform service after the remote response has been
 * flushed. Autostart is disabled during preparation; this step prevents a
 * KeepAlive/Restart policy from relaunching the current daemon in the interim.
 */
export function stopPreparedRemoteAccessService(
  options: Pick<RemoteAccessPauseOptions, 'platform' | 'servicePresent' | 'execCommand'> = {},
): RemoteAccessServiceStopResult {
  const platform = options.platform ?? getPlatform()
  const servicePresent = options.servicePresent ?? (
    shouldInstallPlatformService() && isAutoStartServicePresent(platform)
  )
  if (!servicePresent) return { serviceStopped: true }
  const execCommand =
    options.execCommand ??
    ((command: string) => {
      execSync(command, { stdio: 'pipe', windowsHide: true })
    })

  try {
    if (platform === 'darwin') {
      execCommand(`launchctl bootout "${getLaunchdServiceTarget()}"`)
    } else if (platform === 'linux') {
      execCommand('systemctl --user stop shennian')
    } else {
      execCommand(`schtasks /end /tn "${WINDOWS_TASK_NAME}"`)
    }
    return { serviceStopped: true }
  } catch (error) {
    return {
      serviceStopped: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function persistServerUrlOverride(serverUrl?: string): void {
  const normalized = serverUrl?.trim()
  if (!normalized) return
  const config = loadConfig()
  config.serverUrl = normalized
  saveConfig(config)
}

function resolveServerUrlOverride(api?: string): string | undefined {
  return api?.trim() || process.env.SHENNIAN_DESKTOP_SERVER_URL?.trim() || undefined
}

// ─── Service definitions ─────────────────────────────────────────────────────

const LAUNCHD_LABEL = 'com.shennian.agent'
const LAUNCHD_PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LAUNCHD_LABEL}.plist`)
const LEGACY_MAC_BACKGROUND_APP = resolveShennianPath('Shennian.app')
const WINDOWS_STARTUP_DIR = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
)
const WINDOWS_STARTUP_CMD = resolveShennianPath('autostart.cmd')
const WINDOWS_LAUNCHER_VBS = resolveShennianPath('autostart.vbs')
const WINDOWS_TASK_XML = resolveShennianPath('autostart.xml')
const WINDOWS_STARTUP_VBS = path.join(WINDOWS_STARTUP_DIR, 'ShennianAgent.vbs')

function findCommandPath(binary: string): string | null {
  const command = getPlatform() === 'win32' ? `where ${binary}` : `command -v ${binary}`
  try {
    const output = execSync(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      windowsHide: true,
    })
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return first ?? null
  } catch {
    return null
  }
}

function resolveNpxPath(): string | null {
  const fileName = getPlatform() === 'win32' ? 'npx.cmd' : 'npx'
  const sibling = path.join(path.dirname(NODE_EXEC), fileName)
  if (fs.existsSync(sibling)) return sibling
  return findCommandPath('npx')
}

function resolveCurrentServiceLaunchSpec(): ServiceLaunchSpec {
  return resolveServiceLaunchSpec({
    nodeExec: NODE_EXEC,
    scriptPath: SHENNIAN_SCRIPT,
    shennianCommandPath: findCommandPath('shennian'),
    npxPath: resolveNpxPath(),
  })
}

function removeLegacyWindowsTask(): void {
  try {
    execSync(`schtasks /delete /tn "${WINDOWS_TASK_NAME}" /f`, { stdio: 'pipe', windowsHide: true })
  } catch {
    // Ignore missing legacy Task Scheduler entries during migration.
  }
}

function removeLegacyWindowsStartupFiles(): void {
  try {
    fs.unlinkSync(WINDOWS_STARTUP_VBS)
  } catch {
    // Legacy Startup entry may already be absent.
  }
}

function getWindowsTaskUserId(): string {
  const domain = process.env.USERDOMAIN?.trim()
  const computer = process.env.COMPUTERNAME?.trim()
  const username = process.env.USERNAME?.trim() || os.userInfo().username
  if (domain && domain.toUpperCase() !== 'WORKGROUP') return `${domain}\\${username}`
  if (computer) return `${computer}\\${username}`
  return username
}

function buildDetachedLaunchSpec(spec: ServiceLaunchSpec): DetachedLaunchSpec {
  if (getPlatform() === 'win32' && isWindowsCmdScript(spec.command)) {
    const commandLine = [spec.command, ...spec.args].map(quoteCmdArg).join(' ')
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      windowsVerbatimArguments: true,
    }
  }
  return {
    command: spec.command,
    args: spec.args,
  }
}

export function buildDaemonSpawnOptions(
  launch: DetachedLaunchSpec,
  logFd: number,
  env: NodeJS.ProcessEnv = process.env,
): Parameters<typeof spawn>[2] {
  return {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
    windowsHide: true,
    ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  }
}

function installWindowsScheduledTask(): boolean {
  const launch = resolveCurrentServiceLaunchSpec()
  fs.writeFileSync(WINDOWS_STARTUP_CMD, buildWindowsLauncherCommand(launch, LOG_FILE))
  fs.writeFileSync(WINDOWS_LAUNCHER_VBS, buildWindowsStartupVbs(WINDOWS_STARTUP_CMD))
  removeLegacyWindowsStartupFiles()
  removeLegacyWindowsTask()

  const taskXml = buildWindowsScheduledTaskXml({
    userId: getWindowsTaskUserId(),
    command: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'),
    arguments: [quoteCmdArg(WINDOWS_LAUNCHER_VBS)],
  })
  fs.writeFileSync(WINDOWS_TASK_XML, `\ufeff${taskXml}`, 'utf16le')
  return registerWindowsScheduledTask({
    taskName: WINDOWS_TASK_NAME,
    xmlPath: WINDOWS_TASK_XML,
  }, (command) => { execSync(command, { stdio: 'pipe', windowsHide: true }) })
}

function suspendWindowsScheduledTaskForRestart(): void {
  suspendWindowsScheduledTask(WINDOWS_TASK_NAME, (command) => {
    execSync(command, { stdio: 'pipe', windowsHide: true })
  })
}

export function buildMacLaunchdPlist(input: {
  launch?: ServiceLaunchSpec
} = {}): string {
  const env = captureEnvForService()
  const launch = input.launch ?? resolveCurrentServiceLaunchSpec()
  const envEntries = Object.entries(env)
    .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
    .join('\n')
  const programArgs = [launch.command, ...launch.args]
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>`
}

export function removeLegacyMacBackgroundApp(appPath = LEGACY_MAC_BACKGROUND_APP): void {
  fs.rmSync(appPath, { recursive: true, force: true })
}

export function getMacBackgroundItemNotice(platform: Platform = getPlatform()): string | null {
  if (platform !== 'darwin') return null
  return 'macOS may show “Node.js Foundation” under Allow in the Background. This is the Node.js runtime used by Shennian Client.'
}

const SYSTEMD_UNIT = path.join(os.homedir(), '.config/systemd/user/shennian.service')

export function buildSystemdUnit(): string {
  const env = captureEnvForService()
  const launch = resolveCurrentServiceLaunchSpec()
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join('\n')
  const execStart = [launch.command, ...launch.args].map(quoteSystemdArg).join(' ')

  return `[Unit]
Description=Shennian Agent Daemon
After=network.target

[Service]
${envLines}
ExecStart=${execStart}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target`
}

const WINDOWS_TASK_NAME = 'ShennianAgent'

type LaunchdCommandExecutor = (command: string) => void

function runLaunchdCommand(command: string): void {
  execSync(command, { stdio: 'pipe', windowsHide: true })
}

function getLaunchdUserId(): number | string {
  const uid = process.getuid?.()
  if (typeof uid === 'number') return uid
  const userInfo = os.userInfo()
  return typeof userInfo.uid === 'number' ? userInfo.uid : userInfo.username
}

export function getLaunchdServiceTarget(uid: number | string = getLaunchdUserId()): string {
  return `gui/${uid}/${LAUNCHD_LABEL}`
}

export function reloadLaunchdAgent(
  execCommand: LaunchdCommandExecutor = runLaunchdCommand,
): boolean {
  const domain = `gui/${getLaunchdUserId()}`
  const target = getLaunchdServiceTarget()
  try {
    execCommand(`launchctl enable "${target}"`)
    execCommand(`launchctl bootout "${target}" 2>/dev/null || true`)
    execCommand(`launchctl bootstrap "${domain}" "${LAUNCHD_PLIST}"`)
    execCommand(`launchctl kickstart -k "${target}"`)
    execCommand(`launchctl print "${target}"`)
    return true
  } catch {
    try {
      // `load` remains as a compatibility fallback for older macOS releases,
      // but success is accepted only after launchd can print the registered job.
      execCommand(`launchctl enable "${target}"`)
      execCommand(`launchctl unload "${LAUNCHD_PLIST}" 2>/dev/null || true`)
      execCommand(`launchctl load -w "${LAUNCHD_PLIST}"`)
      execCommand(`launchctl kickstart -k "${target}"`)
      execCommand(`launchctl print "${target}"`)
      return true
    } catch {
      return false
    }
  }
}

// ─── Exported helpers (used by pair.ts) ─────────────────────────────────────

export function startDaemonProcess(opts: { quiet?: boolean } = {}): void {
  fs.mkdirSync(SHENNIAN_DIR, { recursive: true })

  const status = getDaemonStatus({ cleanupStale: true })
  const unsupportedSource = getUnsupportedDaemonSourceError(status)
  if (unsupportedSource) throw new Error(unsupportedSource)
  if (status.pid !== null && status.running && !shouldReplaceRunningDaemon(status)) {
    if (!opts.quiet) {
      console.log(chalk.green(`✓ Background service already running (PID ${status.pid})`))
    }
    return
  }
  stopIncompatibleDaemonForStart(status)

  const logFd = fs.openSync(LOG_FILE, 'a')
  const launch = buildDetachedLaunchSpec(resolveCurrentServiceLaunchSpec())
  const child = spawn(launch.command, launch.args, buildDaemonSpawnOptions(launch, logFd))
  child.unref()
  fs.closeSync(logFd)
  recordStartedDaemon(child.pid)

  if (!opts.quiet) {
    console.log(chalk.green(`✓ Background service started (PID ${child.pid})`))
    console.log(chalk.gray(`  Logs: ${LOG_FILE}`))
  }
}

export function shouldReplaceRunningDaemon(
  status: Pick<DaemonStatus, 'pid' | 'running' | 'adopted' | 'launcher'>,
  record: { version?: string } | null = readPidRecord(),
  currentVersion = getCurrentVersion(),
): boolean {
  if (status.pid === null || !status.running) return false
  // Lifecycle commands own only an independently installed Client. Historical
  // Desktop-managed and unknown processes are diagnosed, never stopped or replaced.
  if (status.launcher !== 'global-cli') return false
  return status.adopted === true || record?.version !== currentVersion
}

export function getUnsupportedDaemonSourceError(
  status: Pick<DaemonStatus, 'pid' | 'running' | 'launcher'>,
): string | null {
  if (status.pid === null || !status.running || status.launcher === 'global-cli') return null
  return `unsupported_daemon_source:${status.launcher}`
}

export function isAutoStartServicePresent(platform: Platform = getPlatform()): boolean {
  switch (platform) {
    case 'darwin':
      return fs.existsSync(LAUNCHD_PLIST) && !fs.existsSync(LEGACY_MAC_BACKGROUND_APP)
    case 'linux':
      return fs.existsSync(SYSTEMD_UNIT)
    case 'win32':
      return (
        fs.existsSync(WINDOWS_STARTUP_CMD) &&
        fs.existsSync(WINDOWS_LAUNCHER_VBS) &&
        fs.existsSync(WINDOWS_TASK_XML)
      )
  }
}

export function canReuseRunningDaemonForStart(
  status: Pick<
    DaemonStatus,
    'pid' | 'running' | 'stale' | 'remoteAccessDisabled' | 'adopted' | 'launcher'
  >,
  opts: { api?: string },
  servicePresent: boolean,
  record: { version?: string } | null = readPidRecord(),
  currentVersion = getCurrentVersion(),
): boolean {
  return (
    !opts.api?.trim() &&
    status.pid !== null &&
    status.running &&
    status.launcher === 'global-cli' &&
    !status.stale &&
    !status.remoteAccessDisabled &&
    servicePresent &&
    !shouldReplaceRunningDaemon(status, record, currentVersion)
  )
}

function stopIncompatibleDaemonForStart(status = getDaemonStatus({ cleanupStale: true })): void {
  if (!shouldReplaceRunningDaemon(status) || status.pid === null) return
  let failure: unknown
  try {
    process.kill(status.pid, 'SIGTERM')
    if (!waitForPidExitSync(status.pid, 5000)) {
      process.kill(status.pid, 'SIGKILL')
      waitForPidExitSync(status.pid, 2000)
    }
  } catch (error) {
    failure = error
  }
  if (isRunning(status.pid)) {
    const reason = failure instanceof Error ? failure.message : 'daemon_stop_timeout'
    const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES') &&
      status.daemonVersion && compareVersions(status.daemonVersion, '0.5.12') !== 'none') {
      throw new Error('legacy_s4u_migration_required')
    }
    throw new Error(`daemon_replacement_failed: ${reason}`)
  }
  try {
    if (readPidRecord()?.pid === status.pid) fs.unlinkSync(PID_FILE)
  } catch {
    // The old daemon may have cleaned up or another start may have taken over.
  }
}

/**
 * Install the platform-native auto-start service.
 * Returns true if the service was immediately started (so caller can skip startDaemonProcess).
 */
export function installService(options: { quiet?: boolean } = {}): boolean {
  fs.mkdirSync(SHENNIAN_DIR, { recursive: true })
  if (!shouldInstallPlatformService()) return false
  const platform = getPlatform()

  const spec = resolveCurrentServiceLaunchSpec()
  if (spec.mode === 'direct' && isEphemeralCliPath(SHENNIAN_SCRIPT)) {
    console.warn(
      chalk.yellow(
        '⚠ Warning: Current CLI path is temporary (npx). Auto-start may not work after reboot.\n' +
          '  Run `npm install -g shennian@latest` for reliable auto-start.',
      ),
    )
  }

  switch (platform) {
    case 'darwin': {
      const dir = path.dirname(LAUNCHD_PLIST)
      fs.mkdirSync(dir, { recursive: true })
      removeLegacyMacBackgroundApp()
      fs.writeFileSync(LAUNCHD_PLIST, buildMacLaunchdPlist())
      const started = reloadLaunchdAgent()
      const notice = getMacBackgroundItemNotice(platform)
      if (!options.quiet && notice) console.log(chalk.gray(`ℹ ${notice}`))
      return started
    }
    case 'linux': {
      const dir = path.dirname(SYSTEMD_UNIT)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(SYSTEMD_UNIT, buildSystemdUnit())
      try {
        execSync('systemctl --user daemon-reload && systemctl --user enable shennian', {
          stdio: 'pipe',
          windowsHide: true,
        })
      } catch {
        // Some Linux environments lack systemd user services; keep best-effort behavior.
        return false
      }
      // Enable linger so the user systemd session (and thus this service) persists
      // across reboots even without an active login session.
      try {
        execSync(`loginctl enable-linger ${os.userInfo().username}`, {
          stdio: 'pipe',
          windowsHide: true,
        })
      } catch {
        // loginctl is unavailable on some distros/containers; auto-start still works after login.
      }
      try {
        execSync('systemctl --user restart shennian', { stdio: 'pipe', windowsHide: true })
        return true
      } catch {
        return false
      }
    }
    case 'win32': {
      return installWindowsScheduledTask()
    }
  }
}

// ─── Subcommand implementations ──────────────────────────────────────────────

function stopDaemonProcess(): { stoppedPid?: number; stalePid?: number; refusedPid?: number; error?: string; errorCode?: string } {
  const status = getDaemonStatus({ cleanupStale: true })
  const pid = status.pid
  if (pid === null) {
    return {}
  }
  if (!isRunning(pid)) {
    try {
      fs.unlinkSync(PID_FILE)
    } catch {
      // Stale pid file is already gone.
    }
    return { stalePid: pid }
  }
  try {
    process.kill(pid, 'SIGTERM')
    return { stoppedPid: pid }
  } catch (err) {
    const errorCode = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string'
      ? err.code : undefined
    return { refusedPid: pid, error: err instanceof Error ? err.message : String(err), errorCode }
  }
}

async function stopDaemonProcessAndWait(timeoutMs = 5000): Promise<{
  stoppedPid?: number
  stalePid?: number
  error?: string
}> {
  let result = stopDaemonProcess()
  let stoppedViaIpc = false
  if (result.refusedPid && (result.errorCode === 'EPERM' || result.errorCode === 'EACCES') && getPlatform() === 'win32') {
    const selfStop = await requestWindowsDaemonSelfStop(result.refusedPid)
    if (!selfStop.accepted) return { error: selfStop.error }
    result = { stoppedPid: result.refusedPid }
    stoppedViaIpc = true
  }
  if (!result.stoppedPid) return result

  const stopped = await waitForPidExit(result.stoppedPid, timeoutMs)
  if (!stopped && stoppedViaIpc) return { ...result, error: 'daemon_stop_timeout' }
  if (!stopped) {
    try {
      process.kill(result.stoppedPid, 'SIGKILL')
      if (!await waitForPidExit(result.stoppedPid, 2000)) {
        return { ...result, error: 'daemon_stop_timeout' }
      }
    } catch (err) {
      return { ...result, error: err instanceof Error ? err.message : String(err) }
    }
  }

  try {
    fs.unlinkSync(PID_FILE)
  } catch {
    // Best-effort cleanup after the process exits.
  }
  clearDaemonLauncher()

  if (shouldDiscoverGlobalDaemonProcesses()) {
    for (const orphanPid of findRunningDaemonProcessIds()) {
      if (orphanPid === result.stoppedPid) continue
      try {
        process.kill(orphanPid, 'SIGTERM')
        await waitForPidExit(orphanPid, 2000)
      } catch {
        // Best-effort orphan cleanup; the main managed daemon has already stopped.
      }
    }
  }
  return result
}

/**
 * Setup's service step. A service the person paused stays paused unless the caller
 * resumes it for them (setup only does so right after a fresh pairing, like `pair`).
 */
export function ensureDaemonStarted(opts: { resumePaused?: boolean } = {}):
  { status: 'running' | 'started' | 'paused' } {
  const initialStatus = getDaemonStatus({ cleanupStale: true })
  if (initialStatus.remoteAccessDisabled && !opts.resumePaused) return { status: 'paused' }
  if (isDaemonReadyStatus(initialStatus) && !initialStatus.remoteAccessDisabled) {
    return { status: 'running' }
  }
  const unsupportedSource = getUnsupportedDaemonSourceError(initialStatus)
  if (unsupportedSource) throw new Error(unsupportedSource)
  saveEnvSnapshot()
  clearRemoteAccessDisabled()
  stopIncompatibleDaemonForStart(initialStatus)
  const startedByService = installService({ quiet: true })
  if (!startedByService) startDaemonProcess({ quiet: true })
  const excludedInstanceId = initialStatus.running ? initialStatus.instanceId : undefined
  const ready = waitForDaemonReadyStatus(
    () => getDaemonStatus({ cleanupStale: true }),
    { excludedInstanceId },
  )
  if (!isDaemonReadyStatus(ready, excludedInstanceId)) throw new Error('daemon_start_failed')
  return { status: 'started' }
}

function enableRemoteAccess(opts: { json?: boolean; api?: string } = {}): void {
  const wasDisabled = isRemoteAccessDisabled()
  try {
    const initialStatus = getDaemonStatus({ cleanupStale: true })
    const unsupportedSource = getUnsupportedDaemonSourceError(initialStatus)
    if (unsupportedSource) throw new Error(unsupportedSource)
    persistServerUrlOverride(resolveServerUrlOverride(opts.api))
    clearRemoteAccessDisabled()
    stopIncompatibleDaemonForStart(initialStatus)
    const startedByService = installService({ quiet: opts.json })
    if (!startedByService) startDaemonProcess({ quiet: opts.json })
    const excludedInstanceId = initialStatus.running ? initialStatus.instanceId : undefined
    const ready = waitForDaemonReadyStatus(
      () => getDaemonStatus({ cleanupStale: true }),
      { excludedInstanceId },
    )
    if (!isDaemonReadyStatus(ready, excludedInstanceId)) throw new Error('daemon_start_failed')
    if (opts.json) printJson(ready)
    else console.log(chalk.green('✓ Background service started'))
  } catch (error) {
    if (wasDisabled) writeRemoteAccessDisabledMarker(REMOTE_ACCESS_DISABLED_FILE, new Date().toISOString())
    process.exitCode = 1
    const message = error instanceof Error ? error.message : String(error)
    if (opts.json) printJson({ ...getDaemonStatus(), error: message })
    else console.error(chalk.red(`Background service did not start: ${message}`))
  }
}

async function disableRemoteAccess(opts: { json?: boolean } = {}): Promise<void> {
  const preparation = prepareRemoteAccessPause()
  const serviceStop = stopPreparedRemoteAccessService()
  const result = await stopDaemonProcessAndWait()
  const status = getDaemonStatus({ cleanupStale: true })
  const error = result.error ?? preparation.autoStartError ?? serviceStop.error ??
    (status.running ? 'daemon_stop_failed' : !status.remoteAccessDisabled ? 'remote_access_pause_failed' : undefined)
  if (error) process.exitCode = 1
  if (opts.json) {
    printJson(error ? { ...status, error } : status)
    return
  }
  if (error) {
    console.error(chalk.red(`✗ Failed to stop completely: ${error}`))
  } else {
    console.log(chalk.green('✓ Background service stopped'))
  }
}

function daemonStart(opts: { json?: boolean; api?: string }): void {
  const status = getDaemonStatus({ cleanupStale: true })
  const lifecycleManaged = !shouldInstallPlatformService() || isAutoStartServicePresent()
  if (canReuseRunningDaemonForStart(status, opts, lifecycleManaged)) {
    if (opts.json) {
      printJson(status)
    } else {
      console.log(chalk.green(`✓ Background service already running (PID ${status.pid})`))
    }
    return
  }
  saveEnvSnapshot()
  enableRemoteAccess(opts)
}

async function daemonStop(opts: { json?: boolean } = {}): Promise<void> {
  const status = getDaemonStatus({ cleanupStale: true })
  const unsupportedSource = getUnsupportedDaemonSourceError(status)
  if (unsupportedSource) {
    process.exitCode = 1
    if (opts.json) printJson({ ...status, error: unsupportedSource })
    else console.error(chalk.red(`Background service was not stopped: ${unsupportedSource}`))
    return
  }
  await disableRemoteAccess(opts)
}

async function waitForPidExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!isRunning(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !isRunning(pid)
}

async function daemonRestart(opts: { json?: boolean; api?: string } = {}): Promise<void> {
  const initialStatus = getDaemonStatus({ cleanupStale: true })
  const unsupportedSource = getUnsupportedDaemonSourceError(initialStatus)
  if (unsupportedSource) {
    process.exitCode = 1
    if (opts.json) printJson({ ...initialStatus, error: unsupportedSource })
    else console.error(chalk.red(`Background service was not restarted: ${unsupportedSource}`))
    return
  }
  if (initialStatus.remoteAccessDisabled) {
    const error = 'remote_access_disabled_use_shennian_start'
    if (opts.json) {
      printJson({ ...initialStatus, error })
    } else {
      console.error(
        chalk.yellow('Remote access is paused. Run `shennian start` on this computer to resume.'),
      )
    }
    return
  }

  persistServerUrlOverride(resolveServerUrlOverride(opts.api))
  const platform = getPlatform()
  if (platform === 'win32') suspendWindowsScheduledTaskForRestart()

  const result = await stopDaemonProcessAndWait()
  if (result.error) {
    if (opts.json) {
      printJson({ ...getDaemonStatus(), error: result.error })
    } else {
      console.error(chalk.red(`✗ Failed to stop: ${result.error}`))
    }
    return
  }

  if (result.stoppedPid !== undefined) {
    if (!opts.json) {
      console.log(chalk.green(`✓ Background service stopped (PID ${result.stoppedPid})`))
    }
  } else if (result.stalePid !== undefined) {
    if (!opts.json) {
      console.log(
        chalk.yellow(`⚠ Service process no longer exists, cleaned up stale PID ${result.stalePid}`),
      )
    }
  } else {
    if (!opts.json) {
      console.log(chalk.gray('● Background service not running, starting it now'))
    }
  }

  if (platform === 'linux' || platform === 'win32') {
    const startedByService = installService()
    if (startedByService) {
      if (opts.json)
        printJson(waitForDaemonReadyStatus(() => getDaemonStatus({ cleanupStale: true })))
      return
    }
  }

  startDaemonProcess({ quiet: opts.json })
  if (opts.json) printJson(waitForDaemonReadyStatus(() => getDaemonStatus({ cleanupStale: true })))
}

async function daemonStatus(opts: { json?: boolean } = {}): Promise<void> {
  const daemon = getDaemonStatus()
  const status = { ...daemon, client: readCliDistribution(), ipc: await checkDaemonIpcHealth(daemon.running) }
  if (opts.json) {
    printJson(status)
    return
  }
  if (status.pid === null) {
    console.log(chalk.gray('● Background service not running'))
    return
  }
  if (status.running) {
    console.log(chalk.green(`● Background service running (PID ${status.pid})`))
    if (status.ipc.state === 'unavailable' || status.ipc.state === 'unsupported') {
      console.log(chalk.yellow(`  Local control IPC: ${status.ipc.state} (${status.ipc.error})`))
      console.log(chalk.gray('  PID and pairing alone do not prove local commands work; check the Client version, service account, and logs.'))
    }
    console.log(chalk.gray(`  Logs: ${LOG_FILE}`))
  } else {
    console.log(chalk.yellow(`● Background service stopped (PID ${status.pid} is stale)`))
  }
}

function daemonLogs(opts: { lines: number }): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(chalk.gray('No logs yet'))
    return
  }
  try {
    const out = execSync(
      os.platform() === 'win32'
        ? `powershell Get-Content -Tail ${opts.lines} "${LOG_FILE}"`
        : `tail -n ${opts.lines} "${LOG_FILE}"`,
      { encoding: 'utf-8', windowsHide: true },
    )
    process.stdout.write(out)
  } catch {
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-opts.lines)
    console.log(lines.join('\n'))
  }
}

async function daemonUninstall(): Promise<void> {
  await daemonStop()
  const platform = getPlatform()

  switch (platform) {
    case 'darwin': {
      if (fs.existsSync(LAUNCHD_PLIST)) {
        try {
          execSync(`launchctl unload -w "${LAUNCHD_PLIST}"`, { stdio: 'pipe', windowsHide: true })
        } catch {
          // Continue removing the plist even if launchctl already forgot about it.
        }
        fs.unlinkSync(LAUNCHD_PLIST)
      }
      removeLegacyMacBackgroundApp()
      console.log(chalk.green('✓ Auto-start uninstalled (launchd)'))
      break
    }
    case 'linux': {
      try {
        execSync('systemctl --user disable --now shennian', { stdio: 'pipe', windowsHide: true })
      } catch {
        // Service may already be absent or systemd user services may be unavailable.
      }
      if (fs.existsSync(SYSTEMD_UNIT)) {
        fs.unlinkSync(SYSTEMD_UNIT)
        try {
          execSync('systemctl --user daemon-reload', { stdio: 'pipe', windowsHide: true })
        } catch {
          // Ignore reload errors during cleanup.
        }
      }
      console.log(chalk.green('✓ Auto-start uninstalled (systemd)'))
      break
    }
    case 'win32': {
      removeLegacyWindowsTask()
      try {
        fs.unlinkSync(WINDOWS_STARTUP_CMD)
      } catch {
        // Launcher script may already be removed.
      }
      try {
        fs.unlinkSync(WINDOWS_LAUNCHER_VBS)
      } catch {
        // Launcher vbs may already be removed.
      }
      try {
        fs.unlinkSync(WINDOWS_TASK_XML)
      } catch {
        // Task xml may already be removed.
      }
      removeLegacyWindowsStartupFiles()
      console.log(chalk.green('✓ Auto-start uninstalled (Task Scheduler)'))
      break
    }
  }
}

// ─── Register command ─────────────────────────────────────────────────────────

export function registerDaemonCommand(program: Command): void {
  program
    .command('start')
    .description('Start the background service')
    .option('--json', 'Print machine-readable status JSON')
    .option('--api <url>', 'Server URL override')
    .action((opts: { json?: boolean; api?: string }) => daemonStart(opts))

  program
    .command('stop')
    .description('Stop the background service')
    .option('--json', 'Print machine-readable status JSON')
    .action((opts: { json?: boolean }) => daemonStop(opts))

  program
    .command('status')
    .description('Show background service status')
    .option('--json', 'Print machine-readable status JSON')
    .action((opts: { json?: boolean }) => daemonStatus(opts))

  program
    .command('logs')
    .description('Show recent logs')
    .option('-n, --lines <n>', 'Number of lines', '50')
    .action((opts: { lines: string }) => daemonLogs({ lines: parseInt(opts.lines, 10) }))

  const daemon = program
    .command('daemon', { hidden: true })
    .description('Deprecated: use top-level start/stop/status/logs')

  const warnDeprecated = (replacement: string, json?: boolean) => {
    if (!json)
      console.error(chalk.yellow(`⚠ Deprecated command. Use \`shennian ${replacement}\` instead.`))
  }

  daemon
    .command('start')
    .description('Start the background service')
    .option('--json', 'Print machine-readable status JSON')
    .option('--api <url>', 'Server URL override')
    .action((opts: { json?: boolean; api?: string }) => {
      warnDeprecated('start', opts.json)
      daemonStart(opts)
    })

  daemon
    .command('stop')
    .description('Stop the background service')
    .option('--json', 'Print machine-readable status JSON')
    .action(async (opts: { json?: boolean }) => {
      warnDeprecated('stop', opts.json)
      await daemonStop(opts)
    })

  daemon
    .command('restart')
    .description('Restart the background service')
    .option('--json', 'Print machine-readable status JSON')
    .option('--api <url>', 'Server URL override')
    .action((opts: { json?: boolean; api?: string }) => {
      warnDeprecated('stop && shennian start', opts.json)
      daemonRestart(opts)
    })

  daemon
    .command('status')
    .description('Show background service status')
    .option('--json', 'Print machine-readable status JSON')
    .action((opts: { json?: boolean }) => {
      warnDeprecated('status', opts.json)
      daemonStatus(opts)
    })

  daemon
    .command('logs')
    .description('Show recent logs')
    .option('-n, --lines <n>', 'Number of lines', '50')
    .action((opts: { lines: string }) => {
      warnDeprecated('logs')
      daemonLogs({ lines: parseInt(opts.lines, 10) })
    })

  daemon.command('uninstall').description('Uninstall auto-start service').action(daemonUninstall)
}
