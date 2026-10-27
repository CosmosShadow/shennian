// @covers src/routes/retired-external-channels.ts
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retiredExternalChannelRoutes } from '../routes/retired-external-channels.js'

describe('retired external channel compatibility routes', () => {
  let app = Fastify()

  beforeEach(async () => {
    app = Fastify()
    await app.register(retiredExternalChannelRoutes, { prefix: '/integrations/wecom' })
    await app.register(retiredExternalChannelRoutes, { prefix: '/integrations/feishu' })
    await app.register(retiredExternalChannelRoutes, { prefix: '/channels/wechat' })
    await app.ready()
  })

  afterEach(async () => app.close())

  it.each([
    ['POST', '/integrations/wecom/bind'],
    ['DELETE', '/integrations/feishu/accounts/legacy'],
    ['GET', '/channels/wechat/status'],
  ])('returns a stable retirement response for %s %s', async (method, url) => {
    const response = await app.inject({ method, url })

    expect(response.statusCode).toBe(410)
    expect(response.json()).toEqual(expect.objectContaining({ error: 'feature_retired' }))
  })
})
