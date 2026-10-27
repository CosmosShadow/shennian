// @arch open-source/docs/server-runtime.md
// @test src/__tests__/rooms-routes.test.ts

import type { FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { RoomPolicyError } from '../services/room-policy.js'

export function sendRoomError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof RoomPolicyError)) throw error
  const forbidden = error.code.endsWith('_forbidden')
  const missing = error.code.endsWith('_not_found')
  const conflict = error.code.endsWith('_conflict')
  const gone = error.code === 'room_invite_unavailable'
  const stateConflict =
    error.code === 'owner_leave_forbidden' || error.code === 'profile_name_required'
  return reply
    .code(gone ? 410 : stateConflict ? 409 : forbidden ? 403 : missing ? 404 : conflict ? 409 : 400)
    .send({
      error: error.code,
      message: error.message,
    })
}

export function parseSequence(value: string | undefined): bigint | null {
  if (value == null || value === '') return 0n
  if (!/^\d+$/.test(value)) return null
  return BigInt(value)
}

export function shapeRoomLimits(room: {
  maxHumanMembers: number
  maxAgentsPerUser: number
  maxAgentsPerRoom: number
  maxAutoFollowAgents: number
}) {
  return {
    maxHumanMembers: room.maxHumanMembers,
    maxAgentsPerMember: room.maxAgentsPerUser,
    maxAgentsPerRoom: room.maxAgentsPerRoom,
    maxAutoFollowAgents: room.maxAutoFollowAgents,
  }
}

export async function findActiveHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  if (membership?.status !== 'active' || !await roomVisibleToConversationClient(membership.room)) {
    return null
  }
  return membership
}

export async function findHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  if (membership?.principalType !== 'human'
    || !await roomVisibleToConversationClient(membership.room)) return null
  return membership
}

async function roomVisibleToConversationClient(room: { id: string; conversationKind?: string }) {
  if (room.conversationKind === 'work') {
    const migration = await prisma.sessionRoomMigration.findFirst({
      where: { roomId: room.id, state: 'canonical' }, select: { sessionId: true },
    })
    return migration != null
  }
  if (room.conversationKind !== 'published_ai') return true
  const [control, direct] = await Promise.all([
    prisma.conversationWriteControl.findUnique({
      where: { name: 'published_ai' }, select: { mode: true },
    }),
    prisma.agentDirectConversation.findUnique({ where: { roomId: room.id },
      select: { canonicalState: true } }),
  ])
  return control?.mode === 'canonical' && direct?.canonicalState === 'ready'
}

export async function resolveRoomReadAccess(roomId: string, userId: string) {
  const membership = await findHumanMembership(roomId, userId)
  if (membership?.status === 'active')
    return {
      room: membership.room,
      membership,
      historyFromSequence: membership.historyFromSequence,
      historyThroughSequence: null as bigint | null,
    }
  if (
    membership &&
    (membership.status === 'left' || membership.status === 'removed') &&
    membership.historyThroughSequence != null
  ) {
    return {
      room: membership.room,
      membership,
      historyFromSequence: membership.historyFromSequence,
      historyThroughSequence: membership.historyThroughSequence,
    }
  }
  if (membership) return null
  const room = await prisma.room.findUnique({ where: { id: roomId } })
  if (!room || room.status !== 'active' || room.visibility !== 'public_read'
    || !await roomVisibleToConversationClient(room)) return null
  return { room, membership: null, historyFromSequence: 1n, historyThroughSequence: null }
}
