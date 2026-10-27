// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-routes.test.ts
import type { FastifyInstance } from 'fastify'
/** Old clients receive a deterministic retirement response, never a shared feed
 * or another HTML snapshot. Historical database/OSS data is intentionally kept. */
export async function interactiveContentRoutes(app: FastifyInstance) {
  app.get('/capabilities', async () => ({ ready: false, imageGeneration: false, replacement: 'local-apps' }))
  app.all('/*', async (_request, reply) => reply.code(410).header('Cache-Control', 'no-store').send({ error: 'local_apps_moved' }))
}
