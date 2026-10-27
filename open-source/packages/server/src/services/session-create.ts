// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-session-create.test.ts
import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  hasRequiredSessionSyncCapabilities,
  type SessionScope,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { requireEntitlement } from './entitlements.js'
import { upsertSessionProject } from './projects.js'
import { requireMachineAccess } from './session-creation-access.js'

export async function createSessionForUser(params: {
  id?: string
  title?: string
  creationKey?: string
  machineId: string
  userId: string
  agentType: string
  sessionMode?: 'standard' | 'manager'
  sessionScope?: SessionScope
  managerConfig?: {
    defaultWorkerAgentType?: string | null
    defaultWorkerModelId?: string | null
  } | null
  workDir?: string
  modelId?: string
  managerDefaultWorkerAgentType?: string | null
  managerDefaultWorkerModelId?: string | null
  agentIdentityId?: string | null
}) {
  const legacyManager = params.agentType === 'manager'
  const sessionMode = legacyManager ? 'manager' : (params.sessionMode ?? 'standard')
  const agentType = legacyManager
    ? params.modelId === 'claude'
      ? 'claude'
      : 'codex'
    : params.agentType
  const sessionScope: SessionScope = params.sessionScope === 'steward' ? 'steward' : 'personal'
  const machine = await requireMachineAccess(params.machineId, params.userId)
  if (sessionScope === 'steward') {
    // The steward lives in the Owner's own fixed workspace; shared access never reaches it.
    if (machine.userId !== params.userId) throw new Error('Not authorized')
    if (sessionMode !== 'standard' || params.agentIdentityId) throw new Error('Steward session must be a standard personal session')
  }
  if (!machine.online) throw new Error('machine_offline')
  if (
    machine.sessionSyncProtocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    !hasRequiredSessionSyncCapabilities(
      Array.isArray(machine.sessionSyncCapabilities) ? machine.sessionSyncCapabilities as string[] : null,
    ) ||
    !machine.daemonInstallationId
  ) throw new Error('upgrade_required')
  if (sessionMode === 'manager') {
    await requireEntitlement(params.userId, 'manager_agent')
    const runtimeInfo = Array.isArray(machine.agents)
      ? machine.agents.find((item) =>
          Boolean(
            item && typeof item === 'object' && (item as { type?: unknown }).type === agentType,
          ),
        )
      : null
    const explicitlySupported = Boolean(
      runtimeInfo &&
      typeof runtimeInfo === 'object' &&
      (runtimeInfo as { supportsManagerMode?: unknown }).supportsManagerMode === true,
    )
    const legacyCompatible =
      !Array.isArray(machine.agents) && (agentType === 'codex' || agentType === 'claude')
    if (!explicitlySupported && !legacyCompatible)
      throw new Error('Manager mode is unavailable for this Agent')
  }
  let session = params.creationKey
    ? await prisma.nianSession.findUnique({ where: { creationKey: params.creationKey } })
    : null
  if (session) assertIdempotentSessionCreation(session, { ...params, sessionScope })
  if (!session) {
    try {
      session = await prisma.nianSession.create({
        data: {
          id: params.id,
          creationKey: params.creationKey ?? null,
          machineId: params.machineId,
          userId: params.userId,
          daemonInstallationId: machine.daemonInstallationId,
          dataEpoch: SESSION_SYNC_DATA_EPOCH,
          agentType,
          sessionMode,
          sessionScope,
          nativeSessionVisibility: sessionScope === 'steward' ? 'internal' : 'user',
          managerConfig: params.managerConfig ?? {
            defaultWorkerAgentType: params.managerDefaultWorkerAgentType ?? null,
            defaultWorkerModelId: params.managerDefaultWorkerModelId ?? null,
          },
          modelId: legacyManager ? null : (params.modelId ?? null),
          modelSource: params.agentIdentityId ? 'agent' : 'session',
          managerDefaultWorkerAgentType: params.managerDefaultWorkerAgentType ?? null,
          managerDefaultWorkerModelId: params.managerDefaultWorkerModelId ?? null,
          workDir: params.workDir ?? '',
          title: params.title?.trim() ?? '',
          ...(params.title?.trim() ? { titleSource: 'shennian_manual', titleLockedByUser: true, titleRevision: 1 } : {}),
          status: 'active',
          bodyStorageMode: 'machine_local',
          lastActivityAt: new Date(),
          deletedAt: null,
          agentIdentityId: params.agentIdentityId ?? null,
          userStates: {
            create: {
              userId: params.userId,
              lastReadAttentionCount: 0,
              lastReadAttentionId: null,
            },
          },
        },
      })
    } catch (error) {
      if (!params.creationKey || !isUniqueConstraintError(error)) throw error
      session = await prisma.nianSession.findUnique({ where: { creationKey: params.creationKey } })
      if (!session) throw error
      assertIdempotentSessionCreation(session, { ...params, sessionScope })
    }
  }
  await upsertSessionProject({
    machineId: session.machineId,
    workDir: session.workDir,
    agentIdentityId: session.agentIdentityId,
    sessionScope: session.sessionScope,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
  })
  return { ...session, machineName: machine.name ?? null }
}

function assertIdempotentSessionCreation(
  session: {
    id: string
    machineId: string
    workDir: string
    userId: string
    agentIdentityId: string | null
    sessionScope?: string
    deletedAt: Date | null
  },
  params: {
    id?: string
    machineId: string
    workDir?: string
    userId: string
    agentIdentityId?: string | null
    sessionScope: SessionScope
  },
) {
  if (
    (params.id !== undefined && session.id !== params.id) ||
    (params.id !== undefined && (session.machineId !== params.machineId || session.workDir !== (params.workDir ?? ''))) ||
    session.deletedAt ||
    session.userId !== params.userId ||
    session.agentIdentityId !== (params.agentIdentityId ?? null) ||
    (session.sessionScope ?? 'personal') !== params.sessionScope
  ) {
    throw new Error('Session creation key conflict')
  }
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

