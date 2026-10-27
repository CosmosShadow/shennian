// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-model-quota.test.ts
import { randomUUID } from 'node:crypto'
import { redis } from '../lib/redis.js'

const DEFAULT_MONTHLY_LIMIT = 5_000_000
const OUTPUT_WEIGHT = 4
const MODEL_CONTEXT_LIMIT = 1_024_000
// One ledger per account/month; pending reservations count toward the hard limit.
// A crashed process leaves its reservation charged, rather than granting free retries.
const RESERVE = `
local used = tonumber(redis.call('HGET', KEYS[1], 'used') or '0')
local amount = tonumber(ARGV[2])
if used + amount > tonumber(ARGV[3]) then return -1 end
redis.call('HINCRBY', KEYS[1], 'used', amount)
redis.call('HSET', KEYS[1], ARGV[1], amount)
redis.call('EXPIREAT', KEYS[1], ARGV[4])
return used + amount`
const SETTLE = `
local reserved = redis.call('HGET', KEYS[1], ARGV[1])
if not reserved then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HINCRBY', KEYS[1], 'used', tonumber(ARGV[2]) - tonumber(reserved))
return 1`

export function personalModelQuotaPeriod(now = new Date()) {
  // Natural months in Asia/Shanghai, shared by all devices and credentials.
  const local = new Date(now.getTime() + 8 * 3600_000)
  const month = local.toISOString().slice(0, 7)
  const resetsAt = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 8 * 3600_000)
  return { month, resetsAt: resetsAt.toISOString(), expiresAt: Math.floor(resetsAt.getTime() / 1000) + 7 * 86400 }
}
export function personalModelMonthlyLimit() {
  const raw = Number(process.env.PERSONAL_MODEL_MONTHLY_ALLOWANCE)
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_LIMIT
}
const ledgerKey = (userId: string, month: string) => `personal-model:quota:${userId}:${month}`
export async function readPersonalModelQuota(userId: string, now = new Date()) {
  const period = personalModelQuotaPeriod(now), limit = personalModelMonthlyLimit()
  const used = Math.max(0, Number(await redis.hget(ledgerKey(userId, period.month), 'used')) || 0)
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: period.resetsAt, outputWeight: OUTPUT_WEIGHT }
}
export function personalModelReservationAmount(body: Record<string, unknown>) {
  const text = JSON.stringify(body)
  // UTF-8 bytes conservatively bound text tokens and include messages, schemas and
  // tool results. Image tokenization is provider-specific: reserve the full window.
  const hasImages = /"(?:image_url|input_image)"\s*[:,]/.test(text)
  const input = hasImages ? MODEL_CONTEXT_LIMIT : Math.min(MODEL_CONTEXT_LIMIT, Buffer.byteLength(text, 'utf8') + 64 * (Array.isArray(body.messages) ? body.messages.length : 1))
  const output = Number(body.max_tokens)
  if (!Number.isSafeInteger(output) || output <= 0 || output > 1_000_000) throw new Error('model_request_invalid')
  return input + OUTPUT_WEIGHT * output
}
export type PersonalQuotaReservation = { settle: (usage: { inputTokens: number; outputTokens: number } | null) => Promise<void> }
export async function reservePersonalModelQuota(userId: string, body: Record<string, unknown>, now = new Date()): Promise<PersonalQuotaReservation | null> {
  const period = personalModelQuotaPeriod(now), key = ledgerKey(userId, period.month), id = `pending:${randomUUID()}`
  const amount = personalModelReservationAmount(body)
  const result = Number(await redis.eval(RESERVE, 1, key, id, amount, personalModelMonthlyLimit(), period.expiresAt))
  if (result === -1) return null
  if (!Number.isSafeInteger(result) || result < amount) throw new Error('personal_model_quota_unavailable')
  return { settle: async usage => {
    const valid = usage && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    // Missing/invalid usage keeps the conservative reservation; no free disconnects.
    const actual = valid ? usage.inputTokens + OUTPUT_WEIGHT * usage.outputTokens : amount
    await redis.eval(SETTLE, 1, key, id, actual)
  } }
}
