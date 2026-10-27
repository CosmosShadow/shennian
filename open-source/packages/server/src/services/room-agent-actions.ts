// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-actions.test.ts

import type { RoomActivationMode } from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { signDownloadUrl } from '../lib/oss.js'
import { sendRoomTextMessage } from './room-core.js'
import { appendSystemMessage } from './room-membership.js'
import { roomAgentModeChangedSystemText } from './room-agent-system-messages.js'
import { RoomPolicyError } from './room-policy.js'
import {
  completeRoomAttachmentForMembership,
  initializeRoomAttachmentForMembership,
  type RoomAttachmentInitInput,
} from './room-attachments.js'
import {
  parseStoredManagedAgentPermissionConfirmation,
  resolveStoredManagedAgentPermissionPolicy,
} from './managed-agent-permission-policy.js'
import { enforceManagedAgentBindingSecurity } from './managed-agent-binding-security.js'
import { roomMessageRetentionCutoff } from './room-message-retention.js'
import { getSessionActivity } from './session-activity.js'

type AgentBindingActor = {
  roomId: string
  bindingId: string
  userId: string
  machineId: string
}

const MODES = new Set<RoomActivationMode>(['auto_follow', 'mention_only', 'paused'])

export async function getRoomAgentStatus(input: AgentBindingActor) {
  const binding = await prisma.roomBinding.findUnique({
    where: { id: input.bindingId },
    include: {
      room: {
        include: {
          _count: { select: { memberships: { where: { status: 'active' } } } },
          memberships: {
            where: { status: 'active' },
            select: {
              displayAlias: true,
              principalType: true,
              agentIdentity: { select: { description: true } },
              parentHumanMembership: { select: { displayAlias: true } },
            },
            orderBy: { joinedAt: 'asc' },
          },
        },
      },
      agentIdentity: {
        select: {
          displayName: true,
          description: true,
          systemPrompt: true,
          modelId: true,
          sessionMode: true,
          managerConfig: true,
          permissionPolicy: true,
          permissionPolicyVersion: true,
          permissionConfirmation: true,
          configurationVersion: true,
        },
      },
      agentMembership: true,
      nianSession: true,
    },
  })
  assertStatusBinding(binding, input)
  if (
    (binding.status === 'active' || binding.status === 'paused') &&
    binding.pendingConfigurationVersion == null
  ) {
    await enforceManagedAgentBindingSecurity(input)
  }
  const managedSession = binding.activationCapability === 'managed' &&
    binding.nianSession?.userId === input.userId &&
    binding.nianSession.machineId === input.machineId &&
    !binding.nianSession.deletedAt
    ? binding.nianSession
    : null
  return {
    bindingId: binding.id,
    nianSessionId: binding.nianSessionId,
    sessionRegistryKey: binding.sourceSessionKey,
    roomId: binding.roomId,
    agentIdentityId: binding.agentIdentityId,
    agentMembershipId: binding.agentMembershipId,
    status: binding.status,
    activationCapability: binding.activationCapability,
    activationMode: binding.activationMode,
    // Additive: old daemons ignore this field. Null means no explicit model;
    // absence means this Binding has no authoritative managed Session model.
    ...(managedSession ? {
      effectiveModelId: managedSession.modelSource === 'agent'
        ? binding.agentIdentity.modelId ?? null
        : managedSession.modelId ?? null,
    } : {}),
    managedWorkspacePath:
      binding.activationCapability === 'managed' &&
      binding.nianSession?.userId === input.userId &&
      binding.nianSession.machineId === input.machineId &&
      !binding.nianSession.deletedAt &&
      binding.nianSession.workDir.trim()
        ? binding.nianSession.workDir
        : null,
    lastDeliveredSequence: binding.lastDeliveredSequence.toString(),
    lastActivatedSequence: binding.lastActivatedSequence.toString(),
    appliedConfigurationVersion: binding.appliedConfigurationVersion,
    pendingConfigurationVersion: binding.pendingConfigurationVersion,
    agent: {
      displayName: binding.agentIdentity.displayName,
      description: binding.agentIdentity.description,
      systemPrompt: binding.agentIdentity.systemPrompt,
      sessionMode: binding.agentIdentity.sessionMode === 'manager' ? 'manager' : 'standard',
      managerConfig:
        binding.agentIdentity.sessionMode === 'manager'
          ? binding.agentIdentity.managerConfig
          : null,
      permissionPolicy: resolveStoredManagedAgentPermissionPolicy(binding.agentIdentity),
      permissionConfirmation: parseStoredManagedAgentPermissionConfirmation(
        binding.agentIdentity.permissionConfirmation,
      ),
      configurationVersion: binding.agentIdentity.configurationVersion,
      configurationPending: binding.pendingConfigurationVersion != null,
    },
    room: {
      name: binding.room.name,
      status: binding.room.status,
      lastSequence: binding.room.nextSequence.toString(),
      memberCount: binding.room._count?.memberships,
      members: binding.room.memberships.map((membership) => ({
        displayName: membership.displayAlias,
        principalType: membership.principalType,
        ...(membership.principalType === 'agent'
          ? {
              description: membership.agentIdentity?.description ?? '',
              ownerDisplayName: membership.parentHumanMembership?.displayAlias ?? null,
            }
          : {}),
      })),
    },
  }
}

function assertStatusBinding<
  Binding extends {
    id: string
    roomId: string
    userId: string
    machineId: string
    status: string
    agentMembershipId: string | null
    room: { id: string; status: string }
    agentMembership: { id: string; roomId: string; principalType: string; status: string } | null
  },
>(binding: Binding | null, input: AgentBindingActor): asserts binding is Binding {
  const acceptedStatus =
    binding?.status === 'pending_approval' ||
    binding?.status === 'active' ||
    binding?.status === 'paused' ||
    binding?.status === 'detached'
  const pendingIsConsistent =
    binding?.status !== 'pending_approval' ||
    (!binding.agentMembershipId && !binding.agentMembership && binding.room.status === 'active')
  const membershipIsConsistent =
    binding?.status === 'pending_approval' ||
    (binding?.agentMembership != null &&
      binding.agentMembershipId === binding.agentMembership.id &&
      binding.agentMembership.roomId === input.roomId &&
      binding.agentMembership.principalType === 'agent' &&
      (binding.status === 'detached' ||
        (binding.agentMembership.status === 'active' && binding.room.status === 'active')))
  if (
    !binding ||
    binding.id !== input.bindingId ||
    binding.roomId !== input.roomId ||
    binding.room.id !== input.roomId ||
    binding.userId !== input.userId ||
    binding.machineId !== input.machineId ||
    !acceptedStatus ||
    !pendingIsConsistent ||
    !membershipIsConsistent
  ) {
    throw new RoomPolicyError(
      'room_binding_unavailable',
      'The exact Agent Room binding is unavailable.',
    )
  }
}

export async function readRoomAgentMessages(
  input: AgentBindingActor & { beforeSequence?: string; afterSequence?: string; limit?: number },
) {
  if (input.beforeSequence != null && input.afterSequence != null) {
    throw new RoomPolicyError(
      'ambiguous_sequence_cursor',
      'before and after are mutually exclusive.',
    )
  }
  const beforeSequence = input.beforeSequence == null ? null : parseSequence(input.beforeSequence)
  const afterSequence = input.afterSequence == null ? null : parseSequence(input.afterSequence)
  const limit = normalizeLimit(input.limit)
  await enforceManagedAgentBindingSecurity(input)
  return prisma.$transaction(
    async (tx) => {
      const binding = await tx.roomBinding.findUnique({
        where: { id: input.bindingId },
        include: { agentMembership: { include: { room: true, readState: true } } },
      })
      assertExactBinding(binding, input, false)
      const membership = binding.agentMembership!
      const floor = membership.historyFromSequence > 0n ? membership.historyFromSequence - 1n : 0n
      const cursor = afterSequence != null && afterSequence > floor ? afterSequence : floor
      const descending = beforeSequence != null || (beforeSequence == null && afterSequence == null)
      const messages = await tx.roomMessage.findMany({
        where: {
          roomId: input.roomId,
          createdAt: { gte: roomMessageRetentionCutoff() },
          sequence:
            beforeSequence != null
              ? { gt: floor, lt: beforeSequence }
              : afterSequence != null
                ? { gt: cursor }
                : { gt: floor },
        },
        include: { attachments: true },
        orderBy: { sequence: descending ? 'desc' : 'asc' },
        take: limit,
      })
      if (descending) messages.reverse()
      const newest = messages.at(-1)?.sequence ?? cursor
      const delivered = [
        binding.lastDeliveredSequence,
        membership.readState?.lastDeliveredSequence ?? floor,
        newest,
      ].reduce((left, right) => (left > right ? left : right))
      await Promise.all([
        tx.roomBinding.update({
          where: { id: binding.id },
          data: { lastDeliveredSequence: delivered },
        }),
        tx.roomReadState.upsert({
          where: { membershipId: membership.id },
          create: {
            roomId: input.roomId,
            membershipId: membership.id,
            lastDeliveredSequence: delivered,
          },
          update: { lastDeliveredSequence: delivered },
        }),
      ])
      return {
        messages,
        nextSequence: newest.toString(),
        hasMore: messages.length === limit,
        historyFromSequence: membership.historyFromSequence.toString(),
        roomName: membership.room.name,
        capabilityEpoch: binding.capabilityEpoch,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function sendRoomAgentMessage(
  input: AgentBindingActor & {
    clientMessageId: string
    text: string
    mentionMembershipIds?: string[]
    replyToMessageId?: string
    activationCauseMessageId?: string
    activeRunId?: string
    attachmentIds?: string[]
  },
) {
  await enforceManagedAgentBindingSecurity(input)
  const binding = await prisma.roomBinding.findUnique({
    where: { id: input.bindingId },
    include: { agentMembership: { include: { room: true } } },
  })
  assertExactBinding(binding, input, false)
  if (binding.status !== 'active' && !(await isPausedContinuation(binding, input.activeRunId))) {
    throw new RoomPolicyError(
      'room_binding_paused',
      'The Agent is paused and cannot send Room messages.',
    )
  }
  const mentionMembershipIds =
    input.mentionMembershipIds ?? (await resolveNicknameMentions(input.roomId, input.text))
  return sendRoomTextMessage({
    roomId: input.roomId,
    authorMembershipId: binding.agentMembershipId!,
    clientMessageId: input.clientMessageId,
    text: input.text,
    mentionMembershipIds,
    replyToMessageId: input.replyToMessageId,
    activationCauseMessageId: input.activationCauseMessageId,
    attachmentIds: input.attachmentIds,
    requiredBinding: {
      bindingId: input.bindingId,
      userId: input.userId,
      machineId: input.machineId,
    },
    source: 'managed_agent',
  })
}

async function isPausedContinuation(
  binding: {
    id: string
    roomId: string
    agentMembershipId: string | null
    status: string
    activationMode: string
    nianSessionId: string | null
  },
  activeRunId?: string,
): Promise<boolean> {
  if (
    binding.status !== 'paused' ||
    binding.activationMode !== 'paused' ||
    !binding.nianSessionId ||
    !activeRunId
  ) return false
  const activity = await getSessionActivity(binding.nianSessionId)
  if (!activity || activity.runId !== activeRunId) return false
  const manualPause = await prisma.roomMessage.findFirst({
    where: {
      roomId: binding.roomId,
      authorMembershipId: binding.agentMembershipId!,
      clientMessageId: {
        startsWith: `system:binding-mode:${binding.id}:`,
        endsWith: ':paused',
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!manualPause) return false
  const startedAt = Date.parse(activity.startedAt)
  return Number.isFinite(startedAt) && startedAt <= manualPause.createdAt.getTime()
}

async function resolveNicknameMentions(roomId: string, text: string): Promise<string[]> {
  if (!text.includes('@')) return []
  const members = await prisma.roomMembership.findMany({
    where: { roomId, status: 'active' },
    select: { id: true, displayAlias: true },
  })
  return members
    .sort((left, right) => right.displayAlias.length - left.displayAlias.length)
    .filter((member) => text.includes(`@${member.displayAlias}`))
    .map((member) => member.id)
}

export async function initializeRoomAgentAttachment(
  input: AgentBindingActor & Omit<RoomAttachmentInitInput, 'userId'>,
) {
  await enforceManagedAgentBindingSecurity(input)
  const binding = await prisma.roomBinding.findUnique({
    where: { id: input.bindingId },
    include: { agentMembership: { include: { room: true } } },
  })
  assertExactBinding(binding, input, false)
  return initializeRoomAttachmentForMembership(
    { ...input, userId: input.userId },
    binding.agentMembershipId!,
  )
}

export async function completeRoomAgentAttachment(
  input: AgentBindingActor & { attachmentId: string },
) {
  await enforceManagedAgentBindingSecurity(input)
  const binding = await prisma.roomBinding.findUnique({
    where: { id: input.bindingId },
    include: { agentMembership: { include: { room: true } } },
  })
  assertExactBinding(binding, input, false)
  return completeRoomAttachmentForMembership(
    { roomId: input.roomId, attachmentId: input.attachmentId },
    binding.agentMembershipId!,
  )
}

export async function getRoomAgentAttachmentCapability(
  input: AgentBindingActor & { attachmentId: string },
) {
  await enforceManagedAgentBindingSecurity(input)
  const binding = await prisma.roomBinding.findUnique({
    where: { id: input.bindingId },
    include: { agentMembership: { include: { room: true } } },
  })
  assertExactBinding(binding, input, false)
  const attachment = await prisma.roomAttachment.findUnique({
    where: { id: input.attachmentId },
    include: { message: { select: { roomId: true, sequence: true, deletedAt: true } } },
  })
  if (
    !attachment ||
    attachment.roomId !== input.roomId ||
    attachment.status !== 'ready' ||
    !attachment.message ||
    attachment.message.roomId !== input.roomId ||
    attachment.message.deletedAt ||
    attachment.message.sequence < binding.agentMembership!.historyFromSequence ||
    (attachment.expiresAt && attachment.expiresAt <= new Date())
  ) {
    throw new RoomPolicyError('room_attachment_unavailable', 'The Room attachment is unavailable.')
  }
  const now = new Date()
  const remainingSeconds = attachment.expiresAt
    ? Math.max(1, Math.floor((attachment.expiresAt.getTime() - now.getTime()) / 1_000))
    : 60
  const expiresInSeconds = Math.min(60, remainingSeconds)
  return {
    attachmentId: attachment.id,
    roomId: attachment.roomId,
    safeName: attachment.safeName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize.toString(),
    sha256: attachment.sha256,
    downloadUrl: signDownloadUrl(attachment.objectKey, expiresInSeconds),
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1_000).toISOString(),
  }
}

export async function updateRoomAgentMode(
  input: AgentBindingActor & { activationMode: RoomActivationMode },
) {
  if (!MODES.has(input.activationMode)) {
    throw new RoomPolicyError('invalid_activation_mode', 'Unsupported Agent activation mode.')
  }
  await enforceManagedAgentBindingSecurity(input)
  return prisma.$transaction(
    async (tx) => {
      const binding = await tx.roomBinding.findUnique({
        where: { id: input.bindingId },
        include: { agentMembership: { include: { room: true } } },
      })
      assertExactBinding(binding, input, false)
      if (binding.activationMode === input.activationMode) {
        return { binding, message: null, idempotent: true }
      }
      const updated = await tx.roomBinding.update({
        where: { id: binding.id },
        data: {
          activationMode: input.activationMode,
          status: input.activationMode === 'paused' ? 'paused' : 'active',
          resumeActivationMode:
            input.activationMode === 'paused'
              ? binding.activationMode === 'auto_follow'
                ? 'auto_follow'
                : 'mention_only'
              : null,
        },
        include: { agentMembership: { include: { room: true } } },
      })
      const message = await appendSystemMessage(tx, {
        roomId: input.roomId,
        author: binding.agentMembership!,
        text: roomAgentModeChangedSystemText(
          binding.agentMembership!.displayAlias,
          input.activationMode,
        ),
        clientMessageId: `system:binding-mode:${binding.id}:${updated.updatedAt.getTime()}:${input.activationMode}`,
      })
      return { binding: updated, message, idempotent: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}

export async function pauseRoomAgentWork(input: AgentBindingActor & { reason: string }) {
  const reason = input.reason
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!reason || reason.length > 500) {
    throw new RoomPolicyError(
      'invalid_pause_reason',
      'Pause reason must be between 1 and 500 characters.',
    )
  }
  // Stopping participation only reduces privileges. Do not turn a pause into a
  // runtime quarantine; exact actor/membership checks still run transactionally.
  // Status/read/send/resume paths retain their independent security gates.
  let lastConflict: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const binding = await tx.roomBinding.findUnique({
            where: { id: input.bindingId },
            include: {
              agentMembership: { include: { room: true } },
              agentIdentity: { select: { displayName: true } },
            },
          })
          assertExactBinding(binding, input, false)
          const messagePrefix = `system:binding-paused:${binding.id}:`
          if (binding.status === 'paused') {
            const message = await tx.roomMessage.findFirst({
              where: {
                roomId: input.roomId,
                authorMembershipId: binding.agentMembershipId!,
                clientMessageId: { startsWith: messagePrefix },
              },
              orderBy: { createdAt: 'desc' },
            })
            if (!message) {
              throw new RoomPolicyError(
                'pause_state_conflict',
                'Agent is paused but its pause message is unavailable.',
              )
            }
            return { binding, message, idempotent: true }
          }
          const transitioned = await tx.roomBinding.updateMany({
            where: { id: binding.id, status: 'active' },
            data: {
              status: 'paused',
              activationMode: 'paused',
              resumeActivationMode:
                binding.activationMode === 'auto_follow' ? 'auto_follow' : 'mention_only',
            },
          })
          if (transitioned.count !== 1) {
            throw new RoomPolicyError(
              'pause_state_conflict',
              'Agent pause state changed concurrently.',
            )
          }
          const updated = await tx.roomBinding.findUniqueOrThrow({ where: { id: binding.id } })
          const message = await appendSystemMessage(tx, {
            roomId: input.roomId,
            author: {
              id: binding.agentMembership!.id,
              principalType: binding.agentMembership!.principalType,
              ownerUserId: binding.agentMembership!.ownerUserId,
              displayAlias: binding.agentMembership!.displayAlias,
            },
            text: `${binding.agentIdentity.displayName} paused work. Reason: ${reason}`,
            clientMessageId: `${messagePrefix}${updated.updatedAt.getTime()}`,
          })
          return { binding: updated, message, idempotent: false }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      const retryable =
        (error instanceof RoomPolicyError && error.code === 'pause_state_conflict') ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      if (!retryable || attempt === 1) throw error
      lastConflict = error
    }
  }
  throw lastConflict
}

function assertExactBinding<
  Binding extends {
    id: string
    roomId: string
    userId: string
    machineId: string
    status: string
    agentMembershipId: string | null
    agentMembership: {
      id: string
      roomId: string
      principalType: string
      status: string
      room: { status: string }
    } | null
  },
>(
  binding: Binding | null,
  input: AgentBindingActor,
  allowDetached: boolean,
): asserts binding is Binding {
  const acceptedStatus = allowDetached
    ? binding?.status === 'active' || binding?.status === 'paused' || binding?.status === 'detached'
    : binding?.status === 'active' || binding?.status === 'paused'
  if (
    !binding ||
    binding.id !== input.bindingId ||
    binding.roomId !== input.roomId ||
    binding.userId !== input.userId ||
    binding.machineId !== input.machineId ||
    !acceptedStatus ||
    !binding.agentMembership ||
    binding.agentMembershipId !== binding.agentMembership.id ||
    binding.agentMembership.roomId !== input.roomId ||
    binding.agentMembership.principalType !== 'agent' ||
    (binding.status !== 'detached' &&
      (binding.agentMembership.status !== 'active' ||
        binding.agentMembership.room.status !== 'active'))
  ) {
    throw new RoomPolicyError(
      'room_binding_unavailable',
      'The exact Agent Room binding is unavailable.',
    )
  }
}

function parseSequence(value?: string): bigint {
  const normalized = value ?? '0'
  if (!/^(0|[1-9]\d{0,19})$/.test(normalized)) {
    throw new RoomPolicyError('invalid_sequence', 'Invalid Room sequence.')
  }
  return BigInt(normalized)
}

function normalizeLimit(value?: number): number {
  if (value == null) return 50
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RoomPolicyError('invalid_limit', 'Room message limit must be between 1 and 100.')
  }
  return value
}
