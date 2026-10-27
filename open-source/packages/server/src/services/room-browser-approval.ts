// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-browser-approval.test.ts

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { hashRoomInviteCapability } from './room-invite-browser.js'
import { createActiveRoomBrowserSession } from './room-browser-session.js'
import { joinOpenRoomFromLink } from './room-membership.js'
import { RoomPolicyError } from './room-policy.js'

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/
const ROOM_ID = /^[A-Za-z0-9_-]{1,191}$/
const APPROVAL_TTL_MS = 3 * 60 * 1000

export class RoomBrowserApprovalError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) {
    super(code)
    this.name = 'RoomBrowserApprovalError'
  }
}

export async function createRoomBrowserApproval(roomId: string, now = new Date()) {
  if (!ROOM_ID.test(roomId)) throw unavailable()
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { name: true, status: true },
  })
  if (room?.status !== 'active') throw unavailable()

  const token = crypto.randomBytes(32).toString('base64url')
  const browserSecret = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS)
  await prisma.roomBrowserApproval.deleteMany({ where: { expiresAt: { lte: now } } })
  await prisma.roomBrowserApproval.create({
    data: {
      tokenHash: hashRoomInviteCapability(token),
      browserSecretHash: hashRoomInviteCapability(browserSecret),
      roomId,
      expiresAt,
    },
  })
  return {
    token,
    browserSecret,
    expiresAt,
    payload: `room-access:${roomId}:${token}`,
    roomName: room.name,
  }
}

export async function previewRoomBrowserApproval(input: { roomId: string; token: unknown; userId: string }) {
  const approval = await findApproval(input.roomId, input.token)
  if (approval.expiresAt <= new Date() || approval.status !== 'pending') throw expired()
  const member = await findActiveMembership(input.roomId, input.userId)
  if (member) return { roomName: member.room.name, expiresAt: approval.expiresAt.toISOString(), willJoin: false }
  const room = await prisma.room.findUnique({ where: { id: input.roomId }, select: { name: true, status: true, joinPolicy: true } })
  if (room?.status !== 'active' || room.joinPolicy !== 'open')
    throw new RoomBrowserApprovalError('room_join_unavailable', 403)
  return { roomName: room.name, expiresAt: approval.expiresAt.toISOString(), willJoin: true }
}

export async function confirmRoomBrowserApproval(input: {
  roomId: string
  token: unknown
  userId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const approval = await findApproval(input.roomId, input.token)
  if (approval.expiresAt <= now) throw expired()
  if (approval.status !== 'pending' && !(approval.status === 'approved' && approval.approvedUserId === input.userId))
    throw unavailable()

  let membership = await findActiveMembership(input.roomId, input.userId)
  let joined: Awaited<ReturnType<typeof joinOpenRoomFromLink>> | null = null
  if (!membership) {
    try {
      joined = await joinOpenRoomFromLink({ roomId: input.roomId, userId: input.userId, now })
      membership = await findActiveMembership(input.roomId, input.userId)
    } catch (error) {
      if (error instanceof RoomPolicyError) throw new RoomBrowserApprovalError(error.code, 403)
      throw error
    }
  }
  if (!membership) throw new RoomBrowserApprovalError('room_join_unavailable', 403)

  if (
    approval.status === 'approved' &&
    approval.approvedUserId === input.userId &&
    approval.approvedMembershipId === membership.id
  ) {
    return { status: 'approved' as const }
  }
  if (approval.status !== 'pending') throw unavailable()

  const claimed = await prisma.roomBrowserApproval.updateMany({
    where: { id: approval.id, status: 'pending', expiresAt: { gt: now } },
    data: {
      status: 'approved',
      approvedUserId: input.userId,
      approvedMembershipId: membership.id,
      approvedAt: now,
    },
  })
  if (claimed.count !== 1) throw unavailable()
  return joined?.joined ? { status: 'approved' as const, joined } : { status: 'approved' as const }
}

export async function consumeRoomBrowserApproval(input: {
  roomId: string
  token: unknown
  browserSecret?: string
  clientLabel?: string
  existingToken?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const approval = await findApproval(input.roomId, input.token)
  if (!input.browserSecret || !RAW_TOKEN.test(input.browserSecret) ||
      !approval.browserSecretHash || hashRoomInviteCapability(input.browserSecret) !== approval.browserSecretHash) throw unavailable()
  if (approval.expiresAt <= now) return { status: 'expired' as const }
  if (approval.status === 'pending' || approval.status === 'confirming') {
    return { status: 'pending' as const }
  }
  if (
    approval.status !== 'approved' ||
    !approval.approvedUserId ||
    !approval.approvedMembershipId
  ) {
    throw unavailable()
  }

  const claimed = await prisma.roomBrowserApproval.updateMany({
    where: { id: approval.id, status: 'approved', expiresAt: { gt: now } },
    data: { status: 'consuming' },
  })
  if (claimed.count !== 1) throw unavailable()

  try {
    const membership = await findActiveMembership(input.roomId, approval.approvedUserId)
    if (!membership || membership.id !== approval.approvedMembershipId) throw unavailable()
    const session = await createActiveRoomBrowserSession({
      roomId: input.roomId,
      userId: approval.approvedUserId,
      membershipId: membership.id,
      clientLabel: input.clientLabel,
      existingToken: input.existingToken,
      now,
    })
    await prisma.roomBrowserApproval.update({
      where: { id: approval.id },
      data: { status: 'consumed', consumedAt: now },
    })
    return { status: 'authorized' as const, userId: approval.approvedUserId, ...session }
  } catch (error) {
    await prisma.roomBrowserApproval.updateMany({
      where: { id: approval.id, status: 'consuming' },
      data: { status: 'approved' },
    }).catch(() => {})
    throw error
  }
}

async function findApproval(roomId: string, token: unknown) {
  if (!ROOM_ID.test(roomId) || typeof token !== 'string' || !RAW_TOKEN.test(token)) {
    throw unavailable()
  }
  const approval = await prisma.roomBrowserApproval.findUnique({
    where: { tokenHash: hashRoomInviteCapability(token) },
  })
  if (!approval || approval.roomId !== roomId) throw unavailable()
  return approval
}

async function findActiveMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: {
      roomId_principalKey: { roomId, principalKey: `human:${userId}` },
    },
    include: { room: true },
  })
  return membership?.status === 'active' && membership.room.status === 'active'
    ? membership
    : null
}

function unavailable() {
  return new RoomBrowserApprovalError('room_browser_approval_unavailable', 400)
}

function expired() {
  return new RoomBrowserApprovalError('room_browser_approval_expired', 410)
}
