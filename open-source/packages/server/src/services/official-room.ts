// @arch open-source/docs/server-runtime.md
// @test src/__tests__/official-room.test.ts

import { prisma } from '../lib/prisma.js'
import { createRoomWithOwner } from './room-core.js'
import { getCanonicalRoomInvite } from './room-membership.js'
import { withDistributedLease } from './distributed-lease.js'

export const OFFICIAL_ROOM_ROLLOVER_HUMAN_COUNT = 900
const OFFICIAL_ROOM_LEASE = 'official-room-rollover'
const OFFICIAL_ROOM_LEASE_TTL_MS = 30_000

type OfficialRoomRecord = {
  id: string
  name: string
  ownerUserId: string
  visibility: string
  joinPolicy: string
  maxHumanMembers: number
  officialSequence: number | null
  officialInviteToken: string | null
  _count: { memberships: number }
}

export type OfficialRoomTarget = {
  roomId: string
  name: string
  inviteToken: string
  sequence: number
  humanCount: number
  maxHumanMembers: number
}

export class OfficialRoomUnavailableError extends Error {
  constructor(message = 'The official Room is unavailable.') {
    super(message)
    this.name = 'OfficialRoomUnavailableError'
  }
}

async function latestOfficialRoom(): Promise<OfficialRoomRecord | null> {
  return prisma.room.findFirst({
    where: { officialSequence: { not: null }, status: 'active' },
    orderBy: { officialSequence: 'desc' },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      visibility: true,
      joinPolicy: true,
      maxHumanMembers: true,
      officialSequence: true,
      officialInviteToken: true,
      _count: {
        select: {
          memberships: {
            where: { principalType: 'human', status: 'active' },
          },
        },
      },
    },
  })
}

async function completeOfficialRoom(room: OfficialRoomRecord): Promise<OfficialRoomRecord> {
  if (room.officialInviteToken) return room
  const invitation = await getCanonicalRoomInvite({
    roomId: room.id,
    actorUserId: room.ownerUserId,
  })
  return prisma.room.update({
    where: { id: room.id },
    data: { officialInviteToken: invitation.rawToken },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      visibility: true,
      joinPolicy: true,
      maxHumanMembers: true,
      officialSequence: true,
      officialInviteToken: true,
      _count: {
        select: {
          memberships: {
            where: { principalType: 'human', status: 'active' },
          },
        },
      },
    },
  })
}

function target(room: OfficialRoomRecord): OfficialRoomTarget {
  if (room.officialSequence == null || !room.officialInviteToken) {
    throw new OfficialRoomUnavailableError('The official Room configuration is incomplete.')
  }
  return {
    roomId: room.id,
    name: room.name,
    inviteToken: room.officialInviteToken,
    sequence: room.officialSequence,
    humanCount: room._count.memberships,
    maxHumanMembers: room.maxHumanMembers,
  }
}

async function resolveInsideLease(): Promise<OfficialRoomTarget> {
  const currentRecord = await latestOfficialRoom()
  if (!currentRecord) throw new OfficialRoomUnavailableError()
  const current = await completeOfficialRoom(currentRecord)
  if (current._count.memberships < OFFICIAL_ROOM_ROLLOVER_HUMAN_COUNT) return target(current)

  const nextSequence = (current.officialSequence ?? 0) + 1
  const existingNext = await prisma.room.findUnique({
    where: { officialSequence: nextSequence },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      visibility: true,
      joinPolicy: true,
      maxHumanMembers: true,
      officialSequence: true,
      officialInviteToken: true,
      _count: {
        select: {
          memberships: {
            where: { principalType: 'human', status: 'active' },
          },
        },
      },
    },
  })
  if (existingNext) return target(await completeOfficialRoom(existingNext))

  const created = await createRoomWithOwner({
    userId: current.ownerUserId,
    name: `神念官方交流群 ${nextSequence} 群`,
    visibility: current.visibility === 'public_read' ? 'public_read' : 'private',
    joinPolicy: 'open',
    officialSequence: nextSequence,
  })
  const createdRecord = await latestOfficialRoom()
  if (!createdRecord || createdRecord.id !== created.room.id) {
    throw new OfficialRoomUnavailableError('The new official Room could not be resolved.')
  }
  return target(await completeOfficialRoom(createdRecord))
}

export async function resolveOfficialRoom(): Promise<OfficialRoomTarget> {
  const currentRecord = await latestOfficialRoom()
  if (!currentRecord) throw new OfficialRoomUnavailableError()
  const current = await completeOfficialRoom(currentRecord)
  if (current._count.memberships < OFFICIAL_ROOM_ROLLOVER_HUMAN_COUNT) return target(current)

  const result = await withDistributedLease({
    name: OFFICIAL_ROOM_LEASE,
    ttlMs: OFFICIAL_ROOM_LEASE_TTL_MS,
    run: resolveInsideLease,
  })
  if (result.acquired) return result.result

  const latest = await latestOfficialRoom()
  if (!latest) throw new OfficialRoomUnavailableError()
  return target(await completeOfficialRoom(latest))
}
