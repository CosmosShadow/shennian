// @arch open-source/docs/server-runtime.md
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts

import { createHash, randomUUID } from 'node:crypto'
import { AGENT_INCLUDE, isOwnerStandaloneContext, serializeCreatedSession } from './agent-workspace-sessions.js'
import {
  DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
  isAvailableAgentType,
  managedAgentExecutionMode,
  parseManagedAgentPermissionPolicy,
  type AgentWorkspace,
  type AgentType,
  type ManagedAgentPermissionConfirmation,
  type ManagedAgentPermissionPolicy,
  type ManagedAgentRuntimeProtection,
  type ManagerConfig,
  type RoomActivationMode,
  type SessionMode,
} from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import {
  broadcastAgentRuntimePolicy,
  createSessionForUser,
  deleteSessionForUser,
} from './sessions.js'
import { publicAgentAvatar } from './agent-avatar.js'
import { removeRoomMembership } from './room-core.js'
import { broadcastRoomEvent } from './room-events.js'
import { syncCancelledPublishedAiRoomMessages } from './published-ai-room-status.js'
import {
  deriveAgentRepairAction,
  deriveAgentRuntimeAvailability,
  deriveRoomBindingAvailability,
} from './agent-runtime-availability.js'
import { reconcileAgentRoomBindings } from './agent-room-recovery.js'
import {
  managedAgentPermissionConfirmationMatches,
  parseManagedAgentPermissionConfirmationRequest,
  parseManagedAgentRuntimeProtection,
  parseStoredManagedAgentPermissionConfirmation,
  resolveStoredManagedAgentPermissionPolicy,
} from './managed-agent-permission-policy.js'
import { allocateRoomDisplayAlias } from './room-display-alias.js'
import { AgentWorkspaceError } from './agent-workspace-error.js'
export { AgentWorkspaceError } from './agent-workspace-error.js'
import {
  normalizeManagedAgentSessionMode,
  normalizeManagerConfig,
} from './agent-workspace-session-mode.js'


type AgentRecord = Awaited<ReturnType<typeof findOwnedAgent>>

function policyJson(policy: ManagedAgentPermissionPolicy): Prisma.InputJsonValue {
  return {
    version: policy.version,
    executionMode: managedAgentExecutionMode(policy),
    fileAccess: policy.fileAccess,
    externalCapabilities: { ...policy.externalCapabilities },
  }
}

function newPermissionPolicy(value: unknown): ManagedAgentPermissionPolicy {
  const policy =
    value === undefined
      ? DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY
      : parseManagedAgentPermissionPolicy(value)
  if (!policy) throw new AgentWorkspaceError('invalid', 'permissionPolicy is invalid')
  return {
    ...policy,
    version: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY.version,
    externalCapabilities: { ...policy.externalCapabilities },
  }
}

function updatedPermissionPolicy(
  value: unknown,
  current: { permissionPolicy?: unknown; permissionPolicyVersion?: number },
): ManagedAgentPermissionPolicy {
  const policy = parseManagedAgentPermissionPolicy(value)
  if (!policy) throw new AgentWorkspaceError('invalid', 'permissionPolicy is invalid')
  const currentPolicy = resolveStoredManagedAgentPermissionPolicy(current)
  if (policy.version !== currentPolicy.version) {
    throw new AgentWorkspaceError('invalid', 'permissionPolicy version is stale')
  }
  if (samePermissionPolicy(policy, currentPolicy)) return currentPolicy
  return {
    ...policy,
    version: currentPolicy.version + 1,
    externalCapabilities: { ...policy.externalCapabilities },
  }
}

function samePermissionPolicy(
  left: ManagedAgentPermissionPolicy,
  right: ManagedAgentPermissionPolicy,
): boolean {
  return (
    managedAgentExecutionMode(left) === managedAgentExecutionMode(right) &&
    left.fileAccess === right.fileAccess &&
    JSON.stringify(left.externalCapabilities) === JSON.stringify(right.externalCapabilities)
  )
}

function normalizeText(value: unknown, maxLength: number, field: string, required = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if ((required && !text) || text.length > maxLength) {
    throw new AgentWorkspaceError('invalid', `${field} is invalid`)
  }
  return text
}

async function requireOwnedMachine(userId: string, machineId: string) {
  const machine = await prisma.machine.findFirst({ where: { id: machineId, userId, paired: true } })
  if (!machine) throw new AgentWorkspaceError('not_found', 'Machine not found')
  return machine
}

function machineAgentInfo(machine: { agents?: unknown }, agentType: AgentType) {
  if (!Array.isArray(machine.agents)) return null
  return machine.agents.find((item) => {
    return Boolean(
      item && typeof item === 'object' && (item as { type?: unknown }).type === agentType,
    )
  }) as
    | {
        supportsManagedAgent?: unknown
        supportsManagedNativeFull?: unknown
        supportsAgent?: unknown
        supportedAgentExecutionModes?: unknown
        supportsWorker?: unknown
        supportsManagerMode?: unknown
        managedAgentProtection?: unknown
      }
    | undefined
}

function runtimeSupportsExecutionMode(
  runtimeInfo: ReturnType<typeof machineAgentInfo>,
  mode: 'native-full' | 'restricted',
): boolean {
  // Old daemons without rich AgentInfo only supported the historical restricted policy.
  if (!runtimeInfo) return mode === 'restricted'
  if (Array.isArray(runtimeInfo.supportedAgentExecutionModes)) {
    return runtimeInfo.supportedAgentExecutionModes.includes(mode)
  }
  return mode === 'native-full'
    ? runtimeInfo.supportsManagedNativeFull === true
    : runtimeInfo.supportsManagedAgent === true
}

function assertRuntimeCapabilities(
  machine: { agentList?: unknown; agents?: unknown },
  runtimeAdapter: AgentType,
  sessionMode: SessionMode,
  managerConfig: ManagerConfig | null,
  policy: ManagedAgentPermissionPolicy,
): ManagedAgentRuntimeProtection {
  if (runtimeAdapter === 'manager' || runtimeAdapter === 'pi' || runtimeAdapter === 'openclaw') {
    throw new AgentWorkspaceError('invalid', 'runtimeAdapter is invalid')
  }
  const detected = Array.isArray(machine.agentList)
    ? machine.agentList.filter((value): value is string => typeof value === 'string')
    : []
  if (detected.length && !detected.includes(runtimeAdapter)) {
    throw new AgentWorkspaceError('invalid', 'runtimeAdapter is not available on this machine')
  }
  const runtimeInfo = machineAgentInfo(machine, runtimeAdapter)
  if (runtimeInfo?.supportsAgent === false) {
    throw new AgentWorkspaceError('invalid', 'This runtime cannot be used as an Agent')
  }
  if (sessionMode === 'manager' && runtimeInfo && runtimeInfo.supportsManagerMode !== true) {
    throw new AgentWorkspaceError('invalid', 'Manager mode is unavailable for this Agent')
  }
  const executionMode = managedAgentExecutionMode(policy)
  if (!runtimeSupportsExecutionMode(runtimeInfo, executionMode)) {
    throw new AgentWorkspaceError(
      'invalid',
      executionMode === 'native-full'
        ? 'Native full access requires a newer Shennian CLI on this machine'
        : 'Restricted access is unavailable for this Agent',
    )
  }
  const protection = parseManagedAgentRuntimeProtection(runtimeInfo?.managedAgentProtection) ?? {
    level: 'unverified' as const,
    runtimeVersion: 'unknown',
    platform: 'unknown',
    unsupportedCapabilities: ['native-permission-enforcement'],
  }
  const workerType = managerConfig?.defaultWorkerAgentType
  if (sessionMode === 'manager' && workerType) {
    if (detected.length && !detected.includes(workerType)) {
      throw new AgentWorkspaceError('invalid', 'Manager worker is not available on this machine')
    }
    const workerInfo = machineAgentInfo(machine, workerType)
    if (workerInfo && workerInfo.supportsWorker !== true) {
      throw new AgentWorkspaceError('invalid', 'Manager worker is unavailable for this Agent')
    }
    if (!runtimeSupportsExecutionMode(workerInfo, executionMode)) {
      throw new AgentWorkspaceError(
        'invalid',
        executionMode === 'native-full'
          ? 'Manager worker native full access requires a newer Shennian CLI on this machine'
          : 'Manager worker restricted access is unavailable for this Agent',
      )
    }
  }
  return protection
}

function assertRequestedExternalCapabilities(
  _policy: ManagedAgentPermissionPolicy,
  _protection: ManagedAgentRuntimeProtection,
): void {
  // The policy is the user's authorization ceiling. Runtime gaps are reported
  // through enforcement metadata instead of making the Agent unselectable.
}

function permissionConfirmationJson(
  confirmation: ManagedAgentPermissionConfirmation | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return confirmation ? ({ ...confirmation } as Prisma.InputJsonValue) : Prisma.JsonNull
}

function resolvePermissionConfirmation(input: {
  raw: unknown
  current?: unknown
  policy: ManagedAgentPermissionPolicy
  runtimeAdapter: AgentType
  protection: ManagedAgentRuntimeProtection
}): ManagedAgentPermissionConfirmation | null {
  const executionMode = managedAgentExecutionMode(input.policy)
  const hostFullAccess = executionMode === 'native-full' || input.policy.fileAccess === 'host-full'
  const limitedProtection = executionMode === 'restricted' && input.protection.level !== 'hard'
  if (!hostFullAccess) return null

  const current = parseStoredManagedAgentPermissionConfirmation(input.current)
  if (!input.protection.executableFingerprint) return null
  if (
    managedAgentPermissionConfirmationMatches({
      confirmation: current,
      policy: input.policy,
      runtimeAdapter: input.runtimeAdapter,
      protection: input.protection,
    })
  ) {
    return current
  }

  const request = parseManagedAgentPermissionConfirmationRequest(input.raw)
  if (
    !request ||
    request.runtimeAdapter !== input.runtimeAdapter ||
    request.runtimeVersion !== input.protection.runtimeVersion ||
    request.platform !== input.protection.platform ||
    request.executableFingerprint !== input.protection.executableFingerprint ||
    request.executionMode !== executionMode ||
    request.hostFullAccess !== hostFullAccess ||
    request.limitedProtection !== limitedProtection
  ) {
    throw new AgentWorkspaceError(
      'invalid',
      limitedProtection
        ? 'host file access and limited protection confirmation are required'
        : 'host file access confirmation is required',
    )
  }
  return {
    ...request,
    policyVersion: input.policy.version,
    confirmedAt: new Date().toISOString(),
  }
}

async function findOwnedAgent(userId: string, id: string, machineId?: string) {
  return prisma.agentIdentity.findFirst({
    where: {
      id,
      ownerType: 'user',
      ownerUserId: userId,
      status: { not: 'deleted' },
      ...(machineId ? { machineId } : {}),
    },
    include: AGENT_INCLUDE,
  })
}

function serializeAgent(record: NonNullable<AgentRecord>): AgentWorkspace {
  const roomSessions = record.sessions.filter(
    (session) =>
      session.roomBinding?.agentMembership?.status === 'active' &&
      session.roomBinding.room.status === 'active' &&
      (session.roomBinding.status === 'active' ||
        session.roomBinding.status === 'paused' ||
        session.roomBinding.status === 'detached'),
  )
  const machineAvailability = deriveAgentRuntimeAvailability(record.machine)
  const recoveryPending = roomSessions.some(
    (session) =>
      session.roomBinding?.status === 'detached' &&
      ['runtime_reconfigured', 'recovery_requested', 'recovering'].includes(
        session.roomBinding.detachedReason ?? '',
      ),
  )
  const recoveryFailed = roomSessions.some(
    (session) => session.roomBinding?.detachedReason === 'recovery_failed',
  )
  const recoveryBlocked = roomSessions.some(
    (session) =>
      session.roomBinding?.status === 'detached' &&
      !['runtime_reconfigured', 'recovery_requested', 'recovering'].includes(
        session.roomBinding.detachedReason ?? '',
      ),
  )
  const availability =
    machineAvailability !== 'available'
      ? 'unavailable'
      : recoveryBlocked
        ? 'unavailable'
        : recoveryPending
          ? 'recovering'
          : 'available'
  const repairAction = deriveAgentRepairAction({
    availability,
    detachedReason: recoveryFailed ? 'recovery_failed' : null,
  })
  return {
    id: record.id,
    configurationVersion: record.configurationVersion,
    displayName: record.displayName,
    description: record.description,
    systemPrompt: record.systemPrompt,
    avatar: publicAgentAvatar(record),
    status: record.status,
    availability,
    repairAction,
    pinnedAt: record.pinnedAt?.toISOString() ?? null,
    machineId: record.machineId,
    machineName: record.machine?.name ?? null,
    runtimeAdapter: isAvailableAgentType(record.runtimeAdapter ?? '')
      ? (record.runtimeAdapter as AgentWorkspace['runtimeAdapter'])
      : null,
    workDir: record.workDir,
    modelId: record.modelId,
    sessionMode:
      record.sessionMode === 'manager' || record.runtimeAdapter === 'manager'
        ? 'manager'
        : 'standard',
    managerConfig: normalizeManagerConfig(record.managerConfig),
    permissionPolicy: resolveStoredManagedAgentPermissionPolicy(record),
    permissionConfirmation: parseStoredManagedAgentPermissionConfirmation(
      record.permissionConfirmation,
    ),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sessions: record.sessions.filter((session) => (!session.roomBinding && (session.nativeSessionVisibility !== 'internal' || isOwnerStandaloneContext(session))) || roomSessions.includes(session)).map((session) => {
      const roomAvailability = session.roomBinding ? deriveRoomBindingAvailability({
        status: session.roomBinding.status,
        machine: session.roomBinding.machine,
        recovering: session.roomBinding.detachedReason === 'recovering',
      }) : 'available' as const
      return {
        id: session.id,
        title: session.title,
        status: session.status,
        agentType: isAvailableAgentType(session.agentType) ? session.agentType : 'codex',
        modelId: session.modelId,
        machineId: session.machineId,
        machineName: session.machine?.name ?? null,
        workDir: session.workDir,
        lastActivityAt: session.lastActivityAt.toISOString(),
        room: session.roomBinding
          ? {
              bindingId: session.roomBinding.id,
              status: session.roomBinding.status,
              roomId: session.roomBinding.room.id,
              roomName: session.roomBinding.room.name,
              activationMode: session.roomBinding.activationMode as RoomActivationMode,
              availability: roomAvailability,
              repairAction: deriveAgentRepairAction({
                availability: roomAvailability,
                detachedReason: session.roomBinding.detachedReason,
              }),
            }
          : null,
      }
    }),
  }
}


export async function listAgentWorkspaces(userId: string, machineId?: string) {
  const records = await prisma.agentIdentity.findMany({
    where: {
      ownerType: 'user',
      ownerUserId: userId,
      status: { not: 'deleted' },
      ...(machineId ? { machineId } : {}),
    },
    include: AGENT_INCLUDE,
    orderBy: [{ pinnedAt: 'desc' }, { updatedAt: 'desc' }],
  })
  return records.map(serializeAgent)
}

export async function getAgentWorkspace(userId: string, id: string, machineId?: string) {
  const record = await findOwnedAgent(userId, id, machineId)
  if (!record) throw new AgentWorkspaceError('not_found', 'Agent not found')
  return serializeAgent(record)
}

export async function createAgentWorkspace(userId: string, input: Record<string, unknown>) {
  const displayName = normalizeText(input.displayName, 191, 'displayName', true)
  const description = normalizeText(input.description, 1000, 'description', true)
  const systemPrompt = normalizeText(input.systemPrompt, 20_000, 'systemPrompt')
  const machineId = normalizeText(input.machineId, 191, 'machineId', true)
  const runtimeAdapter = normalizeText(input.runtimeAdapter, 64, 'runtimeAdapter', true)
  const workDir = normalizeText(input.workDir, 1024, 'workDir', true)
  const modelId = normalizeText(input.modelId, 191, 'modelId') || null
  const sessionMode = normalizeManagedAgentSessionMode(input.sessionMode)
  const managerConfig =
    sessionMode === 'manager' ? normalizeManagerConfig(input.managerConfig) : null
  const permissionPolicy = newPermissionPolicy(input.permissionPolicy)
  if (
    !isAvailableAgentType(runtimeAdapter) ||
    runtimeAdapter === 'manager' ||
    runtimeAdapter === 'pi' ||
    runtimeAdapter === 'openclaw'
  ) {
    throw new AgentWorkspaceError('invalid', 'runtimeAdapter is invalid')
  }
  const machine = await requireOwnedMachine(userId, machineId)
  const protection = assertRuntimeCapabilities(
    machine,
    runtimeAdapter,
    sessionMode,
    managerConfig,
    permissionPolicy,
  )
  assertRequestedExternalCapabilities(permissionPolicy, protection)
  const permissionConfirmation = resolvePermissionConfirmation({
    raw: input.permissionConfirmation,
    policy: permissionPolicy,
    runtimeAdapter,
    protection,
  })
  const created = await prisma.agentIdentity.create({
    data: {
      ownerType: 'user',
      ownerUserId: userId,
      displayName,
      description,
      systemPrompt,
      machineId,
      runtimeAdapter,
      workDir,
      modelId,
      sessionMode,
      managerConfig: managerConfig ?? Prisma.JsonNull,
      permissionPolicy: policyJson(permissionPolicy),
      permissionPolicyVersion: permissionPolicy.version,
      permissionConfirmation: permissionConfirmationJson(permissionConfirmation),
    },
  })
  return getAgentWorkspace(userId, created.id)
}

export async function updateAgentWorkspace(
  userId: string,
  id: string,
  input: Record<string, unknown>,
  machineScopeId?: string,
) {
  const current = await findOwnedAgent(userId, id)
  if (!current) throw new AgentWorkspaceError('not_found', 'Agent not found')
  if (machineScopeId && current.machineId !== machineScopeId) {
    throw new AgentWorkspaceError('forbidden', 'Machine cannot manage this Agent')
  }
  if (
    machineScopeId &&
    'machineId' in input &&
    normalizeText(input.machineId, 191, 'machineId', true) !== machineScopeId
  ) {
    throw new AgentWorkspaceError('forbidden', 'Machine cannot move an Agent to another machine')
  }
  const data: Record<string, unknown> = {}
  let nextDisplayName: string | null = null
  let expectedPermissionPolicyVersion: number | null = null
  let nextPermissionPolicy = resolveStoredManagedAgentPermissionPolicy(current)
  let permissionPolicyChanged = false
  let runtimeConfigurationTouched = false
  let runtimeConfigurationChanged = false
  let conversationRestartChanged = false
  let turnRuntimeChanged = false
  let nextRuntimeAdapter = isAvailableAgentType(current.runtimeAdapter ?? '')
    ? (current.runtimeAdapter as AgentType)
    : null
  let nextMachineId = current.machineId
  let nextRuntimeProtection: ManagedAgentRuntimeProtection | null = null
  if ('displayName' in input) {
    nextDisplayName = normalizeText(input.displayName, 191, 'displayName', true)
    data.displayName = nextDisplayName
  }
  if ('description' in input)
    data.description = normalizeText(input.description, 1000, 'description', true)
  if ('systemPrompt' in input)
    data.systemPrompt = normalizeText(input.systemPrompt, 20_000, 'systemPrompt')
  if ('modelId' in input) data.modelId = normalizeText(input.modelId, 191, 'modelId') || null
  if ('permissionPolicy' in input) {
    const permissionPolicy = updatedPermissionPolicy(input.permissionPolicy, current)
    nextPermissionPolicy = permissionPolicy
    permissionPolicyChanged = permissionPolicy.version !== current.permissionPolicyVersion
    if (permissionPolicyChanged) {
      expectedPermissionPolicyVersion = permissionPolicy.version - 1
      data.permissionPolicy = policyJson(permissionPolicy)
      data.permissionPolicyVersion = permissionPolicy.version
    }
  }
  if ('pinned' in input) {
    if (typeof input.pinned !== 'boolean') {
      throw new AgentWorkspaceError('invalid', 'pinned is invalid')
    }
    data.pinnedAt = input.pinned ? new Date() : null
  }
  if (
    'machineId' in input ||
    'runtimeAdapter' in input ||
    'workDir' in input ||
    'sessionMode' in input ||
    'managerConfig' in input
  ) {
    runtimeConfigurationTouched = true
    const machineId =
      'machineId' in input
        ? normalizeText(input.machineId, 191, 'machineId', true)
        : (current.machineId ?? '')
    const runtimeAdapter =
      'runtimeAdapter' in input
        ? normalizeText(input.runtimeAdapter, 64, 'runtimeAdapter', true)
        : (current.runtimeAdapter ?? '')
    const workDir =
      'workDir' in input ? normalizeText(input.workDir, 1024, 'workDir', true) : current.workDir
    const sessionMode = normalizeManagedAgentSessionMode(
      input.sessionMode,
      current.sessionMode === 'manager' ? 'manager' : 'standard',
    )
    const managerConfig =
      sessionMode === 'manager'
        ? normalizeManagerConfig(
            'managerConfig' in input ? input.managerConfig : current.managerConfig,
          )
        : null
    if (
      !machineId ||
      !isAvailableAgentType(runtimeAdapter) ||
      runtimeAdapter === 'manager' ||
      runtimeAdapter === 'pi' ||
      runtimeAdapter === 'openclaw'
    ) {
      throw new AgentWorkspaceError('invalid', 'Agent runtime configuration is invalid')
    }
    const machine = await requireOwnedMachine(userId, machineId)
    nextRuntimeProtection = assertRuntimeCapabilities(
      machine,
      runtimeAdapter,
      sessionMode,
      managerConfig,
      nextPermissionPolicy,
    )
    assertRequestedExternalCapabilities(nextPermissionPolicy, nextRuntimeProtection)
    nextRuntimeAdapter = runtimeAdapter
    nextMachineId = machineId
    data.machineId = machineId
    data.runtimeAdapter = runtimeAdapter
    data.workDir = workDir
    data.sessionMode = sessionMode
    data.managerConfig = managerConfig ?? Prisma.JsonNull
    runtimeConfigurationChanged =
      machineId !== current.machineId ||
      runtimeAdapter !== current.runtimeAdapter ||
      workDir !== current.workDir ||
      sessionMode !== (current.sessionMode === 'manager' ? 'manager' : 'standard') ||
      JSON.stringify(managerConfig) !==
        JSON.stringify(normalizeManagerConfig(current.managerConfig))
    conversationRestartChanged =
      machineId !== current.machineId ||
      runtimeAdapter !== current.runtimeAdapter ||
      workDir !== current.workDir
    turnRuntimeChanged = runtimeConfigurationChanged && !conversationRestartChanged
  }
  const permissionConfirmationTouched = 'permissionConfirmation' in input
  const runtimeSecurityTouched =
    runtimeConfigurationTouched || permissionPolicyChanged || permissionConfirmationTouched
  if (runtimeSecurityTouched && (!nextRuntimeAdapter || !nextMachineId)) {
    throw new AgentWorkspaceError('invalid', 'Agent runtime configuration is invalid')
  }
  if (runtimeSecurityTouched && !nextRuntimeProtection) {
    const currentSessionMode = normalizeManagedAgentSessionMode(
      undefined,
      current.sessionMode === 'manager' ? 'manager' : 'standard',
    )
    const machine = await requireOwnedMachine(userId, nextMachineId!)
    nextRuntimeProtection = assertRuntimeCapabilities(
      machine,
      nextRuntimeAdapter!,
      currentSessionMode,
      currentSessionMode === 'manager' ? normalizeManagerConfig(current.managerConfig) : null,
      nextPermissionPolicy,
    )
    assertRequestedExternalCapabilities(nextPermissionPolicy, nextRuntimeProtection)
  }
  let permissionConfirmationChanged = false
  if (runtimeSecurityTouched && nextRuntimeAdapter && nextRuntimeProtection) {
    const nextConfirmation = resolvePermissionConfirmation({
      raw: input.permissionConfirmation,
      // Confirmation is scoped to the Agent row and owner by storage, and to
      // the machine by refusing to reuse it after a machine change.
      current: nextMachineId === current.machineId ? current.permissionConfirmation : null,
      policy: nextPermissionPolicy,
      runtimeAdapter: nextRuntimeAdapter,
      protection: nextRuntimeProtection,
    })
    const currentConfirmation = parseStoredManagedAgentPermissionConfirmation(
      current.permissionConfirmation,
    )
    permissionConfirmationChanged =
      JSON.stringify(nextConfirmation) !== JSON.stringify(currentConfirmation)
    if (permissionConfirmationChanged) {
      data.permissionConfirmation = permissionConfirmationJson(nextConfirmation)
    }
  }
  const promptChanged = 'systemPrompt' in data && data.systemPrompt !== current.systemPrompt
  const modelChanged = 'modelId' in data && data.modelId !== current.modelId
  const turnPolicyChanged =
    turnRuntimeChanged ||
    permissionPolicyChanged ||
    permissionConfirmationChanged ||
    promptChanged ||
    modelChanged
  const configurationChanged = conversationRestartChanged || turnPolicyChanged
  const currentConfigurationVersion = current.configurationVersion ?? 1
  const nextConfigurationVersion = configurationChanged
    ? currentConfigurationVersion + 1
    : currentConfigurationVersion
  if (configurationChanged) data.configurationVersion = nextConfigurationVersion
  const recoveryIntentId = randomUUID()
  const { affectedBindings, renamedMemberships } = await prisma.$transaction(async (tx) => {
    if (configurationChanged) {
      // Publication -> Agent -> conversation is the same lock order as public delivery.
      await tx.$queryRaw`SELECT id FROM AgentPublication WHERE agentIdentityId = ${id} FOR UPDATE`
    }
    if (expectedPermissionPolicyVersion !== null || configurationChanged) {
      const result = await tx.agentIdentity.updateMany({
        where: {
          id,
          ...(expectedPermissionPolicyVersion !== null
            ? { permissionPolicyVersion: expectedPermissionPolicyVersion }
            : {}),
          ...(configurationChanged ? { configurationVersion: currentConfigurationVersion } : {}),
        },
        data,
      })
      if (result.count !== 1) {
        throw new AgentWorkspaceError('invalid', 'Agent configuration version is stale')
      }
    } else {
      await tx.agentIdentity.update({ where: { id }, data })
    }
    if (configurationChanged) {
      await tx.agentPublication.updateMany({
        where: { agentIdentityId: id, ownerUserId: userId,
          status: { in: ['active', 'paused'] } },
        data: { status: 'paused', policyVersion: { increment: 1 } },
      })
      await tx.agentDirectMessage.updateMany({
        where: { status: { in: ['pending', 'running'] },
          conversation: { agentIdentityId: id, ownerUserId: userId } },
        data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, { agentIdentityId: id, ownerUserId: userId })
    }
    const renamedMemberships: Array<{ id: string; roomId: string }> = []
    if (nextDisplayName !== null) {
      const memberships = await tx.roomMembership.findMany({
        where: {
          agentIdentityId: id,
          ownerUserId: userId,
          principalType: 'agent',
          status: 'active',
        },
        select: { id: true, roomId: true, displayAlias: true },
      })
      for (const membership of memberships) {
        const displayAlias = await allocateRoomDisplayAlias(
          tx,
          membership.roomId,
          nextDisplayName,
          {
            excludeMembershipId: membership.id,
          },
        )
        if (displayAlias === membership.displayAlias) continue
        await tx.roomMembership.update({
          where: { id: membership.id },
          data: { displayAlias },
        })
        renamedMemberships.push({ id: membership.id, roomId: membership.roomId })
      }
    }
    let affectedBindings: Array<{
      id: string
      roomId: string
      recoveryIntentId: string | null
      nianSessionId: string | null
      pendingConfigurationVersion: number | null
      machineId: string
      machine: { daemonInstallationId: string | null }
    }> = []
    const shouldRecoverDetachedBindings =
      runtimeConfigurationTouched && !conversationRestartChanged && !turnPolicyChanged
    if (conversationRestartChanged || turnPolicyChanged || shouldRecoverDetachedBindings) {
      affectedBindings = await tx.roomBinding.findMany({
        where: {
          agentIdentityId: id,
          userId,
          NOT: { detachedReason: 'machine_removed' },
          status:
            conversationRestartChanged || turnPolicyChanged
              ? { in: ['active', 'paused', 'detached'] }
              : 'detached',
          room: { status: 'active' },
          agentMembership: { status: 'active' },
        },
        select: {
          id: true,
          roomId: true,
          recoveryIntentId: true,
          nianSessionId: true,
          pendingConfigurationVersion: true,
          machineId: true,
          machine: { select: { daemonInstallationId: true } },
        },
      })
      if (conversationRestartChanged && affectedBindings.length > 0) {
        await tx.roomBinding.updateMany({
          where: { id: { in: affectedBindings.map((binding) => binding.id) } },
          data: {
            detachedReason: 'runtime_reconfigured',
            recoveryIntentId,
            recoveryLeaseUntil: null,
            recoveryErrorCode: null,
            pendingConfigurationVersion: nextConfigurationVersion,
          },
        })
      } else if (turnPolicyChanged && affectedBindings.length > 0) {
        const stableBindingIds = affectedBindings
          .filter((binding) => binding.pendingConfigurationVersion == null)
          .map((binding) => binding.id)
        const restartingBindingIds = affectedBindings
          .filter((binding) => binding.pendingConfigurationVersion != null)
          .map((binding) => binding.id)
        if (stableBindingIds.length > 0) {
          await tx.roomBinding.updateMany({
            where: { id: { in: stableBindingIds }, pendingConfigurationVersion: null },
            data: { appliedConfigurationVersion: nextConfigurationVersion },
          })
        }
        if (restartingBindingIds.length > 0) {
          await tx.roomBinding.updateMany({
            where: { id: { in: restartingBindingIds }, pendingConfigurationVersion: { not: null } },
            data: { pendingConfigurationVersion: nextConfigurationVersion },
          })
        }
      } else if (shouldRecoverDetachedBindings) {
        const existingIntentIds = affectedBindings
          .filter((binding) => binding.recoveryIntentId)
          .map((binding) => binding.id)
        const missingIntentIds = affectedBindings
          .filter((binding) => !binding.recoveryIntentId)
          .map((binding) => binding.id)
        if (existingIntentIds.length > 0) {
          await tx.roomBinding.updateMany({
            where: { id: { in: existingIntentIds } },
            data: {
              detachedReason: 'recovery_requested',
              recoveryLeaseUntil: null,
              recoveryErrorCode: null,
            },
          })
        }
        if (missingIntentIds.length > 0) {
          await tx.roomBinding.updateMany({
            where: { id: { in: missingIntentIds } },
            data: {
              detachedReason: 'recovery_requested',
              recoveryIntentId,
              recoveryLeaseUntil: null,
              recoveryErrorCode: null,
            },
          })
        }
      }
    }
    return { affectedBindings, renamedMemberships }
  })
  await Promise.all([
    ...renamedMemberships.map((membership) =>
      broadcastRoomEvent(membership.roomId, {
        event: 'room.membership.updated',
        roomId: membership.roomId,
        entityId: membership.id,
      }),
    ),
    ...affectedBindings.map((binding) =>
      broadcastRoomEvent(binding.roomId, {
        event: 'room.binding.updated',
        roomId: binding.roomId,
        entityId: binding.id,
      }),
    ),
  ])
  const updated = await getAgentWorkspace(userId, id)
  if ('systemPrompt' in input || 'modelId' in input) {
    await broadcastAgentRuntimePolicy({
      agentIdentityId: id,
      modelId: updated.modelId,
      systemPrompt: updated.systemPrompt,
    })
  }
  if (
    conversationRestartChanged ||
    (runtimeConfigurationTouched && !conversationRestartChanged && !turnPolicyChanged)
  ) {
    void reconcileAgentRoomBindings({ agentId: id, userId }).catch(() => {})
  }
  return updated
}

export async function deleteAgentWorkspace(userId: string, id: string) {
  const agent = await prisma.agentIdentity.findFirst({
    where: { id, ownerType: 'user', ownerUserId: userId },
    select: { id: true, status: true },
  })
  if (!agent) throw new AgentWorkspaceError('not_found', 'Agent not found')

  if (agent.status !== 'deleted') {
    // Stop public claims before walking native Sessions; a visitor must not
    // create a new hidden Session halfway through Agent deletion.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM AgentPublication WHERE agentIdentityId = ${id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM AgentIdentity WHERE id = ${id} FOR UPDATE`
      await tx.agentPublication.updateMany({
        where: { agentIdentityId: id, ownerUserId: userId,
          status: { in: ['active', 'paused'] } },
        data: { status: 'paused', policyVersion: { increment: 1 } },
      })
      await tx.agentDirectMessage.updateMany({
        where: { status: { in: ['pending', 'running'] },
          conversation: { agentIdentityId: id, ownerUserId: userId } },
        data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, { agentIdentityId: id, ownerUserId: userId })
    })
  }

  const memberships = await prisma.roomMembership.findMany({
    where: { agentIdentityId: id, ownerUserId: userId, principalType: 'agent', status: 'active' },
    select: {
      id: true,
      roomId: true,
      parentHumanMembershipId: true,
      parentHumanMembership: { select: { status: true } },
      room: { select: { status: true, nextSequence: true } },
    },
  })
  const removedMembershipIds: string[] = []
  for (const membership of memberships) {
    if (
      membership.room.status === 'active' &&
      membership.parentHumanMembershipId &&
      membership.parentHumanMembership?.status === 'active'
    ) {
      const result = await removeRoomMembership({
        roomId: membership.roomId,
        actorMembershipId: membership.parentHumanMembershipId,
        targetMembershipId: membership.id,
      })
      removedMembershipIds.push(...result.removedMembershipIds)
    } else {
      // Archived Rooms and deleted human records can legitimately outlive their
      // detached Agent membership. Global Agent deletion is owner-authorized and
      // must not require that historical human membership to become active again.
      const now = new Date()
      const [, removed] = await prisma.$transaction([
        prisma.roomBinding.updateMany({
          where: { agentMembershipId: membership.id },
          data: { status: 'detached', activationMode: 'paused' },
        }),
        prisma.roomMembership.updateMany({
          where: {
            id: membership.id,
            agentIdentityId: id,
            ownerUserId: userId,
            principalType: 'agent',
            status: 'active',
          },
          data: {
            status: 'removed',
            removedAt: now,
            historyThroughSequence: membership.room.nextSequence,
          },
        }),
      ])
      if (removed.count > 0) removedMembershipIds.push(membership.id)
    }
    await broadcastRoomEvent(membership.roomId, {
      event: 'room.membership.updated',
      roomId: membership.roomId,
      entityId: membership.id,
    })
  }

  const sessions = await prisma.nianSession.findMany({
    where: { agentIdentityId: id },
    select: { id: true },
  })
  const deletedSessionIds: string[] = []
  for (const session of sessions) {
    await deleteSessionForUser(session.id, userId, { nativeCleanupPolicy: 'auto' })
    deletedSessionIds.push(session.id)
  }

  // Keep the Agent visible and retryable until all dedicated conversations
  // have durable deletion tombstones. Marking it deleted first turns a later
  // session cleanup error into the misleading “failed, but disappeared” state.
  await prisma.$transaction([
    prisma.roomBinding.updateMany({
      where: {
        agentIdentityId: id,
        status: { in: ['pending_approval', 'active', 'paused'] },
      },
      data: { status: 'detached', activationMode: 'paused' },
    }),
    prisma.agentIdentity.update({
      where: { id },
      data: { status: 'deleted', pinnedAt: null },
    }),
  ])
  return { removedMembershipIds, deletedSessionIds, alreadyDeleted: agent.status === 'deleted' }
}

export async function createAgentWorkspaceSession(userId: string, id: string,
  input: Record<string, unknown> = {}, machineScopeId?: string) {
  const agent = await findOwnedAgent(userId, id, machineScopeId)
  if (!agent) throw new AgentWorkspaceError('not_found', 'Agent not found')
  if (
    !agent.machineId ||
    !agent.runtimeAdapter ||
    !agent.workDir ||
    !isAvailableAgentType(agent.runtimeAdapter)
  ) {
    throw new AgentWorkspaceError('invalid', 'Agent runtime configuration is incomplete')
  }
  const sessionMode = agent.sessionMode === 'manager' ? 'manager' : 'standard'
  const managerConfig =
    sessionMode === 'manager' ? normalizeManagerConfig(agent.managerConfig) : null
  const assignmentIntentId = normalizeText(input.assignmentIntentId, 191, 'assignmentIntentId')
  const creationKey = assignmentIntentId
    ? createHash('sha256').update(`${userId}\0${agent.id}\0${assignmentIntentId}`).digest('hex')
    : undefined
  const session = await createSessionForUser({
    creationKey,
    userId,
    machineId: agent.machineId,
    agentType: agent.runtimeAdapter,
    workDir: agent.workDir,
    modelId: agent.modelId ?? undefined,
    sessionMode,
    managerConfig,
    managerDefaultWorkerAgentType: managerConfig?.defaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: managerConfig?.defaultWorkerModelId ?? null,
    agentIdentityId: agent.id,
  })
  return {
    ...serializeCreatedSession(session),
    agentIdentityId: agent.id,
    modelSource: 'agent' as const,
    agentDefaultModelId: agent.modelId,
    agentSystemPrompt: agent.systemPrompt,
  }
}
