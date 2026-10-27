// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-quota.test.ts
import { redis } from '../../lib/redis.js'
import { ContentError } from './repository.js'

// Platform-sponsored beta caps, not an undisclosed debit of users' existing credits.
export const CONTENT_QUOTA_SCRIPT = `
local a = tonumber(redis.call('get', KEYS[1]) or '0')
local b = tonumber(redis.call('get', KEYS[2]) or '0')
if a >= tonumber(ARGV[1]) or b >= tonumber(ARGV[2]) then return 0 end
redis.call('incr', KEYS[1]); redis.call('expire', KEYS[1], 172800)
redis.call('incr', KEYS[2]); redis.call('expire', KEYS[2], 172800)
return 1
`
export async function consumeContentQuota(actorId: string, kind: 'turn' | 'job' | 'image' | 'asset' | 'vision') {
  if (!process.env.REDIS_URL) throw new ContentError('quota_store_unavailable', 503)
  const defaults = { vision: [10, 80], asset: [20, 200], turn: [60, 1500], job: [10, 150], image: [12, 100] }
  const [defaultLimit, globalLimit] = defaults[kind]!
  // Explicit, bounded QA allowance: never resets counters or increases the platform cap.
  const requested = Number(process.env.INTERACTIVE_CONTENT_TEST_JOB_LIMIT)
  const testLimit = Number.isInteger(requested) && requested >= 10 && requested <= 30 ? requested : defaultLimit
  const userLimit = kind === 'job' && actorId === process.env.INTERACTIVE_CONTENT_TEST_USER_ID
    ? testLimit : defaultLimit
  const day = new Date().toISOString().slice(0, 10)
  const result = await redis.eval(CONTENT_QUOTA_SCRIPT, 2, `content:quota:${day}:${kind}:${actorId}`,
    `content:quota:${day}:${kind}:global`, String(userLimit), String(globalLimit))
  if (Number(result) !== 1) throw new ContentError('content_daily_limit', 429)
}
export function requireContentEnabled() {
  if (process.env.INTERACTIVE_CONTENT_ENABLED !== '1') throw new ContentError('content_not_enabled', 503)
}

export function contentActorAllowed(actorId: string) {
  const allowed = (process.env.INTERACTIVE_CONTENT_ALLOWED_USERS || '').split(',').map((value) => value.trim()).filter(Boolean)
  return allowed.includes('*') || allowed.includes(actorId)
}
