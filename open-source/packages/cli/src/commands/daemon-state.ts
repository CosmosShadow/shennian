// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getShennianDir, loadConfig, resolveShennianPath } from '../config/index.js'
import { findRunningWindowsDaemonProcessIds, inferDaemonLauncherFromCommand, isDaemonProcessInCurrentNamespace, isDaemonProcessRunning, isShennianRunServiceCommand, readWindowsProcessCommand } from './daemon-process.js'

export const SHENNIAN_DIR = getShennianDir()
export const PID_FILE = resolveShennianPath('daemon.pid')
export const LOG_FILE = resolveShennianPath('daemon.log')
export const REMOTE_ACCESS_DISABLED_FILE = resolveShennianPath('remote-access.disabled')
export const LAUNCHER_FILE = resolveShennianPath('daemon-launcher.json')

export type Platform = 'darwin' | 'linux' | 'win32'
export type DaemonLauncher = 'desktop-managed' | 'global-cli' | 'unknown'

export type DaemonStatus = {
  running: boolean
  pid: number | null
  stale: boolean
  remoteAccessDisabled: boolean
  launcher: DaemonLauncher
  daemonVersion?: string
  platform: Platform
  shennianDir: string
  pidFile: string
  logFile: string
  machineId?: string
  paired?: boolean
  serverUrl?: string
  instanceId?: string
  adopted?: boolean
}

export function getPlatform(): Platform {
  const p = os.platform()
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p
  return 'linux'
}

// ─── PID helpers ────────────────────────────────────────────────────────────

type DaemonPidRecord = {
  pid: number
  instanceId?: string
  version?: string
  launcher?: DaemonLauncher
  startedAt?: string
  adopted?: boolean
}

function parsePidRecord(raw: string): DaemonPidRecord | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<DaemonPidRecord>
      const pid = Number(parsed.pid)
      if (!Number.isInteger(pid) || pid <= 0) return null
      return {
        pid,
        ...(typeof parsed.instanceId === 'string' ? { instanceId: parsed.instanceId } : {}),
        ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
        ...(parsed.launcher === 'desktop-managed' ||
        parsed.launcher === 'global-cli' ||
        parsed.launcher === 'unknown'
          ? { launcher: parsed.launcher }
          : {}),
        ...(typeof parsed.startedAt === 'string' ? { startedAt: parsed.startedAt } : {}),
        ...(parsed.adopted === true ? { adopted: true } : {}),
      }
    } catch {
      return null
    }
  }
  const pid = parseInt(trimmed, 10)
  return isNaN(pid) ? null : { pid }
}

export function readPidRecord(): DaemonPidRecord | null {
  try {
    return parsePidRecord(fs.readFileSync(PID_FILE, 'utf-8'))
  } catch {
    return null
  }
}

export function isRunning(pid: number): boolean {
  return isDaemonProcessRunning(pid)
}

export function waitForPidExitSync(pid: number, timeoutMs = 3000): boolean {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!isRunning(pid)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return !isRunning(pid)
}

export function isRemoteAccessDisabled(): boolean {
  try {
    fs.lstatSync(REMOTE_ACCESS_DISABLED_FILE)
    return true
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
  }
}

export function clearRemoteAccessDisabled(): void {
  try {
    fs.unlinkSync(REMOTE_ACCESS_DISABLED_FILE)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

export function getCurrentProcessDaemonLauncher(): DaemonLauncher {
  return 'global-cli'
}

export function createDaemonInstanceId(): string {
  return `${process.pid}-${Date.now()}-${randomUUID()}`
}

export function writeDaemonPid(
  pid: number,
  instanceId: string,
  meta: { version?: string; launcher?: DaemonLauncher; adopted?: boolean } = {},
): void {
  fs.mkdirSync(SHENNIAN_DIR, { recursive: true })
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid,
        instanceId,
        ...(meta.version ? { version: meta.version } : {}),
        launcher: meta.launcher ?? getCurrentProcessDaemonLauncher(),
        ...(meta.adopted ? { adopted: true } : {}),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
}

export function clearDaemonPidIfOwner(pid: number, instanceId: string): void {
  const current = readPidRecord()
  if (current?.pid !== pid || current.instanceId !== instanceId) return
  try {
    fs.unlinkSync(PID_FILE)
  } catch {
    // PID metadata may already be gone.
  }
}

export function writeDaemonLauncher(
  pid: number,
  launcher = getCurrentProcessDaemonLauncher(),
  instanceId?: string,
): void {
  fs.mkdirSync(SHENNIAN_DIR, { recursive: true })
  fs.writeFileSync(
    LAUNCHER_FILE,
    JSON.stringify(
      {
        pid,
        launcher,
        ...(instanceId ? { instanceId } : {}),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
}

export function clearDaemonLauncher(instanceId?: string): void {
  if (instanceId) {
    try {
      const raw = JSON.parse(fs.readFileSync(LAUNCHER_FILE, 'utf-8')) as { instanceId?: unknown }
      if (raw.instanceId !== instanceId) return
    } catch {
      return
    }
  }
  try {
    fs.unlinkSync(LAUNCHER_FILE)
  } catch {
    // Launcher metadata may already be absent.
  }
}

export function recordStartedDaemon(childPid: number | undefined): void {
  if (childPid) writeDaemonLauncher(childPid)
}

function readDaemonLauncher(pid: number | null, running: boolean): DaemonLauncher {
  if (!pid || !running) return 'unknown'
  try {
    const raw = JSON.parse(fs.readFileSync(LAUNCHER_FILE, 'utf-8')) as {
      pid?: unknown
      launcher?: unknown
    }
    if (raw.pid !== pid) return 'unknown'
    if (raw.launcher === 'desktop-managed' || raw.launcher === 'global-cli') return raw.launcher
  } catch {
    // Older daemons do not have launcher metadata.
  }
  return inferDaemonLauncherFromProcess(pid)
}

function inferDaemonLauncherFromProcess(pid: number): DaemonLauncher {
  if (getPlatform() === 'win32') {
    const command = readWindowsProcessCommand(pid)
    return command ? inferDaemonLauncherFromCommand(command) : 'unknown'
  }
  try {
    const command = execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
      windowsHide: true,
    }).replace(/\\/g, '/')
    return inferDaemonLauncherFromCommand(command)
  } catch {
    // Process command inspection is best effort.
  }
  return 'unknown'
}

export function findRunningDaemonProcessIds(excludePid = process.pid): number[] {
  if (getPlatform() === 'win32') return findRunningWindowsDaemonProcessIds(excludePid)
  try {
    const output = execSync('ps -axo pid=,command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
      windowsHide: true,
    })
    return output
      .split(/\r?\n/)
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/)
        if (!match) return null
        const pid = Number(match[1])
        const command = match[2]
        if (!Number.isInteger(pid) || pid === excludePid) return null
        return isShennianRunServiceCommand(command) && isDaemonProcessInCurrentNamespace(pid) ? pid : null
      })
      .filter((pid): pid is number => typeof pid === 'number')
  } catch {
    return []
  }
}

export function isIsolatedDaemonE2eInstance(
  env: NodeJS.ProcessEnv = process.env,
  shennianDir = SHENNIAN_DIR,
  tempDir = os.tmpdir(),
  defaultDir = path.join(os.homedir(), '.shennian'),
): boolean {
  if (env.SHENNIAN_E2E_ISOLATED_DAEMON !== '1' || !env.SHENNIAN_HOME?.trim()) return false
  if (path.resolve(shennianDir) === path.resolve(defaultDir)) return false
  const relative = path.relative(path.resolve(tempDir), path.resolve(shennianDir))
  const insideTemp =
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  return insideTemp || path.resolve(shennianDir) === path.resolve(env.SHENNIAN_HOME)
}

export function shouldDiscoverGlobalDaemonProcesses(
  env: NodeJS.ProcessEnv = process.env,
  shennianDir = SHENNIAN_DIR,
): boolean {
  return !isIsolatedDaemonE2eInstance(env, shennianDir)
}

export function shouldInstallPlatformService(
  env: NodeJS.ProcessEnv = process.env,
  shennianDir = SHENNIAN_DIR,
): boolean {
  // The Docker entrypoint owns restart and adoption of CLI-resumed daemons.
  // Never install or control systemd/launchd from that runtime.
  return env.SHENNIAN_DAEMON_SUPERVISOR !== 'docker' && !isIsolatedDaemonE2eInstance(env, shennianDir)
}

export function getDaemonStatus(opts: { cleanupStale?: boolean } = {}): DaemonStatus {
  let record = readPidRecord()
  let pid = record?.pid ?? null
  let running = pid !== null && isRunning(pid)
  let stale = pid !== null && !running
  let adopted = record?.adopted === true
  const config = loadConfig()

  if (stale && opts.cleanupStale) {
    try {
      fs.unlinkSync(PID_FILE)
    } catch {
      // Another process may have cleaned up the stale pid file first.
    }
    record = null
    pid = null
    running = false
    stale = false
  }

  if (!running && shouldDiscoverGlobalDaemonProcesses()) {
    const discoveredPid = findRunningDaemonProcessIds()[0]
    if (discoveredPid) {
      pid = discoveredPid
      running = true
      stale = false
      adopted = true
      if (opts.cleanupStale) {
        const instanceId = createDaemonInstanceId()
        writeDaemonPid(discoveredPid, instanceId, {
          launcher: inferDaemonLauncherFromProcess(discoveredPid),
          adopted: true,
        })
        writeDaemonLauncher(discoveredPid, inferDaemonLauncherFromProcess(discoveredPid))
        record = { pid: discoveredPid, instanceId, adopted: true }
      }
    }
  }

  return {
    running,
    pid,
    stale,
    remoteAccessDisabled: isRemoteAccessDisabled(),
    launcher: readDaemonLauncher(pid, running),
    ...(running && record?.pid === pid && record.version ? { daemonVersion: record.version } : {}),
    platform: getPlatform(),
    shennianDir: SHENNIAN_DIR,
    pidFile: PID_FILE,
    logFile: LOG_FILE,
    ...(record?.instanceId ? { instanceId: record.instanceId } : {}),
    ...(adopted ? { adopted: true } : {}),
    ...(config.machineId ? { machineId: config.machineId } : {}),
    paired: Boolean(config.machineToken && config.machineId),
    ...(config.serverUrl ? { serverUrl: config.serverUrl } : {}),
  }
}
