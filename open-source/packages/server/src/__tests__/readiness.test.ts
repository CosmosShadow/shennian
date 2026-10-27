// @covers open-source/packages/server/src/routes/health.ts

import { describe, expect, it, vi } from 'vitest'
import { checkServerReadiness } from '../routes/health.js'

describe('server readiness', () => {
  it('requires both MySQL and configured Redis', async () => {
    await expect(checkServerReadiness({
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      redisRequired: true,
      redisReady: () => true,
    })).resolves.toEqual({ ready: true, database: true, redis: true })

    await expect(checkServerReadiness({
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      redisRequired: true,
      redisReady: () => false,
    })).resolves.toEqual({ ready: false, database: true, redis: false })
  })

  it('reports database failure without exposing the error', async () => {
    const result = await checkServerReadiness({
      databaseCheck: vi.fn().mockRejectedValue(new Error('private database detail')),
      redisRequired: false,
      redisReady: () => false,
    })
    expect(result).toEqual({ ready: false, database: false, redis: true })
    expect(JSON.stringify(result)).not.toContain('private database detail')
  })
})
