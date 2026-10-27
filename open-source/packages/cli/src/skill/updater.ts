// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/skill-updater.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'

export const OFFICIAL_SKILL_MANIFEST_URL = 'https://shennian.net/skill-manifest.json'
export const OFFICIAL_SKILL_URL = 'https://shennian.net/skill.md'
export const SKILL_CHECK_INTERVAL_MS = 24 * 60 * 60_000

type SkillManifest = {
  schemaVersion: 1
  product: 'shennian'
  skill: {
    name: 'shennian'
    version: string
    url: typeof OFFICIAL_SKILL_URL
    sha256: string
    minimumClientVersion: string
    maximumClientVersion: string | null
  }
  previousSkills?: Array<{ version: string; sha256: string }>
}

type SkillRecord = {
  path: string
  version: string
  sha256: string
  lastCheckedAt: number
  lastStatus: SkillUpdateStatus
  clientVersion?: string
}

type SkillRegistry = {
  schemaVersion: 1
  targets: Record<string, SkillRecord>
  checks: Record<string, {
    sha256: string
    version: string
    lastCheckedAt: number
    lastStatus: SkillUpdateStatus
    remoteVersion?: string
    clientVersion?: string
  }>
}

export type SkillUpdateStatus =
  | 'registered'
  | 'current'
  | 'updated'
  | 'check_failed'
  | 'local_modified'
  | 'manual_update_required'
  | 'client_incompatible'
  | 'remote_older'
  | 'not_writable'

export type SkillUpdateResult = {
  status: SkillUpdateStatus
  path: string
  localVersion: string
  remoteVersion?: string
  checked: boolean
  nextCheckAt?: number
  message: string
  officialUrl?: typeof OFFICIAL_SKILL_URL
  manualCommand?: string
}

type SkillUpdateOptions = {
  clientVersion: string
  fetchImpl?: typeof fetch
  registryPath?: string
  now?: number
  forceCheck?: boolean
  replace?: boolean
}

export async function updateOfficialSkill(
  targetPath: string,
  options: SkillUpdateOptions,
): Promise<SkillUpdateResult> {
  const resolvedPath = validateTargetPath(targetPath)
  const local = readSkillFile(resolvedPath)
  const registryPath = options.registryPath ?? resolveShennianPath('skill-updates.json')
  const registry = readRegistry(registryPath)
  const record = registry.targets[resolvedPath]
  const previousCheck = registry.checks[resolvedPath]
  const now = options.now ?? Date.now()
  const manualCommand = manualUpdateCommand(resolvedPath)

  if (record && local.sha256 !== record.sha256 && !options.replace) {
    return localProtectionResult('local_modified', resolvedPath, local.version, manualCommand)
  }
  if (
    previousCheck &&
    previousCheck.sha256 === local.sha256 &&
    previousCheck.clientVersion === options.clientVersion &&
    !options.forceCheck &&
    !options.replace &&
    now - previousCheck.lastCheckedAt < SKILL_CHECK_INTERVAL_MS
  ) {
    return {
      status: previousCheck.lastStatus,
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: previousCheck.remoteVersion,
      checked: false,
      nextCheckAt: previousCheck.lastCheckedAt + SKILL_CHECK_INTERVAL_MS,
      message: 'The previous official Skill check is still fresh; the local file was not changed.',
      ...(previousCheck.lastStatus === 'current' || previousCheck.lastStatus === 'registered'
        ? {}
        : { officialUrl: OFFICIAL_SKILL_URL, manualCommand }),
    }
  }
  if (
    record &&
    record.clientVersion === options.clientVersion &&
    !options.forceCheck &&
    !options.replace &&
    now - record.lastCheckedAt < SKILL_CHECK_INTERVAL_MS
  ) {
    return {
      status: record.lastStatus === 'updated' ? 'current' : record.lastStatus,
      path: resolvedPath,
      localVersion: local.version,
      checked: false,
      nextCheckAt: record.lastCheckedAt + SKILL_CHECK_INTERVAL_MS,
      message: record.lastStatus === 'check_failed'
        ? 'The previous official Skill check failed; continuing with the registered local copy.'
        : 'Official Skill check is still fresh; using the registered local copy.',
    }
  }

  let manifest: SkillManifest
  try {
    manifest = await fetchManifest(options.fetchImpl ?? fetch)
  } catch {
    if (record) {
      record.lastCheckedAt = now
      record.lastStatus = 'check_failed'
      record.clientVersion = options.clientVersion
    } else rememberCheck(registry, resolvedPath, local, now, 'check_failed', options.clientVersion)
    writeRegistry(registryPath, registry)
    return {
      status: 'check_failed',
      path: resolvedPath,
      localVersion: local.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'Could not verify the official Skill manifest; continuing with the local copy.',
      officialUrl: OFFICIAL_SKILL_URL,
    }
  }

  if (!clientSupports(options.clientVersion, manifest.skill)) {
    rememberCheck(
      registry,
      resolvedPath,
      local,
      now,
      'client_incompatible',
      options.clientVersion,
      manifest.skill.version,
    )
    writeRegistry(registryPath, registry)
    return {
      status: 'client_incompatible',
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'The official Skill is not compatible with this Shennian Client version.',
      officialUrl: OFFICIAL_SKILL_URL,
      manualCommand,
    }
  }

  // Web and CLI releases are independent. A newer installed Plugin/Skill must
  // never be replaced by an older public Skill during an intervening rollout.
  if (compareSemver(local.version, manifest.skill.version) > 0) {
    if (record) {
      record.lastCheckedAt = now
      record.lastStatus = 'remote_older'
      record.clientVersion = options.clientVersion
    } else rememberCheck(registry, resolvedPath, local, now, 'remote_older',
      options.clientVersion, manifest.skill.version)
    writeRegistry(registryPath, registry)
    return {
      status: 'remote_older',
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'The public official Skill is older than this local copy; it was not replaced.',
    }
  }

  if (!record && local.sha256 === manifest.skill.sha256) {
    registry.targets[resolvedPath] = {
      path: resolvedPath,
      version: local.version,
      sha256: local.sha256,
      lastCheckedAt: now,
      lastStatus: 'registered',
      clientVersion: options.clientVersion,
    }
    writeRegistry(registryPath, registry)
    return {
      status: 'registered',
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'Registered this exact official Skill copy for future safe updates.',
    }
  }

  const verifiedPrevious = manifest.previousSkills?.some(previous =>
    previous.version === local.version && previous.sha256 === local.sha256,
  ) ?? false
  if (!record && !verifiedPrevious && !options.replace) {
    rememberCheck(
      registry,
      resolvedPath,
      local,
      now,
      'manual_update_required',
      options.clientVersion,
      manifest.skill.version,
    )
    writeRegistry(registryPath, registry)
    return localProtectionResult(
      'manual_update_required',
      resolvedPath,
      local.version,
      manualCommand,
      manifest.skill.version,
    )
  }
  if (record && local.sha256 !== record.sha256 && !options.replace) {
    return localProtectionResult(
      'local_modified',
      resolvedPath,
      local.version,
      manualCommand,
      manifest.skill.version,
    )
  }
  if (local.sha256 === manifest.skill.sha256) {
    registry.targets[resolvedPath] = {
      path: resolvedPath,
      version: local.version,
      sha256: local.sha256,
      lastCheckedAt: now,
      lastStatus: 'current',
      clientVersion: options.clientVersion,
    }
    writeRegistry(registryPath, registry)
    return {
      status: 'current',
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'The registered official Skill is current.',
    }
  }

  if (!isWritableRegularFile(resolvedPath)) {
    return {
      ...localProtectionResult(
        'not_writable',
        resolvedPath,
        local.version,
        manualCommand,
        manifest.skill.version,
      ),
      message: 'The Skill file is read-only or not a regular file; use the host update mechanism.',
    }
  }

  let candidate: Buffer
  try {
    candidate = await fetchSkill(options.fetchImpl ?? fetch, manifest)
  } catch {
    if (record) {
      record.lastCheckedAt = now
      record.lastStatus = 'check_failed'
      record.clientVersion = options.clientVersion
    } else rememberCheck(registry, resolvedPath, local, now, 'check_failed', options.clientVersion, manifest.skill.version)
    writeRegistry(registryPath, registry)
    return {
      status: 'check_failed',
      path: resolvedPath,
      localVersion: local.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
      message: 'Could not verify the official Skill file; continuing with the local copy.',
      officialUrl: OFFICIAL_SKILL_URL,
    }
  }

  atomicReplace(resolvedPath, candidate)
  registry.targets[resolvedPath] = {
    path: resolvedPath,
    version: manifest.skill.version,
    sha256: manifest.skill.sha256,
    lastCheckedAt: now,
    lastStatus: 'updated',
    clientVersion: options.clientVersion,
  }
  writeRegistry(registryPath, registry)
  return {
    status: 'updated',
    path: resolvedPath,
    localVersion: manifest.skill.version,
    remoteVersion: manifest.skill.version,
    checked: true,
    nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
    message: 'Updated the verified official Skill atomically. Re-read this file now; start a new AI host session if it caches Skills.',
  }
}

export type SkillInstallResult = Omit<SkillUpdateResult, 'status'> & {
  status: SkillUpdateStatus | 'installed'
}

/**
 * Setup writes a verified official copy into a host's Skill directory. A missing
 * target is created and registered; any existing file keeps the update rules above,
 * so a person's own edits are never overwritten.
 */
export async function installOfficialSkill(
  targetPath: string,
  options: SkillUpdateOptions,
): Promise<SkillInstallResult> {
  const resolvedPath = validateTargetPath(targetPath)
  if (pathExists(resolvedPath)) return updateOfficialSkill(resolvedPath, { ...options, forceCheck: true })
  const fetchImpl = options.fetchImpl ?? fetch
  const manifest = await fetchManifest(fetchImpl)
  if (!clientSupports(options.clientVersion, manifest.skill)) {
    return {
      status: 'client_incompatible',
      path: resolvedPath,
      localVersion: manifest.skill.version,
      remoteVersion: manifest.skill.version,
      checked: true,
      message: 'The official Skill is not compatible with this Shennian Client version.',
      officialUrl: OFFICIAL_SKILL_URL,
    }
  }
  const candidate = await fetchSkill(fetchImpl, manifest)
  const directory = path.dirname(resolvedPath)
  fs.mkdirSync(directory, { recursive: true })
  const temporary = path.join(directory, `.SKILL.md.shennian-${process.pid}-${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, candidate, { flag: 'wx', mode: 0o644 })
    fs.renameSync(temporary, resolvedPath)
  } finally {
    try { fs.unlinkSync(temporary) } catch { /* renamed */ }
  }
  const now = options.now ?? Date.now()
  const registryPath = options.registryPath ?? resolveShennianPath('skill-updates.json')
  const registry = readRegistry(registryPath)
  registry.targets[resolvedPath] = {
    path: resolvedPath,
    version: manifest.skill.version,
    sha256: manifest.skill.sha256,
    lastCheckedAt: now,
    lastStatus: 'registered',
    clientVersion: options.clientVersion,
  }
  delete registry.checks[resolvedPath]
  writeRegistry(registryPath, registry)
  return {
    status: 'installed',
    path: resolvedPath,
    localVersion: manifest.skill.version,
    remoteVersion: manifest.skill.version,
    checked: true,
    nextCheckAt: now + SKILL_CHECK_INTERVAL_MS,
    message: 'Installed the verified official Skill.',
  }
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath)
    return true
  } catch {
    return false
  }
}

function validateTargetPath(value: string): string {
  if (!path.isAbsolute(value)) throw new Error('skill_path_must_be_absolute')
  const resolved = path.resolve(value)
  if (path.basename(resolved) !== 'SKILL.md') throw new Error('skill_path_must_name_SKILL.md')
  return resolved
}

function readSkillFile(filePath: string): { version: string; sha256: string } {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('skill_path_must_be_regular_file')
  const content = fs.readFileSync(filePath)
  const metadata = parseSkillMetadata(content.toString('utf8'))
  return { version: metadata.version, sha256: sha256(content) }
}

function parseSkillMetadata(content: string): { version: string } {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1]
  if (!header || !/^name:\s*shennian\s*$/m.test(header)) throw new Error('not_official_shennian_skill')
  const version = /^version:\s*([^\s]+)\s*$/m.exec(header)?.[1]
  if (!version || !isSemver(version)) throw new Error('invalid_skill_version')
  return { version }
}

async function fetchManifest(fetchImpl: typeof fetch): Promise<SkillManifest> {
  const response = await fetchImpl(OFFICIAL_SKILL_MANIFEST_URL, {
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('skill_manifest_unavailable')
  const value = await response.json() as Partial<SkillManifest>
  const skill = value.skill
  if (
    value.schemaVersion !== 1 ||
    value.product !== 'shennian' ||
    !skill ||
    skill.name !== 'shennian' ||
    skill.url !== OFFICIAL_SKILL_URL ||
    !isSemver(skill.version) ||
    !isSemver(skill.minimumClientVersion) ||
    (skill.maximumClientVersion !== null && !isSemver(skill.maximumClientVersion)) ||
    !/^[a-f0-9]{64}$/.test(skill.sha256 ?? '') ||
    (value.previousSkills !== undefined && (
      !Array.isArray(value.previousSkills) ||
      value.previousSkills.length > 32 ||
      value.previousSkills.some(previous =>
        !previous || !isSemver(previous.version) || !/^[a-f0-9]{64}$/.test(previous.sha256),
      )
    ))
  ) throw new Error('invalid_skill_manifest')
  return value as SkillManifest
}

async function fetchSkill(fetchImpl: typeof fetch, manifest: SkillManifest): Promise<Buffer> {
  const response = await fetchImpl(OFFICIAL_SKILL_URL, {
    redirect: 'error',
    headers: { Accept: 'text/markdown' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('skill_download_unavailable')
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > 512_000) throw new Error('skill_too_large')
  const candidate = Buffer.from(await response.arrayBuffer())
  if (candidate.length === 0 || candidate.length > 512_000) throw new Error('skill_too_large')
  if (sha256(candidate) !== manifest.skill.sha256) throw new Error('skill_integrity_mismatch')
  if (parseSkillMetadata(candidate.toString('utf8')).version !== manifest.skill.version) {
    throw new Error('skill_version_mismatch')
  }
  return candidate
}

function clientSupports(clientVersion: string, skill: SkillManifest['skill']): boolean {
  if (!isSemver(clientVersion)) return false
  if (compareSemver(clientVersion, skill.minimumClientVersion) < 0) return false
  return skill.maximumClientVersion === null || compareSemver(clientVersion, skill.maximumClientVersion) <= 0
}

function isWritableRegularFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) return false
    fs.accessSync(filePath, fs.constants.W_OK)
    fs.accessSync(path.dirname(filePath), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function atomicReplace(filePath: string, content: Buffer): void {
  const directory = path.dirname(filePath)
  const mode = fs.statSync(filePath).mode & 0o777
  const temporary = path.join(directory, `.SKILL.md.shennian-${process.pid}-${crypto.randomUUID()}.tmp`)
  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(temporary, 'wx', mode)
    fs.writeFileSync(descriptor, content)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.renameSync(temporary, filePath)
    try {
      const directoryDescriptor = fs.openSync(directory, 'r')
      fs.fsyncSync(directoryDescriptor)
      fs.closeSync(directoryDescriptor)
    } catch { /* Windows and some file systems do not fsync directories. */ }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
    try { fs.unlinkSync(temporary) } catch { /* rename or cleanup already completed */ }
  }
}

function readRegistry(filePath: string): SkillRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SkillRegistry
    if (parsed.schemaVersion === 1 && parsed.targets && typeof parsed.targets === 'object') {
      return {
        schemaVersion: 1,
        targets: parsed.targets,
        checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
      }
    }
  } catch { /* missing or invalid registries fail closed to an empty registry */ }
  return { schemaVersion: 1, targets: {}, checks: {} }
}

function writeRegistry(filePath: string, registry: SkillRegistry): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
  try { fs.chmodSync(filePath, 0o600) } catch { /* best effort on Windows */ }
}

function localProtectionResult(
  status: Extract<SkillUpdateStatus, 'local_modified' | 'manual_update_required' | 'not_writable'>,
  filePath: string,
  localVersion: string,
  manualCommand: string,
  remoteVersion?: string,
): SkillUpdateResult {
  return {
    status,
    path: filePath,
    localVersion,
    remoteVersion,
    checked: true,
    message: status === 'local_modified'
      ? 'The local Skill differs from its registered official copy; it was not overwritten.'
      : 'This local Skill copy is not registered as the current official file; it was not overwritten.',
    officialUrl: OFFICIAL_SKILL_URL,
    manualCommand,
  }
}

function rememberCheck(
  registry: SkillRegistry,
  filePath: string,
  local: { version: string; sha256: string },
  lastCheckedAt: number,
  lastStatus: SkillUpdateStatus,
  clientVersion: string,
  remoteVersion?: string,
): void {
  registry.checks[filePath] = {
    sha256: local.sha256,
    version: local.version,
    lastCheckedAt,
    lastStatus,
    clientVersion,
    remoteVersion,
  }
}

function manualUpdateCommand(filePath: string): string {
  if (process.platform === 'win32') return `shennian skill update --path ${JSON.stringify(filePath)} --replace --json`
  return `shennian skill update --path '${filePath.replaceAll("'", "'\\''")}' --replace --json`
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
}

function compareSemver(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}
