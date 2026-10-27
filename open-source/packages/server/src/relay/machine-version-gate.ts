// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/machine-version-gate.test.ts

import { SESSION_SYNC_RELEASE_GATE } from '@shennian/wire'

export const MIN_MACHINE_CLI_VERSION = SESSION_SYNC_RELEASE_GATE.minCliVersion

export type MachineVersionDecision =
  | { allowed: true; version: string }
  | { allowed: false; version: string | null; minVersion: string; reason: string }

export type MachineVersionQuarantineDecision =
  | { quarantined: false; key: string; attempts: number; resetAt: number }
  | { quarantined: true; key: string; attempts: number; resetAt: number; quarantinedUntil: number; retryAfterMs: number }

type VersionBlockBucket = {
  attempts: number
  resetAt: number
  quarantinedUntil: number
  lastSeenAt: number
}

export type MachineVersionQuarantineConfig = {
  windowMs: number
  maxAttempts: number
  quarantineMs: number
}

const DEFAULT_VERSION_BLOCK_WINDOW_MS = 60_000
const DEFAULT_VERSION_BLOCK_MAX_ATTEMPTS = 3
const DEFAULT_VERSION_QUARANTINE_MS = 6 * 60 * 60_000
const VERSION_BUCKET_TTL_MS = DEFAULT_VERSION_QUARANTINE_MS + 10 * 60_000

const versionBlockBuckets = new Map<string, VersionBlockBucket>()
let lastVersionBucketSweepAt = 0

function parseSemver(version: string | null | undefined): [number, number, number] | null {
  if (!version) return null
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getMachineVersionQuarantineConfig(): MachineVersionQuarantineConfig {
  return {
    windowMs: readPositiveInteger(process.env.MACHINE_VERSION_BLOCK_WINDOW_MS, DEFAULT_VERSION_BLOCK_WINDOW_MS),
    maxAttempts: readPositiveInteger(process.env.MACHINE_VERSION_BLOCK_MAX, DEFAULT_VERSION_BLOCK_MAX_ATTEMPTS),
    quarantineMs: readPositiveInteger(process.env.MACHINE_VERSION_QUARANTINE_MS, DEFAULT_VERSION_QUARANTINE_MS),
  }
}

function normalizeIp(ip: string | undefined): string {
  return ip?.trim() || 'unknown'
}

export function buildMachineVersionQuarantineKey(machineId: string, ip: string | undefined): string {
  return `${machineId}:${normalizeIp(ip)}`
}

function sweepExpiredVersionBuckets(now: number): void {
  if (now - lastVersionBucketSweepAt < DEFAULT_VERSION_BLOCK_WINDOW_MS) return
  lastVersionBucketSweepAt = now
  for (const [key, bucket] of versionBlockBuckets) {
    if (bucket.quarantinedUntil <= now && (bucket.resetAt <= now || now - bucket.lastSeenAt > VERSION_BUCKET_TTL_MS)) {
      versionBlockBuckets.delete(key)
    }
  }
}

export function checkMachineVersionQuarantine(
  machineId: string,
  ip: string | undefined,
  now = Date.now(),
): MachineVersionQuarantineDecision {
  sweepExpiredVersionBuckets(now)
  const key = buildMachineVersionQuarantineKey(machineId, ip)
  const bucket = versionBlockBuckets.get(key)
  if (!bucket || bucket.quarantinedUntil <= now) {
    return {
      quarantined: false,
      key,
      attempts: bucket?.attempts ?? 0,
      resetAt: bucket?.resetAt ?? now,
    }
  }
  bucket.lastSeenAt = now
  return {
    quarantined: true,
    key,
    attempts: bucket.attempts,
    resetAt: bucket.resetAt,
    quarantinedUntil: bucket.quarantinedUntil,
    retryAfterMs: bucket.quarantinedUntil - now,
  }
}

export function clearMachineVersionQuarantine(
  machineId: string,
  ip: string | undefined,
): void {
  versionBlockBuckets.delete(buildMachineVersionQuarantineKey(machineId, ip))
}

export function recordMachineVersionBlock(
  machineId: string,
  ip: string | undefined,
  now = Date.now(),
  config = getMachineVersionQuarantineConfig(),
): MachineVersionQuarantineDecision {
  sweepExpiredVersionBuckets(now)
  const key = buildMachineVersionQuarantineKey(machineId, ip)
  const existing = versionBlockBuckets.get(key)
  const bucket = !existing || existing.resetAt <= now
    ? { attempts: 0, resetAt: now + config.windowMs, quarantinedUntil: 0, lastSeenAt: now }
    : existing

  bucket.attempts += 1
  bucket.lastSeenAt = now
  if (bucket.attempts >= config.maxAttempts) {
    bucket.quarantinedUntil = Math.max(bucket.quarantinedUntil, now + config.quarantineMs)
  }
  versionBlockBuckets.set(key, bucket)

  if (bucket.quarantinedUntil > now) {
    return {
      quarantined: true,
      key,
      attempts: bucket.attempts,
      resetAt: bucket.resetAt,
      quarantinedUntil: bucket.quarantinedUntil,
      retryAfterMs: bucket.quarantinedUntil - now,
    }
  }

  return {
    quarantined: false,
    key,
    attempts: bucket.attempts,
    resetAt: bucket.resetAt,
  }
}

export function resetMachineVersionQuarantineForTest(): void {
  versionBlockBuckets.clear()
  lastVersionBucketSweepAt = 0
}

export function checkMachineCliVersion(
  version: string | null | undefined,
  minVersion: string = MIN_MACHINE_CLI_VERSION,
): MachineVersionDecision {
  const parsedVersion = parseSemver(version)
  const parsedMinVersion = parseSemver(minVersion)
  if (!parsedMinVersion) {
    throw new Error(`Invalid minimum CLI version: ${minVersion}`)
  }

  if (!parsedVersion) {
    return {
      allowed: false,
      version: version ?? null,
      minVersion,
      reason: 'missing-or-invalid-cli-version',
    }
  }

  if (compareSemver(parsedVersion, parsedMinVersion) < 0) {
    return {
      allowed: false,
      version: version ?? null,
      minVersion,
      reason: 'cli-version-too-old',
    }
  }

  return { allowed: true, version: version?.trim() ?? minVersion }
}
