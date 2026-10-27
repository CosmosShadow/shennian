// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/updater-launcher.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolveShennianPath } from '../config/index.js'
import { findPackageJson, resolveNpmGlobalPrefixFromPackageJson } from './engine.js'
import { ensureUpdaterInstalled } from './updater-bootstrap.js'
import { resolveNpmCommand } from './npm-command.js'
import {
  UPDATER_PROTOCOL_VERSION,
  type UpdaterJob,
  type UpdaterResult,
} from './updater-protocol.js'

function atomicJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, filePath)
    if (process.platform !== 'win32') {
      const directoryFd = fs.openSync(path.dirname(filePath), 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function createUpdaterJob(input: {
  fromVersion: string
  targetVersion: string
  oldDaemonPid: number | null
  npmPrefix?: string
  npmExecutable?: string
  nodeExecutable?: string
  root?: string
  now?: Date
  jobId?: string
  operation?: 'upgrade' | 'rollback'
  isolatedDaemonStart?: boolean
  rollbackJobId?: string
  requireHandoffAck?: boolean
}): UpdaterJob {
  const root = input.root ?? resolveShennianPath('runtime', 'updater')
  const packageJson = findPackageJson()
  const npmPrefix = input.npmPrefix
    ?? (packageJson ? resolveNpmGlobalPrefixFromPackageJson(packageJson) : null)
  if (!npmPrefix) throw new Error('Cannot determine the active npm prefix')
  const jobId = input.jobId ?? randomUUID()
  return {
    protocolVersion: UPDATER_PROTOCOL_VERSION,
    jobId,
    fromVersion: input.fromVersion,
    targetVersion: input.targetVersion,
    npmPrefix,
    npmExecutable: input.npmExecutable ?? resolveNpmCommand(input.nodeExecutable ?? process.execPath),
    nodeExecutable: input.nodeExecutable ?? process.execPath,
    packageName: 'shennian',
    operation: input.operation ?? 'upgrade',
    oldDaemonPid: input.oldDaemonPid,
    platform: process.platform,
    createdAt: (input.now ?? new Date()).toISOString(),
    daemonExitTimeoutMs: 15_000,
    commandTimeoutMs: 120_000,
    resultPath: path.join(root, 'results', `${jobId}.json`),
    attemptPath: resolveShennianPath('upgrade-attempt.json'),
    ...(input.requireHandoffAck ? { requireHandoffAck: true } : {}),
    ...(input.rollbackJobId ? { rollbackJobId: input.rollbackJobId } : {}),
    ...(input.isolatedDaemonStart || process.env.SHENNIAN_DAEMON_SUPERVISOR === 'docker' ? { isolatedDaemonStart: true } : {}),
  }
}

export function writeUpdaterJob(job: UpdaterJob, root = resolveShennianPath('runtime', 'updater')): string {
  const directory = path.join(root, 'jobs')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = path.join(directory, `${job.jobId}.json`)
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, target)
    if (process.platform !== 'win32') {
      const directoryFd = fs.openSync(directory, 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
    return target
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function needsSystemdUpdater(platform: string, cgroup: string): boolean {
  return platform === 'linux' && /(?:^|\/)shennian\.service(?:\n|$)/m.test(cgroup.trim())
}

export function launchUpdater(input: Parameters<typeof createUpdaterJob>[0], deps: {
  root?: string
  spawn?: typeof spawn
  readiness?: ReturnType<typeof ensureUpdaterInstalled>
  now?: () => number
  isAlive?: (pid: number) => boolean
  serviceCgroup?: string
  platform?: NodeJS.Platform
  systemdRun?: typeof spawnSync
} = {}): { job: UpdaterJob; process: ChildProcess | null } {
  const root = deps.root ?? input.root ?? resolveShennianPath('runtime', 'updater')
  const readiness = deps.readiness ?? ensureUpdaterInstalled({ root })
  const job = createUpdaterJob({ ...input, root })
  const jobPath = writeUpdaterJob(job, root)
  const lockPath = path.join(root, 'updater.lock')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  let lockFd: number | null = null
  let ownsLock = false
  const releaseOwnedLock = () => {
    if (!ownsLock) return
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { jobId?: string }
      if (current.jobId === job.jobId) fs.unlinkSync(lockPath)
    } catch {}
    ownsLock = false
  }
  try {
    try {
      lockFd = fs.openSync(lockPath, 'wx', 0o600)
      ownsLock = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let locked = false
      try {
        const current = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
          pid?: number
          createdAt?: number
        }
        const isAlive = deps.isAlive ?? ((pid: number) => {
          try { process.kill(pid, 0); return true } catch { return false }
        })
        locked = Boolean(
          current.pid &&
          isAlive(current.pid),
        )
      } catch {
        // Truncated and otherwise invalid locks are stale by definition.
      }
      if (locked) throw new Error('upgrade_locked')
      fs.rmSync(lockPath, { force: true })
      lockFd = fs.openSync(lockPath, 'wx', 0o600)
      ownsLock = true
    }
    fs.writeFileSync(lockFd, JSON.stringify({
      jobId: job.jobId,
      phase: 'handoff',
      pid: process.pid,
      createdAt: (deps.now ?? Date.now)(),
    }))
    fs.closeSync(lockFd)
    lockFd = null
    let cgroup = deps.serviceCgroup ?? ''
    if (process.platform === 'linux' && !deps.spawn && deps.serviceCgroup === undefined) {
      try { cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8') } catch {}
    }
    if (needsSystemdUpdater(deps.platform ?? process.platform, cgroup)) {
      // setsid/detached does not leave systemd's cgroup. Start a sibling unit
      // synchronously before acknowledging handoff, or fail without exiting daemon.
      const result = (deps.systemdRun ?? spawnSync)('systemd-run', [
        '--user', '--quiet', '--collect', `--unit=shennian-updater-${job.jobId}`,
        '--property=Type=exec', '--property=KillMode=process',
        `--setenv=PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
        '--', job.nodeExecutable, readiness.workerPath, jobPath,
      ], { encoding: 'utf8', stdio: 'pipe', timeout: 10_000 })
      if (result.error || result.status !== 0) throw new Error('updater_service_launch_failed')
      return { job, process: null }
    }
    const child = (deps.spawn ?? spawn)(job.nodeExecutable, [readiness.workerPath, jobPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once?.('error', (error) => {
      atomicJson(job.resultPath, {
        protocolVersion: UPDATER_PROTOCOL_VERSION,
        jobId: job.jobId,
        state: 'failed',
        fromVersion: job.fromVersion,
        targetVersion: job.targetVersion,
        errorCode: 'internal_error',
        errorSummary: error instanceof Error ? error.message.slice(0, 500) : 'updater_spawn_failed',
        updatedAt: new Date().toISOString(),
      } satisfies UpdaterResult)
      releaseOwnedLock()
    })
    child.unref()
    return { job, process: child }
  } catch (error) {
    if (lockFd !== null) fs.closeSync(lockFd)
    releaseOwnedLock()
    try { fs.unlinkSync(jobPath) } catch {}
    throw error
  }
}

/** Do not freeze/exit just because spawn succeeded: require worker readiness. */
export async function waitForUpdaterReady(job: UpdaterJob, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let result: UpdaterResult | null = null
    try { result = JSON.parse(fs.readFileSync(job.resultPath, 'utf8')) as UpdaterResult } catch { /* not ready */ }
    if (result?.jobId === job.jobId && result.state === 'waiting_for_daemon') return
    if (result?.jobId === job.jobId && result.state === 'failed') throw new Error(result.errorCode ?? 'updater_not_ready')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('updater_readiness_timeout')
}

export function confirmUpdaterHandoff(job: UpdaterJob): void {
  atomicJson(`${job.resultPath}.handoff`, { jobId: job.jobId })
}

export function markUpdaterHealthy(
  jobId: string,
  effectiveVersion: string,
  root = resolveShennianPath('runtime', 'updater'),
): boolean {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return false
  const resultPath = path.join(root, 'results', `${jobId}.json`)
  try {
    const stat = fs.lstatSync(resultPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return false
    const current = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as UpdaterResult
    if (
      current.protocolVersion !== UPDATER_PROTOCOL_VERSION ||
      current.jobId !== jobId ||
      current.state !== 'starting' ||
      current.targetVersion !== effectiveVersion
    ) return false
    atomicJson(resultPath, {
      ...current,
      state: current.operation === 'rollback' ? 'rolled_back' : 'healthy',
      effectiveVersion,
      updatedAt: new Date().toISOString(),
    } satisfies UpdaterResult)
    return true
  } catch {
    return false
  }
}
