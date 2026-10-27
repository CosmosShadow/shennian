// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/machine-ownership.ts

import { describe, expect, it, vi } from 'vitest'
import {
  finalizeMachineOwnershipClose,
  MachineOwnershipStore,
  shouldCloseForMachineReplacement,
} from '../relay/machine-ownership.js'

type Owner = { instanceId: string; connectionId: string; generation: number; leaseUntil: number }

class FakeAtomicRedis {
  private readonly owners = new Map<string, Owner>()
  private readonly generations = new Map<string, number>()

  async eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const keys = args.slice(0, numberOfKeys).map(String)
    const values = args.slice(numberOfKeys).map(String)
    const ownerKey = keys[0]
    if (script.includes("redis.call('INCR'")) {
      const generationKey = keys[1]
      const generation = (this.generations.get(generationKey) ?? 0) + 1
      this.generations.set(generationKey, generation)
      const previous = this.owners.get(ownerKey)
      const leaseUntil = Number(values[2]) + Number(values[3])
      this.owners.set(ownerKey, {
        instanceId: values[0], connectionId: values[1], generation, leaseUntil,
      })
      return [
        String(generation), String(leaseUntil), previous?.instanceId ?? '',
        previous?.connectionId ?? '', String(previous?.generation ?? ''),
        String(previous?.leaseUntil ?? ''),
      ]
    }
    const current = this.owners.get(ownerKey)
    const matches = current?.instanceId === values[0] &&
      current.connectionId === values[1] && String(current.generation) === values[2]
    if (script.includes("redis.call('DEL'")) {
      if (!matches) return 0
      this.owners.delete(ownerKey)
      return 1
    }
    if (!matches) return [0]
    current.leaseUntil = Number(values[3]) + Number(values[4])
    return [1, String(current.leaseUntil)]
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const owner = this.owners.get(key)
    return owner ? Object.fromEntries(Object.entries(owner).map(([name, value]) => [name, String(value)])) : {}
  }
}

describe('MachineOwnershipStore', () => {
  it('atomically gives concurrent acquirers increasing generations and keeps one owner', async () => {
    const redis = new FakeAtomicRedis()
    const firstStore = new MachineOwnershipStore(redis, 'server-1', 45_000, true)
    const secondStore = new MachineOwnershipStore(redis, 'server-2', 45_000, true)
    const now = Date.now()

    const [first, second] = await Promise.all([
      firstStore.acquire('machine-1', 'connection-1', now),
      secondStore.acquire('machine-1', 'connection-2', now + 1),
    ])

    expect(first.ownership.generation).toBe(1)
    expect(second.ownership.generation).toBe(2)
    expect(second.previous).toMatchObject({
      instanceId: 'server-1', connectionId: 'connection-1', generation: 1,
    })
    await expect(firstStore.read('machine-1')).resolves.toMatchObject({
      instanceId: 'server-2', connectionId: 'connection-2', generation: 2,
    })
  })

  it('rejects renew and release from an old generation', async () => {
    const redis = new FakeAtomicRedis()
    const oldStore = new MachineOwnershipStore(redis, 'server-1', 45_000, true)
    const newStore = new MachineOwnershipStore(redis, 'server-2', 45_000, true)
    const old = (await oldStore.acquire('machine-1', 'connection-1', 1_000)).ownership
    const current = (await newStore.acquire('machine-1', 'connection-2', 1_001)).ownership

    await expect(oldStore.renew(old, 2_000)).resolves.toBe(false)
    await expect(oldStore.release(old)).resolves.toBe(false)
    await expect(newStore.renew(current, 2_000)).resolves.toBe(true)
    await expect(newStore.release(current)).resolves.toBe(true)
  })

  it('does not run offline cleanup when an old socket loses ownership', async () => {
    const redis = new FakeAtomicRedis()
    const oldStore = new MachineOwnershipStore(redis, 'server-1', 45_000, true)
    const newStore = new MachineOwnershipStore(redis, 'server-2', 45_000, true)
    const old = (await oldStore.acquire('machine-1', 'connection-1')).ownership
    const current = (await newStore.acquire('machine-1', 'connection-2')).ownership
    const markOffline = vi.fn(async () => {})

    await expect(finalizeMachineOwnershipClose(oldStore, old, true, markOffline)).resolves.toBe(false)
    expect(markOffline).not.toHaveBeenCalled()
    await expect(finalizeMachineOwnershipClose(newStore, current, true, markOffline)).resolves.toBe(true)
    expect(markOffline).toHaveBeenCalledOnce()
  })

  it('closes only the superseded connection for a replacement event', async () => {
    const redis = new FakeAtomicRedis()
    const firstStore = new MachineOwnershipStore(redis, 'server-1', 45_000, true)
    const secondStore = new MachineOwnershipStore(redis, 'server-2', 45_000, true)
    const first = (await firstStore.acquire('machine-1', 'connection-1')).ownership
    const second = (await secondStore.acquire('machine-1', 'connection-2')).ownership
    const event = {
      version: 1 as const,
      type: 'machine.connection.replaced' as const,
      machineId: 'machine-1',
      connectionId: second.connectionId,
      generation: second.generation,
    }

    expect(shouldCloseForMachineReplacement(first, event)).toBe(true)
    expect(shouldCloseForMachineReplacement(second, event)).toBe(false)
  })

  it('keeps single-instance development operational without Redis', async () => {
    const store = new MachineOwnershipStore(new FakeAtomicRedis(), 'local', 45_000, false)
    const ownership = (await store.acquire('machine-1', 'connection-1', 1_000)).ownership

    expect(ownership).toMatchObject({ instanceId: 'local', connectionId: 'connection-1', generation: 1 })
    await expect(store.renew(ownership, 2_000)).resolves.toBe(true)
    await expect(store.release(ownership)).resolves.toBe(true)
  })

  it('fails closed instead of inventing local ownership when configured Redis is unavailable', async () => {
    const unavailable = {
      eval: vi.fn(async () => { throw new Error('redis unavailable') }),
      hgetall: vi.fn(async () => { throw new Error('redis unavailable') }),
    }
    const store = new MachineOwnershipStore(unavailable, 'server-1', 45_000, true)

    await expect(store.acquire('machine-1', 'connection-1')).rejects.toThrow('redis unavailable')
  })
})
