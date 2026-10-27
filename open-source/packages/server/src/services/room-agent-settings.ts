// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-settings.test.ts

import type { RoomActivationMode } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { roomAgentModeChangedSystemText } from './room-agent-system-messages.js'
import { appendSystemMessage } from './room-membership.js'
import { RoomPolicyError } from './room-policy.js'

const MODES = new Set<RoomActivationMode>(['auto_follow', 'mention_only', 'paused'])

export async function updateOwnedRoomAgentMode(input: {
  roomId: string
  membershipId: string
  userId: string
  activationMode: RoomActivationMode
  restorePrevious?: boolean
}) {
  if (!input.restorePrevious && !MODES.has(input.activationMode)) {
    throw new RoomPolicyError('invalid_activation_mode', 'Unsupported Agent activation mode.')
  }

  return prisma.$transaction(
    async (tx) => {
      const membership = await tx.roomMembership.findUnique({
        where: { id: input.membershipId },
        include: { room: true, binding: true },
      })
      const binding = membership?.binding
      if (
        !membership ||
        membership.roomId !== input.roomId ||
        membership.principalType !== 'agent' ||
        membership.ownerUserId !== input.userId ||
        membership.status !== 'active' ||
        membership.room.status !== 'active' ||
        !binding ||
        binding.roomId !== input.roomId ||
        binding.userId !== input.userId ||
        (binding.status !== 'active' && binding.status !== 'paused')
      ) {
        throw new RoomPolicyError(
          'room_agent_settings_forbidden',
          'This Agent cannot be configured by the current user in this Room.',
        )
      }

      if (input.restorePrevious && binding.activationMode !== 'paused') {
        return { binding, message: null, idempotent: true }
      }

      const activationMode: RoomActivationMode = input.restorePrevious
        ? binding.activationMode === 'paused' && binding.resumeActivationMode === 'auto_follow'
          ? 'auto_follow'
          : 'mention_only'
        : input.activationMode

      if (binding.activationMode === activationMode) {
        return { binding, message: null, idempotent: true }
      }
      const updated = await tx.roomBinding.update({
        where: { id: binding.id },
        data: {
          activationMode,
          status: activationMode === 'paused' ? 'paused' : 'active',
          resumeActivationMode:
            activationMode === 'paused'
              ? binding.activationMode === 'auto_follow'
                ? 'auto_follow'
                : 'mention_only'
              : null,
        },
      })
      const message = await appendSystemMessage(tx, {
        roomId: input.roomId,
        author: membership,
        text: roomAgentModeChangedSystemText(membership.displayAlias, activationMode),
        clientMessageId: `system:binding-mode:${binding.id}:${updated.updatedAt.getTime()}:${activationMode}`,
      })
      return { binding: updated, message, idempotent: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}
