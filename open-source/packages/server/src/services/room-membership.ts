// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-membership.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  buildPendingJoinKey,
  buildRoomPrincipalKey,
  assertHumanRoomCapacity,
  canReviewJoinRequest,
  resolveInviteJoinResult,
  RoomPolicyError,
} from './room-policy.js'
import { hashRoomInviteCapability } from './room-invite-browser.js'
import { allocateRoomDisplayAlias } from './room-display-alias.js'
import { commitExclusiveRoomSessionDeletions } from './room-session-cleanup.js'

const BROWSER_STATE = /^[A-Za-z0-9_-]{43}$/
const MAX_JOIN_MESSAGE_LENGTH = 500
const DEFAULT_INVITE_DAYS = 7
const MAX_INVITE_DAYS = 30
const MAX_INVITE_USES = 100

type ReviewDecision = 'approve' | 'reject'

export function normalizeJoinMessage(value?: string): string {
  const message = value?.trim() ?? ''
  if (message.length > MAX_JOIN_MESSAGE_LENGTH) {
    throw new RoomPolicyError('join_message_too_long', 'Join request message is too long.')
  }
  return message
}

export async function getHumanRoomInviteEntryState(input: {
  roomId: string
  userId: string
}): Promise<'joined' | 'pending_approval' | 'can_join'> {
  const [membership, pendingRequest] = await Promise.all([
    prisma.roomMembership.findUnique({
      where: {
        roomId_principalKey: {
          roomId: input.roomId,
          principalKey: `human:${input.userId}`,
        },
      },
      select: { status: true },
    }),
    prisma.roomJoinRequest.findUnique({
      where: { pendingKey: buildPendingJoinKey(input.roomId, input.userId) },
      select: { status: true },
    }),
  ])
  if (membership?.status === 'active') return 'joined'
  if (pendingRequest?.status === 'pending') return 'pending_approval'
  return 'can_join'
}

export function normalizeInviteOptions(input: { expiresInDays?: number; maxUses?: number | null }) {
  const expiresInDays = input.expiresInDays ?? DEFAULT_INVITE_DAYS
  const maxUses = input.maxUses === undefined ? null : input.maxUses
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_INVITE_DAYS) {
    throw new RoomPolicyError(
      'invalid_invite_expiry',
      'Invite expiry must be between 1 and 30 days.',
    )
  }
  if (
    maxUses !== null &&
    (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES)
  ) {
    throw new RoomPolicyError(
      'invalid_invite_max_uses',
      'Invite max uses must be between 1 and 100.',
    )
  }
  return { expiresInDays, maxUses }
}

export async function createRoomInvite(input: {
  roomId: string
  actorUserId: string
  expiresInDays?: number
  maxUses?: number | null
  now?: Date
}) {
  const options = normalizeInviteOptions(input)
  const now = input.now ?? new Date()
  const rawToken = crypto.randomBytes(32).toString('base64url')
  const invite = await prisma.$transaction(
    async (tx) => {
      const actor = await findActiveHuman(tx, input.roomId, input.actorUserId)
      if (!actor || !canReviewJoinRequest(actor.role as 'owner' | 'admin' | 'member', true)) {
        throw new RoomPolicyError(
          'room_admin_forbidden',
          'Only the active Room owner can create invitations.',
        )
      }
      if (actor.room.status !== 'active') {
        throw new RoomPolicyError('room_not_found', 'Active Room is required.')
      }
      if (actor.room.conversationKind && actor.room.conversationKind !== 'group') {
        throw new RoomPolicyError('room_read_forbidden', 'This conversation has no Room invite.')
      }
      return tx.roomInvite.create({
        data: {
          roomId: input.roomId,
          tokenHash: hashRoomInviteCapability(rawToken),
          createdByUserId: input.actorUserId,
          expiresAt: new Date(now.getTime() + options.expiresInDays * 24 * 60 * 60 * 1000),
          maxUses: options.maxUses,
        },
      })
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  return { invite, rawToken }
}

function canonicalInviteToken(roomId: string, version: number): string {
  const secret =
    process.env.ROOM_CAPABILITY_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me'
  return crypto
    .createHmac('sha256', secret)
    .update(`canonical-room-invite:${roomId}:${version}`, 'utf8')
    .digest('base64url')
}

export async function getCanonicalRoomInvite(input: { roomId: string; actorUserId: string }) {
  return prisma.$transaction(
    async (tx) => {
      const actor = await findActiveHuman(tx, input.roomId, input.actorUserId)
      if (!actor) {
        throw new RoomPolicyError(
          'room_read_forbidden',
          'An active Room membership is required to view its invitation link.',
        )
      }
      if (actor.room.status !== 'active') {
        throw new RoomPolicyError('room_not_found', 'Active Room is required.')
      }
      if (actor.room.conversationKind && actor.room.conversationKind !== 'group') {
        throw new RoomPolicyError('room_read_forbidden', 'This conversation has no Room invite.')
      }
      let version = actor.room.inviteVersion
      let rawToken = canonicalInviteToken(input.roomId, version)
      let tokenHash = hashRoomInviteCapability(rawToken)
      const existing = await tx.roomInvite.findUnique({ where: { tokenHash } })
      if (existing?.status === 'active') return { invite: existing, rawToken, version }
      if (existing) {
        const room = await tx.room.update({
          where: { id: input.roomId },
          data: { inviteVersion: { increment: 1 } },
        })
        version = room.inviteVersion
        rawToken = canonicalInviteToken(input.roomId, version)
        tokenHash = hashRoomInviteCapability(rawToken)
      }
      const invite = await tx.roomInvite.create({
        data: {
          roomId: input.roomId,
          tokenHash,
          createdByUserId: input.actorUserId,
          expiresAt: null,
          maxUses: null,
        },
      })
      return { invite, rawToken, version }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function resetCanonicalRoomInvite(input: {
  roomId: string
  actorUserId: string
  expectedVersion?: number
  now?: Date
}) {
  return prisma.$transaction(
    async (tx) => {
      const actor = await findActiveHuman(tx, input.roomId, input.actorUserId)
      if (!actor || actor.role !== 'owner' || actor.room.createdByUserId !== input.actorUserId) {
        throw new RoomPolicyError(
          'room_owner_forbidden',
          'Only the Room creator can reset its invitation link.',
        )
      }
      if (actor.room.status !== 'active') {
        throw new RoomPolicyError('room_not_found', 'Active Room is required.')
      }
      if (actor.room.conversationKind && actor.room.conversationKind !== 'group') {
        throw new RoomPolicyError('room_admin_forbidden', 'This conversation has no Room invite.')
      }
      if (
        input.expectedVersion !== undefined &&
        actor.room.inviteVersion !== input.expectedVersion
      ) {
        if (actor.room.inviteVersion === input.expectedVersion + 1) {
          const rawToken = canonicalInviteToken(input.roomId, actor.room.inviteVersion)
          const invite = await tx.roomInvite.findUnique({
            where: { tokenHash: hashRoomInviteCapability(rawToken) },
          })
          if (invite?.status === 'active') {
            return {
              invite,
              rawToken,
              version: actor.room.inviteVersion,
              idempotent: true,
            }
          }
        }
        throw new RoomPolicyError(
          'room_invite_version_conflict',
          'The Room invitation changed after it was read. Get it again before resetting.',
        )
      }
      const now = input.now ?? new Date()
      const room = await tx.room.update({
        where: { id: input.roomId },
        data: { inviteVersion: { increment: 1 } },
      })
      await tx.roomInviteBrowserState.updateMany({
        where: { invite: { roomId: input.roomId }, status: 'active' },
        data: { status: 'revoked' },
      })
      await tx.roomInvite.updateMany({
        where: { roomId: input.roomId, status: 'active', targetUserId: null },
        data: { status: 'revoked', revokedAt: now },
      })
      const rawToken = canonicalInviteToken(input.roomId, room.inviteVersion)
      const invite = await tx.roomInvite.create({
        data: {
          roomId: input.roomId,
          tokenHash: hashRoomInviteCapability(rawToken),
          createdByUserId: input.actorUserId,
          expiresAt: null,
          maxUses: null,
        },
      })
      return { invite, rawToken, version: room.inviteVersion, idempotent: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function revokeRoomInvite(input: {
  roomId: string
  inviteId: string
  actorUserId: string
  now?: Date
}) {
  return prisma.$transaction(
    async (tx) => {
      const actor = await findActiveHuman(tx, input.roomId, input.actorUserId)
      if (!actor || !canReviewJoinRequest(actor.role as 'owner' | 'admin' | 'member', true)) {
        throw new RoomPolicyError(
          'room_admin_forbidden',
          'Only the active Room owner can revoke invitations.',
        )
      }
      const invite = await tx.roomInvite.findUnique({ where: { id: input.inviteId } })
      if (!invite || invite.roomId !== input.roomId) {
        throw new RoomPolicyError('invite_not_found', 'Invitation does not exist in this Room.')
      }
      if (invite.status !== 'active') return { invite, idempotent: true }
      const updated = await tx.roomInvite.update({
        where: { id: invite.id },
        data: { status: 'revoked', revokedAt: input.now ?? new Date() },
      })
      await tx.roomInviteBrowserState.updateMany({
        where: { inviteId: invite.id, status: 'active' },
        data: { status: 'revoked' },
      })
      return { invite: updated, idempotent: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function joinRoomFromBrowserState(input: {
  browserState: unknown
  applicantUserId: string
  expectedRoomId?: string
  message?: string
  now?: Date
}) {
  if (typeof input.browserState !== 'string' || !BROWSER_STATE.test(input.browserState)) {
    throw new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.')
  }
  const message = normalizeJoinMessage(input.message)
  const now = input.now ?? new Date()
  try {
    return await prisma.$transaction(
      async (tx) => {
        const state = await tx.roomInviteBrowserState.findUnique({
          where: { stateHash: hashRoomInviteCapability(input.browserState as string) },
          include: { invite: { include: { room: true } } },
        })
        if (!state || state.expiresAt <= now) throw inviteUnavailable()
        const invite = state.invite
        if (invite.targetUserId != null) throw inviteUnavailable()
        if (input.expectedRoomId != null && invite.roomId !== input.expectedRoomId)
          throw inviteUnavailable()
        if (state.status === 'consumed') {
          const pending = await tx.roomJoinRequest.findUnique({
            where: { pendingKey: buildPendingJoinKey(invite.roomId, input.applicantUserId) },
          })
          if (pending) {
            return {
              outcome: 'pending_approval' as const,
              roomId: invite.roomId,
              joinRequest: pending,
              idempotent: true,
            }
          }
          const joined = await tx.roomMembership.findUnique({
            where: {
              roomId_principalKey: {
                roomId: invite.roomId,
                principalKey: `human:${input.applicantUserId}`,
              },
            },
          })
          if (joined?.status === 'active') {
            return {
              outcome: 'joined' as const,
              roomId: invite.roomId,
              membership: joined,
              idempotent: true,
            }
          }
          throw inviteUnavailable()
        }
        if (state.status !== 'active') throw inviteUnavailable()
        const user = await requireNamedUser(tx, input.applicantUserId)
        const existing = await tx.roomMembership.findUnique({
          where: {
            roomId_principalKey: { roomId: invite.roomId, principalKey: `human:${user.id}` },
          },
        })
        if (existing?.status === 'active') {
          await consumeBrowserState(tx, state.id, now)
          return {
            outcome: 'joined' as const,
            roomId: invite.roomId,
            membership: existing,
            idempotent: true,
          }
        }
        const result = resolveInviteJoinResult({
          roomStatus: invite.room.status as 'active' | 'archived' | 'deleted',
          visibility: invite.room.visibility as 'private' | 'public_read',
          joinPolicy: invite.room.joinPolicy as 'open' | 'approval' | 'closed',
          inviteActive: invite.status === 'active',
          inviteExpired: invite.expiresAt != null && invite.expiresAt <= now,
          inviteUseCount: invite.useCount,
          inviteMaxUses: invite.maxUses,
        })
        if (result === 'closed') throw inviteUnavailable()
        const activeHumanCount = await tx.roomMembership.count({
          where: { roomId: invite.roomId, principalType: 'human', status: 'active' },
        })
        assertHumanRoomCapacity({
          activeHumanCount,
          maxHumanMembers: invite.room.maxHumanMembers,
        })

        if (result === 'pending_approval') {
          const pendingKey = buildPendingJoinKey(invite.roomId, user.id)
          const pending = await tx.roomJoinRequest.findUnique({ where: { pendingKey } })
          if (pending) {
            await consumeBrowserState(tx, state.id, now)
            return {
              outcome: 'pending_approval' as const,
              roomId: invite.roomId,
              joinRequest: pending,
              idempotent: true,
            }
          }
          if (!message) {
            throw new RoomPolicyError(
              'join_message_required',
              'A short introduction and reason are required to request access.',
            )
          }
          const joinRequest = await tx.roomJoinRequest.create({
            data: {
              roomId: invite.roomId,
              inviteId: invite.id,
              applicantUserId: user.id,
              pendingKey,
              message,
            },
          })
          await tx.roomInvite.update({
            where: { id: invite.id },
            data: { requestCount: { increment: 1 } },
          })
          await consumeBrowserState(tx, state.id, now)
          return {
            outcome: 'pending_approval' as const,
            roomId: invite.roomId,
            joinRequest,
            idempotent: false,
          }
        }

        const membership = await activateHumanMembership(tx, {
          roomId: invite.roomId,
          userId: user.id,
          displayName: user.name.trim(),
          existing,
          historyFromSequence: invite.room.nextSequence + 1n,
          now,
        })
        const systemMessage = await appendSystemMessage(tx, {
          roomId: invite.roomId,
          author: membership,
          text: `${membership.displayAlias} joined the Room.`,
          clientMessageId: `system:membership-joined:${membership.id}:${membership.membershipEpoch}`,
        })
        await consumeInviteUse(tx, invite)
        await consumeBrowserState(tx, state.id, now)
        return {
          outcome: 'joined' as const,
          roomId: invite.roomId,
          membership,
          message: systemMessage,
          idempotent: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const recovered = await recoverPendingJoin(input.browserState, input.applicantUserId, now)
    if (recovered && (input.expectedRoomId == null || recovered.roomId === input.expectedRoomId))
      return recovered
    throw error
  }
}

/** A shared stable Room link may admit a signed-in human when joining is open. */
export async function joinOpenRoomFromLink(input: { roomId: string; userId: string; now?: Date }) {
  const now = input.now ?? new Date()
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: input.roomId } })
    if (room?.status !== 'active' || room.joinPolicy !== 'open' ||
        (room.conversationKind && room.conversationKind !== 'group')) {
      throw new RoomPolicyError('room_join_unavailable', 'This conversation is not open to join.')
    }
    const user = await requireNamedUser(tx, input.userId)
    const existing = await tx.roomMembership.findUnique({
      where: { roomId_principalKey: { roomId: input.roomId, principalKey: `human:${user.id}` } },
    })
    if (existing?.status === 'active') return { membership: existing, message: null, joined: false }
    const activeHumanCount = await tx.roomMembership.count({
      where: { roomId: input.roomId, principalType: 'human', status: 'active' },
    })
    assertHumanRoomCapacity({ activeHumanCount, maxHumanMembers: room.maxHumanMembers })
    const membership = await activateHumanMembership(tx, {
      roomId: input.roomId,
      userId: user.id,
      displayName: user.name.trim(),
      existing,
      historyFromSequence: room.nextSequence + 1n,
      now,
    })
    const message = await appendSystemMessage(tx, {
      roomId: input.roomId,
      author: membership,
      text: `${membership.displayAlias} joined the Room.`,
      clientMessageId: `system:membership-joined:${membership.id}:${membership.membershipEpoch}`,
    })
    return { membership, message, joined: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function reviewRoomJoinRequest(input: {
  roomId: string
  requestId: string
  reviewerUserId: string
  decision: ReviewDecision
  now?: Date
}) {
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw new RoomPolicyError('invalid_review_decision', 'Review decision is invalid.')
  }
  const now = input.now ?? new Date()
  return prisma.$transaction(
    async (tx) => {
      const reviewer = await findActiveHuman(tx, input.roomId, input.reviewerUserId)
      if (!reviewer || !canReviewJoinRequest(reviewer.role as 'owner' | 'admin' | 'member', true)) {
        throw new RoomPolicyError(
          'room_admin_forbidden',
          'Only the active Room owner can review requests.',
        )
      }
      const request = await tx.roomJoinRequest.findUnique({
        where: { id: input.requestId },
        include: {
          invite: true,
          applicant: true,
          room: true,
          pendingBinding: { include: { agentIdentity: true } },
        },
      })
      if (!request || request.roomId !== input.roomId) {
        throw new RoomPolicyError(
          'join_request_not_found',
          'Join request does not exist in this Room.',
        )
      }
      if (request.status !== 'pending') {
        return {
          outcome: request.status as 'approved' | 'rejected' | 'cancelled',
          request,
          idempotent: true,
        }
      }
      const claimed = await tx.roomJoinRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { pendingKey: null, reviewedByUserId: input.reviewerUserId, reviewedAt: now },
      })
      if (claimed.count !== 1) {
        const latest = await tx.roomJoinRequest.findUnique({ where: { id: request.id } })
        if (!latest)
          throw new RoomPolicyError(
            'join_request_not_found',
            'Join request does not exist in this Room.',
          )
        return {
          outcome: latest.status as 'approved' | 'rejected' | 'cancelled',
          request: latest,
          idempotent: true,
        }
      }
      if (input.decision === 'reject') {
        if (request.pendingBindingId) {
          await tx.roomBinding.updateMany({
            where: { id: request.pendingBindingId, status: 'pending_approval' },
            data: { status: 'detached', activationMode: 'paused' },
          })
        }
        const rejected = await tx.roomJoinRequest.update({
          where: { id: request.id },
          data: {
            status: 'rejected',
            pendingKey: null,
            reviewedByUserId: input.reviewerUserId,
            reviewedAt: now,
          },
        })
        return { outcome: 'rejected' as const, request: rejected, idempotent: false }
      }
      if (request.room.status !== 'active')
        throw new RoomPolicyError('room_not_found', 'Active Room is required.')
      if (request.invite.maxUses != null && request.invite.useCount >= request.invite.maxUses) {
        throw inviteUnavailable()
      }
      const user = await requireNamedUser(tx, request.applicantUserId)
      const existing = await tx.roomMembership.findUnique({
        where: { roomId_principalKey: { roomId: input.roomId, principalKey: `human:${user.id}` } },
      })
      const alreadyActive = existing?.status === 'active'
      if (!alreadyActive) {
        const activeHumanCount = await tx.roomMembership.count({
          where: { roomId: input.roomId, principalType: 'human', status: 'active' },
        })
        assertHumanRoomCapacity({
          activeHumanCount,
          maxHumanMembers: request.room.maxHumanMembers,
        })
      }
      const membership = alreadyActive
        ? existing
        : await activateHumanMembership(tx, {
            roomId: input.roomId,
            userId: user.id,
            displayName: user.name.trim(),
            existing,
            historyFromSequence: request.room.nextSequence + 1n,
            now,
          })
      let systemMessage = null
      if (!alreadyActive) {
        systemMessage = await appendSystemMessage(tx, {
          roomId: input.roomId,
          author: reviewer,
          text: `${membership.displayAlias} joined the Room.`,
          clientMessageId: `system:membership-joined:${membership.id}:${membership.membershipEpoch}`,
        })
        await consumeInviteUse(tx, request.invite)
      }
      const activatedAgent = request.pendingBinding
        ? await activatePendingAgentBinding(tx, {
            roomId: input.roomId,
            humanMembership: membership,
            binding: request.pendingBinding,
            room: request.room,
          })
        : null
      const approved = await tx.roomJoinRequest.update({
        where: { id: request.id },
        data: {
          status: 'approved',
          pendingKey: null,
          reviewedByUserId: input.reviewerUserId,
          reviewedAt: now,
        },
      })
      return {
        outcome: 'approved' as const,
        request: approved,
        membership,
        agentMembership: activatedAgent?.agentMembership ?? null,
        binding: activatedAgent?.binding ?? null,
        message: systemMessage,
        idempotent: alreadyActive && !activatedAgent,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function cancelRoomJoinRequest(input: {
  roomId: string
  requestId: string
  applicantUserId: string
  now?: Date
}) {
  return prisma.$transaction(
    async (tx) => {
      const request = await tx.roomJoinRequest.findUnique({ where: { id: input.requestId } })
      if (
        !request ||
        request.roomId !== input.roomId ||
        request.applicantUserId !== input.applicantUserId
      ) {
        throw new RoomPolicyError(
          'join_request_not_found',
          'Join request does not exist for this user.',
        )
      }
      if (request.status !== 'pending') return { request, idempotent: true }
      if (request.pendingBindingId) {
        await tx.roomBinding.updateMany({
          where: { id: request.pendingBindingId, status: 'pending_approval' },
          data: { status: 'detached', activationMode: 'paused' },
        })
      }
      const cancelled = await tx.roomJoinRequest.update({
        where: { id: request.id },
        data: { status: 'cancelled', pendingKey: null, reviewedAt: input.now ?? new Date() },
      })
      return { request: cancelled, idempotent: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function leaveRoom(input: { roomId: string; userId: string; now?: Date }) {
  return prisma.$transaction(
    async (tx) => {
      const membership = await findActiveHuman(tx, input.roomId, input.userId)
      if (!membership)
        return {
          leftMembershipIds: [] as string[],
          detachedBindingCount: 0,
          committedSessionDeletions: [],
          messages: [],
          idempotent: true,
        }
      if (membership.room.conversationKind === 'published_ai') {
        const [control, direct] = await Promise.all([
          tx.conversationWriteControl.findUnique({ where: { name: 'published_ai' },
            select: { mode: true } }),
          tx.agentDirectConversation.findUnique({ where: { roomId: input.roomId },
            select: { canonicalState: true } }),
        ])
        if (control?.mode !== 'canonical' || direct?.canonicalState !== 'ready') {
          throw new RoomPolicyError('room_not_found', 'Conversation is not available.')
        }
      }
      const removingArchivedRecord = membership.room.status === 'archived'
      if (membership.room.status !== 'active' && !removingArchivedRecord) {
        throw new RoomPolicyError('room_not_found', 'Active or archived Room is required.')
      }
      if (membership.role === 'owner' && !removingArchivedRecord) {
        throw new RoomPolicyError(
          'owner_leave_forbidden',
          'The Room owner must dissolve the Room instead of leaving.',
        )
      }
      const children = await tx.roomMembership.findMany({
        where: { roomId: input.roomId, parentHumanMembershipId: membership.id, status: 'active' },
        select: {
          id: true,
          principalType: true,
          ownerUserId: true,
          displayAlias: true,
          membershipEpoch: true,
          binding: { select: { nianSessionId: true, userId: true } },
        },
      })
      const ids = [membership.id, ...children.map((child) => child.id)]
      const sessionCleanupTargets = removingArchivedRecord
        ? []
        : children.flatMap((child) =>
            child.binding?.nianSessionId
              ? [{ sessionId: child.binding.nianSessionId, userId: child.binding.userId }]
              : [],
          )
      const now = input.now ?? new Date()
      const messages = []
      if (!removingArchivedRecord) {
        for (const member of [...children, membership]) {
          messages.push(
            await appendSystemMessage(tx, {
              roomId: input.roomId,
              author: member,
              text: `${member.displayAlias} left the Room.`,
              clientMessageId: `system:membership-left:${member.id}:${member.membershipEpoch}`,
            }),
          )
        }
      }
      const historyThroughSequence = messages.at(-1)?.sequence ?? membership.room.nextSequence
      await tx.roomMembership.updateMany({
        where: { id: { in: ids }, status: 'active' },
        data: { status: 'left', removedAt: now, historyThroughSequence },
      })
      const detached = await tx.roomBinding.updateMany({
        where: { agentMembershipId: { in: ids } },
        data: { status: 'detached', activationMode: 'paused' },
      })
      const committedSessionDeletions = await commitExclusiveRoomSessionDeletions(
        tx,
        sessionCleanupTargets,
        now,
      )
      return {
        leftMembershipIds: ids,
        detachedBindingCount: detached.count,
        committedSessionDeletions,
        messages,
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export { deleteRoomRecord } from './room-record.js'

async function findActiveHuman(tx: Prisma.TransactionClient, roomId: string, userId: string) {
  const membership = await tx.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  return membership?.principalType === 'human' && membership.status === 'active' ? membership : null
}

export async function requireNamedUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
  if (!user) throw new RoomPolicyError('user_not_found', 'User does not exist.')
  if (!user.name.trim())
    throw new RoomPolicyError('profile_name_required', 'Set a display name before joining a Room.')
  return user
}

export async function activateHumanMembership(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string
    userId: string
    displayName: string
    existing: { id: string; membershipEpoch: number } | null
    historyFromSequence: bigint
    now: Date
  },
) {
  const displayAlias = input.existing
    ? null
    : await allocateRoomDisplayAlias(tx, input.roomId, input.displayName)
  const membership = input.existing
    ? await tx.roomMembership.update({
        where: { id: input.existing.id },
        data: {
          role: 'member',
          status: 'active',
          historyFromSequence: input.historyFromSequence,
          historyThroughSequence: null,
          membershipEpoch: { increment: 1 },
          joinedAt: input.now,
          removedAt: null,
        },
      })
    : await tx.roomMembership.create({
        data: {
          roomId: input.roomId,
          principalType: 'human',
          principalKey: buildRoomPrincipalKey({
            principalType: 'human',
            userId: input.userId,
            ownerUserId: input.userId,
          }),
          userId: input.userId,
          ownerUserId: input.userId,
          displayAlias: displayAlias!,
          role: 'member',
          historyFromSequence: input.historyFromSequence,
          joinedAt: input.now,
        },
      })
  await tx.roomReadState.upsert({
    where: { membershipId: membership.id },
    create: {
      roomId: input.roomId,
      membershipId: membership.id,
      lastReadSequence: input.historyFromSequence - 1n,
      lastDeliveredSequence: input.historyFromSequence - 1n,
    },
    update: {
      lastReadSequence: input.historyFromSequence - 1n,
      lastDeliveredSequence: input.historyFromSequence - 1n,
    },
  })
  return membership
}

export async function appendSystemMessage(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string
    author: { id: string; principalType: string; ownerUserId: string; displayAlias: string }
    text: string
    clientMessageId: string
  },
) {
  const room = await tx.room.update({
    where: { id: input.roomId },
    data: { nextSequence: { increment: 1 } },
    select: { nextSequence: true },
  })
  return tx.roomMessage.create({
    data: {
      roomId: input.roomId,
      sequence: room.nextSequence,
      authorMembershipId: input.author.id,
      authorPrincipalTypeSnapshot: input.author.principalType,
      ownerUserIdSnapshot: input.author.ownerUserId,
      authorDisplayNameSnapshot: input.author.displayAlias,
      ownerDisplayNameSnapshot: input.author.displayAlias,
      kind: 'system',
      source: 'system',
      text: input.text,
      clientMessageId: input.clientMessageId,
    },
  })
}

async function consumeBrowserState(tx: Prisma.TransactionClient, id: string, now: Date) {
  await tx.roomInviteBrowserState.update({
    where: { id },
    data: { status: 'consumed', consumedAt: now, lastSeenAt: now },
  })
}

export async function consumeInviteUse(
  tx: Prisma.TransactionClient,
  invite: { id: string; maxUses: number | null },
) {
  if (invite.maxUses == null) {
    await tx.roomInvite.update({ where: { id: invite.id }, data: { useCount: { increment: 1 } } })
    return
  }
  const consumed = await tx.roomInvite.updateMany({
    where: { id: invite.id, status: 'active', useCount: { lt: invite.maxUses } },
    data: { useCount: { increment: 1 } },
  })
  if (consumed.count !== 1) throw inviteUnavailable()
}

async function activatePendingAgentBinding(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string
    humanMembership: { id: string; historyFromSequence: bigint }
    binding: {
      id: string
      userId: string
      agentIdentityId: string
      activationMode: string
      status: string
      agentIdentity: { id: string; displayName: string }
    }
    room: {
      ownerUserId: string
      maxAgentsPerUser: number
      maxAgentsPerRoom: number
      maxAutoFollowAgents: number
    }
  },
) {
  if (input.binding.status !== 'pending_approval') {
    throw new RoomPolicyError(
      'pending_binding_unavailable',
      'The pending Agent binding is unavailable.',
    )
  }
  const displayAlias = await allocateRoomDisplayAlias(
    tx,
    input.roomId,
    input.binding.agentIdentity.displayName,
  )
  const agentMembership = await tx.roomMembership.create({
    data: {
      roomId: input.roomId,
      principalType: 'agent',
      principalKey: buildRoomPrincipalKey({
        principalType: 'agent',
        agentIdentityId: input.binding.agentIdentityId,
        ownerUserId: input.binding.userId,
        parentHumanMembershipId: input.humanMembership.id,
      }),
      agentIdentityId: input.binding.agentIdentityId,
      ownerUserId: input.binding.userId,
      parentHumanMembershipId: input.humanMembership.id,
      displayAlias,
      role: 'member',
      historyFromSequence: input.humanMembership.historyFromSequence,
    },
  })
  await tx.roomReadState.create({
    data: {
      roomId: input.roomId,
      membershipId: agentMembership.id,
      lastReadSequence: input.humanMembership.historyFromSequence - 1n,
      lastDeliveredSequence: input.humanMembership.historyFromSequence - 1n,
    },
  })
  const binding = await tx.roomBinding.update({
    where: { id: input.binding.id },
    data: {
      agentMembershipId: agentMembership.id,
      status: input.binding.activationMode === 'paused' ? 'paused' : 'active',
    },
  })
  return { agentMembership, binding }
}

async function recoverPendingJoin(browserState: unknown, applicantUserId: string, now: Date) {
  if (typeof browserState !== 'string') return null
  return prisma.$transaction(
    async (tx) => {
      const state = await tx.roomInviteBrowserState.findUnique({
        where: { stateHash: hashRoomInviteCapability(browserState) },
        include: { invite: true },
      })
      if (!state || state.expiresAt <= now) return null
      const pending = await tx.roomJoinRequest.findUnique({
        where: { pendingKey: buildPendingJoinKey(state.invite.roomId, applicantUserId) },
      })
      if (!pending) return null
      if (state.status === 'active') await consumeBrowserState(tx, state.id, now)
      return {
        outcome: 'pending_approval' as const,
        roomId: state.invite.roomId,
        joinRequest: pending,
        idempotent: true,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function inviteUnavailable(): RoomPolicyError {
  return new RoomPolicyError('room_invite_unavailable', 'This Room invitation is unavailable.')
}
