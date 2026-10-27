// @arch open-source/docs/server-runtime.md
// @test src/__tests__/anonymous-agent-rate-limit.test.ts

import crypto from 'node:crypto'
import { redis } from '../lib/redis.js'

const SCRIPT = `
local highest = 0
for i = 1, #KEYS do
  local current = redis.call('INCR', KEYS[i])
  if current == 1 then redis.call('EXPIRE', KEYS[i], ARGV[1]) end
  if current > highest then highest = current end
end
return highest
`

/** Anonymous creation and sends fail closed when shared rate limiting is unavailable. */
export async function consumeAnonymousAgentRateLimit(input: {
  publicId: string; ip: string; action: 'start' | 'send'; userId?: string
}): Promise<boolean> {
  const key = (kind: string, subject: string) =>
    `public-agent-anon:${input.action}:${crypto.createHash('sha256')
      .update(`${input.publicId}:${kind}:${subject}`).digest('hex')}`
  const keys = [key('ip', input.ip)]
  if (input.action === 'send') {
    if (!input.userId) return false
    keys.push(key('visitor', input.userId))
  }
  const windowSeconds = input.action === 'start' ? 600 : 60
  const limit = input.action === 'start' ? 5 : 12
  const count = await redis.eval(SCRIPT, keys.length, ...keys, windowSeconds)
  return typeof count === 'number' && count <= limit
}
