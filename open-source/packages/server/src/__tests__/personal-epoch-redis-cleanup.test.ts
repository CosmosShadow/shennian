// @covers src/services/personal-epoch-redis-cleanup.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { database, cache } = vi.hoisted(() => ({
  database: {
    personalEpochPurgeQueue: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
  cache: { scan: vi.fn(), del: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: database }))
vi.mock('../lib/redis.js', () => ({ redis: cache }))

import { purgeRetiredPersonalRedisState } from '../services/personal-epoch-redis-cleanup.js'

describe('personal epoch Redis cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database.personalEpochPurgeQueue.findMany
      .mockResolvedValueOnce([{ sessionId: 'personal-1' }])
      .mockResolvedValueOnce([])
    database.personalEpochPurgeQueue.deleteMany.mockResolvedValue({ count: 1 })
    cache.scan.mockResolvedValue(['0', ['sessionActivityClosedRun:personal-1:run-1']])
    cache.del.mockResolvedValue(2)
  })

  it('purges only captured personal ids and acknowledges after Redis succeeds', async () => {
    await expect(purgeRetiredPersonalRedisState()).resolves.toBe(1)
    expect(cache.del).toHaveBeenCalledWith(
      'sessionActivity:personal-1',
      'sessionActivityClosedRun:personal-1:run-1',
    )
    expect(database.personalEpochPurgeQueue.deleteMany).toHaveBeenCalledWith({
      where: { sessionId: { in: ['personal-1'] } },
    })
  })

  it('retains the durable queue when Redis cleanup fails', async () => {
    cache.del.mockRejectedValueOnce(new Error('redis unavailable'))
    await expect(purgeRetiredPersonalRedisState()).rejects.toThrow('redis unavailable')
    expect(database.personalEpochPurgeQueue.deleteMany).not.toHaveBeenCalled()
  })
})
