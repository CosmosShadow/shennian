// @arch open-source/docs/server-runtime.md
// @test src/__tests__/rooms-routes.test.ts

import type { FastifyInstance } from 'fastify'
import type { RoomRuntimeAdapter, RoomSummary } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireAuth,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import { createRoomWithOwner, updateRoomSettings } from '../services/room-core.js'
import { createRoomWithContactInvitations, inviteRoomSavedContacts,
  listMyTargetedRoomInvitations, listSentTargetedRoomInvitations,
  respondToTargetedRoomInvitation,
} from '../services/room-targeted-invitations.js'
import {
  createRoomInvite,
  getCanonicalRoomInvite,
  revokeRoomInvite,
  resetCanonicalRoomInvite,
} from '../services/room-membership.js'
import { createRoomBindingAtomic, restartRoomBindingSession } from '../services/room-binding.js'
import { broadcastRoomEvent, broadcastRoomMessageRecord } from '../services/room-events.js'
import { publishRoomBrowserSessionRevoked } from '../relay/connection-control.js'
import { publicUserAvatar } from '../services/user-avatar.js'
import { publicAgentAvatar } from '../services/agent-avatar.js'
import { shapeRoomMessage } from '../services/room-view.js'
import { finalizeExclusiveRoomSessionDeletions } from '../services/room-session-cleanup.js'
import {
  listRoomBrowserSessionsForUser,
  revokeRoomBrowserSessionForUser,
} from '../services/room-browser-session.js'
import { roomInviteUrl } from '../services/public-web-url.js'
import {
  deriveAgentRepairAction,
  deriveRoomBindingAvailability,
} from '../services/agent-runtime-availability.js'
import { roomMessageRetentionCutoff } from '../services/room-message-retention.js'
import {
  sendRoomError,
  shapeRoomLimits,
  findActiveHumanMembership,
  findHumanMembership,
} from './room-route-helpers.js'
import { registerRoomCollaborationRoutes } from './room-collaboration-routes.js'

export async function roomRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.post<{
    Body: {
      name?: string
      visibility?: 'private' | 'public_read'
      joinPolicy?: 'open' | 'approval' | 'closed'
      inviteeUserIds?: unknown
      clientOperationId?: unknown
    }
  }>('/', { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
    try {
      if (request.body.inviteeUserIds !== undefined
        && ((request.body.visibility !== undefined && request.body.visibility !== 'private')
          || (request.body.joinPolicy !== undefined && request.body.joinPolicy !== 'closed'))) {
        return reply.code(400).send({ error: 'room_invite_access_invalid' })
      }
      const result = request.body.inviteeUserIds === undefined
        ? await createRoomWithOwner({
            userId: request.userId,
            name: request.body.name ?? '',
            visibility: request.body.visibility,
            joinPolicy: request.body.joinPolicy,
          })
        : await createRoomWithContactInvitations({
            ownerUserId: request.userId,
            name: request.body.name ?? '',
            targetUserIds: request.body.inviteeUserIds,
            clientOperationId: request.body.clientOperationId,
          })
      const room: RoomSummary = {
        id: result.room.id,
        name: result.room.name,
        conversationKind: 'group',
        status: result.room.status as RoomSummary['status'],
        visibility: result.room.visibility as RoomSummary['visibility'],
        joinPolicy: result.room.joinPolicy as RoomSummary['joinPolicy'],
        humanCount: 1,
        agentCount: 0,
        lastSequence: result.room.nextSequence.toString(),
        lastReadSequence: '0',
        unreadCount: 0,
        membershipRole: 'owner',
        membershipStatus: 'active',
        pinnedAt: null,
        updatedAt: result.room.updatedAt.toISOString(),
      }
      return reply.code(result.idempotent ? 200 : 201).send({
        room, membershipId: result.membership.id,
        ...('invitations' in result ? { invitations: result.invitations } : {}) })
    } catch (error) {
      return sendRoomError(reply, error)
    }
  })

  app.get('/invitations/mine', { preHandler: [requireAuth, requireActivePlan] },
    async (request) => listMyTargetedRoomInvitations(request.userId))

  app.get<{ Querystring: { targetUserId?: string } }>(
    '/invitations/sent', { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try { return await listSentTargetedRoomInvitations({
        senderUserId: request.userId, targetUserId: request.query.targetUserId,
      }) } catch (error) { return sendRoomError(reply, error) }
    })

  app.post<{ Params: { roomId: string }; Body: { targetUserIds?: unknown } }>(
    '/:roomId/invitations', { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const invitations = await inviteRoomSavedContacts({
          roomId: request.params.roomId, actorUserId: request.userId,
          targetUserIds: request.body?.targetUserIds,
        })
        return reply.code(201).send({ invitations })
      } catch (error) { return sendRoomError(reply, error) }
    })

  app.post<{ Params: { invitationId: string }; Body: { decision?: string } }>(
    '/invitations/:invitationId/respond', { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      if (request.body?.decision !== 'accept' && request.body?.decision !== 'decline') {
        return reply.code(400).send({ error: 'room_invitation_decision_invalid' })
      }
      try {
        const result = await respondToTargetedRoomInvitation({
          invitationId: request.params.invitationId, userId: request.userId,
          decision: request.body.decision,
        })
        if (result.message) await broadcastRoomMessageRecord(result.roomId, result.message)
        return { roomId: result.roomId, status: result.status,
          membershipId: result.membershipId, idempotent: result.idempotent }
      } catch (error) { return sendRoomError(reply, error) }
    })

  app.post<{
    Params: { roomId: string }
    Body: {
      bindingIntentId?: string
      agentIdentityId?: string
      nianSessionId?: string
      runtimeAdapter?: RoomRuntimeAdapter
      sessionRegistryKey?: string
      activationCapability?: 'managed' | 'idle_resume' | 'notify_only'
      activationMode?: 'auto_follow' | 'mention_only' | 'paused'
    }
  }>('/:roomId/bindings', { preHandler: requireUserOrMachineAuth }, async (request, reply) => {
    if (!request.machineId) return reply.code(403).send({ error: 'machine_auth_required' })
    try {
      const result = await createRoomBindingAtomic({
        bindingIntentId: request.body.bindingIntentId ?? '',
        roomId: request.params.roomId,
        userId: request.userId,
        machineId: request.machineId,
        agentIdentityId: request.body.agentIdentityId ?? '',
        nianSessionId: request.body.nianSessionId ?? '',
        runtimeAdapter: request.body.runtimeAdapter ?? ('' as RoomRuntimeAdapter),
        sessionRegistryKey: request.body.sessionRegistryKey ?? '',
        activationCapability: request.body.activationCapability ?? 'notify_only',
        activationMode: request.body.activationMode,
      })
      await broadcastRoomEvent(request.params.roomId, {
        event: 'room.binding.updated',
        roomId: request.params.roomId,
        entityId: result.binding.id,
      })
      if (result.message) {
        const message = shapeRoomMessage(result.message)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.message.created',
          roomId: request.params.roomId,
          sequence: message.sequence,
          message,
        })
      }
      return reply.code(result.idempotent ? 200 : 201).send({
        binding: {
          id: result.binding.id,
          roomId: result.binding.roomId,
          agentIdentityId: result.binding.agentIdentityId,
          agentMembershipId: result.binding.agentMembershipId,
          nianSessionId: result.binding.nianSessionId,
          runtimeAdapter: result.binding.runtimeAdapter,
          activationCapability: result.binding.activationCapability,
          activationMode: result.binding.activationMode,
          status: result.binding.status,
        },
        resumeSequence: result.resumeSequence,
        idempotent: result.idempotent,
      })
    } catch (error) {
      return sendRoomError(reply, error)
    }
  })

  app.patch<{
    Params: { roomId: string; bindingId: string }
    Body: {
      agentIdentityId?: string
      previousNianSessionId?: string
      nianSessionId?: string
      runtimeAdapter?: RoomRuntimeAdapter
      sessionRegistryKey?: string
    }
  }>(
    '/:roomId/bindings/:bindingId/session',
    { preHandler: requireUserOrMachineAuth },
    async (request, reply) => {
      if (!request.machineId) return reply.code(403).send({ error: 'machine_auth_required' })
      try {
        const result = await restartRoomBindingSession({
          roomId: request.params.roomId,
          bindingId: request.params.bindingId,
          userId: request.userId,
          machineId: request.machineId,
          agentIdentityId: request.body.agentIdentityId ?? '',
          previousNianSessionId: request.body.previousNianSessionId ?? '',
          nianSessionId: request.body.nianSessionId ?? '',
          runtimeAdapter: request.body.runtimeAdapter ?? ('' as RoomRuntimeAdapter),
          sessionRegistryKey: request.body.sessionRegistryKey ?? '',
        })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.binding.updated',
          roomId: request.params.roomId,
          entityId: result.binding.id,
        })
        return {
          binding: {
            id: result.binding.id,
            roomId: result.binding.roomId,
            agentIdentityId: result.binding.agentIdentityId,
            agentMembershipId: result.binding.agentMembershipId,
            nianSessionId: result.binding.nianSessionId,
            runtimeAdapter: result.binding.runtimeAdapter,
            activationCapability: result.binding.activationCapability,
            activationMode: result.binding.activationMode,
            status: result.binding.status,
          },
          resumeSequence: result.resumeSequence,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{ Querystring: { includeDirect?: string } }>(
    '/', { preHandler: [requireAuth, requireActivePlan] }, async (request) => {
    const includeDirect = request.query.includeDirect === '1'
    const directCanonical = includeDirect
      && (await prisma.conversationWriteControl.findUnique({
        where: { name: 'published_ai' }, select: { mode: true },
      }))?.mode === 'canonical'
    const memberships = await prisma.roomMembership.findMany({
      where: {
        userId: request.userId,
        principalType: 'human',
        status: { in: ['active', 'left', 'removed'] },
        ...(includeDirect
          ? {} : { room: { conversationKind: 'group' } }),
      },
      include: {
        readState: true,
        room: {
          include: {
            legacyDirectConversation: { select: { canonicalState: true } },
            sessionMigrations: { select: { state: true }, take: 1 },
            memberships: {
              where: { status: 'active' },
              orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                principalType: true,
                displayAlias: true,
                joinedAt: true,
                user: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true } },
                ownerUser: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true } },
                agentIdentity: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true } },
              },
            },
          },
        },
      },
      orderBy: [{ pinnedAt: 'desc' }, { room: { updatedAt: 'desc' } }],
    })
    const retentionCutoff = roomMessageRetentionCutoff()
    const visibleMemberships = memberships.filter((membership) => {
      if (membership.room.conversationKind === 'published_ai'
        && (!directCanonical
          || membership.room.legacyDirectConversation?.canonicalState !== 'ready')) return false
      if (membership.room.conversationKind === 'work'
        && membership.room.sessionMigrations[0]?.state !== 'canonical') return false
      if (membership.status === 'active' && membership.room.status === 'active') return true
      const ceiling =
        membership.status === 'active'
          ? membership.room.nextSequence
          : membership.historyThroughSequence
      return ceiling != null && membership.historyFromSequence <= ceiling
    })
    return {
      rooms: await Promise.all(
        visibleMemberships.map(async (membership) => {
          const {
            room,
            readState,
            role,
            pinnedAt,
            muteRegularNotifications,
            muteMentionNotifications,
          } = membership
          const historyThroughSequence =
            membership.status === 'active' ? room.nextSequence : membership.historyThroughSequence!
          const latestMessage = await prisma.roomMessage.findFirst({
            where: {
              roomId: room.id,
              sequence: {
                gte: membership.historyFromSequence,
                lte: historyThroughSequence,
              },
              createdAt: { gte: retentionCutoff },
            },
            orderBy: { sequence: 'desc' },
            include: {
              attachments: true,
              authorMembership: { select: { displayAlias: true, status: true } },
            },
          })
          const lastReadSequence = readState?.lastReadSequence ?? 0n
          const unreadCount =
            membership.status === 'active' && lastReadSequence < historyThroughSequence ? 1 : 0
          return {
            id: room.id,
            name: room.name,
            conversationKind: room.conversationKind as RoomSummary['conversationKind'],
            status: room.status,
            visibility: room.visibility,
            joinPolicy: room.joinPolicy,
            humanCount: room.memberships.filter((member) => member.principalType === 'human')
              .length,
            agentCount: room.memberships.filter((member) => member.principalType === 'agent')
              .length,
            lastSequence: historyThroughSequence.toString(),
            historyFromSequence: membership.historyFromSequence.toString(),
            lastReadSequence: lastReadSequence.toString(),
            unreadCount,
            membershipRole: role,
            membershipStatus: membership.status,
            pinnedAt: pinnedAt?.toISOString() ?? null,
            muteRegularNotifications,
            muteMentionNotifications,
            updatedAt:
              latestMessage?.createdAt.toISOString() ??
              membership.removedAt?.toISOString() ??
              room.updatedAt.toISOString(),
            latestMessage: latestMessage ? shapeRoomMessage(latestMessage) : null,
            avatarMembers: (() => {
              if (room.conversationKind === 'published_ai') {
                return room.memberships.filter((member) => member.principalType === 'agent')
              }
              const humans = room.memberships.filter((member) => member.principalType === 'human')
              // In a 1:1 chat, prefer the other participant's avatar over our own.
              // In group chats (3+ humans), keep everyone including ourselves.
              if (humans.length > 2) {
                return humans
              }
              const others = humans.filter((member) => member.user?.id !== request.userId)
              return others.length > 0 ? others : humans
            })()
              .slice(0, 4)
              .map((member) => ({
                id: member.id,
                principalType: member.principalType,
                displayAlias: member.displayAlias,
                joinedAt: member.joinedAt.toISOString(),
                avatar:
                  member.principalType === 'human' && member.user
                    ? publicUserAvatar(member.user)
                    : member.principalType === 'agent'
                      ? publicAgentAvatar(member.agentIdentity)
                      : null,
                ownerAvatar:
                  member.principalType === 'agent' ? publicUserAvatar(member.ownerUser) : null,
              })),
          }
        }),
      ),
    }
  })

  app.get<{ Params: { nianSessionId: string } }>(
    '/session/:nianSessionId/binding',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request) => {
      const binding = await prisma.roomBinding.findFirst({
        where: {
          nianSessionId: request.params.nianSessionId,
          userId: request.userId,
        },
        select: {
          id: true,
          status: true,
          activationMode: true,
          agentIdentity: { select: { displayName: true } },
          room: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      })
      if (!binding) return { binding: null }
      return {
        binding: {
          id: binding.id,
          status: binding.status,
          activationMode: binding.activationMode,
          agentDisplayName: binding.agentIdentity.displayName,
          room: binding.room,
        },
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/invite-link',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await getCanonicalRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
        })
        return {
          invite: {
            id: result.invite.id,
            status: result.invite.status,
            expiresAt: null,
            createdAt: result.invite.createdAt.toISOString(),
            url: roomInviteUrl(request, request.params.roomId, result.rawToken),
            version: result.version,
          },
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/agent-invite-link',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await getCanonicalRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
        })
        return { invite: { url: roomInviteUrl(request, request.params.roomId, result.rawToken) } }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.post<{ Params: { roomId: string } }>(
    '/:roomId/invite-link/reset',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await resetCanonicalRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
        })
        return {
          invite: {
            id: result.invite.id,
            status: result.invite.status,
            expiresAt: null,
            createdAt: result.invite.createdAt.toISOString(),
            url: roomInviteUrl(request, request.params.roomId, result.rawToken),
            version: result.version,
          },
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/members',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const actor = await findHumanMembership(request.params.roomId, request.userId)
      if (!actor) return reply.code(403).send({ error: 'room_read_forbidden' })
      if (
        actor.status !== 'active' &&
        !(
          (actor.status === 'left' || actor.status === 'removed') &&
          actor.historyThroughSequence != null
        )
      )
        return reply.code(403).send({ error: 'room_read_forbidden' })
      const memberships = await prisma.roomMembership.findMany({
        where: {
          roomId: request.params.roomId,
          status: 'active',
          ...(actor.status === 'active' || !actor.removedAt
            ? {}
            : { joinedAt: { lte: actor.removedAt } }),
        },
        orderBy: [{ principalType: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          principalType: true,
          ownerUserId: true,
          parentHumanMembershipId: true,
          displayAlias: true,
          role: true,
          joinedAt: true,
          user: { select: { id: true, avatarVersion: true, avatarUpdatedAt: true } },
          ownerUser: {
            select: { id: true, name: true, avatarVersion: true, avatarUpdatedAt: true },
          },
          agentIdentity: {
            select: {
              id: true,
              description: true,
              avatarVersion: true,
              avatarUpdatedAt: true,
            },
          },
        },
      })
      const agentMembershipIds = memberships
        .filter((member) => member.principalType === 'agent')
        .map((member) => member.id)
      const bindings =
        agentMembershipIds.length === 0
          ? []
          : await prisma.roomBinding.findMany({
              where: {
                roomId: request.params.roomId,
                agentMembershipId: { in: agentMembershipIds },
              },
              select: {
                agentMembershipId: true,
                agentIdentityId: true,
                nianSessionId: true,
                status: true,
                activationMode: true,
                detachedReason: true,
                nianSession: { select: { lastMessagePreview: true } },
                machine: { select: { paired: true, online: true } },
              },
            })
      const bindingByMembership = new Map(
        bindings.map((binding) => {
          const availability = deriveRoomBindingAvailability({
            status: binding.status,
            machine: binding.machine,
            recovering: binding.detachedReason === 'recovering',
          })
          return [
            binding.agentMembershipId,
            {
              agentMembershipId: binding.agentMembershipId,
              agentIdentityId: binding.agentIdentityId,
              nianSessionId: binding.nianSessionId,
              status: binding.status,
              activationMode: binding.activationMode,
              availability,
              repairAction: deriveAgentRepairAction({
                availability,
                detachedReason: binding.detachedReason,
              }),
              lastMessagePreview: binding.nianSession?.lastMessagePreview ?? null,
            },
          ] as const
        }),
      )
      return {
        memberships: memberships.map((member) => ({
          id: member.id,
          agentIdentityId:
            member.principalType === 'agent' && member.ownerUserId === request.userId
              ? (member.agentIdentity?.id ??
                bindingByMembership.get(member.id)?.agentIdentityId ??
                null)
              : undefined,
          principalType: member.principalType,
          ownerUserId: member.ownerUserId,
          parentHumanMembershipId: member.parentHumanMembershipId,
          displayAlias: member.displayAlias,
          role: member.role,
          joinedAt: member.joinedAt.toISOString(),
          avatar:
            member.principalType === 'human' && member.user
              ? publicUserAvatar(member.user)
              : member.principalType === 'agent'
                ? publicAgentAvatar(member.agentIdentity)
                : null,
          ownerAvatar: member.principalType === 'agent' ? publicUserAvatar(member.ownerUser) : null,
          ownerDisplayName: member.principalType === 'agent' ? member.ownerUser.name : null,
          description:
            member.principalType === 'agent' ? (member.agentIdentity?.description ?? '') : '',
          agentParticipation:
            member.principalType === 'agent'
              ? (() => {
                  const binding = bindingByMembership.get(member.id)
                  return binding
                    ? {
                        activationMode: binding.activationMode,
                        availability: binding.availability,
                      }
                    : { activationMode: 'paused' as const, availability: 'unavailable' as const }
                })()
              : undefined,
          ownBinding:
            member.principalType === 'agent' && member.ownerUserId === request.userId
              ? (bindingByMembership.get(member.id) ?? null)
              : undefined,
        })),
      }
    },
  )

  app.post<{
    Params: { roomId: string }
    Body: { expiresInDays?: number; maxUses?: number | null }
  }>(
    '/:roomId/invites',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await createRoomInvite({
          roomId: request.params.roomId,
          actorUserId: request.userId,
          expiresInDays: request.body.expiresInDays,
          maxUses: request.body.maxUses,
        })
        return reply.code(201).send({
          invite: {
            id: result.invite.id,
            roomId: result.invite.roomId,
            status: result.invite.status,
            expiresAt: result.invite.expiresAt?.toISOString() ?? null,
            maxUses: result.invite.maxUses,
            useCount: result.invite.useCount,
            url: roomInviteUrl(request, request.params.roomId, result.rawToken),
          },
        })
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.patch<{
    Params: { roomId: string }
    Body: {
      pinned?: boolean
      muteRegularNotifications?: boolean
      muteMentionNotifications?: boolean
    }
  }>(
    '/:roomId/preferences',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const { pinned, muteRegularNotifications, muteMentionNotifications } = request.body
      if (
        pinned === undefined &&
        muteRegularNotifications === undefined &&
        muteMentionNotifications === undefined
      ) {
        return reply.code(400).send({ error: 'room_preference_required' })
      }
      if (
        (pinned !== undefined && typeof pinned !== 'boolean') ||
        (muteRegularNotifications !== undefined && typeof muteRegularNotifications !== 'boolean') ||
        (muteMentionNotifications !== undefined && typeof muteMentionNotifications !== 'boolean')
      ) {
        return reply.code(400).send({ error: 'invalid_room_preference' })
      }
      const membership = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!membership) return reply.code(403).send({ error: 'room_read_forbidden' })
      const pinnedAt = pinned === undefined ? membership.pinnedAt : pinned ? new Date() : null
      const updated = await prisma.roomMembership.update({
        where: { id: membership.id },
        data: {
          ...(pinned === undefined ? {} : { pinnedAt }),
          ...(muteRegularNotifications === undefined ? {} : { muteRegularNotifications }),
          ...(muteMentionNotifications === undefined ? {} : { muteMentionNotifications }),
        },
        select: {
          pinnedAt: true,
          muteRegularNotifications: true,
          muteMentionNotifications: true,
        },
      })
      return {
        pinnedAt: updated.pinnedAt?.toISOString() ?? null,
        muteRegularNotifications: updated.muteRegularNotifications,
        muteMentionNotifications: updated.muteMentionNotifications,
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/invites',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      const actor = await findActiveHumanMembership(request.params.roomId, request.userId)
      if (!actor || actor.role !== 'owner') {
        return reply.code(403).send({ error: 'room_admin_forbidden' })
      }
      const invites = await prisma.roomInvite.findMany({
        where: { roomId: request.params.roomId, targetUserId: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          maxUses: true,
          useCount: true,
          requestCount: true,
          createdAt: true,
          revokedAt: true,
        },
      })
      return {
        invites: invites.map((invite) => ({
          ...invite,
          expiresAt: invite.expiresAt?.toISOString() ?? null,
          createdAt: invite.createdAt.toISOString(),
          revokedAt: invite.revokedAt?.toISOString() ?? null,
        })),
      }
    },
  )

  app.get<{ Params: { roomId: string } }>(
    '/:roomId/browser-sessions',
    { preHandler: requireAuth },
    async (request) => ({
      sessions: await listRoomBrowserSessionsForUser({
        roomId: request.params.roomId,
        userId: request.userId,
      }),
    }),
  )

  app.delete<{ Params: { roomId: string; sessionId: string } }>(
    '/:roomId/browser-sessions/:sessionId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const result = await revokeRoomBrowserSessionForUser({
        roomId: request.params.roomId,
        userId: request.userId,
        sessionId: request.params.sessionId,
      })
      if (!result) return reply.code(404).send({ error: 'room_browser_session_not_found' })
      if (result.status === 'revoked') {
        publishRoomBrowserSessionRevoked(result.sessionId)
      }
      return result
    },
  )

  app.delete<{ Params: { roomId: string; inviteId: string } }>(
    '/:roomId/invites/:inviteId',
    { preHandler: [requireAuth, requireActivePlan] },
    async (request, reply) => {
      try {
        const result = await revokeRoomInvite({
          roomId: request.params.roomId,
          inviteId: request.params.inviteId,
          actorUserId: request.userId,
        })
        return {
          inviteId: result.invite.id,
          status: result.invite.status,
          idempotent: result.idempotent,
        }
      } catch (error) {
        return sendRoomError(reply, error)
      }
    },
  )

  app.patch<{
    Params: { roomId: string }
    Body: {
      name?: string
      visibility?: 'private' | 'public_read'
      joinPolicy?: 'open' | 'approval' | 'closed'
      maxAgentsPerMember?: number
    }
  }>('/:roomId', { preHandler: [requireAuth, requireActivePlan] }, async (request, reply) => {
    try {
      const result = await updateRoomSettings({
        roomId: request.params.roomId,
        actorUserId: request.userId,
        name: request.body.name,
        visibility: request.body.visibility,
        joinPolicy: request.body.joinPolicy,
        maxAgentsPerMember: request.body.maxAgentsPerMember,
      })
      await broadcastRoomEvent(request.params.roomId, {
        event: 'room.updated',
        roomId: request.params.roomId,
        sequence: result.room.nextSequence.toString(),
      })
      const message = result.message ? shapeRoomMessage(result.message) : null
      if (message) {
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.message.created',
          roomId: request.params.roomId,
          sequence: message.sequence,
          message,
        })
      }
      return {
        room: {
          id: result.room.id,
          name: result.room.name,
          description: result.room.description,
          status: result.room.status,
          visibility: result.room.visibility,
          joinPolicy: result.room.joinPolicy,
          lastSequence: result.room.nextSequence.toString(),
          limits: shapeRoomLimits(result.room),
        },
        idempotent: result.idempotent,
      }
    } catch (error) {
      return sendRoomError(reply, error)
    }
  })

  await registerRoomCollaborationRoutes(app)
}
