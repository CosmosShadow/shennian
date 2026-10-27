// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/machine-connection-rate-limit.test.ts

export type MachineConnectionRateLimitDecision =
  | {
      allowed: true
      key: string
      attempts: number
      resetAt: number
    }
  | {
      allowed: false
      key: string
      attempts: number
      resetAt: number
      retryAfterMs: number
    }

type Bucket = {
  attempts: number
  resetAt: number
  lastSeenAt: number
}

export type MachineConnectionRateLimitConfig = {
  windowMs: number
  maxAttempts: number
}

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 20
const BUCKET_TTL_MS = 5 * 60_000

const buckets = new Map<string, Bucket>()
let lastSweepAt = 0

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getMachineConnectionRateLimitConfig(): MachineConnectionRateLimitConfig {
  return {
    windowMs: readPositiveInteger(process.env.MACHINE_CONNECT_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    maxAttempts: readPositiveInteger(process.env.MACHINE_CONNECT_RATE_LIMIT_MAX, DEFAULT_MAX_ATTEMPTS),
  }
}

function normalizeIp(ip: string | undefined): string {
  return ip?.trim() || 'unknown'
}

export function buildMachineConnectionRateLimitKey(machineId: string, ip: string | undefined): string {
  return `${machineId}:${normalizeIp(ip)}`
}

function sweepExpiredBuckets(now: number): void {
  if (now - lastSweepAt < DEFAULT_WINDOW_MS) return
  lastSweepAt = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now || now - bucket.lastSeenAt > BUCKET_TTL_MS) {
      buckets.delete(key)
    }
  }
}

export function checkMachineConnectionRateLimit(
  machineId: string,
  ip: string | undefined,
  now = Date.now(),
  config = getMachineConnectionRateLimitConfig(),
): MachineConnectionRateLimitDecision {
  sweepExpiredBuckets(now)

  const key = buildMachineConnectionRateLimitKey(machineId, ip)
  const existing = buckets.get(key)
  const bucket = !existing || existing.resetAt <= now
    ? { attempts: 0, resetAt: now + config.windowMs, lastSeenAt: now }
    : existing

  bucket.attempts += 1
  bucket.lastSeenAt = now
  buckets.set(key, bucket)

  if (bucket.attempts > config.maxAttempts) {
    return {
      allowed: false,
      key,
      attempts: bucket.attempts,
      resetAt: bucket.resetAt,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    }
  }

  return {
    allowed: true,
    key,
    attempts: bucket.attempts,
    resetAt: bucket.resetAt,
  }
}

export function resetMachineConnectionRateLimitForTest(): void {
  buckets.clear()
  lastSweepAt = 0
}
