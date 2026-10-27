// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-ownership.test.ts

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { redis } from '../lib/redis.js'

const DEFAULT_LEASE_MS = 45_000

const ACQUIRE_SCRIPT = `
local generation = redis.call('INCR', KEYS[2])
local previous = redis.call('HMGET', KEYS[1], 'instanceId', 'connectionId', 'generation', 'leaseUntil')
local leaseUntil = tonumber(ARGV[3]) + tonumber(ARGV[4])
redis.call('HSET', KEYS[1],
  'instanceId', ARGV[1], 'connectionId', ARGV[2],
  'generation', generation, 'leaseUntil', leaseUntil)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return { tostring(generation), tostring(leaseUntil), previous[1] or '', previous[2] or '', previous[3] or '', previous[4] or '' }
`

const RENEW_SCRIPT = `
local current = redis.call('HMGET', KEYS[1], 'instanceId', 'connectionId', 'generation')
if current[1] ~= ARGV[1] or current[2] ~= ARGV[2] or current[3] ~= ARGV[3] then return { 0 } end
local leaseUntil = tonumber(ARGV[4]) + tonumber(ARGV[5])
redis.call('HSET', KEYS[1], 'leaseUntil', leaseUntil)
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return { 1, tostring(leaseUntil) }
`

const RELEASE_SCRIPT = `
local current = redis.call('HMGET', KEYS[1], 'instanceId', 'connectionId', 'generation')
if current[1] ~= ARGV[1] or current[2] ~= ARGV[2] or current[3] ~= ARGV[3] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`

export type MachineOwnership = {
  machineId: string
  instanceId: string
  connectionId: string
  generation: number
  leaseUntil: number
}

export type MachineOwnershipAcquire = {
  ownership: MachineOwnership
  previous: MachineOwnership | null
}

export type MachineReplacementEvent = {
  version: 1
  type: 'machine.connection.replaced'
  machineId: string
  connectionId: string
  generation: number
}

type RedisEval = {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>
  hgetall(key: string): Promise<Record<string, string>>
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function ownerKey(machineId: string): string {
  return `machine:${machineId}:ownership`
}

function generationKey(machineId: string): string {
  return `machine:${machineId}:ownership:generation`
}

function tuple(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '')) : []
}

export class MachineOwnershipStore {
  readonly enabled: boolean

  constructor(
    private readonly client: RedisEval = redis,
    readonly instanceId = process.env.INSTANCE_ID?.trim() || hostname(),
    readonly leaseMs = positiveInteger(process.env.MACHINE_OWNERSHIP_LEASE_MS, DEFAULT_LEASE_MS),
    enabled = Boolean(process.env.REDIS_URL),
  ) {
    this.enabled = enabled
  }

  newConnectionId(): string {
    return randomUUID()
  }

  async acquire(machineId: string, connectionId: string, now = Date.now()): Promise<MachineOwnershipAcquire> {
    if (!this.enabled) {
      return {
        ownership: { machineId, instanceId: this.instanceId, connectionId, generation: 1, leaseUntil: now + this.leaseMs },
        previous: null,
      }
    }
    const result = tuple(await this.client.eval(
      ACQUIRE_SCRIPT,
      2,
      ownerKey(machineId),
      generationKey(machineId),
      this.instanceId,
      connectionId,
      now,
      this.leaseMs,
    ))
    const generation = Number(result[0])
    const leaseUntil = Number(result[1])
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isFinite(leaseUntil)) {
      throw new Error('Invalid machine ownership acquire response')
    }
    const previousGeneration = Number(result[4])
    return {
      ownership: { machineId, instanceId: this.instanceId, connectionId, generation, leaseUntil },
      previous: result[2] && result[3] && Number.isSafeInteger(previousGeneration)
        ? {
            machineId,
            instanceId: result[2],
            connectionId: result[3],
            generation: previousGeneration,
            leaseUntil: Number(result[5]) || 0,
          }
        : null,
    }
  }

  async renew(ownership: MachineOwnership, now = Date.now()): Promise<boolean> {
    if (!this.enabled) return true
    const result = tuple(await this.client.eval(
      RENEW_SCRIPT,
      1,
      ownerKey(ownership.machineId),
      ownership.instanceId,
      ownership.connectionId,
      ownership.generation,
      now,
      this.leaseMs,
    ))
    if (result[0] !== '1') return false
    ownership.leaseUntil = Number(result[1])
    return true
  }

  async release(ownership: MachineOwnership): Promise<boolean> {
    if (!this.enabled) return true
    const result = await this.client.eval(
      RELEASE_SCRIPT,
      1,
      ownerKey(ownership.machineId),
      ownership.instanceId,
      ownership.connectionId,
      ownership.generation,
    )
    return Number(result) === 1
  }

  async read(machineId: string): Promise<MachineOwnership | null> {
    if (!this.enabled) return null
    const current = await this.client.hgetall(ownerKey(machineId))
    const generation = Number(current.generation)
    const leaseUntil = Number(current.leaseUntil)
    if (!current.instanceId || !current.connectionId || !Number.isSafeInteger(generation) || leaseUntil <= Date.now()) {
      return null
    }
    return { machineId, instanceId: current.instanceId, connectionId: current.connectionId, generation, leaseUntil }
  }
}

export function shouldCloseForMachineReplacement(
  ownership: MachineOwnership,
  event: MachineReplacementEvent,
): boolean {
  return event.machineId === ownership.machineId &&
    event.connectionId !== ownership.connectionId &&
    event.generation > ownership.generation
}

export async function finalizeMachineOwnershipClose(
  store: Pick<MachineOwnershipStore, 'release'>,
  ownership: MachineOwnership,
  isCurrentLocalConnection: boolean,
  onAuthoritativeClose: () => Promise<void>,
): Promise<boolean> {
  const released = await store.release(ownership)
  if (!released || !isCurrentLocalConnection) return false
  await onAuthoritativeClose()
  return true
}

export const machineOwnership = new MachineOwnershipStore()
