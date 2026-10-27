// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-cli-routes.test.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
  LEGACY_MANAGED_AGENT_PERMISSION_POLICY,
  managedAgentExecutionMode,
  parseManagedAgentPermissionPolicy,
  type ManagedAgentPermissionPolicy,
  type RoomActivationMode,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import {
  registerAuthDecorators,
  requireActivePlan,
  requireUserOrMachineAuth,
} from '../middleware/auth.js'
import {
  AgentWorkspaceError,
  createAgentWorkspace,
  createAgentWorkspaceSession,
  deleteAgentWorkspace,
  getAgentWorkspace,
  listAgentWorkspaces,
  updateAgentWorkspace,
} from '../services/agent-workspaces.js'
import { removeRoomMembership } from '../services/room-core.js'
import { broadcastRoomEvent, broadcastRoomMessageRecord } from '../services/room-events.js'
import { finalizeExclusiveRoomSessionDeletions } from '../services/room-session-cleanup.js'
import { RoomPolicyError } from '../services/room-policy.js'
import { parseManagedAgentRuntimeProtection } from '../services/managed-agent-permission-policy.js'

const EDITABLE_FIELDS = new Set([
  'displayName',
  'description',
  'systemPrompt',
  'runtimeAdapter',
  'workDir',
  'modelId',
])
const CREATE_FIELDS = new Set([...EDITABLE_FIELDS, 'permissionPolicy'])

export async function agentCliRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  const machineAuth = { preHandler: [requireUserOrMachineAuth, requireActivePlan] }

  app.get('/agents', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    return { agents: await listAgentWorkspaces(request.userId, request.machineId) }
  })

  app.get<{ Params: { agentId: string } }>('/agents/:agentId', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    try {
      return { agent: await getAgentWorkspace(request.userId, request.params.agentId, request.machineId) }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Body: unknown }>('/agents', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const body = bodyRecord(request.body)
    if (!body || !onlyFields(body, CREATE_FIELDS)) {
      return reply.code(400).send({ error: 'agent_definition_invalid' })
    }
    try {
      const definition = await standardAgentDefinition(request, body)
      return reply.code(201).send({
        agent: await createAgentWorkspace(request.userId, definition),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch<{ Params: { agentId: string }; Body: unknown }>(
    '/agents/:agentId',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      const body = bodyRecord(request.body)
      if (!body || !onlyFields(body, EDITABLE_FIELDS) || Object.keys(body).length === 0) {
        return reply.code(400).send({ error: 'agent_changes_invalid' })
      }
      try {
        const current = await getAgentWorkspace(
          request.userId,
          request.params.agentId,
          request.machineId,
        )
        const runtimeAdapter = typeof body.runtimeAdapter === 'string'
          ? body.runtimeAdapter
          : current.runtimeAdapter
        const permissionConfirmation = body.runtimeAdapter === undefined
          ? undefined
          : await permissionConfirmationForRuntime(
              request,
              runtimeAdapter,
              current.permissionPolicy ?? LEGACY_MANAGED_AGENT_PERMISSION_POLICY,
            )
        return {
          agent: await updateAgentWorkspace(
            request.userId,
            request.params.agentId,
            {
              ...body,
              ...(permissionConfirmation ? { permissionConfirmation } : {}),
            },
            request.machineId,
          ),
        }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.delete<{ Params: { agentId: string } }>(
    '/agents/:agentId',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        await getAgentWorkspace(request.userId, request.params.agentId, request.machineId)
        return await deleteAgentWorkspace(request.userId, request.params.agentId)
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/rooms',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        const agent = await getAgentWorkspace(request.userId, request.params.agentId, request.machineId)
        return { rooms: agent.sessions.flatMap((session) => (session.room ? [{
          room: session.room,
          sessionId: session.id,
          activationMode: session.room.activationMode,
          bindingStatus: session.room.status,
        }] : [])) }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{
    Params: { agentId: string }
    Body: unknown
  }>('/agents/:agentId/room-sessions', machineAuth, async (request, reply) => {
    if (!requireMachine(request, reply)) return
    const body = bodyRecord(request.body)
    if (!body) return reply.code(400).send({ error: 'agent_room_assignment_invalid' })
    const roomId = typeof body.roomId === 'string' ? body.roomId : ''
    const assignmentIntentId = typeof body.assignmentIntentId === 'string'
      ? body.assignmentIntentId
      : ''
    if (!safeId(roomId) || !safeId(assignmentIntentId)) {
      return reply.code(400).send({ error: 'agent_room_assignment_invalid' })
    }
    const activationMode = body.activationMode as RoomActivationMode | undefined
    if (!['auto_follow', 'mention_only', 'paused'].includes(activationMode ?? 'auto_follow')) {
      return reply.code(400).send({ error: 'invalid_activation_mode' })
    }
    try {
      const human = await activeHumanMembership(roomId, request.userId)
      if (!human) return reply.code(403).send({ error: 'room_read_forbidden' })
      const agent = await getAgentWorkspace(request.userId, request.params.agentId, request.machineId)
      const existing = agent.sessions.find((session) => session.room?.roomId === roomId)
      if (existing) return { existing: true, session: existing }
      const session = await createAgentWorkspaceSession(
        request.userId,
        request.params.agentId,
        { assignmentIntentId },
        request.machineId,
      )
      return reply.code(201).send({ existing: false, session })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { agentId: string; roomId: string } }>(
    '/agents/:agentId/rooms/:roomId/remove',
    machineAuth,
    async (request, reply) => {
      if (!requireMachine(request, reply)) return
      try {
        await getAgentWorkspace(request.userId, request.params.agentId, request.machineId)
        const actor = await activeHumanMembership(request.params.roomId, request.userId)
        if (!actor) return reply.code(403).send({ error: 'room_admin_forbidden' })
        const target = await prisma.roomMembership.findFirst({
          where: {
            roomId: request.params.roomId,
            agentIdentityId: request.params.agentId,
            ownerUserId: request.userId,
            principalType: 'agent',
            status: 'active',
          },
          select: { id: true },
        })
        if (!target) return { removed: false, idempotent: true }
        const result = await removeRoomMembership({
          roomId: request.params.roomId,
          actorMembershipId: actor.id,
          targetMembershipId: target.id,
        })
        finalizeExclusiveRoomSessionDeletions(result.committedSessionDeletions)
        await broadcastRoomEvent(request.params.roomId, {
          event: 'room.membership.updated',
          roomId: request.params.roomId,
        })
        for (const message of result.messages) {
          await broadcastRoomMessageRecord(request.params.roomId, message)
        }
        return { removed: result.removedMembershipIds.includes(target.id), idempotent: result.idempotent }
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )
}

async function standardAgentDefinition(
  request: FastifyRequest,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const runtimeAdapter = typeof input.runtimeAdapter === 'string' ? input.runtimeAdapter : ''
  const permissionPolicy = input.permissionPolicy === undefined
    ? DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY
    : parseManagedAgentPermissionPolicy(input.permissionPolicy)
  if (!permissionPolicy || (input.permissionPolicy !== undefined && !isNarrowCodexPolicy(permissionPolicy, runtimeAdapter))) {
    throw new AgentWorkspaceError('invalid', 'Only explicit Codex workspace-read/workspace-write isolation is supported here')
  }
  if (input.permissionPolicy !== undefined) await assertRestrictedCodexRuntime(request)
  const permissionConfirmation = await permissionConfirmationForRuntime(
    request,
    runtimeAdapter,
    permissionPolicy,
  )
  return {
    ...input,
    machineId: request.machineId,
    sessionMode: 'standard',
    managerConfig: null,
    permissionPolicy,
    ...(permissionConfirmation ? { permissionConfirmation } : {}),
  }
}

function isNarrowCodexPolicy(policy: ManagedAgentPermissionPolicy, runtimeAdapter: string): boolean {
  return runtimeAdapter === 'codex' && managedAgentExecutionMode(policy) === 'restricted'
    && (policy.fileAccess === 'workspace-read' || policy.fileAccess === 'workspace-write')
    && Object.values(policy.externalCapabilities).every((allowed) => allowed === false)
}

async function assertRestrictedCodexRuntime(request: FastifyRequest): Promise<void> {
  const machine = await prisma.machine.findFirst({
    where: { id: request.machineId, userId: request.userId, paired: true },
    select: { agents: true },
  })
  const runtime = Array.isArray(machine?.agents)
    ? machine.agents.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && (entry as Record<string, unknown>).type === 'codex') as Record<string, unknown> | undefined
    : undefined
  const protection = parseManagedAgentRuntimeProtection(runtime?.managedAgentProtection)
  const matrix = protection?.capabilityMatrix
  if (!runtime || runtime.supportsManagedAgent !== true || protection?.level !== 'hard'
    || (protection.platform !== 'darwin' && protection.platform !== 'linux')
    || !matrix?.fileAccess['workspace-read'] || !matrix.fileAccess['workspace-write']
    || Object.values(matrix.externalCapabilities).some((capability) => !capability.deny)
    || protection.unsupportedCapabilities.length > 0) {
    throw new AgentWorkspaceError('invalid', 'Codex hard isolation is not verified on this machine; update and refresh the Client before sharing')
  }
}

async function permissionConfirmationForRuntime(
  request: FastifyRequest,
  runtimeAdapter: unknown,
  permissionPolicy: ManagedAgentPermissionPolicy,
) {
  const machine = await prisma.machine.findFirst({
    where: { id: request.machineId, userId: request.userId, paired: true },
    select: { agents: true },
  })
  const runtime = Array.isArray(machine?.agents)
    ? machine.agents.find((value) => value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).type === runtimeAdapter) as Record<string, unknown> | undefined
    : undefined
  const protection = parseManagedAgentRuntimeProtection(runtime?.managedAgentProtection)
  const executionMode = managedAgentExecutionMode(permissionPolicy)
  const hostFullAccess = executionMode === 'native-full' || permissionPolicy.fileAccess === 'host-full'
  if (!hostFullAccess || !protection?.executableFingerprint) return undefined
  return {
    runtimeAdapter,
    runtimeVersion: protection.runtimeVersion,
    platform: protection.platform,
    executableFingerprint: protection.executableFingerprint,
    executionMode,
    hostFullAccess,
    limitedProtection: executionMode === 'restricted' && protection.level !== 'hard',
  }
}

async function activeHumanMembership(roomId: string, userId: string) {
  const membership = await prisma.roomMembership.findUnique({
    where: { roomId_principalKey: { roomId, principalKey: `human:${userId}` } },
    include: { room: true },
  })
  return membership?.status === 'active' && membership.room.status === 'active' ? membership : null
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9_.:@/-]{1,191}$/.test(value)
}

function onlyFields(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireMachine(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.machineId) return true
  void reply.code(403).send({ error: 'machine_auth_required' })
  return false
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentWorkspaceError) {
    const status = error.code === 'invalid' ? 400 : error.code === 'forbidden' ? 403 : 404
    return reply.code(status).send({ error: `agent_${error.code}`, message: error.message })
  }
  if (error instanceof RoomPolicyError) {
    const status = error.code.endsWith('_forbidden') ? 403
      : error.code.endsWith('_not_found') ? 404
        : error.code.endsWith('_conflict') ? 409 : 400
    return reply.code(status).send({ error: error.code, message: error.message })
  }
  throw error
}
