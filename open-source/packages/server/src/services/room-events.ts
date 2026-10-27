// @arch open-source/docs/server-runtime.md
// @test src/__tests__/rooms-routes.test.ts

import type { RoomEvent, RoomMessageView } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { connections } from '../relay/connections.js'
import { pubsub } from '../relay/pubsub.js'
import { broadcastRoomBrowserEvent } from './room-browser-events.js'
import { deliverRoomMessageToManagedMachines } from './room-managed-delivery.js'
import { shapeRoomMessage, type RoomMessageRecord } from './room-view.js'

export async function broadcastRoomEvent(roomId: string, event: RoomEvent): Promise<void> {
  const memberships = await prisma.roomMembership.findMany({
    where: { roomId, principalType: 'human', status: 'active' },
    select: { id: true, ownerUserId: true },
  })
  const data = JSON.stringify({ type: 'event', event: event.event, payload: event })
  broadcastRoomBrowserEvent(roomId, new Set(memberships.map((membership) => membership.id)), data)
  for (const userId of new Set(memberships.map((membership) => membership.ownerUserId))) {
    if (pubsub.isActive) pubsub.publishToUser(userId, data)
    else connections.broadcastToClientsOfUser(userId, data)
  }
  if (event.event === 'room.message.created') {
    await deliverRoomMessageToManagedMachines(roomId, event.message).catch((error) => {
      // The committed Room row remains the reconnect/cursor source of truth,
      // but finish target discovery and dispatch before the route returns so a
      // short-lived request cannot silently skip the live-delivery attempt.
      console.warn('[room-managed-delivery] dispatch failed; cursor sync will retry', {
        roomId,
        messageId: event.message.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

export async function broadcastRoomMessageRecord(
  roomId: string,
  record: RoomMessageRecord,
): Promise<RoomMessageView> {
  const message = shapeRoomMessage(record)
  await broadcastRoomEvent(roomId, {
    event: 'room.message.created',
    roomId,
    sequence: message.sequence,
    message,
  })
  return message
}

/** Delivers the final membership invalidation to users who are no longer active Room members. */
export function broadcastRoomEventToUsers(userIds: Iterable<string>, event: RoomEvent): void {
  const data = JSON.stringify({ type: 'event', event: event.event, payload: event })
  for (const userId of new Set(userIds)) {
    if (pubsub.isActive) pubsub.publishToUser(userId, data)
    else connections.broadcastToClientsOfUser(userId, data)
  }
}

/**
 * The server already moved the sender's watermark past their own message. Released clients only
 * learn that from a membership refetch, and the sender's later read report will not broadcast
 * again because it no longer advances anything.
 */
export function broadcastAuthorReadAdvanced(result: {
  authorReadAdvanced: boolean
  message: { roomId: string; authorMembershipId: string | null; ownerUserIdSnapshot: string | null }
}): void {
  const { message } = result
  if (!result.authorReadAdvanced || !message.ownerUserIdSnapshot || !message.authorMembershipId) return
  broadcastRoomEventToUsers([message.ownerUserIdSnapshot], {
    event: 'room.membership.updated',
    roomId: message.roomId,
    entityId: message.authorMembershipId,
  })
}

/** Invalidates every active Room member projection that depends on a changed identity. */
export async function broadcastRoomIdentityUpdated(input: {
  ownerUserId?: string
  agentIdentityId?: string
}): Promise<void> {
  const memberships = await prisma.roomMembership.findMany({
    where: {
      status: 'active',
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.agentIdentityId ? { agentIdentityId: input.agentIdentityId } : {}),
    },
    select: { id: true, roomId: true },
  })
  await Promise.all(memberships.map((membership) =>
    broadcastRoomEvent(membership.roomId, {
      event: 'room.membership.updated',
      roomId: membership.roomId,
      entityId: membership.id,
    }),
  ))
}
