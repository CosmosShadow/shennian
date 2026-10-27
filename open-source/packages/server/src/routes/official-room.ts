// @arch open-source/docs/server-runtime.md
// @test src/__tests__/official-room-routes.test.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { resolveOfficialRoom } from '../services/official-room.js'
import { roomInviteUrl } from '../services/public-web-url.js'

async function resolve(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store')
  try {
    const room = await resolveOfficialRoom()
    return {
      ...room,
      inviteUrl: roomInviteUrl(request, room.roomId, room.inviteToken),
    }
  } catch (error) {
    app.log.warn({ error }, 'Official Room resolution failed')
    return reply.code(503).send({ error: 'official_room_unavailable' })
  }
}

export async function officialRoomRoutes(app: FastifyInstance) {
  app.get('/public/official-room', (request, reply) => resolve(app, request, reply))
  app.get('/api/public/official-room', (request, reply) => resolve(app, request, reply))
  app.get('/join/official', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      const room = await resolveOfficialRoom()
      return reply.redirect(roomInviteUrl(request, room.roomId, room.inviteToken))
    } catch (error) {
      app.log.warn({ error }, 'Official Room redirect failed')
      return reply.code(503).send({ error: 'official_room_unavailable' })
    }
  })
}
