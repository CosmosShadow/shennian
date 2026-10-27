// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-invite-browser.test.ts

import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

const INVITE_TOKEN = /^[A-Za-z0-9_-]{32,256}$/
const BROWSER_STATE = /^[A-Za-z0-9_-]{43}$/
const STATE_TTL_MS = 15 * 60 * 1000
const APPLICANT_BINDING_TTL_SECONDS = STATE_TTL_MS / 1000

export class RoomInviteBrowserError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'RoomInviteBrowserError'
  }
}

export function hashRoomInviteCapability(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function applicantBindingKey(browserState: string): string {
  return `room-invite-applicant:${hashRoomInviteCapability(browserState)}`
}

export async function bindRoomInviteApplicant(
  rawState: unknown,
  applicant: { userId: string; roomId: string },
): Promise<void> {
  if (typeof rawState !== 'string' || !BROWSER_STATE.test(rawState)) throw unavailable()
  await redis.set(
    applicantBindingKey(rawState),
    JSON.stringify(applicant),
    'EX',
    APPLICANT_BINDING_TTL_SECONDS,
  )
}

export async function readRoomInviteApplicant(
  rawState: unknown,
  expectedRoomId: string,
): Promise<{ userId: string; roomId: string } | null> {
  if (typeof rawState !== 'string' || !BROWSER_STATE.test(rawState)) return null
  const value = await redis.get(applicantBindingKey(rawState))
  if (!value) return null
  try {
    const applicant = JSON.parse(value) as { userId?: unknown; roomId?: unknown }
    if (
      typeof applicant.userId !== 'string' ||
      typeof applicant.roomId !== 'string' ||
      applicant.roomId !== expectedRoomId
    )
      return null
    return { userId: applicant.userId, roomId: applicant.roomId }
  } catch {
    return null
  }
}

export async function clearRoomInviteApplicant(rawState: unknown): Promise<void> {
  if (typeof rawState !== 'string' || !BROWSER_STATE.test(rawState)) return
  await redis.del(applicantBindingKey(rawState))
}

export async function exchangeRoomInviteToken(
  rawToken: unknown,
  expectedRoomId: string,
  now = new Date(),
) {
  if (typeof rawToken !== 'string' || !INVITE_TOKEN.test(rawToken)) {
    throw unavailable()
  }
  const invite = await prisma.roomInvite.findUnique({
    where: { tokenHash: hashRoomInviteCapability(rawToken) },
    include: { room: true },
  })
  assertInviteAvailable(invite, now)
  if (invite!.roomId !== expectedRoomId) throw unavailable()

  const browserState = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS)
  await prisma.roomInviteBrowserState.create({
    data: {
      stateHash: hashRoomInviteCapability(browserState),
      inviteId: invite!.id,
      expiresAt,
      lastSeenAt: now,
    },
  })
  return { browserState, expiresAt, roomId: invite!.roomId }
}

export async function getRoomInviteBootstrap(rawState: unknown, now = new Date()) {
  if (typeof rawState !== 'string' || !BROWSER_STATE.test(rawState)) throw unavailable()
  const state = await prisma.roomInviteBrowserState.findUnique({
    where: { stateHash: hashRoomInviteCapability(rawState) },
    include: { invite: { include: { room: true } } },
  })
  if (!state || state.status !== 'active' || state.expiresAt <= now) throw unavailable()
  assertInviteAvailable(state.invite, now)
  await prisma.roomInviteBrowserState.update({
    where: { id: state.id },
    data: { lastSeenAt: now },
  })
  return {
    status: 'ready' as const,
    room: {
      id: state.invite.room.id,
      name: state.invite.room.name,
      description: state.invite.room.description,
      visibility: state.invite.room.visibility,
      joinPolicy: state.invite.room.joinPolicy,
    },
    expiresAt: state.expiresAt.toISOString(),
  }
}

function assertInviteAvailable(
  invite: {
    id: string
    status: string
    expiresAt: Date | null
    maxUses: number | null
    useCount: number
    targetUserId?: string | null
    room: { status: string }
  } | null,
  now: Date,
): void {
  if (
    !invite ||
    invite.targetUserId != null ||
    invite.status !== 'active' ||
    invite.room.status !== 'active' ||
    (invite.expiresAt != null && invite.expiresAt <= now) ||
    (invite.maxUses != null && invite.useCount >= invite.maxUses)
  ) {
    throw unavailable()
  }
}

function unavailable(): RoomInviteBrowserError {
  return new RoomInviteBrowserError(
    'room_invite_unavailable',
    410,
    'This Room invitation is unavailable.',
  )
}
