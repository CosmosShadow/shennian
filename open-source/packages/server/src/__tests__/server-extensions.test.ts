// @covers open-source/packages/server/src/core.ts
import { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
// No listener, Redis connection or real relay in this unit-level wiring check.
vi.mock('../middleware/security.js', () => ({ securityPlugin: async () => {} }))
vi.mock('../relay/index.js', () => ({ relayPlugin: async () => {} }))
import { buildApp } from '../core.js'

const apps: FastifyInstance[] = []
afterEach(async () => { await Promise.allSettled(apps.splice(0).map(app => app.close())); vi.unstubAllEnvs() })

describe('trusted server extension composition', () => {
  it('wires the real core factory without private modules', async () => {
    vi.stubEnv('SHENNIAN_DEPLOYMENT_MODE', 'official')
    const core = await buildApp(); apps.push(core)
    expect((await core.inject('/health')).json().status).toBe('ok')
    expect((await core.inject({ method: 'POST', url: '/billing/orders' })).json().error).toBe('module_unavailable')

  })
})
