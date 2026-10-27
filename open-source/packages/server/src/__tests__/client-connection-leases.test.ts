// @covers src/relay/client-connection-leases.ts

import { describe, expect, it } from 'vitest'
import { ClientConnectionLeaseStore } from '../relay/client-connection-leases.js'

class FakeRedis {
  readonly leases = new Map<string, Map<string, number>>()
  fail = false

  async eval(script: string, _keys: number, key: string, ...args: Array<string | number>) {
    if (this.fail) throw new Error('redis unavailable')
    const values = this.leases.get(key) ?? new Map<string, number>()
    this.leases.set(key, values)

    if (script.includes('HGETALL')) {
      const [leaseId, nowValue, expiresValue, maxValue] = args
      const now = Number(nowValue)
      for (const [id, expiresAt] of values) {
        if (expiresAt <= now) values.delete(id)
      }
      if (values.has(String(leaseId))) {
        values.set(String(leaseId), Number(expiresValue))
        return 1
      }
      if (values.size >= Number(maxValue)) return 0
      values.set(String(leaseId), Number(expiresValue))
      return 1
    }

    if (script.includes('HEXISTS')) {
      const [leaseId, expiresValue] = args
      if (!values.has(String(leaseId))) return 0
      values.set(String(leaseId), Number(expiresValue))
      return 1
    }

    const [leaseId] = args
    return values.delete(String(leaseId)) ? 1 : 0
  }
}

describe('ClientConnectionLeaseStore', () => {
  it('enforces one shared limit across Server instances', async () => {
    const redis = new FakeRedis()
    const firstServer = new ClientConnectionLeaseStore(redis, true, 2, 90_000)
    const secondServer = new ClientConnectionLeaseStore(redis, true, 2, 90_000)

    const first = await firstServer.acquire('machine-1')
    const second = await secondServer.acquire('machine-1')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(await firstServer.acquire('machine-1')).toBeNull()

    await first?.release()
    expect(await secondServer.acquire('machine-1')).not.toBeNull()
  })

  it('caps the production default at 50 clients across two Servers', async () => {
    const redis = new FakeRedis()
    const firstServer = new ClientConnectionLeaseStore(redis, true)
    const secondServer = new ClientConnectionLeaseStore(redis, true)

    for (let index = 0; index < 50; index += 1) {
      const server = index % 2 === 0 ? firstServer : secondServer
      expect(await server.acquire('machine-1')).not.toBeNull()
    }
    expect(await firstServer.acquire('machine-1')).toBeNull()
    expect(await secondServer.acquire('machine-1')).toBeNull()
    expect(await firstServer.acquire('machine-2')).not.toBeNull()
  })

  it('reconciles expired leases before enforcing the limit', async () => {
    let now = 1_000
    const redis = new FakeRedis()
    const store = new ClientConnectionLeaseStore(redis, true, 1, 100, () => now)
    expect(await store.acquire('machine-1')).not.toBeNull()
    expect(await store.acquire('machine-1')).toBeNull()

    now = 1_101
    expect(await store.acquire('machine-1')).not.toBeNull()
  })

  it('renews active leases and releases idempotently', async () => {
    let now = 1_000
    const redis = new FakeRedis()
    const store = new ClientConnectionLeaseStore(redis, true, 1, 100, () => now)
    const lease = await store.acquire('machine-1')
    expect(lease).not.toBeNull()

    now = 1_050
    expect(await lease?.renew()).toBe(true)
    now = 1_120
    expect(await store.acquire('machine-1')).toBeNull()
    await lease?.release()
    await lease?.release()
    expect(await store.acquire('machine-1')).not.toBeNull()
  })

  it('fails closed when configured Redis is unavailable', async () => {
    const redis = new FakeRedis()
    redis.fail = true
    const store = new ClientConnectionLeaseStore(redis, true)
    expect(await store.acquire('machine-1')).toBeNull()
  })

  it('keeps the single-server local fallback when Redis is not configured', async () => {
    const store = new ClientConnectionLeaseStore(new FakeRedis(), false, 1)
    const lease = await store.acquire('machine-1')
    expect(lease).not.toBeNull()
    expect(await store.acquire('machine-1')).toBeNull()
    await lease?.release()
    expect(await store.acquire('machine-1')).not.toBeNull()
  })
})
