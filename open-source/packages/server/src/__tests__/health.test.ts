import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { buildApp } from '../app.js'

// Health is a unit-level Fastify inject check, not a live Redis probe.
beforeEach(() => vi.stubEnv('REDIS_URL', ''))
afterEach(() => vi.unstubAllEnvs())

describe('buildApp', () => {
  it('creates a Fastify instance', async () => {
    const app = await buildApp()
    expect(app).toBeDefined()
    expect(app.server).toBeDefined()
    await app.close()
  })
})

describe('GET /health', () => {
  it('returns status ok with timestamp', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.payload)
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('number')

    await app.close()
  }, 15_000)
})
