// @arch open-source/docs/server-runtime.md
// @test src/__tests__/acp-registry.test.ts

import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { AcpCatalogPlatform } from '@shennian/wire'
import { registerAuthDecorators, requireUserOrMachineAuth } from '../middleware/auth.js'
import {
  getAcpRegistrySnapshot,
  getPublicAcpAgentCatalog,
  recordAcpDaemonCatalogRevision,
} from '../services/acp-registry.js'

const PLATFORMS = new Set<AcpCatalogPlatform>([
  'darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64',
])

export const acpRegistryRoutes: FastifyPluginAsync = async (app) => {
  registerAuthDecorators(app)
  const publicCatalogHandler = async (_request: unknown, reply: FastifyReply) => {
    const catalog = await getPublicAcpAgentCatalog()
    if (!catalog) return reply.code(503).send({ error: 'acp_registry_unavailable' })
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
    return catalog
  }
  app.get('/public/acp-agents', publicCatalogHandler)
  app.get('/api/public/acp-agents', publicCatalogHandler)
  app.get<{ Querystring: { platform?: string } }>(
    '/api/acp/registry',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      recordAcpDaemonCatalogRevision(request.headers['x-shennian-acp-revision'])
      const platform = request.query.platform as AcpCatalogPlatform
      if (!PLATFORMS.has(platform)) return reply.code(400).send({ error: 'invalid_platform' })
      const snapshot = await getAcpRegistrySnapshot(platform)
      if (!snapshot) return reply.code(503).send({ error: 'acp_registry_unavailable' })
      reply.header('Cache-Control', 'private, max-age=300')
      return snapshot
    },
  )
}
