// @covers open-source/packages/server/src/services/distributed-lease.ts

import { describe, expect, it, vi } from 'vitest'
import { withDistributedLease, type DistributedLeaseClient } from '../services/distributed-lease.js'

describe('distributed worker lease', () => {
  it('runs only after acquiring and releases with the same opaque token', async () => {
    const client: DistributedLeaseClient = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    }
    const run = vi.fn().mockResolvedValue('done')

    await expect(withDistributedLease({
      name: 'maintenance',
      ttlMs: 60_000,
      run,
      client,
      redisRequired: true,
    })).resolves.toEqual({ acquired: true, result: 'done' })

    expect(run).toHaveBeenCalledOnce()
    expect(client.set).toHaveBeenCalledWith(
      'worker:lease:maintenance',
      expect.stringMatching(/^[a-f0-9]{32}$/),
      'PX',
      60_000,
      'NX',
    )
    const token = vi.mocked(client.set).mock.calls[0]![1]
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('del'"),
      1,
      'worker:lease:maintenance',
      token,
    )
  })

  it('does not run when another worker owns the lease', async () => {
    const client: DistributedLeaseClient = {
      set: vi.fn().mockResolvedValue(null),
      eval: vi.fn(),
    }
    const run = vi.fn()

    await expect(withDistributedLease({
      name: 'maintenance',
      ttlMs: 60_000,
      run,
      client,
      redisRequired: true,
    })).resolves.toEqual({ acquired: false })
    expect(run).not.toHaveBeenCalled()
    expect(client.eval).not.toHaveBeenCalled()
  })

  it('keeps local development usable when Redis is not configured', async () => {
    const run = vi.fn().mockResolvedValue(7)
    await expect(withDistributedLease({
      name: 'maintenance',
      ttlMs: 60_000,
      run,
      redisRequired: false,
    })).resolves.toEqual({ acquired: true, result: 7 })
  })
})
