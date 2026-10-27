// @covers open-source/packages/server/src/services/room-agent-settings.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tx, prisma } = vi.hoisted(() => {
  const transaction = {
    roomMembership: { findUnique: vi.fn() },
    roomBinding: { count: vi.fn(), update: vi.fn() },
    room: { update: vi.fn() },
    roomMessage: { create: vi.fn() },
  }
  return {
    tx: transaction,
    prisma: {
      $transaction: vi.fn((work: (client: typeof transaction) => unknown) => work(transaction)),
    },
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma }))

import { updateOwnedRoomAgentMode } from '../services/room-agent-settings.js'

const binding = {
  id: 'binding_1',
  roomId: 'room_1',
  userId: 'user_1',
  status: 'active',
  activationMode: 'mention_only',
}

describe('owned Room Agent settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.roomMembership.findUnique.mockResolvedValue({
      id: 'agent_member_1',
      roomId: 'room_1',
      principalType: 'agent',
      ownerUserId: 'user_1',
      displayAlias: '产品助手',
      status: 'active',
      room: { status: 'active', maxAutoFollowAgents: 8 },
      binding,
    })
    tx.roomBinding.count.mockResolvedValue(0)
    tx.roomBinding.update.mockResolvedValue({
      ...binding,
      status: 'paused',
      activationMode: 'paused',
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    })
    tx.room.update.mockResolvedValue({ nextSequence: 2n })
    tx.roomMessage.create.mockResolvedValue({ id: 'message_1', sequence: 2n })
  })

  it('updates only the current user Agent binding inside the exact Room', async () => {
    const result = await updateOwnedRoomAgentMode({
      roomId: 'room_1',
      membershipId: 'agent_member_1',
      userId: 'user_1',
      activationMode: 'paused',
    })

    expect(tx.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_1' },
      data: {
        activationMode: 'paused',
        status: 'paused',
        resumeActivationMode: 'mention_only',
      },
    })
    expect(result.idempotent).toBe(false)
    expect(tx.roomMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'system',
        text: '产品助手 changed work mode to paused.',
      }),
    })
  })

  it('restores the activation mode that was active before a safety pause', async () => {
    tx.roomMembership.findUnique.mockResolvedValueOnce({
      id: 'agent_member_1',
      roomId: 'room_1',
      principalType: 'agent',
      ownerUserId: 'user_1',
      displayAlias: '产品助手',
      status: 'active',
      room: { status: 'active', maxAutoFollowAgents: 8 },
      binding: {
        ...binding,
        status: 'paused',
        activationMode: 'paused',
        resumeActivationMode: 'auto_follow',
      },
    })
    tx.roomBinding.update.mockResolvedValueOnce({
      ...binding,
      activationMode: 'auto_follow',
      resumeActivationMode: null,
      updatedAt: new Date('2026-09-10T00:00:01.000Z'),
    })

    await updateOwnedRoomAgentMode({
      roomId: 'room_1',
      membershipId: 'agent_member_1',
      userId: 'user_1',
      activationMode: '' as 'paused',
      restorePrevious: true,
    })

    expect(tx.roomBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding_1' },
      data: {
        activationMode: 'auto_follow',
        status: 'active',
        resumeActivationMode: null,
      },
    })
  })

  it('rejects another user Agent and invalid modes', async () => {
    tx.roomMembership.findUnique.mockResolvedValueOnce({
      id: 'agent_member_1',
      roomId: 'room_1',
      principalType: 'agent',
      ownerUserId: 'user_2',
      displayAlias: '产品助手',
      status: 'active',
      room: { status: 'active', maxAutoFollowAgents: 8 },
      binding,
    })

    await expect(
      updateOwnedRoomAgentMode({
        roomId: 'room_1',
        membershipId: 'agent_member_1',
        userId: 'user_1',
        activationMode: 'auto_follow',
      }),
    ).rejects.toMatchObject({ code: 'room_agent_settings_forbidden' })
    await expect(
      updateOwnedRoomAgentMode({
        roomId: 'room_1',
        membershipId: 'agent_member_1',
        userId: 'user_1',
        activationMode: 'invalid' as 'paused',
      }),
    ).rejects.toMatchObject({ code: 'invalid_activation_mode' })
  })
})
