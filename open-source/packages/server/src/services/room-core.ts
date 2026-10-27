// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-core.test.ts

import crypto from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  buildRoomPrincipalKey,
  canRemoveMembership,
  DEFAULT_ROOM_LIMITS,
  normalizeRoomMemberAgentLimit,
  RoomPolicyError,
} from './room-policy.js'
import { publicUserAvatar } from './user-avatar.js'
import { publicAgentAvatar } from './agent-avatar.js'
import { commitExclusiveRoomSessionDeletions } from './room-session-cleanup.js'
import { appendSystemMessage } from './room-membership.js'
import { advanceReadStateForOwnMessage } from './room-read-state.js'

const MAX_ROOM_NAME_LENGTH = 80
const MAX_ROOM_TEXT_LENGTH = 20_000
const MAX_ROOM_MENTIONS = 20
const MAX_ROOM_ATTACHMENTS = 10

export function normalizeRoomName(value: string): string {
  const name = value.trim()
  if (!name) throw new RoomPolicyError('room_name_required', 'Room name is required.')
  if (/^(?:undefined|null)$/i.test(name)) {
    throw new RoomPolicyError('room_name_invalid', 'Room name is invalid.')
  }
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    throw new RoomPolicyError('room_name_too_long', 'Room name is too long.')
  }
  return name
}

export function normalizeRoomText(value: string): string {
  const text = value.trim()
  if (!text) throw new RoomPolicyError('room_text_required', 'Message text is required.')
  if (text.length > MAX_ROOM_TEXT_LENGTH) {
    throw new RoomPolicyError('room_text_too_long', 'Message text is too long.')
  }
  return text
}

export function normalizeRoomAccess(input: { visibility?: string; joinPolicy?: string }): {
  visibility: 'private' | 'public_read'
  joinPolicy: 'open' | 'approval' | 'closed'
} {
  const visibility = input.visibility ?? 'private'
  const joinPolicy = input.joinPolicy ?? 'open'
  if (visibility !== 'private' && visibility !== 'public_read') {
    throw new RoomPolicyError('invalid_room_visibility', 'Room visibility is invalid.')
  }
  if (joinPolicy !== 'open' && joinPolicy !== 'approval' && joinPolicy !== 'closed') {
    throw new RoomPolicyError('invalid_room_join_policy', 'Room join policy is invalid.')
  }
  return { visibility, joinPolicy }
}

export async function createRoomWithOwner(input: {
  userId: string
  name: string
  clientOperationId?: string
  visibility?: 'private' | 'public_read'
  joinPolicy?: 'open' | 'approval' | 'closed'
  officialSequence?: number
}) {
  const name = normalizeRoomName(input.name)
  const access = normalizeRoomAccess(input)
  const roomId = input.clientOperationId
    ? `room_cli_${crypto.createHash('sha256').update(`${input.userId}:${input.clientOperationId}`).digest('hex').slice(0, 32)}`
    : undefined
  return prisma.$transaction(
    (tx) => createRoomWithOwnerInTransaction(tx, { ...input, name, ...access, roomId }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function createRoomWithOwnerInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    name: string
    visibility: 'private' | 'public_read'
    joinPolicy: 'open' | 'approval' | 'closed'
    officialSequence?: number
    roomId?: string
    creationRequestHash?: string
  },
) {
  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true },
  })
  if (!user) throw new RoomPolicyError('user_not_found', 'User does not exist.')
  if (!user.name.trim()) {
    throw new RoomPolicyError(
      'profile_name_required',
      'Set a display name before creating or joining a Room.',
    )
  }

  if (input.roomId) {
    const existing = await tx.room.findUnique({ where: { id: input.roomId } })
    if (existing) {
      if (
        existing.createdByUserId !== user.id ||
        existing.ownerUserId !== user.id ||
        existing.name !== input.name ||
        existing.visibility !== input.visibility ||
        existing.joinPolicy !== input.joinPolicy ||
        (input.creationRequestHash !== undefined
          && existing.creationRequestHash !== input.creationRequestHash)
      ) {
        throw new RoomPolicyError(
          'room_operation_conflict',
          'This Room create operation was already used with different input.',
        )
      }
      const membership = await tx.roomMembership.findUnique({
        where: {
          roomId_principalKey: { roomId: existing.id, principalKey: `human:${user.id}` },
        },
      })
      if (!membership) {
        throw new RoomPolicyError('room_operation_conflict', 'The prior Room create is incomplete.')
      }
      return { room: existing, membership, idempotent: true }
    }
  }

  const room = await tx.room.create({
    data: {
      ...(input.roomId ? { id: input.roomId } : {}),
      ...(input.creationRequestHash ? { creationRequestHash: input.creationRequestHash } : {}),
      name: input.name,
      createdByUserId: user.id,
      ownerUserId: user.id,
      visibility: input.visibility,
      joinPolicy: input.joinPolicy,
      ...(input.officialSequence === undefined
        ? {}
        : { officialSequence: input.officialSequence }),
    },
  })
  const membership = await tx.roomMembership.create({
    data: {
      roomId: room.id,
      principalType: 'human',
      principalKey: buildRoomPrincipalKey({
        principalType: 'human',
        userId: user.id,
        ownerUserId: user.id,
      }),
      userId: user.id,
      ownerUserId: user.id,
      displayAlias: user.name.trim(),
      role: 'owner',
      historyFromSequence: 1,
    },
  })
  await tx.roomReadState.create({
    data: { roomId: room.id, membershipId: membership.id },
  })
  return { room, membership, idempotent: false }
}

export async function updateRoomSettings(input: {
  roomId: string
  actorUserId: string
  expectedUpdatedAt?: Date
  name?: string
  visibility?: 'private' | 'public_read'
  joinPolicy?: 'open' | 'approval' | 'closed'
  maxAgentsPerMember?: number
}) {
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.roomMembership.findUnique({
        where: {
          roomId_principalKey: {
            roomId: input.roomId,
            principalKey: buildRoomPrincipalKey({
              principalType: 'human',
              userId: input.actorUserId,
              ownerUserId: input.actorUserId,
            }),
          },
        },
        include: { room: true },
      })
      if (!actor || actor.status !== 'active' || actor.room.status !== 'active') {
        throw new RoomPolicyError(
          'room_admin_forbidden',
          'Active human Room membership is required.',
        )
      }
      if (actor.room.conversationKind && actor.room.conversationKind !== 'group') {
        throw new RoomPolicyError('room_admin_forbidden', 'This conversation has dedicated settings.')
      }
      const changesAccess = input.visibility !== undefined || input.joinPolicy !== undefined
      const changesCapacity = input.maxAgentsPerMember !== undefined
      if ((changesAccess || changesCapacity) && actor.role !== 'owner') {
        throw new RoomPolicyError(
          'room_admin_forbidden',
          'Only the active Room owner can change Room settings.',
        )
      }

      const name = input.name == null ? actor.room.name : normalizeRoomName(input.name)
      const access = normalizeRoomAccess({
        visibility: input.visibility ?? actor.room.visibility,
        joinPolicy: input.joinPolicy ?? actor.room.joinPolicy,
      })
      const maxAgentsPerUser =
        input.maxAgentsPerMember === undefined
          ? (actor.room.maxAgentsPerUser ?? DEFAULT_ROOM_LIMITS.maxAgentsPerUser)
          : normalizeRoomMemberAgentLimit(input.maxAgentsPerMember)
      const unchanged =
        name === actor.room.name &&
        access.visibility === actor.room.visibility &&
        access.joinPolicy === actor.room.joinPolicy &&
        (!changesCapacity || maxAgentsPerUser === actor.room.maxAgentsPerUser)
      if (
        input.expectedUpdatedAt &&
        actor.room.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        if (unchanged) return { room: actor.room, message: null, idempotent: true }
        throw new RoomPolicyError(
          'room_version_conflict',
          'The Room changed after it was read. Read it again before updating.',
        )
      }
      if (
        unchanged
      ) {
        return { room: actor.room, message: null, idempotent: true }
      }

      const room = await tx.room.update({
        where: { id: input.roomId },
        data: {
          name,
          visibility: access.visibility,
          joinPolicy: access.joinPolicy,
          ...(changesCapacity ? { maxAgentsPerUser } : {}),
        },
      })
      const message = name !== actor.room.name
        ? await appendSystemMessage(tx, {
            roomId: input.roomId,
            author: actor,
            text: `${actor.displayAlias} changed the group chat name to “${name}”.`,
            clientMessageId: `system:room-renamed:${crypto.randomUUID()}`,
          })
        : null
      return {
        room: message ? { ...room, nextSequence: message.sequence } : room,
        message,
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function sendRoomTextMessage(input: {
  roomId: string
  authorMembershipId: string
  clientMessageId: string
  text: string
  mentionMembershipIds?: string[]
  replyToMessageId?: string
  requiredBinding?: { bindingId: string; userId: string; machineId: string }
  activationCauseMessageId?: string
  attachmentIds?: string[]
  source?: 'app' | 'cli' | 'managed_agent'
}) {
  const attachmentIds = [
    ...new Set((input.attachmentIds ?? []).filter((id) => typeof id === 'string' && id.length > 0)),
  ]
  if (attachmentIds.length > MAX_ROOM_ATTACHMENTS) {
    throw new RoomPolicyError('room_attachments_too_many', 'A message has too many attachments.')
  }
  const text = input.text.trim()
  if (!text && attachmentIds.length === 0) {
    throw new RoomPolicyError('room_message_empty', 'Message text or an attachment is required.')
  }
  if (text.length > MAX_ROOM_TEXT_LENGTH) {
    throw new RoomPolicyError('room_text_too_long', 'Message text is too long.')
  }
  if (!input.clientMessageId.trim()) {
    throw new RoomPolicyError('client_message_id_required', 'clientMessageId is required.')
  }

  const findExisting = () =>
    prisma.roomMessage.findUnique({
      where: {
        roomId_authorMembershipId_clientMessageId: {
          roomId: input.roomId,
          authorMembershipId: input.authorMembershipId,
          clientMessageId: input.clientMessageId,
        },
      },
      include: { attachments: true },
    })

  if (!input.requiredBinding) {
    const existing = await findExisting()
    if (existing) {
      assertIdempotentMessage(existing, input, text)
      return { message: existing, idempotent: true, authorReadAdvanced: false }
    }
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        if (input.requiredBinding) {
          const binding = await tx.roomBinding.findUnique({
            where: { id: input.requiredBinding.bindingId },
          })
          if (
            !binding ||
            binding.roomId !== input.roomId ||
            binding.userId !== input.requiredBinding.userId ||
            binding.machineId !== input.requiredBinding.machineId ||
            binding.agentMembershipId !== input.authorMembershipId ||
            (binding.status !== 'active' && binding.status !== 'paused')
          ) {
            throw new RoomPolicyError(
              'room_binding_unavailable',
              'The exact Agent Room binding is unavailable.',
            )
          }
        }
        if (input.requiredBinding) {
          const existing = await tx.roomMessage.findUnique({
            where: {
              roomId_authorMembershipId_clientMessageId: {
                roomId: input.roomId,
                authorMembershipId: input.authorMembershipId,
                clientMessageId: input.clientMessageId,
              },
            },
            include: { attachments: true },
          })
          if (existing) {
            assertIdempotentMessage(existing, input, text)
            return { message: existing, idempotent: true, authorReadAdvanced: false }
          }
        }
        const membership = await tx.roomMembership.findUnique({
          where: { id: input.authorMembershipId },
          include: {
            room: true,
            ownerUser: {
              select: { id: true, name: true, avatarVersion: true, avatarUpdatedAt: true },
            },
            agentIdentity: {
              select: { id: true, avatarVersion: true, avatarUpdatedAt: true },
            },
          },
        })
        if (
          !membership ||
          membership.roomId !== input.roomId ||
          membership.status !== 'active' ||
          membership.room.status !== 'active'
        ) {
          throw new RoomPolicyError('room_write_forbidden', 'Active Room membership is required.')
        }
        if (membership.room.conversationKind === 'published_ai') {
          // Published AI sends must atomically apply the publication quota and
          // exact worker job lease. The generic Room route cannot bypass them.
          throw new RoomPolicyError('room_write_forbidden', 'Use the published AI send endpoint.')
        }
        if (membership.room.conversationKind === 'work') {
          // The mirror is not an execution queue. A separate durable Session
          // delivery contract must be in place before work Rooms can accept writes.
          throw new RoomPolicyError('room_write_forbidden', 'Work conversation delivery is unavailable.')
        }
        if (!membership.displayAlias.trim()) {
          throw new RoomPolicyError(
            'profile_name_required',
            'Set a display name before sending a Room message.',
          )
        }

        const mentionMembershipIds = [
          ...new Set(
            (Array.isArray(input.mentionMembershipIds) ? input.mentionMembershipIds : []).filter(
              (membershipId): membershipId is string =>
                typeof membershipId === 'string' && membershipId.length > 0,
            ),
          ),
        ]
        if (mentionMembershipIds.length > MAX_ROOM_MENTIONS) {
          throw new RoomPolicyError('room_mentions_too_many', 'A message has too many mentions.')
        }
        let mentionSnapshots: Array<{
          membershipId: string
          principalType: string
          displayName: string
        }> = []
        if (mentionMembershipIds.length > 0) {
          const mentionedMemberships = await tx.roomMembership.findMany({
            where: {
              id: { in: mentionMembershipIds },
              roomId: input.roomId,
              status: 'active',
            },
            select: { id: true, principalType: true, displayAlias: true },
          })
          if (mentionedMemberships.length !== mentionMembershipIds.length) {
            throw new RoomPolicyError(
              'invalid_room_mention',
              'Every mention must target an active membership in this Room.',
            )
          }
          const mentionedById = new Map(mentionedMemberships.map((item) => [item.id, item]))
          mentionSnapshots = mentionMembershipIds.map((membershipId) => {
            const mentioned = mentionedById.get(membershipId)!
            if (!text.includes(`@${mentioned.displayAlias}`)) {
              throw new RoomPolicyError(
                'invalid_room_mention',
                'A structured mention must also be visible in the message text.',
              )
            }
            return {
              membershipId: mentioned.id,
              principalType: mentioned.principalType,
              displayName: mentioned.displayAlias,
            }
          })
        }

        if (input.replyToMessageId) {
          const replyTarget = await tx.roomMessage.findUnique({
            where: { id: input.replyToMessageId },
            select: { roomId: true },
          })
          if (!replyTarget || replyTarget.roomId !== input.roomId) {
            throw new RoomPolicyError('invalid_reply_target', 'Reply target is not in this Room.')
          }
        }

        const attachments =
          attachmentIds.length > 0
            ? await tx.roomAttachment.findMany({ where: { id: { in: attachmentIds } } })
            : []
        if (
          attachments.length !== attachmentIds.length ||
          attachments.some(
            (attachment) =>
              attachment.roomId !== input.roomId ||
              attachment.uploaderMembershipId !== membership.id ||
              attachment.status !== 'ready' ||
              attachment.messageId !== null ||
              (attachment.expiresAt != null && attachment.expiresAt <= new Date()),
          )
        ) {
          throw new RoomPolicyError(
            'room_attachment_unavailable',
            'Every attachment must be ready, unexpired, uncommitted, and owned by the sender.',
          )
        }

        let activationCause: {
          causeMessageId: string
          rootCauseMessageId: string
          hopCount: number
        } | null = null
        if (input.activationCauseMessageId) {
          if (
            input.activationCauseMessageId.length > 191 ||
            /[\0\r\n]/.test(input.activationCauseMessageId)
          ) {
            throw new RoomPolicyError('invalid_activation_cause', 'Activation cause is invalid.')
          }
          if (!input.requiredBinding) {
            throw new RoomPolicyError(
              'invalid_activation_cause',
              'Only an Agent Binding can set activation causality.',
            )
          }
          const cause = await tx.roomMessage.findUnique({
            where: { id: input.activationCauseMessageId },
            select: {
              roomId: true,
              activationRootCauseMessageId: true,
              activationHopCount: true,
            },
          })
          if (!cause || cause.roomId !== input.roomId) {
            throw new RoomPolicyError(
              'invalid_activation_cause',
              'Activation cause is not in this Room.',
            )
          }
          const hopCount = (cause.activationHopCount ?? 0) + 1
          if (hopCount > 4) {
            throw new RoomPolicyError(
              'activation_hop_limit',
              'The Agent activation chain has stopped at its hop limit.',
            )
          }
          activationCause = {
            causeMessageId: input.activationCauseMessageId,
            rootCauseMessageId:
              cause.activationRootCauseMessageId ?? input.activationCauseMessageId,
            hopCount,
          }
        }

        const updatedRoom = await tx.room.update({
          where: { id: input.roomId },
          data: { nextSequence: { increment: 1 } },
          select: { nextSequence: true },
        })
        const avatarSnapshot =
          membership.principalType === 'agent'
            ? (publicAgentAvatar(membership.agentIdentity) ??
              publicUserAvatar(membership.ownerUser))
            : publicUserAvatar(membership.ownerUser)
        const message = await tx.roomMessage.create({
          data: {
            roomId: input.roomId,
            sequence: updatedRoom.nextSequence,
            authorMembershipId: membership.id,
            authorPrincipalTypeSnapshot: membership.principalType,
            ownerUserIdSnapshot: membership.ownerUserId,
            authorDisplayNameSnapshot: membership.displayAlias,
            ownerDisplayNameSnapshot: membership.ownerUser.name.trim(),
            ...(avatarSnapshot ? { authorAvatarSnapshot: avatarSnapshot } : {}),
            ...(mentionSnapshots.length > 0 ? { mentionSnapshots } : {}),
            kind: attachmentIds.length > 0 ? (text ? 'mixed' : 'attachment') : 'text',
            source: input.source ?? 'app',
            text: text || null,
            replyToMessageId: input.replyToMessageId,
            clientMessageId: input.clientMessageId,
            ...(activationCause
              ? {
                  activationCauseMessageId: activationCause.causeMessageId,
                  activationRootCauseMessageId: activationCause.rootCauseMessageId,
                  activationHopCount: activationCause.hopCount,
                }
              : {}),
          },
          include: { attachments: true },
        })
        if (attachmentIds.length > 0) {
          const attached = await tx.roomAttachment.updateMany({
            where: {
              id: { in: attachmentIds },
              roomId: input.roomId,
              uploaderMembershipId: membership.id,
              messageId: null,
              status: 'ready',
            },
            data: { messageId: message.id },
          })
          if (attached.count !== attachmentIds.length) {
            throw new RoomPolicyError(
              'room_attachment_conflict',
              'Attachment was committed concurrently.',
            )
          }
          message.attachments = attachments
        }
        const authorReadAdvanced =
          membership.principalType === 'human' &&
          (await advanceReadStateForOwnMessage(tx, {
            roomId: input.roomId,
            membershipId: membership.id,
            sequence: message.sequence,
          }))
        return { message, idempotent: false, authorReadAdvanced }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const retried = await findExisting()
      if (retried) {
        assertIdempotentMessage(retried, input, text)
        return { message: retried, idempotent: true, authorReadAdvanced: false }
      }
    }
    throw error
  }
}

function assertIdempotentMessage(
  existing: {
    text?: string | null
    replyToMessageId?: string | null
    activationCauseMessageId?: string | null
    attachments?: Array<{ id: string }>
  },
  input: {
    text: string
    replyToMessageId?: string
    activationCauseMessageId?: string
    attachmentIds?: string[]
  },
  normalizedText: string,
): void {
  if (
    (existing.text !== undefined && existing.text !== normalizedText) ||
    (existing.replyToMessageId !== undefined &&
      existing.replyToMessageId !== (input.replyToMessageId ?? null)) ||
    (existing.activationCauseMessageId ?? null) !== (input.activationCauseMessageId ?? null) ||
    (existing.attachments !== undefined &&
      [...existing.attachments.map((item) => item.id)].sort().join('\0') !==
        [...new Set(input.attachmentIds ?? [])].sort().join('\0'))
  ) {
    throw new RoomPolicyError(
      'client_message_id_conflict',
      'clientMessageId was already used for different Room message content or causality.',
    )
  }
}

export async function removeRoomMembership(input: {
  roomId: string
  actorMembershipId: string
  targetMembershipId: string
  expectedTargetVersion?: number
}) {
  return prisma.$transaction(
    async (tx) => {
      const [actor, target] = await Promise.all([
        tx.roomMembership.findUnique({ where: { id: input.actorMembershipId } }),
        tx.roomMembership.findUnique({ where: { id: input.targetMembershipId } }),
      ])
      if (!actor || actor.roomId !== input.roomId || actor.status !== 'active') {
        throw new RoomPolicyError('room_admin_forbidden', 'Active Room membership is required.')
      }
      if (!target || target.roomId !== input.roomId) {
        throw new RoomPolicyError('membership_not_found', 'Membership does not exist in this Room.')
      }
      if (
        input.expectedTargetVersion !== undefined &&
        target.membershipEpoch !== input.expectedTargetVersion
      ) {
        throw new RoomPolicyError(
          'room_member_version_conflict',
          'The Room member changed after it was read. List members again before removing.',
        )
      }
      if (target.status !== 'active') {
        return {
          removedMembershipIds: [] as string[],
          removedHumanUserIds: [] as string[],
          detachedBindingCount: 0,
          committedSessionDeletions: [],
          messages: [],
          idempotent: true,
        }
      }
      if (
        !canRemoveMembership({
          actorRole: actor.role as 'owner' | 'admin' | 'member',
          actorActive: true,
          actorOwnerUserId: actor.ownerUserId,
          targetRole: target.role as 'owner' | 'admin' | 'member',
          targetPrincipalType: target.principalType as 'human' | 'agent',
          targetOwnerUserId: target.ownerUserId,
        })
      ) {
        throw new RoomPolicyError(
          'membership_remove_forbidden',
          'This membership cannot be removed.',
        )
      }

      const descendants =
        target.principalType === 'human'
          ? await tx.roomMembership.findMany({
              where: {
                roomId: input.roomId,
                parentHumanMembershipId: target.id,
                status: 'active',
              },
              select: {
                id: true,
                principalType: true,
                ownerUserId: true,
                displayAlias: true,
                membershipEpoch: true,
                binding: { select: { nianSessionId: true, userId: true } },
              },
            })
          : []
      const removedMembershipIds = [target.id, ...descendants.map((member) => member.id)]
      const targetBinding = await tx.roomBinding.findUnique({
        where: { agentMembershipId: target.id },
        select: { nianSessionId: true, userId: true },
      })
      const sessionCleanupTargets = [targetBinding, ...descendants.map((item) => item.binding)]
        .filter(
          (binding): binding is { nianSessionId: string; userId: string } =>
            Boolean(binding?.nianSessionId),
        )
        .map((binding) => ({ sessionId: binding.nianSessionId, userId: binding.userId }))
      const now = new Date()
      const detached = await tx.roomBinding.updateMany({
        where: { agentMembershipId: { in: removedMembershipIds } },
        data: { status: 'detached', activationMode: 'paused' },
      })
      const committedSessionDeletions = await commitExclusiveRoomSessionDeletions(
        tx,
        sessionCleanupTargets,
        now,
      )

      const messages = []
      for (const member of [...descendants, target]) {
        messages.push(
          await appendSystemMessage(tx, {
            roomId: input.roomId,
            author: actor,
            text: `${member.displayAlias} was removed from the Room.`,
            clientMessageId: `system:membership-removed:${member.id}:${member.membershipEpoch}`,
          }),
        )
      }
      const historyThroughSequence = messages.at(-1)?.sequence
      await tx.roomMembership.updateMany({
        where: { id: { in: removedMembershipIds }, status: 'active' },
        data: { status: 'removed', removedAt: now, historyThroughSequence },
      })
      return {
        removedMembershipIds,
        removedHumanUserIds: target.principalType === 'human' ? [target.ownerUserId] : [],
        detachedBindingCount: detached.count,
        committedSessionDeletions,
        messages,
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function dissolveRoom(input: { roomId: string; actorUserId: string; now?: Date }) {
  return prisma.$transaction(
    async (tx) => {
      const room = await tx.room.findUnique({ where: { id: input.roomId } })
      if (!room || (room.status !== 'active' && room.status !== 'archived')) {
        throw new RoomPolicyError('room_not_found', 'Active or archived Room is required.')
      }
      if (room.conversationKind && room.conversationKind !== 'group') {
        throw new RoomPolicyError('room_owner_forbidden', 'This conversation cannot be dissolved as a Room.')
      }
      if (room.createdByUserId !== input.actorUserId || room.ownerUserId !== input.actorUserId) {
        throw new RoomPolicyError('room_owner_forbidden', 'Only the Room creator can dissolve it.')
      }
      const now = input.now ?? new Date()
      const alreadyArchived = room.status === 'archived'
      const bindings = await tx.roomBinding.findMany({
        where: {
          roomId: input.roomId,
          status: {
            in: alreadyArchived ? ['detached'] : ['pending_approval', 'active', 'paused'],
          },
          nianSessionId: { not: null },
        },
        select: { nianSessionId: true, userId: true },
      })
      const sessionCleanupTargets = bindings.flatMap((binding) =>
        binding.nianSessionId
          ? [{ sessionId: binding.nianSessionId, userId: binding.userId }]
          : [],
      )
      if (alreadyArchived) {
        const committedSessionDeletions = await commitExclusiveRoomSessionDeletions(
          tx,
          sessionCleanupTargets,
          now,
        )
        return {
          roomId: input.roomId,
          status: 'archived' as const,
          committedSessionDeletions,
          idempotent: true,
        }
      }
      await Promise.all([
        tx.roomInvite.updateMany({
          where: { roomId: input.roomId, status: 'active' },
          data: { status: 'revoked', revokedAt: now },
        }),
        tx.roomInviteBrowserState.updateMany({
          where: { invite: { roomId: input.roomId }, status: 'active' },
          data: { status: 'revoked' },
        }),
        tx.roomJoinRequest.updateMany({
          where: { roomId: input.roomId, status: 'pending' },
          data: { status: 'cancelled', pendingKey: null, reviewedAt: now },
        }),
      ])
      await tx.room.update({
        where: { id: input.roomId },
        data: { status: 'archived', joinPolicy: 'closed', archivedAt: now },
      })
      await tx.roomBinding.updateMany({
        where: {
          roomId: input.roomId,
          status: { in: ['pending_approval', 'active', 'paused'] },
        },
        data: { status: 'detached', activationMode: 'paused' },
      })
      const committedSessionDeletions = await commitExclusiveRoomSessionDeletions(
        tx,
        sessionCleanupTargets,
        now,
      )
      return {
        roomId: input.roomId,
        status: 'archived' as const,
        committedSessionDeletions,
        idempotent: false,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
