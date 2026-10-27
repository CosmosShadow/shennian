// @arch open-source/docs/cli-runtime.md

import fs from 'node:fs'
import path from 'node:path'
import { execSync, execFileSync, execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { getShennianDir, resolveShennianPath } from '../config/index.js'

import { getUpgradeDistTag } from './channel.js'
import { fetchCliDistribution } from './distribution.js'
import { resolveNpmCommand } from './npm-command.js'

const execFile = promisify(execFileCb)

const UPGRADE_ATTEMPT_FILE = resolveShennianPath('upgrade-attempt.json')
const MAX_CRASH_COUNT = 3
const NPM_REGISTRY_FALLBACK = 'https://registry.npmjs.org'
const UPGRADE_LOCK_STALE_MS = 10 * 60_000

export type UpgradeProgress =
  | { step: 'checking' }
  | { step: 'backing-up' }
  | { step: 'installing'; version: string }
  | { step: 'verifying'; version: string }
  | { step: 'restarting'; from: string; to: string }
  | { step: 'done'; from: string; to: string }

export type UpgradeResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string; rolledBack?: boolean }

export type UpgradeAttempt = {
  from: string
  to: string
  attemptCount: number
  attemptAt: number
  jobId?: string
  operation?: 'upgrade' | 'rollback'
}

export type UpgradeFailureRecord = {
  version: string
  failureCount: number
  firstFailedAt: number
  lastFailedAt: number
  nextRetryAt: number
  error: string
}

export type UpgradeFailures = {
  versions: Record<string, UpgradeFailureRecord>
}

const RETRY_DELAYS_MS = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
]

// ─── Version helpers ─────────────────────────────────────────────────────────

export function getCurrentVersion(): string {
  try {
    const pkgPath = findPackageJson()
    if (pkgPath) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }
      return pkg.version
    }
  } catch { /* noop */ }
  return '0.0.0'
}

export function findPackageJson(startFilePath = fileURLToPath(import.meta.url)): string | null {
  // Walk up from this file's location to find package.json
  let dir = path.dirname(startFilePath)
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { name?: string }
      if (pkg.name === 'shennian') return candidate
    }
    dir = path.dirname(dir)
  }
  return null
}

export async function fetchLatestVersion(): Promise<string> {
  let npmError: unknown
  try {
    const res = await fetch(`https://registry.npmjs.org/shennian/${getUpgradeDistTag()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
    const data = (await res.json()) as { version?: unknown }
    if (typeof data?.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
      throw new Error('npm registry returned an unsupported CLI version (expected numeric major.minor.patch)')
    }
    return data.version
  } catch (error) {
    npmError = error
  }
  try {
    return (await fetchCliDistribution()).version
  } catch (ownError) {
    const first = npmError instanceof Error ? npmError.message : String(npmError)
    const second = ownError instanceof Error ? ownError.message : String(ownError)
    throw new Error(`npm registry unavailable: ${first}; Shennian fallback failed: ${second}`)
  }
}

/**
 * Compare semver strings. Returns:
 *   'none'  — same or older
 *   'patch' — only patch differs
 *   'minor' — minor or patch differs
 *   'major' — major differs
 */
export function compareVersions(current: string, latest: string): 'none' | 'patch' | 'minor' | 'major' {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [cMaj, cMin, cPat] = parse(current)
  const [lMaj, lMin, lPat] = parse(latest)

  if (lMaj > cMaj) return 'major'
  if (lMaj === cMaj && lMin > cMin) return 'minor'
  if (lMaj === cMaj && lMin === cMin && lPat > cPat) return 'patch'
  return 'none'
}

// ─── npm global path helpers ──────────────────────────────────────────────────

function getNpmGlobalRoot(): string {
  return execSync('npm root -g', { encoding: 'utf-8', stdio: 'pipe', windowsHide: true }).trim()
}

export function resolveNpmGlobalPrefixFromPackageJson(
  packageJsonPath: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const packageRoot = pathApi.dirname(packageJsonPath)
  const nodeModulesDir = pathApi.dirname(packageRoot)
  if (pathApi.basename(nodeModulesDir) !== 'node_modules') return null

  const parent = pathApi.dirname(nodeModulesDir)
  return pathApi.basename(parent) === 'lib' ? pathApi.dirname(parent) : parent
}

function getActiveNpmGlobalPrefix(): string | null {
  const packageJsonPath = findPackageJson()
  return packageJsonPath
    ? resolveNpmGlobalPrefixFromPackageJson(packageJsonPath)
    : null
}

function getGlobalBinScript(): string {
  const packageJsonPath = findPackageJson()
  if (packageJsonPath) {
    return path.join(path.dirname(packageJsonPath), 'dist', 'bin', 'shennian.js')
  }
  return path.join(getNpmGlobalRoot(), 'shennian', 'dist', 'bin', 'shennian.js')
}

// ─── Upgrade attempt tracking (crash detection) ───────────────────────────────

export function readUpgradeAttempt(): UpgradeAttempt | null {
  try {
    return JSON.parse(fs.readFileSync(UPGRADE_ATTEMPT_FILE, 'utf-8')) as UpgradeAttempt
  } catch {
    return null
  }
}

export function writeUpgradeAttempt(attempt: UpgradeAttempt): void {
  fs.mkdirSync(getShennianDir(), { recursive: true })
  fs.writeFileSync(UPGRADE_ATTEMPT_FILE, JSON.stringify(attempt, null, 2))
}

export function clearUpgradeAttempt(): void {
  try { fs.unlinkSync(UPGRADE_ATTEMPT_FILE) } catch { /* noop */ }
}

function getUpgradeFailuresFile(): string {
  return resolveShennianPath('upgrade-failures.json')
}

function getUpgradeLockFile(): string {
  return resolveShennianPath('upgrade.lock')
}

export type UpgradeLock = { release(): void }

export function acquireUpgradeLock(
  filePath = getUpgradeLockFile(),
  opts: {
    now?: number
    pid?: number
    isProcessAlive?: (pid: number) => boolean
  } = {},
): UpgradeLock {
  const now = opts.now ?? Date.now()
  const pid = opts.pid ?? process.pid
  const isProcessAlive = opts.isProcessAlive ?? ((candidate: number) => {
    try {
      process.kill(candidate, 0)
      return true
    } catch {
      return false
    }
  })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const create = (): number => fs.openSync(filePath, 'wx', 0o600)
  let fd: number
  try {
    fd = create()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let stale = false
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { pid?: unknown; createdAt?: unknown }
      const existingPid = Number(existing.pid)
      const createdAt = Number(existing.createdAt)
      stale = !Number.isInteger(existingPid)
        || !Number.isFinite(createdAt)
        || now - createdAt > UPGRADE_LOCK_STALE_MS
        || !isProcessAlive(existingPid)
    } catch {
      stale = true
    }
    if (!stale) throw new Error('Another Shennian upgrade is already running')
    fs.rmSync(filePath, { force: true })
    fd = create()
  }
  fs.writeFileSync(fd, JSON.stringify({ pid, createdAt: now }))
  fs.closeSync(fd)
  let released = false
  return {
    release() {
      if (released) return
      released = true
      try { fs.unlinkSync(filePath) } catch { /* noop */ }
    },
  }
}

export function readUpgradeFailures(filePath = getUpgradeFailuresFile()): UpgradeFailures {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as UpgradeFailures
    if (!parsed || typeof parsed !== 'object' || !parsed.versions) return { versions: {} }
    return { versions: parsed.versions }
  } catch {
    return { versions: {} }
  }
}

function writeUpgradeFailures(failures: UpgradeFailures): void {
  fs.mkdirSync(getShennianDir(), { recursive: true })
  fs.writeFileSync(getUpgradeFailuresFile(), JSON.stringify(failures, null, 2))
}

export function getUpgradeRetryDelayMs(failureCount: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(failureCount - 1, 0), RETRY_DELAYS_MS.length - 1)]
}

export function isUpgradeVersionInCooldown(
  version: string,
  now = Date.now(),
  failures = readUpgradeFailures(),
): boolean {
  const record = failures.versions[version]
  return Boolean(record && record.nextRetryAt > now)
}

export function recordUpgradeFailure(version: string, error: string, now = Date.now()): UpgradeFailureRecord {
  const failures = readUpgradeFailures()
  const previous = failures.versions[version]
  const failureCount = (previous?.failureCount ?? 0) + 1
  const record: UpgradeFailureRecord = {
    version,
    failureCount,
    firstFailedAt: previous?.firstFailedAt ?? now,
    lastFailedAt: now,
    nextRetryAt: now + getUpgradeRetryDelayMs(failureCount),
    error,
  }
  failures.versions[version] = record
  writeUpgradeFailures(failures)
  return record
}

export function clearUpgradeFailure(version: string): void {
  const failures = readUpgradeFailures()
  if (!failures.versions[version]) return
  delete failures.versions[version]
  writeUpgradeFailures(failures)
}

/**
 * Called on daemon startup. Detects crash loops from a failed upgrade and
 * requests an external rollback if crash count exceeds threshold.
 * Package replacement remains owned by the npm-package-independent Updater.
 */
export async function handleStartupCrashCheck(): Promise<UpgradeAttempt | null> {
  const attempt = readUpgradeAttempt()
  if (!attempt) return null

  const elapsed = Date.now() - attempt.attemptAt
  // If more than 10 minutes have passed, this is a stale record — clear and continue
  if (elapsed > 10 * 60 * 1000) {
    clearUpgradeAttempt()
    return null
  }

  attempt.attemptCount++

  if (attempt.attemptCount >= MAX_CRASH_COUNT) {
    writeUpgradeAttempt(attempt)
    return attempt
  }

  writeUpgradeAttempt(attempt)
  return null
}

// ─── Core upgrade ─────────────────────────────────────────────────────────────

export async function performUpgrade(
  targetVersion: string,
  onProgress: (p: UpgradeProgress) => void,
  opts: { currentVersion?: string } = {},
): Promise<UpgradeResult> {
  let lock: UpgradeLock
  try {
    lock = acquireUpgradeLock()
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    return await performUpgradeUnlocked(targetVersion, onProgress, opts)
  } finally {
    lock.release()
  }
}

async function performUpgradeUnlocked(
  targetVersion: string,
  onProgress: (p: UpgradeProgress) => void,
  opts: { currentVersion?: string } = {},
): Promise<UpgradeResult> {
  const currentVersion = opts.currentVersion ?? getCurrentVersion()
  const installedVersion = getCurrentVersion()

  if (currentVersion === targetVersion) {
    clearUpgradeFailure(targetVersion)
    return { ok: false, error: `Already on version ${targetVersion}` }
  }

  // Step 1: Verify npm is accessible
  onProgress({ step: 'checking' })
  try {
    execFileSync(npmExecutable(), ['--version'], { ...npmExecOptions(30_000), stdio: 'pipe' })
  } catch {
    return { ok: false, error: 'npm is not available in PATH' }
  }

  if (installedVersion === targetVersion) {
    onProgress({ step: 'verifying', version: targetVersion })
    try {
      await verifyInstalledVersion(targetVersion)
    } catch (err) {
      return {
        ok: false,
        error: `Smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    writeUpgradeAttempt({
      from: currentVersion,
      to: targetVersion,
      attemptCount: 0,
      attemptAt: Date.now(),
    })
    clearUpgradeFailure(targetVersion)
    onProgress({ step: 'restarting', from: currentVersion, to: targetVersion })
    return { ok: true, from: currentVersion, to: targetVersion }
  }

  // Step 2: Record the exact rollback version. Rollback is a complete npm
  // reinstall, not a partial dist/manifest copy.
  onProgress({ step: 'backing-up' })

  // Step 3: npm install new version
  onProgress({ step: 'installing', version: targetVersion })
  try {
    await installShennianVersion(targetVersion)
  } catch (err) {
    const rollback = await tryExactRollback(currentVersion)
    return {
      ok: false,
      error: `npm install failed: ${err instanceof Error ? err.message : String(err)}${rollback.ok ? '' : `; rollback failed: ${rollback.error}`}`,
      rolledBack: rollback.ok,
    }
  }

  // Step 4: Smoke test — verify the new binary works
  onProgress({ step: 'verifying', version: targetVersion })
  try {
    await verifyInstalledVersion(targetVersion)
  } catch (err) {
    const rollback = await tryExactRollback(currentVersion)
    return {
      ok: false,
      error: `Smoke test failed: ${err instanceof Error ? err.message : String(err)}${rollback.ok ? '' : `; rollback failed: ${rollback.error}`}`,
      rolledBack: rollback.ok,
    }
  }

  // Step 5: Write upgrade attempt file (crash detection on restart)
  writeUpgradeAttempt({
    from: currentVersion,
    to: targetVersion,
    attemptCount: 0,
    attemptAt: Date.now(),
  })

  clearUpgradeFailure(targetVersion)

  // Step 6: Signal restart (caller sends upgrade.status: restarting before killing)
  onProgress({ step: 'restarting', from: currentVersion, to: targetVersion })

  return { ok: true, from: currentVersion, to: targetVersion }
}

function assertNpmVersion(version: string): void {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid npm version: ${version}`)
  }
}

function npmExecutable(): string {
  return resolveNpmCommand()
}

export function npmExecOptionsForPlatform(
  platform: NodeJS.Platform,
  timeout: number,
): {
  timeout: number
  windowsHide: boolean
  shell: boolean
} {
  return {
    timeout,
    windowsHide: true,
    // Windows cannot execute .cmd shims directly through execFile on current
    // Node releases. Arguments are safe here because versions are validated
    // before this helper is reached and every other argument is static.
    shell: platform === 'win32',
  }
}

function npmExecOptions(timeout: number) {
  return npmExecOptionsForPlatform(process.platform, timeout)
}

export async function installShennianVersion(targetVersion: string): Promise<void> {
  assertNpmVersion(targetVersion)
  const prefix = getActiveNpmGlobalPrefix()
  const installArgs = [
    'install',
    '-g',
    `shennian@${targetVersion}`,
    ...(prefix ? ['--prefix', prefix] : []),
  ]
  try {
    await execFile(npmExecutable(), installArgs, npmExecOptions(120_000))
  } catch (error) {
    const firstMessage = error instanceof Error ? error.message : String(error)
    try {
      await execFile(npmExecutable(), [...installArgs, '--registry', NPM_REGISTRY_FALLBACK], {
        ...npmExecOptions(120_000),
      })
    } catch (fallbackError) {
      const secondMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      throw new Error(`${firstMessage}\n--- npmjs fallback ---\n${secondMessage}`)
    }
  }
}

export async function verifyInstalledVersion(targetVersion: string): Promise<void> {
  assertNpmVersion(targetVersion)
  const binScript = getGlobalBinScript()
  const { stdout } = await execFile(process.execPath, [binScript, '--version'], {
    timeout: 10_000,
    windowsHide: true,
  })
  if (stdout.trim() !== targetVersion) {
    throw new Error(`Version verification failed: expected ${targetVersion}, got ${stdout.trim() || 'empty output'}`)
  }
  const prefix = getActiveNpmGlobalPrefix()
  await execFile(npmExecutable(), [
    'ls',
    '-g',
    `shennian@${targetVersion}`,
    '--omit=dev',
    '--depth=0',
    ...(prefix ? ['--prefix', prefix] : []),
  ], {
    ...npmExecOptions(30_000),
  })
}

export async function rollbackToExactVersion(
  version: string,
  deps: {
    install?: (version: string) => Promise<void>
    verify?: (version: string) => Promise<void>
  } = {},
): Promise<void> {
  await (deps.install ?? installShennianVersion)(version)
  await (deps.verify ?? verifyInstalledVersion)(version)
}

async function tryExactRollback(version: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await rollbackToExactVersion(version)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Version check (for auto-upgrade scheduler) ───────────────────────────────

export type VersionCheckResult =
  | { hasUpdate: false }
  | { hasUpdate: true; current: string; latest: string; changeType: 'patch' | 'minor' | 'major' }

export async function checkForUpdate(currentVersion?: string): Promise<VersionCheckResult> {
  const current = currentVersion ?? getCurrentVersion()
  const latest = await fetchLatestVersion()
  const changeType = compareVersions(current, latest)
  if (changeType === 'none') return { hasUpdate: false }
  return { hasUpdate: true, current, latest, changeType }
}
