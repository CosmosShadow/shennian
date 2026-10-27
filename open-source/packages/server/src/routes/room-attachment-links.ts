// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-attachment-link.test.ts

import type { FastifyInstance } from 'fastify'
import { redeemRoomAttachmentLink } from '../services/room-attachment-link.js'

export async function roomAttachmentLinkRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/a/:token', async (request, reply) => {
    try {
      const result = await redeemRoomAttachmentLink(request.params.token)
      return reply
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .redirect(result.downloadUrl)
    } catch {
      return reply.code(404).send({ error: 'room_attachment_unavailable' })
    }
  })
}
