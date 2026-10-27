// @arch open-source/docs/server-runtime.md
// @test src/__tests__/client-connection-leases.test.ts

import { randomUUID } from 'crypto'
import { redis } from '../lib/redis.js'

const DEFAULT_MAX_CLIENTS_PER_MACHINE = 50
const DEFAULT_LEASE_TTL_MS = 90_000

type RedisEval = {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>
}

export type ClientConnectionLease = {
  readonly id: string
  readonly machineId: string
  renew(): Promise<boolean>
  release(): Promise<void>
}

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local lease_id = ARGV[1]
local now_ms = tonumber(ARGV[2])
local expires_at = tonumber(ARGV[3])
local max_clients = tonumber(ARGV[4])
local key_ttl_ms = tonumber(ARGV[5])

local entries = redis.call('HGETALL', key)
local active = 0
for i = 1, #entries, 2 do
  local member = entries[i]
  local member_expires_at = tonumber(entries[i + 1]) or 0
  if member_expires_at <= now_ms then
    redis.call('HDEL', key, member)
  elseif member == lease_id then
    redis.call('HSET', key, lease_id, expires_at)
    redis.call('PEXPIRE', key, key_ttl_ms)
    return 1
  else
    active = active + 1
  end
end

if active >= max_clients then
  return 0
end

redis.call('HSET', key, lease_id, expires_at)
redis.call('PEXPIRE', key, key_ttl_ms)
return 1
`

const RENEW_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  return 0
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`

const RELEASE_SCRIPT = `
return redis.call('HDEL', KEYS[1], ARGV[1])
`

function leaseKey(machineId: string): string {
  return `relay:client-leases:${machineId}`
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return Number.NaN
}

export class ClientConnectionLeaseStore {
  private readonly localLeases = new Map<string, Set<string>>()

  constructor(
    private readonly client: RedisEval = redis,
    private readonly redisConfigured = Boolean(process.env.REDIS_URL),
    private readonly maxClientsPerMachine = DEFAULT_MAX_CLIENTS_PER_MACHINE,
    private readonly ttlMs = DEFAULT_LEASE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get renewIntervalMs(): number {
    return Math.max(1_000, Math.floor(this.ttlMs / 3))
  }

  async acquire(machineId: string): Promise<ClientConnectionLease | null> {
    const leaseId = randomUUID()
    if (!this.redisConfigured) {
      const leases = this.localLeases.get(machineId) ?? new Set<string>()
      if (leases.size >= this.maxClientsPerMachine) return null
      leases.add(leaseId)
      this.localLeases.set(machineId, leases)
      return this.createLease(machineId, leaseId)
    }

    const now = this.now()
    try {
      const acquired = asNumber(
        await this.client.eval(
          ACQUIRE_SCRIPT,
          1,
          leaseKey(machineId),
          leaseId,
          now,
          now + this.ttlMs,
          this.maxClientsPerMachine,
          this.ttlMs * 2,
        ),
      )
      return acquired === 1 ? this.createLease(machineId, leaseId) : null
    } catch {
      // Redis-backed limits must fail closed: accepting locally would let two
      // Server instances independently exceed the global machine limit.
      return null
    }
  }

  private createLease(machineId: string, leaseId: string): ClientConnectionLease {
    let released = false
    return {
      id: leaseId,
      machineId,
      renew: async () => {
        if (released) return false
        if (!this.redisConfigured) {
          return this.localLeases.get(machineId)?.has(leaseId) === true
        }
        try {
          const renewed = asNumber(
            await this.client.eval(
              RENEW_SCRIPT,
              1,
              leaseKey(machineId),
              leaseId,
              this.now() + this.ttlMs,
              this.ttlMs * 2,
            ),
          )
          return renewed === 1
        } catch {
          return false
        }
      },
      release: async () => {
        if (released) return
        released = true
        if (!this.redisConfigured) {
          const leases = this.localLeases.get(machineId)
          leases?.delete(leaseId)
          if (leases?.size === 0) this.localLeases.delete(machineId)
          return
        }
        try {
          await this.client.eval(RELEASE_SCRIPT, 1, leaseKey(machineId), leaseId)
        } catch {
          // The field and its enclosing key both have TTLs, so a failed release
          // self-heals. Releases are best-effort during disconnect cleanup.
        }
      },
    }
  }
}

export const clientConnectionLeases = new ClientConnectionLeaseStore()
