// @arch open-source/docs/server-runtime.md
// @test src/__tests__/support-cli-routes.test.ts

import { prisma } from '../lib/prisma.js'
import { resolveOfficialRoom, type OfficialRoomTarget } from './official-room.js'
import { exchangeRoomInviteToken } from './room-invite-browser.js'
import { joinRoomFromBrowserState } from './room-membership.js'

export const MAX_SUPPORT_TEXT_LENGTH = 2000

const SUSPICIOUS_TEXT_PATTERNS: RegExp[] = [
  /\bBearer\s+\S+/i,
  /\b(sk|pk)-[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Za-z0-9_+/]{40,}={0,2}\b/,
  /\/Users\/\S+/,
  /\/home\/\S+/,
  /\/root\/\S+/,
  /[A-Za-z]:\\\S+/,
  /\.env(\.[a-z]+)?\b/i,
]

export class SupportContactError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'SupportContactError'
  }
}

export function normalizeSupportText(rawText: unknown): string {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) {
    throw new SupportContactError('support_text_required', 400, 'Support text is required.')
  }
  if (text.length > MAX_SUPPORT_TEXT_LENGTH) {
    throw new SupportContactError('support_text_too_long', 400, 'Support text is too long.')
  }
  if (SUSPICIOUS_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new SupportContactError(
      'support_text_contains_sensitive_data',
      400,
      'Remove tokens, absolute paths, or other sensitive data before contacting support.',
    )
  }
  return text
}

async function activeHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
  })
  return membership?.status === 'active' ? membership : null
}

export type SupportRoomMembership = NonNullable<Awaited<ReturnType<typeof activeHumanMembership>>>

export async function getSupportRoomMembership(userId: string): Promise<{
  officialRoom: OfficialRoomTarget
  membership: SupportRoomMembership | null
}> {
  const officialRoom = await resolveOfficialRoom()
  const membership = await activeHumanMembership(officialRoom.roomId, userId)
  return { officialRoom, membership }
}

export async function requireSupportRoomMembership(userId: string): Promise<{
  officialRoom: OfficialRoomTarget
  membership: SupportRoomMembership
}> {
  const { officialRoom, membership } = await getSupportRoomMembership(userId)
  if (!membership) {
    throw new SupportContactError(
      'support_room_not_joined',
      403,
      'Contact support first to join the official Room.',
    )
  }
  return { officialRoom, membership }
}

export async function ensureSupportRoomMembership(userId: string): Promise<{
  officialRoom: OfficialRoomTarget
  membership: SupportRoomMembership
  justJoined: boolean
}> {
  const { officialRoom, membership: existing } = await getSupportRoomMembership(userId)
  if (existing) return { officialRoom, membership: existing, justJoined: false }

  const exchanged = await exchangeRoomInviteToken(officialRoom.inviteToken, officialRoom.roomId)
  const result = await joinRoomFromBrowserState({
    browserState: exchanged.browserState,
    applicantUserId: userId,
  })
  if (result.outcome === 'pending_approval') {
    throw new SupportContactError(
      'support_room_pending_approval',
      503,
      'The support Room is not open for direct join right now.',
    )
  }
  return { officialRoom, membership: result.membership, justJoined: !result.idempotent }
}
