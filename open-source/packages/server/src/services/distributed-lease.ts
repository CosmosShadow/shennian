// @arch open-source/docs/server-runtime.md
// @test src/__tests__/distributed-lease.test.ts

import { randomBytes } from 'node:crypto'
import { redis } from '../lib/redis.js'

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`

export type DistributedLeaseClient = {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<'OK' | null>
  eval(script: string, keyCount: number, key: string, ...args: string[]): Promise<unknown>
}

export type DistributedLeaseResult<T> =
  | { acquired: false }
  | { acquired: true; result: T }

export async function withDistributedLease<T>(input: {
  name: string
  ttlMs: number
  run: () => Promise<T>
  client?: DistributedLeaseClient
  redisRequired?: boolean
}): Promise<DistributedLeaseResult<T>> {
  const redisRequired = input.redisRequired ?? Boolean(process.env.REDIS_URL)
  if (!redisRequired) return { acquired: true, result: await input.run() }

  const client = input.client ?? redis
  const key = `worker:lease:${input.name}`
  const token = randomBytes(16).toString('hex')
  const acquired = await client.set(key, token, 'PX', input.ttlMs, 'NX')
  if (acquired !== 'OK') return { acquired: false }

  let leaseLost = false
  const renewEveryMs = Math.max(1_000, Math.floor(input.ttlMs / 3))
  const renewTimer = setInterval(() => {
    void client.eval(RENEW_SCRIPT, 1, key, token, String(input.ttlMs))
      .then((renewed) => {
        if (Number(renewed) !== 1) leaseLost = true
      })
      .catch(() => {
        leaseLost = true
      })
  }, renewEveryMs)
  renewTimer.unref?.()

  try {
    const result = await input.run()
    if (leaseLost) throw new Error(`Distributed lease lost: ${input.name}`)
    return { acquired: true, result }
  } finally {
    clearInterval(renewTimer)
    await client.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined)
  }
}
