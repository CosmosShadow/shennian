// @covers open-source/packages/server/src/routes/interactive-content.ts
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { interactiveContentRoutes } from '../routes/interactive-content.js'
describe('retired shared HTML routes', () => {
  it('disables cloud generation and closes every shared/version/writing surface for old clients', async () => {
    const app = Fastify(); await app.register(interactiveContentRoutes, { prefix: '/api/interactive-content' })
    try {
      expect((await app.inject('/api/interactive-content/capabilities')).json()).toEqual({ ready: false, imageGeneration: false, replacement: 'local-apps' })
      for (const path of ['/feed', '/document/old?versionId=old', '/public/old', '/public/old/view', '/assets/old?token=old', '/collection']) {
        const response = await app.inject('/api/interactive-content' + path)
        expect(response.statusCode).toBe(410); expect(response.json()).toEqual({ error: 'local_apps_moved' })
      }
      for (const path of ['/turn', '/save', '/publish/old', '/context', '/assets']) expect((await app.inject({ method: 'POST', url: '/api/interactive-content' + path, payload: { text: 'private data' } })).statusCode).toBe(410)
    } finally { await app.close() }
  })
})
