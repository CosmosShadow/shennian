// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/custom-managed-runtime.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import type {
  ManagedAgentRuntimePlatform,
  ManagedAgentRuntimeSecurityDeclaration,
} from '../security/managed-agent-runtime.js'
import type { CustomAgentEntry } from '../config/index.js'
import { parseCommandString } from './command-spec.js'
import { unregisterManagedAgentRuntimeSecurity } from '../security/managed-agent-runtime.js'
import type { CustomAgentType } from '@shennian/wire'

export const CUSTOM_RUNTIME_CONFORMANCE_SUITE_VERSION = '1'
export const CUSTOM_RUNTIME_POLICY_ENV = 'SHENNIAN_MANAGED_AGENT_POLICY_FILE'

const CUSTOM_MANAGED_CONFIG_PREFIX = 'shennian-custom-managed-'
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type CustomRuntimeSecurityAssessment =
  | {
      /** Structurally valid self-declaration; never a Shennian trust verdict. */
      state: 'declared'
      declaration: ManagedAgentRuntimeSecurityDeclaration
      executablePath: string
      executableSha256: string
    }
  | {
      state: 'unverified'
      reason:
        | 'declaration_missing'
        | 'declaration_invalid'
        | 'runtime_version_mismatch'
        | 'platform_mismatch'
        | 'conformance_not_passed'
        | 'conformance_suite_unsupported'
        | 'executable_unavailable'
        | 'executable_not_bound_to_command'
        | 'executable_fingerprint_mismatch'
    }

export type CustomManagedPolicyFile = {
  directory: string
  policyPath: string
}

/**
 * Validates the owner-supplied Custom Runtime attestation against local facts.
 * The result may be used for capability reporting, but the digest is checked
 * again immediately before every managed process launch.
 */
export function assessCustomRuntimeSecurity(
  entry: CustomAgentEntry,
  platform: ManagedAgentRuntimePlatform = currentManagedPlatform(),
): CustomRuntimeSecurityAssessment {
  const security = entry.caps.security
  if (!security) return { state: 'unverified', reason: 'declaration_missing' }
  if (
    security.schemaVersion !== 1 ||
    security.declarationVersion !== 1 ||
    security.policyProtocol !== 'shennian-managed-policy-file-v1' ||
    typeof security.runtimeVersion !== 'string' ||
    !security.runtimeVersion.trim() ||
    typeof security.executablePath !== 'string' ||
    !security.executablePath.trim() ||
    typeof security.executableSha256 !== 'string' ||
    !security.runtimeSecurity ||
    !security.runtimeSecurity.platforms ||
    typeof security.runtimeSecurity.platforms !== 'object' ||
    !security.conformance ||
    typeof security.conformance.testedAt !== 'string' ||
    Number.isNaN(Date.parse(security.conformance.testedAt))
  ) {
    return { state: 'unverified', reason: 'declaration_invalid' }
  }
  if (!entry.caps.version || entry.caps.version.trim() !== security.runtimeVersion.trim()) {
    return { state: 'unverified', reason: 'runtime_version_mismatch' }
  }
  if (security.runtimeSecurity.minimumRuntimeVersion !== security.runtimeVersion.trim()) {
    return { state: 'unverified', reason: 'runtime_version_mismatch' }
  }
  if (security.conformance.platform !== platform) {
    return { state: 'unverified', reason: 'platform_mismatch' }
  }
  if (security.conformance.status !== 'passed') {
    return { state: 'unverified', reason: 'conformance_not_passed' }
  }
  if (security.conformance.suiteVersion !== CUSTOM_RUNTIME_CONFORMANCE_SUITE_VERSION) {
    return { state: 'unverified', reason: 'conformance_suite_unsupported' }
  }
  if (!isSecurityProfile(security.runtimeSecurity.platforms[platform])) {
    return { state: 'unverified', reason: 'declaration_invalid' }
  }

  let executablePath: string
  try {
    executablePath = resolveDeclaredExecutable(security.executablePath)
  } catch {
    return { state: 'unverified', reason: 'executable_unavailable' }
  }
  if (!commandReferencesExecutable(entry.command, executablePath)) {
    return { state: 'unverified', reason: 'executable_not_bound_to_command' }
  }

  const declaredDigest = security.executableSha256.trim().toLowerCase()
  if (!SHA256_PATTERN.test(declaredDigest)) {
    return { state: 'unverified', reason: 'declaration_invalid' }
  }
  const actualDigest = sha256File(executablePath)
  if (!safeDigestEqual(actualDigest, declaredDigest)) {
    return { state: 'unverified', reason: 'executable_fingerprint_mismatch' }
  }

  return {
    state: 'declared',
    declaration: security.runtimeSecurity,
    executablePath,
    executableSha256: actualDigest,
  }
}

function isSecurityProfile(
  value: ManagedAgentRuntimeSecurityDeclaration['platforms'][ManagedAgentRuntimePlatform],
): boolean {
  if (!value || (value.level !== 'hard' && value.level !== 'partial')) return false
  const files = value.fileAccess
  if (
    !files ||
    typeof files['workspace-read'] !== 'boolean' ||
    typeof files['workspace-write'] !== 'boolean' ||
    typeof files['host-full'] !== 'boolean'
  ) return false
  const external = value.externalCapabilities
  if (!external) return false
  for (const capability of ['commandNetwork', 'webSearch', 'browser', 'computerUse', 'mcp'] as const) {
    const support = external[capability]
    if (!support || typeof support.allow !== 'boolean' || typeof support.deny !== 'boolean') {
      return false
    }
  }
  return true
}

export function registerCustomRuntimeSecurity(
  agentType: CustomAgentType,
  entry: CustomAgentEntry,
): CustomRuntimeSecurityAssessment {
  const assessment = assessCustomRuntimeSecurity(entry)
  // A Custom Runtime controls its own /caps response. Until Shennian ships a
  // signed conformance authority, self-declared evidence must never elevate a
  // Runtime from unverified to partial/hard protection.
  unregisterManagedAgentRuntimeSecurity(agentType)
  return assessment
}

export function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/**
 * Produces a confirmation identity for every Custom Runtime. The digest binds
 * the exact command string and every locally resolvable file participating in
 * launch; it is never a digest of command text alone. The separate attestation
 * decides whether the runtime is verified, not what identity the user accepts.
 */
export function resolveCustomRuntimeExecutableFingerprint(
  entry: CustomAgentEntry,
): string | undefined {
  const files = parseCommandString(entry.command)
    .map((part, index) => index === 0 || !part.startsWith('-') ? resolveCommandPart(part) : null)
    .filter((value): value is string => Boolean(value))
  if (files.length === 0) return undefined

  const digest = crypto.createHash('sha256')
  digest.update(entry.command)
  for (const filePath of [...new Set(files)]) {
    digest.update('\0')
    digest.update(filePath)
    digest.update('\0')
    digest.update(fs.readFileSync(filePath))
  }
  return `sha256:${digest.digest('hex')}`
}

export async function createCustomManagedPolicyFile(
  compiled: CompiledManagedAgentPolicy,
): Promise<CustomManagedPolicyFile> {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), CUSTOM_MANAGED_CONFIG_PREFIX))
  const policyPath = path.join(directory, 'managed-policy.json')
  try {
    await fsPromises.chmod(directory, 0o700)
    await fsPromises.writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        policyVersion: compiled.requestedPolicy.version,
        requestedPolicy: compiled.requestedPolicy,
        resolvedWorkDir: compiled.adapterPolicy.workDir,
        enforcement: compiled.enforcement,
        adapterPolicy: compiled.adapterPolicy,
        environmentPolicy: compiled.environmentPolicy,
      })}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    )
    if (process.platform !== 'win32') await fsPromises.chmod(policyPath, 0o600)
    return { directory, policyPath }
  } catch (error) {
    await disposeCustomManagedPolicyFile(directory).catch(() => {})
    throw new Error('custom_managed_policy_initialization_failed', { cause: error })
  }
}

export async function disposeCustomManagedPolicyFile(directory: string): Promise<void> {
  const resolved = path.resolve(directory)
  const tempRoot = path.resolve(os.tmpdir())
  if (
    path.dirname(resolved) !== tempRoot ||
    !path.basename(resolved).startsWith(CUSTOM_MANAGED_CONFIG_PREFIX)
  ) {
    throw new Error('custom_managed_policy_cleanup_refused')
  }
  await fsPromises.rm(resolved, { recursive: true, force: true })
}

function resolveDeclaredExecutable(value: string): string {
  if (!path.isAbsolute(value)) throw new Error('custom_managed_executable_not_absolute')
  const realPath = fs.realpathSync(path.normalize(value))
  if (!fs.statSync(realPath).isFile()) throw new Error('custom_managed_executable_not_file')
  return path.normalize(realPath)
}

function commandReferencesExecutable(command: string, executablePath: string): boolean {
  const parts = parseCommandString(command)
  if (parts.length === 0) return false
  for (const [index, part] of parts.entries()) {
    if (index > 0 && part.startsWith('-')) continue
    const resolved = resolveCommandPart(part)
    if (resolved === executablePath) return true
  }
  return false
}

function resolveCommandPart(value: string): string | null {
  const candidates = path.isAbsolute(value)
    ? [value]
    : value.includes(path.sep) || (process.platform === 'win32' && value.includes('/'))
      ? [path.resolve(value)]
      : executableSearchCandidates(value)
  for (const candidate of candidates) {
    try {
      const realPath = fs.realpathSync(candidate)
      if (fs.statSync(realPath).isFile()) return path.normalize(realPath)
    } catch {
      // Continue through the deterministic candidate list.
    }
  }
  return null
}

function executableSearchCandidates(command: string): string[] {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : ['']
  return pathEntries.flatMap((directory) =>
    extensions.map((extension) => path.join(directory, `${command}${extension}`)),
  )
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function currentManagedPlatform(): ManagedAgentRuntimePlatform {
  if (process.platform === 'linux' && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)) {
    return 'wsl'
  }
  if (
    process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
  ) {
    return process.platform
  }
  return 'unsupported'
}
