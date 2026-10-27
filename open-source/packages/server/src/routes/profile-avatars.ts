// @arch open-source/docs/server-runtime.md
// @test src/__tests__/profile-avatar-routes.test.ts

import type { FastifyInstance } from 'fastify'
import { readPublicUserAvatar, UserAvatarError } from '../services/user-avatar.js'

export async function profileAvatarRoutes(app: FastifyInstance) {
  app.get<{ Params: { userId: string; version: string; size: string } }>(
    '/public/profile-avatars/:userId/:version/:size',
    async (request, reply) => {
      try {
        const image = await readPublicUserAvatar(request.params)
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
