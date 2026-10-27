// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-settings-routes.test.ts

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { RoomActivationMode } from '@shennian/wire'
import { registerAuthDecorators, requireActivePlan, requireAuth } from '../middleware/auth.js'
import { broadcastRoomEvent } from '../services/room-events.js'
import { updateOwnedRoomAgentMode } from '../services/room-agent-settings.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { shapeRoomMessage } from '../services/room-view.js'

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof RoomPolicyError)) throw error
  const status = error.code.endsWith('_forbidden')
    ? 403
    : error.code.endsWith('_limit_reached')
      ? 409
      : 400
  return reply.code(status).send({ error: error.code, message: error.message })
}

export async function roomAgentSettingsRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.patch<{
    Params: { roomId: string; membershipId: string }
    Body: { activationMode?: RoomActivationMode; restorePrevious?: boolean }
  }>(
    '/:roomId/members/:membershipId/agent-mode',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await updateOwnedRoomAgentMode({
          roomId: request.params.roomId,
          membershipId: request.params.membershipId,
          userId: request.userId,
          activationMode: request.body.activationMode ?? ('' as RoomActivationMode),
          restorePrevious: request.body.restorePrevious === true,
        })
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.binding.updated',
          roomId: request.params.roomId,
          entityId: result.binding.id,
        })
        if (result.message) {
          const message = shapeRoomMessage(result.message)
          await broadcastRoomEvent(request.params.roomId, {
            event: 'room.message.created',
            roomId: request.params.roomId,
            sequence: message.sequence,
            message,
          })
        }
        return {
          membershipId: request.params.membershipId,
          status: result.binding.status,
          activationMode: result.binding.activationMode,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
}
