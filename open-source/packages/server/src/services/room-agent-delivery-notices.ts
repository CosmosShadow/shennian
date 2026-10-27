// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-delivery-notices.test.ts

import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { deriveRoomBindingAvailability } from './agent-runtime-availability.js'
import { broadcastRoomEvent } from './room-events.js'
import { appendSystemMessage } from './room-membership.js'
import {
  roomAgentUnavailableSystemText,
  type RoomAgentUnavailableReason,
} from './room-agent-system-messages.js'
import { shapeRoomMessage } from './room-view.js'

type SentMessage = {
  id: string
  roomId: string
  authorMembershipId: string
  mentionSnapshots?: unknown
}

type NoticeBinding = {
  status: string
  activationMode: string
  detachedReason: string | null
  machine: { paired: boolean; online: boolean } | null
}

function mentionedMembershipIds(message: SentMessage): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(message.mentionSnapshots)) return ids
  for (const item of message.mentionSnapshots) {
    const id = (item as { membershipId?: unknown } | null)?.membershipId
    if (typeof id === 'string') ids.add(id)
  }
  return ids
}

/** Returns why an Agent that this message should reach cannot respond, or null if it can. */
export function agentUnavailableReason(
  binding: NoticeBinding,
  mentioned: boolean,
): RoomAgentUnavailableReason | null {
  if (binding.activationMode !== 'auto_follow' && !mentioned) return null
  if (binding.activationMode === 'paused' && binding.status !== 'detached') return 'paused'
  const availability = deriveRoomBindingAvailability({
    status: binding.status,
    machine: binding.machine,
    recovering: binding.detachedReason === 'recovering',
  })
  if (availability === 'available') return null
  if (availability === 'recovering') return 'recovering'
  return binding.machine?.paired && !binding.machine.online ? 'machine_offline' : 'unavailable'
}

/**
 * After a human sends a Room message, tell the Room which Agents that message
 * should have reached but cannot respond right now (machine offline, paused,
 * recovering). The message itself is never blocked; this only appends system
 * messages and is best-effort.
 */
export async function noticeUnavailableAgents(message: SentMessage): Promise<void> {
  try {
    const bindings = await prisma.roomBinding.findMany({
      where: {
        roomId: message.roomId,
        status: { in: ['active', 'paused', 'detached'] },
        agentMembershipId: { not: null, notIn: [message.authorMembershipId] },
        agentMembership: { status: 'active' },
      },
      select: {
        id: true,
        status: true,
        activationMode: true,
        detachedReason: true,
        agentMembership: {
          select: {
            id: true,
            principalType: true,
            ownerUserId: true,
            displayAlias: true,
          },
        },
        machine: { select: { paired: true, online: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const mentioned = mentionedMembershipIds(message)
    for (const binding of bindings) {
      const agent = binding.agentMembership
      if (!agent) continue
      const reason = agentUnavailableReason(binding, mentioned.has(agent.id))
      if (!reason) continue
      const notice = await prisma
        .$transaction(
          (tx) =>
            appendSystemMessage(tx, {
              roomId: message.roomId,
              author: agent,
              text: roomAgentUnavailableSystemText(agent.displayAlias, reason),
              clientMessageId: `system:agent-unavailable:${message.id}:${binding.id}`,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        .catch((error) => {
          console.warn('[room-agent-notice] failed to append notice', {
            roomId: message.roomId,
            bindingId: binding.id,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })
      if (!notice) continue
      const shaped = shapeRoomMessage({ ...notice, attachments: [] })
      await broadcastRoomEvent(message.roomId, {
        event: 'room.message.created',
        roomId: message.roomId,
        sequence: shaped.sequence,
        message: shaped,
      })
    }
  } catch (error) {
    console.warn('[room-agent-notice] failed to check unavailable agents', {
      roomId: message.roomId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
