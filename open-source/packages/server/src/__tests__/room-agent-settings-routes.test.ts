// @covers open-source/packages/server/src/routes/room-agent-settings.ts

import Fastify, { type FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateMode, broadcast } = vi.hoisted(() => ({
  updateMode: vi.fn(),
  broadcast: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: FastifyInstance) => {
    app.decorateRequest('userId', '')
  },
  requireAuth: async (request: { userId: string }) => {
    request.userId = 'user_1'
  },
  requireActivePlan: async () => {},
}))
vi.mock('../services/room-agent-settings.js', () => ({ updateOwnedRoomAgentMode: updateMode }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent: broadcast }))

import { roomAgentSettingsRoutes } from '../routes/room-agent-settings.js'

describe('Room Agent settings route', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(roomAgentSettingsRoutes, { prefix: '/rooms' })
    updateMode.mockResolvedValue({
      binding: { id: 'binding_1', status: 'paused', activationMode: 'paused' },
      message: {
        id: 'message_1',
        roomId: 'room_1',
        sequence: 3n,
        authorMembershipId: 'agent_member_1',
        authorPrincipalTypeSnapshot: 'agent',
        ownerUserIdSnapshot: 'user_1',
        authorDisplayNameSnapshot: '产品助手',
        ownerDisplayNameSnapshot: '产品助手',
        authorAvatarSnapshot: null,
        mentionSnapshots: null,
        kind: 'system',
        text: '产品助手 changed work mode to paused.',
        replyToMessageId: null,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
        editedAt: null,
        deletedAt: null,
        attachments: [],
      },
      idempotent: false,
    })
  })

  it('accepts user auth and broadcasts the exact binding update', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1/members/agent_member_1/agent-mode',
      payload: { activationMode: 'paused' },
    })

    expect(response.statusCode).toBe(200)
    expect(updateMode).toHaveBeenCalledWith({
      roomId: 'room_1',
      membershipId: 'agent_member_1',
      userId: 'user_1',
      activationMode: 'paused',
      restorePrevious: false,
    })
    expect(broadcast).toHaveBeenCalledWith('room_1', {
      event: 'room.binding.updated',
      roomId: 'room_1',
      entityId: 'binding_1',
    })
    expect(broadcast).toHaveBeenCalledWith(
      'room_1',
      expect.objectContaining({
        event: 'room.message.created',
        roomId: 'room_1',
        sequence: '3',
      }),
    )
  })

  it('accepts a request to restore the mode used before a safety pause', async () => {
    updateMode.mockResolvedValueOnce({
      binding: { id: 'binding_1', status: 'active', activationMode: 'auto_follow' },
      message: null,
      idempotent: false,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/rooms/room_1/members/agent_member_1/agent-mode',
      payload: { restorePrevious: true },
    })

    expect(response.statusCode).toBe(200)
    expect(updateMode).toHaveBeenCalledWith({
      roomId: 'room_1',
      membershipId: 'agent_member_1',
      userId: 'user_1',
      activationMode: '',
      restorePrevious: true,
    })
  })
})
