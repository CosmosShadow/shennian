// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-avatar.test.ts

import type { FastifyInstance } from 'fastify'
import { readPublicAgentAvatar } from '../services/agent-avatar.js'
import { UserAvatarError } from '../services/user-avatar.js'

export async function agentAvatarRoutes(app: FastifyInstance) {
  app.get<{ Params: { agentId: string; version: string; size: string } }>(
    '/public/agent-avatars/:agentId/:version/:size',
    async (request, reply) => {
      try {
        const image = await readPublicAgentAvatar(request.params)
        return reply
          .header('content-type', 'image/webp')
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .send(image)
      } catch (error) {
        if (!(error instanceof UserAvatarError)) throw error
        return reply.code(error.statusCode).send({ error: error.code })
      }
    },
  )
}
