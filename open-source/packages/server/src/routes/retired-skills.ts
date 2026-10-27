// @arch open-source/docs/server-runtime.md
// @test src/__tests__/retired-skills-routes.test.ts

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

export const retiredSkillRoutes: FastifyPluginAsync = async (app) => {
  const retired = async (_request: FastifyRequest, reply: FastifyReply) => (
    reply.code(410).send({ error: 'feature_retired', replacement: 'agent.capabilities.list' })
  )
  app.get('/', retired)
  app.get('/*', retired)
}
