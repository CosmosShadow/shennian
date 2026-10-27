// @covers open-source/packages/server/src/routes/retired-skills.ts

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { retiredSkillRoutes } from '../routes/retired-skills.js'

describe('retired Shennian Skill routes', () => {
  it('gives old clients a stable retirement response without serving bundles', async () => {
    const app = Fastify()
    await app.register(retiredSkillRoutes, { prefix: '/skills' })
    const catalog = await app.inject({ method: 'GET', url: '/skills' })
    const bundle = await app.inject({ method: 'GET', url: '/skills/legacy/bundle' })
    expect(catalog.statusCode).toBe(410)
    expect(catalog.json()).toEqual({ error: 'feature_retired', replacement: 'agent.capabilities.list' })
    expect(bundle.statusCode).toBe(410)
    await app.close()
  })
})
