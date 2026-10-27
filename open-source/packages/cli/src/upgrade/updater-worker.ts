// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/updater-worker.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const PROTOCOL_VERSION = 1 as const
const REGISTRY_FALLBACK = 'https://registry.npmjs.org'
const MAX_JOB_AGE_MS = 30 * 60_000

type Job = {
  protocolVersion: 1
  jobId: string
  fromVersion: string
  targetVersion: string
  npmPrefix: string
  npmExecutable: string
  nodeExecutable: string
  packageName: 'shennian'
  operation: 'upgrade' | 'rollback'
  oldDaemonPid: number | null
  platform: NodeJS.Platform
  createdAt: string
  daemonExitTimeoutMs: number
  commandTimeoutMs: number
  resultPath: string
  attemptPath: string
  isolatedDaemonStart?: boolean
  rollbackJobId?: string
  requireHandoffAck?: boolean
}

type ResultState = 'waiting_for_daemon' | 'installing' | 'verifying' | 'starting' | 'healthy' | 'rolled_back' | 'failed'
type WorkerDeps = {
  now?: () => number
  isAlive?: (pid: number) => boolean
  kill?: (pid: number, signal: NodeJS.Signals) => void
  sleep?: (ms: number) => Promise<void>
  execFile?: typeof execFile
  healthTimeoutMs?: number
  serviceRecovery?: boolean
  fetch?: typeof globalThis.fetch
  fetchOwnedArtifact?: (version: string) => Promise<OwnedArtifact | null>
  sourceOrder?: 'npm-first' | 'oss-first'
}

function sanitize(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[A-Za-z]:\\[^\s]+|\/(?:[^\s/]+\/)+[^\s]+/g, '<path>')
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

function atomicJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    const fd = fs.openSync(temp, process.platform === 'win32' ? 'r+' : 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, filePath)
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(filePath), 'r')
      try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
    }
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

function readJob(jobPath: string): Job {
  const stat = fs.lstatSync(jobPath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('invalid_job')
  const input = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as Record<string, unknown>
  const string = (key: string) => {
    if (typeof input[key] !== 'string' || !String(input[key]).trim()) throw new Error('invalid_job')
    return String(input[key])
  }
  const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
  const fromVersion = string('fromVersion')
  const targetVersion = string('targetVersion')
  if (input.protocolVersion !== PROTOCOL_VERSION || input.packageName !== 'shennian') throw new Error('invalid_job')
  if (!semver.test(fromVersion) || !semver.test(targetVersion)) throw new Error('invalid_job')
  if (!Number.isFinite(Date.parse(string('createdAt')))) throw new Error('invalid_job')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(string('jobId'))) throw new Error('invalid_job')
  if (!['darwin', 'linux', 'win32'].includes(string('platform'))) throw new Error('invalid_job')
  const oldDaemonPid = input.oldDaemonPid == null ? null : Number(input.oldDaemonPid)
  const daemonExitTimeoutMs = Number(input.daemonExitTimeoutMs)
  const commandTimeoutMs = Number(input.commandTimeoutMs)
  if (oldDaemonPid != null && (!Number.isSafeInteger(oldDaemonPid) || oldDaemonPid < 1)) throw new Error('invalid_job')
  if (!Number.isSafeInteger(daemonExitTimeoutMs) || daemonExitTimeoutMs < 1000) throw new Error('invalid_job')
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 10_000) throw new Error('invalid_job')
  return {
    protocolVersion: 1,
    jobId: string('jobId'), fromVersion, targetVersion,
    npmPrefix: string('npmPrefix'), npmExecutable: string('npmExecutable'),
    nodeExecutable: string('nodeExecutable'), packageName: 'shennian',
    operation: input.operation === 'rollback' ? 'rollback' : 'upgrade',
    oldDaemonPid,
    platform: string('platform') as NodeJS.Platform,
    createdAt: string('createdAt'),
    daemonExitTimeoutMs,
    commandTimeoutMs,
    resultPath: string('resultPath'),
    attemptPath: string('attemptPath'),
    isolatedDaemonStart: input.isolatedDaemonStart === true,
    requireHandoffAck: input.requireHandoffAck === true,
    ...(typeof input.rollbackJobId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.rollbackJobId) ? { rollbackJobId: input.rollbackJobId } : {}),
  }
}

function packageRoot(prefix: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? path.win32.join(prefix, 'node_modules', 'shennian')
    : path.posix.join(prefix, 'lib', 'node_modules', 'shennian')
}

// Only the CLI package is moved; unrelated global packages and identity/data stay put.
export function updaterPaths(job: Job) {
  const active = packageRoot(job.npmPrefix, job.platform)
  const transaction = path.join(path.dirname(active), `.shennian-upgrade-${job.rollbackJobId ?? job.jobId}`)
  const prefix = path.join(transaction, 'candidate')
  return {
    active, transaction, prefix, candidate: packageRoot(prefix, job.platform),
    previous: path.join(transaction, 'previous'), rejected: path.join(transaction, 'rejected'),
    marker: path.join(transaction, 'transaction.json'),
  }
}

type DiskRecord = {
  jobId?: string; jobPath?: string; fromVersion?: string; targetVersion?: string;
  phase?: string; state?: string; pid?: number; createdAt?: number; version?: string;
  name?: string; bin?: { shennian?: string }; dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
function readJson(file: string): DiskRecord | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function assertDirectory(directory: string): void {
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_installation')
}

// An npm cache/tarball is not a rollback snapshot. Require the complete installed
// dependency closure, with no links pointing out of the package we preserve.
export function verifyLocalPackage(directory: string, version: string): void {
  assertDirectory(directory)
  const root = fs.realpathSync(directory)
  const inside = (file: string) => {
    const relative = path.relative(root, fs.realpathSync(file))
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('external_package_dependency')
    }
  }
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) inside(file)
      else if (entry.isDirectory()) walk(file)
    }
  }
  walk(directory)
  const manifest = readJson(path.join(directory, 'package.json'))
  if (manifest?.name !== 'shennian' || manifest.version !== version ||
      manifest.bin?.shennian !== 'dist/bin/shennian.js') throw new Error('verification_failed')
  inside(path.join(directory, 'dist', 'bin', 'shennian.js'))
  const visited = new Set<string>()
  const dependencies = (dir: string) => {
    const real = fs.realpathSync(dir)
    if (visited.has(real)) return
    visited.add(real)
    const pkg = readJson(path.join(dir, 'package.json'))
    if (!pkg) throw new Error('incomplete_package')
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (Object.hasOwn(pkg.optionalDependencies ?? {}, name)) continue
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error('invalid_dependency')
      let parent = dir
      let found = false
      while (parent === directory || parent.startsWith(directory + path.sep)) {
        const dep = path.join(parent, 'node_modules', name)
        if (fs.existsSync(path.join(dep, 'package.json'))) {
          inside(dep); dependencies(dep); found = true; break
        }
        parent = path.dirname(parent)
      }
      if (!found) throw new Error('incomplete_package')
    }
  }
  dependencies(directory)
}

export function assertUpdaterAvailable(root: string): void {
  const lock = readJson(path.join(root, 'updater.lock'))
  if (liveLock(lock)) throw new Error('upgrade_locked')
}

export async function prepareUpdaterCandidate(job: Job, deps: WorkerDeps = {}): Promise<void> {
  const paths = updaterPaths(job)
  assertDirectory(path.dirname(paths.active))
  verifyLocalPackage(paths.active, job.fromVersion)
  fs.mkdirSync(paths.transaction, { mode: 0o700 })
  try {
    // Full install runs beside, never into, the running package. No second daemon.
    await installCandidate(job, paths, deps)
    await finalizeUpdaterCandidate(job, deps)
  } catch (error) {
    // No freeze, service stop or active-package mutation occurred.
    fs.rmSync(paths.transaction, { recursive: true, force: true })
    throw Object.assign(new Error(sanitize(error)), { code: 'candidate_preparation_failed' })
  }
}

/** Validate an already materialized candidate too (offline repair/artifact transport). */
export async function finalizeUpdaterCandidate(job: Job, deps: WorkerDeps = {}): Promise<void> {
  const paths = updaterPaths(job)
  assertDirectory(paths.transaction)
  const previousMarker = readJson(paths.marker)
  if (previousMarker && previousMarker.phase !== 'prepared') throw new Error('transaction_already_started')
  verifyLocalPackage(paths.active, job.fromVersion)
  verifyLocalPackage(paths.candidate, job.targetVersion)
  const run = deps.execFile ?? execFile
  await verify({ ...job, npmPrefix: paths.prefix }, job.targetVersion, run)
  await run(job.npmExecutable, [
    'ls', '-g', `shennian@${job.targetVersion}`, '--all', '--omit=dev', '--offline', '--depth=100', '--prefix', paths.prefix,
  ], execOptions(job, 30_000))
  atomicJson(paths.marker, {
    jobId: job.jobId, fromVersion: job.fromVersion, targetVersion: job.targetVersion, phase: 'prepared',
  })
}

function durableRename(from: string, to: string): void {
  fs.renameSync(from, to)
  if (process.platform !== 'win32') {
    for (const dir of new Set([path.dirname(from), path.dirname(to)])) {
      const fd = fs.openSync(dir, 'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
  }
}

function pruneCompletedTransactions(job: Job): void {
  const current = updaterPaths(job)
  const results = path.dirname(job.resultPath)
  for (const entry of fs.readdirSync(path.dirname(current.active), { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\.shennian-upgrade-[A-Za-z0-9_-]+$/.test(entry.name)) continue
    const directory = path.join(path.dirname(current.active), entry.name)
    if (directory === current.transaction) continue
    const marker = readJson(path.join(directory, 'transaction.json'))
    if (!marker?.jobId || entry.name !== `.shennian-upgrade-${marker.jobId}`) continue
    const result = readJson(path.join(results, `${marker.jobId}.json`))
    if (result?.jobId === marker.jobId && ['healthy', 'rolled_back'].includes(result.state ?? '')) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}

function recordRollbackCooldown(job: Job): void {
  const file = path.join(path.dirname(job.attemptPath), 'upgrade-failures.json')
  type Failure = { failureCount: number; firstFailedAt: number }
  let data: { versions: Record<string, Failure> } = { versions: {} }
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first failure */ }
  const previous = data.versions?.[job.targetVersion]
  const count = Math.max(0, Number(previous?.failureCount) || 0) + 1
  const now = Date.now()
  const delays = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000]
  atomicJson(file, { versions: { ...data.versions, [job.targetVersion]: {
    version: job.targetVersion, failureCount: count, firstFailedAt: previous?.firstFailedAt ?? now,
    lastFailedAt: now, nextRetryAt: now + delays[Math.min(count - 1, delays.length - 1)], error: 'upgrade_rolled_back',
  } } })
}

function transactionPhase(job: Job, phase: string): void {
  const paths = updaterPaths(job)
  const marker = readJson(paths.marker)
  if (!marker || marker.jobId !== (job.rollbackJobId ?? job.jobId)) throw new Error('invalid_transaction')
  atomicJson(paths.marker, { ...marker, phase })
}

function liveLock(lock: { pid?: number; createdAt?: number } | null): boolean {
  // A PID from before an OS restart may already belong to an unrelated process.
  const boot = Date.now() - os.uptime() * 1000
  return Boolean(lock?.pid && (lock.createdAt === undefined || lock.createdAt >= boot - 2000) && isAliveDefault(lock.pid))
}

function isAliveDefault(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function waitForExit(job: Job, deps: WorkerDeps): Promise<void> {
  if (deps.serviceRecovery) return
  if (!job.oldDaemonPid || !((deps.isAlive ?? isAliveDefault)(job.oldDaemonPid))) return
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  kill(job.oldDaemonPid, 'SIGTERM')
  const deadline = (deps.now ?? Date.now)() + job.daemonExitTimeoutMs
  while ((deps.now ?? Date.now)() < deadline) {
    if (!((deps.isAlive ?? isAliveDefault)(job.oldDaemonPid))) return
    await sleep(100)
  }
  if (deps.kill) {
    kill(job.oldDaemonPid, 'SIGKILL')
  } else if (job.platform === 'win32') {
    // taskkill /T is the only reliable way to include descendants when the
    // daemon itself is wedged and cannot perform its normal child cleanup.
    try {
      await (deps.execFile ?? execFile)(
        'taskkill',
        ['/PID', String(job.oldDaemonPid), '/T', '/F'],
        { timeout: 15_000, windowsHide: true, shell: true },
      )
    } catch {}
  } else {
    // Service/fallback daemons are started as their own process group. Kill
    // the group first so an unresponsive parent cannot orphan Agent children.
    try { process.kill(-job.oldDaemonPid, 'SIGKILL') } catch {
      try { process.kill(job.oldDaemonPid, 'SIGKILL') } catch {}
    }
  }
  await sleep(250)
  if ((deps.isAlive ?? isAliveDefault)(job.oldDaemonPid)) throw new Error('daemon_exit_timeout')
}

function execOptions(job: Job, timeout = job.commandTimeoutMs) {
  return { timeout, windowsHide: true, shell: job.platform === 'win32' }
}

async function install(job: Job, version: string, run: typeof execFile): Promise<void> {
  const args = ['install', '-g', `shennian@${version}`, '--prefix', job.npmPrefix]
  try {
    await run(job.npmExecutable, args, execOptions(job))
  } catch {
    await run(job.npmExecutable, [...args, '--registry', REGISTRY_FALLBACK], execOptions(job))
  }
}

type OwnedArtifact = { url: string; size: number; integrity: string }

async function downloadOwnedArtifact(
  artifact: OwnedArtifact,
  targetVersion: string,
  commandTimeoutMs: number,
  directory: string,
  fetcher: typeof globalThis.fetch,
): Promise<string | null> {
  try {
    if (
      typeof artifact.url !== 'string' ||
      !/^https?:\/\//.test(artifact.url) ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size <= 0 ||
      artifact.size > 200 * 1024 * 1024 ||
      typeof artifact.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity)
    ) return null
    const response = await fetcher(artifact.url, {
      signal: AbortSignal.timeout(commandTimeoutMs),
    })
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength !== artifact.size) return null
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    if (integrity !== artifact.integrity) return null
    const target = path.join(directory, `shennian-${targetVersion}.tgz`)
    fs.writeFileSync(target, bytes, { mode: 0o600 })
    return target
  } catch {
    return null
  }
}

async function installCandidate(
  job: Job,
  paths: ReturnType<typeof updaterPaths>,
  deps: WorkerDeps,
): Promise<void> {
  const run = deps.execFile ?? execFile
  const installOwned = async (): Promise<boolean> => {
    const metadata = await deps.fetchOwnedArtifact?.(job.targetVersion)
    if (!metadata) return false
    const artifact = await downloadOwnedArtifact(
      metadata,
      job.targetVersion,
      job.commandTimeoutMs,
      paths.transaction,
      deps.fetch ?? globalThis.fetch,
    )
    if (!artifact) return false
    try {
      await run(job.npmExecutable, [
        'install', '-g', artifact, '--prefix', paths.prefix,
        '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      ], execOptions(job))
      return true
    } catch {
      fs.rmSync(paths.prefix, { recursive: true, force: true })
      return false
    }
  }
  const sourceOrder = deps.sourceOrder ?? 'npm-first'
  if (sourceOrder === 'oss-first') {
    if (await installOwned()) return
    await install({ ...job, npmPrefix: paths.prefix }, job.targetVersion, run)
    return
  }
  try {
    await install({ ...job, npmPrefix: paths.prefix }, job.targetVersion, run)
    return
  } catch (npmError) {
    fs.rmSync(paths.prefix, { recursive: true, force: true })
    if (await installOwned()) return
    throw npmError
  }
}

async function verify(job: Job, version: string, run: typeof execFile): Promise<string> {
  const root = packageRoot(job.npmPrefix, job.platform)
  const bin = path.join(root, 'dist', 'bin', 'shennian.js')
  const { stdout } = await run(job.nodeExecutable, [bin, '--version'], execOptions(job, 10_000))
  if (stdout.trim() !== version) throw new Error('verification_failed')
  return bin
}

async function startDaemon(
  job: Job,
  bin: string,
  run: typeof execFile,
): Promise<void> {
  if (job.isolatedDaemonStart) {
    // The exact target package recognizes the release-only isolation marker:
    // it skips platform service installation and waits for a direct daemon to
    // become ready. This avoids the detached-child race without touching the
    // user's launchd/systemd/Task Scheduler registration.
    await run(job.nodeExecutable, [bin, 'start', '--json'], execOptions(job, 30_000))
    return
  }
  try {
    // Release smoke must never kick a developer's or test host's real service.
    if (job.platform === 'darwin') {
      const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid
      try {
        await run('launchctl', ['bootstrap', `gui/${uid}`, path.join(os.homedir(), 'Library/LaunchAgents/com.shennian.agent.plist')], execOptions(job, 15_000))
      } catch { /* already loaded */ }
      await run('launchctl', ['kickstart', '-k', `gui/${uid}/com.shennian.agent`], execOptions(job, 15_000))
      return
    }
    if (job.platform === 'linux') {
      await run('systemctl', ['--user', 'restart', 'shennian'], execOptions(job, 15_000))
      return
    }
    if (job.platform === 'win32') {
      await run('schtasks', ['/Run', '/TN', 'ShennianAgent'], execOptions(job, 15_000))
      return
    }
  } catch {
    // A user may not have installed the platform service yet. The exact new
    // entry point is still safe because it no longer lives in the old package.
  }
  await run(job.nodeExecutable, [bin, 'start', '--json'], execOptions(job, 30_000))
}

async function stopPlatformService(job: Job, run: typeof execFile): Promise<void> {
  if (job.isolatedDaemonStart) return
  try {
    if (job.platform === 'darwin') {
      await run('launchctl', ['bootout', `gui/${process.getuid?.() ?? os.userInfo().uid}/com.shennian.agent`], execOptions(job, 15_000))
    } else if (job.platform === 'linux') {
      await run('systemctl', ['--user', 'stop', 'shennian'], execOptions(job, 15_000))
    } else if (job.platform === 'win32') {
      await run('schtasks', ['/End', '/TN', 'ShennianAgent'], execOptions(job, 15_000))
    }
  } catch {
    // No installed service is a supported CLI-only configuration. The PID exit
    // check remains mandatory before any replacement; service entry guards races.
  }
}

function resultWriter(job: Job) {
  return (state: ResultState, fields: Record<string, unknown> = {}) => atomicJson(job.resultPath, {
    protocolVersion: PROTOCOL_VERSION,
    jobId: job.jobId,
    state,
    fromVersion: job.fromVersion,
    targetVersion: job.targetVersion,
    operation: job.operation,
    ...fields,
    updatedAt: new Date().toISOString(),
  })
}

function acquireLock(jobPath: string, job: Job): () => void {
  const root = path.dirname(path.dirname(jobPath))
  const lock = path.join(root, 'updater.lock')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  try {
    const fd = fs.openSync(lock, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify({ jobId: job.jobId, phase: 'worker', pid: process.pid, createdAt: Date.now() }))
    fs.closeSync(fd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    try {
      const existing = JSON.parse(fs.readFileSync(lock, 'utf8')) as { jobId?: string; pid?: number; createdAt?: number; phase?: string }
      if (
        (existing.jobId !== job.jobId || (existing.phase !== 'handoff' && existing.pid !== job.oldDaemonPid)) &&
        liveLock(existing)
      ) {
        throw new Error('upgrade_locked')
      }
    } catch (readError) {
      if (readError instanceof Error && readError.message === 'upgrade_locked') throw readError
    }
    fs.rmSync(lock, { force: true })
    const fd = fs.openSync(lock, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify({ jobId: job.jobId, phase: 'worker', pid: process.pid, createdAt: Date.now() }))
    fs.closeSync(fd)
  }
  return () => { try { fs.unlinkSync(lock) } catch {} }
}

export async function runUpdaterJob(jobPath: string, deps: WorkerDeps = {}): Promise<void> {
  let job: Job
  try { job = readJob(jobPath) } catch { throw new Error('invalid_job') }
  if (!deps.serviceRecovery && (deps.now ?? Date.now)() - Date.parse(job.createdAt) > MAX_JOB_AGE_MS) throw new Error('job_expired')
  const root = path.dirname(path.dirname(path.resolve(jobPath)))
  if (
    path.basename(path.dirname(path.resolve(jobPath))) !== 'jobs' ||
    path.basename(path.resolve(jobPath)) !== `${job.jobId}.json`
  ) throw new Error('invalid_job')
  if (path.dirname(path.resolve(job.resultPath)) !== path.join(root, 'results')) throw new Error('invalid_job')
  if (path.basename(path.resolve(job.resultPath)) !== `${job.jobId}.json`) throw new Error('invalid_job')
  const expectedHome = path.dirname(path.dirname(root))
  if (path.resolve(job.attemptPath) !== path.join(expectedHome, 'upgrade-attempt.json')) {
    throw new Error('invalid_job')
  }
  const release = acquireLock(jobPath, job)
  const writeResult = resultWriter(job)
  const run = deps.execFile ?? execFile
  const paths = updaterPaths(job)
  const activeJob = path.join(root, 'active-job.json')
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let switching = false
  let failure: { errorCode?: string; errorSummary?: string } = {}
  const setAttempt = (rollback: boolean) => {
    if (rollback) recordRollbackCooldown(job)
    atomicJson(job.attemptPath, {
      from: rollback ? job.targetVersion : job.fromVersion,
      to: rollback ? job.fromVersion : job.targetVersion,
      attemptCount: 0, attemptAt: Date.now(), jobId: job.jobId,
      operation: rollback ? 'rollback' : 'upgrade',
    })
    writeResult('starting', rollback ? { operation: 'rollback', ...failure, effectiveVersion: job.fromVersion, targetVersion: job.fromVersion, fromVersion: job.targetVersion } : {})
  }
  const waitHealthy = async (rollback: boolean) => {
    if (deps.serviceRecovery) return
    const deadline = (deps.now ?? Date.now)() + (deps.healthTimeoutMs ?? 90_000)
    while ((deps.now ?? Date.now)() < deadline) {
      const result = readJson(job.resultPath)
      if (result?.state === (rollback ? 'rolled_back' : 'healthy')) return
      // Only the replacement daemon may acknowledge Relay + recovery health.
      await sleep(250)
    }
    throw new Error('daemon_health_timeout')
  }
  const stopReplacement = async () => {
    const pid = readJson(path.join(expectedHome, 'daemon.pid'))
    if (pid?.version === job.targetVersion && Number.isSafeInteger(pid.pid) && typeof pid.pid === 'number' && pid.pid !== process.pid) {
      await waitForExit({ ...job, oldDaemonPid: pid.pid }, deps)
    }
  }
  const restore = async () => {
    transactionPhase(job, 'rolling_back')
    if (!deps.serviceRecovery) await stopPlatformService(job, run)
    await stopReplacement()
    // Check the complete old snapshot BEFORE moving anything out of the way.
    if (!fs.existsSync(paths.previous)) {
      verifyLocalPackage(paths.active, job.fromVersion)
    } else {
      verifyLocalPackage(paths.previous, job.fromVersion)
      if (fs.existsSync(paths.active)) {
        if (fs.existsSync(paths.rejected)) throw new Error('rollback_destination_exists')
        durableRename(paths.active, paths.rejected)
      }
      durableRename(paths.previous, paths.active)
    }
    transactionPhase(job, 'restored')
    verifyLocalPackage(paths.active, job.fromVersion)
    const bin = await verify(job, job.fromVersion, run)
    setAttempt(true)
    if (!deps.serviceRecovery) await startDaemon(job, bin, run)
    await waitHealthy(true)
  }
  try {
    const existing = readJson(job.resultPath)
    if (existing?.jobId === job.jobId && ['healthy', 'rolled_back', 'failed'].includes(existing.state ?? '')) return
    const marker = readJson(paths.marker)
    if (marker && (marker.jobId !== (job.rollbackJobId ?? job.jobId) ||
        marker.fromVersion !== (job.operation === 'rollback' ? job.targetVersion : job.fromVersion))) {
      throw new Error('invalid_transaction')
    }
    if (job.operation === 'rollback') {
      // Crash guard references the original job's preserved on-disk installation.
      // Never re-download the previous release, even for legacy/no-snapshot jobs.
      job = { ...job, fromVersion: job.targetVersion, targetVersion: job.fromVersion }
      switching = true
      atomicJson(activeJob, { jobPath })
      await waitForExit(job, deps)
      await restore()
      return
    }
    if (marker && marker.phase !== 'prepared') {
      switching = true
      // A rerun after a crash converges to the known-good local installation.
      if (marker.phase === 'restored' ||
          (marker.phase === 'rolling_back' && !fs.existsSync(paths.previous))) {
        verifyLocalPackage(paths.active, job.fromVersion)
        transactionPhase(job, 'restored')
        setAttempt(true)
        if (!deps.serviceRecovery) await startDaemon(job, await verify(job, job.fromVersion, run), run)
        await waitHealthy(true)
      } else if (marker.phase === 'switching' && !fs.existsSync(paths.previous)) {
        // Crash before the first rename: the old installation is still in place.
        verifyLocalPackage(paths.active, job.fromVersion)
        transactionPhase(job, 'restored')
        setAttempt(true)
        if (!deps.serviceRecovery) await startDaemon(job, await verify(job, job.fromVersion, run), run)
        await waitHealthy(true)
      } else {
        await restore()
      }
      return
    }
    if (!marker) {
      // Compatibility for an old launcher/no-daemon CLI: prepare safely here too.
      writeResult('installing')
      await prepareUpdaterCandidate(job, deps)
    }
    verifyLocalPackage(paths.candidate, job.targetVersion)
    verifyLocalPackage(paths.active, job.fromVersion)
    writeResult('waiting_for_daemon')
    if (job.requireHandoffAck) {
      const deadline = (deps.now ?? Date.now)() + 10_000
      while (readJson(`${job.resultPath}.handoff`)?.jobId !== job.jobId) {
        if ((deps.now ?? Date.now)() >= deadline) throw new Error('handoff_not_confirmed')
        await sleep(50)
      }
    }
    await sleep(250)
    atomicJson(activeJob, { jobPath })
    if (!deps.serviceRecovery) await stopPlatformService(job, run)
    await waitForExit(job, deps)
    transactionPhase(job, 'switching')
    switching = true
    durableRename(paths.active, paths.previous)
    durableRename(paths.candidate, paths.active)
    writeResult('verifying')
    verifyLocalPackage(paths.active, job.targetVersion)
    const bin = await verify(job, job.targetVersion, run)
    transactionPhase(job, 'starting')
    setAttempt(false)
    if (!deps.serviceRecovery) await startDaemon(job, bin, run)
    await waitHealthy(false)
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : 'internal_error')
    if (!switching) {
      writeResult('failed', { errorCode: code, errorSummary: sanitize(error) })
      // Old launchers may already have exited before preparation. Preserve and
      // restart the unchanged installation, without claiming a healthy rollback.
      if (!job.oldDaemonPid || !(deps.isAlive ?? isAliveDefault)(job.oldDaemonPid)) {
        verifyLocalPackage(paths.active, job.fromVersion)
        if (!deps.serviceRecovery) await startDaemon(job, await verify(job, job.fromVersion, run), run)
      }
      return
    }
    failure = { errorCode: code, errorSummary: sanitize(error) }
    try {
      await restore()
    } catch (rollbackError) {
      writeResult('failed', { errorCode: 'rollback_failed', errorSummary: sanitize(rollbackError) })
      throw rollbackError
    }
  } finally {
    const result = readJson(job.resultPath)
    if (['healthy', 'rolled_back'].includes(result?.state ?? '')) {
      try { pruneCompletedTransactions(job) } catch { /* cleanup never invalidates health */ }
    }
    release()
  }
}

// Platform services enter through the stable worker, outside the replaceable npm
// package. Even a power loss between directory renames cannot strand their entry.
export async function recoverServiceEntry(root: string): Promise<void> {
  const active = readJson(path.join(root, 'active-job.json'))
  if (!active?.jobPath) return
  const jobPath = path.resolve(active.jobPath)
  if (path.dirname(jobPath) !== path.join(path.resolve(root), 'jobs')) throw new Error('invalid_job')
  const job = readJob(jobPath)
  for (;;) {
    const result = readJson(job.resultPath)
    if (['healthy', 'rolled_back', 'failed'].includes(result?.state ?? '')) return
    const lock = readJson(path.join(root, 'updater.lock'))
    const running = lock?.pid !== process.pid && liveLock(lock)
    const marker = readJson(updaterPaths(job).marker)
    if (running) {
      if (result?.state === 'starting' && ['starting', 'restored'].includes(marker?.phase ?? '')) return
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }
    // Do not kill a stale PID from the previous boot. This runs as the platform
    // service, before it imports any business code or opens the personal store.
    await runUpdaterJob(jobPath, { serviceRecovery: true })
    return
  }
}

function canonicalExecutablePath(value: string): string {
  try { return fs.realpathSync.native(value) } catch { return path.resolve(value) }
}

const invokedPath = process.argv[1] ? canonicalExecutablePath(process.argv[1]) : ''
const modulePath = canonicalExecutablePath(fileURLToPath(import.meta.url))
if (invokedPath === modulePath) {
  if (process.argv[2] === '--service') {
    const [, , , root, bin, ...args] = process.argv
    void recoverServiceEntry(root).then(async () => {
      process.argv = [process.execPath, bin, ...args]
      await import(pathToFileURL(bin).href)
    }).catch(() => { process.exitCode = 1 })
  } else {
    const jobPath = process.argv[2]
    if (!jobPath) process.exitCode = 2
    else void runUpdaterJob(jobPath).catch(() => { process.exitCode = 1 })
  }
}
