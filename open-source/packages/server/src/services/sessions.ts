// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sessions-messages.test.ts

import {
  projectSessionPathCandidates,
  SESSION_SYNC_DATA_EPOCH,
  type NianSession,
  type NativeCleanupPolicy,
  type SessionActivitySnapshot,
  type SessionReadWatermark,
  type SessionUserState,
} from '@shennian/wire'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { getAccessibleMachineMap } from './session-visible-machines.js'
import { isDiagnosticUserId } from './log-policy.js'
import { connections } from '../relay/connections.js'
import { pubsub } from '../relay/pubsub.js'
import { syncCodexThreadTitle } from './codex-title-sync.js'
import { getSessionActivities } from './session-activity.js'
import { upsertSessionProject } from './projects.js'
import { personalHistoryRelay } from '../relay/personal-history-relay.js'
import { sensitivePersonalRelay } from '../relay/sensitive-personal-relay.js'
import { invalidateVoiceBodyCacheForSession } from './voice-body-cache.js'
import { requireMachineAccess } from './session-creation-access.js'
import { deleteSessionWorkRoomInTransaction } from './session-room-mirror.js'

import { BASE_SESSION_SELECT, USER_STATE_SELECT, type SessionRecord, type NativeSourceDeletionInput, type SessionUpdatePatch, buildSessionSelect, getManagerAgentSessionIds, buildOrdinarySessionWhere, serializeUserState, serializeSession, serializeDeletedSession } from './session-projection.js'

function collectNativeSourceDeletionInputs(session: {
  agentType: string
  agentSessionId: string | null
  roomNativeSources?: Array<{ agentType: string; sourceSessionKey: string }>
}): NativeSourceDeletionInput[] {
  const sources = new Map<string, NativeSourceDeletionInput>()
  if (session.agentSessionId) {
    sources.set(`${session.agentType}:${session.agentSessionId}`, {
      agentType: session.agentType,
      sourceSessionKey: session.agentSessionId,
    })
  }
  for (const source of session.roomNativeSources ?? []) {
    sources.set(`${source.agentType}:${source.sourceSessionKey}`, {
      agentType: source.agentType,
      sourceSessionKey: source.sourceSessionKey,
    })
  }
  return [...sources.values()]
}

function broadcastAccountEvent(machineId: string, userId: string, data: string): void {
  if (pubsub.isActive) {
    pubsub.publishToUser(userId, data)
    pubsub.publishToClient(machineId, data)
    return
  }
  connections.broadcastToClients(machineId, data)
  connections.broadcastToClientsOfUser(userId, data)
}

export function broadcastSessionUpdate(
  machineId: string,
  userId: string,
  session: SessionUpdatePatch,
): void {
  const eventData = JSON.stringify({
    type: 'event',
    event: 'session.update',
    payload: {
      machineId,
      session: {
        id: session.id,
        updatedAt: session.updatedAt.toISOString(),
        ...(session.lastActivityAt ? { lastActivityAt: session.lastActivityAt.toISOString() } : {}),
        ...(session.lastMessagePreview !== undefined
          ? { lastMessagePreview: session.lastMessagePreview }
          : {}),
        ...(session.lastMessagePreviewMessageId !== undefined
          ? { lastMessagePreviewMessageId: session.lastMessagePreviewMessageId }
          : {}),
        ...(session.lastMessagePreviewAt !== undefined
          ? { lastMessagePreviewAt: session.lastMessagePreviewAt?.toISOString() ?? null }
          : {}),
        ...(session.lastVisibleEventAt !== undefined
          ? { lastVisibleEventAt: session.lastVisibleEventAt?.toISOString() ?? null }
          : {}),
        ...(session.title !== undefined ? { title: session.title } : {}),
        ...(session.titleSource !== undefined ? { titleSource: session.titleSource } : {}),
        ...(session.titleRevision !== undefined ? { titleRevision: session.titleRevision } : {}),
        ...(session.titleLockedByUser !== undefined
          ? { titleLockedByUser: session.titleLockedByUser }
          : {}),
        ...(session.titleOriginEventId !== undefined
          ? { titleOriginEventId: session.titleOriginEventId }
          : {}),
        ...(session.modelId !== undefined ? { modelId: session.modelId } : {}),
        ...(session.modelSource !== undefined ? { modelSource: session.modelSource } : {}),
        ...(session.agentDefaultModelId !== undefined
          ? { agentDefaultModelId: session.agentDefaultModelId }
          : {}),
        ...(session.agentSystemPrompt !== undefined
          ? { agentSystemPrompt: session.agentSystemPrompt }
          : {}),
        ...(session.agentType !== undefined ? { agentType: session.agentType } : {}),
        ...(session.agentSessionId !== undefined ? { agentSessionId: session.agentSessionId } : {}),
        ...(session.sourceMode !== undefined ? { sourceMode: session.sourceMode } : {}),
        ...(session.status !== undefined ? { status: session.status } : {}),
        ...(session.workDir !== undefined ? { workDir: session.workDir } : {}),
        ...(session.deletedAt !== undefined
          ? { deletedAt: session.deletedAt?.toISOString() ?? null }
          : {}),
      },
    },
  })
  broadcastAccountEvent(machineId, userId, eventData)
}

function broadcastSessionDelete(
  machineId: string,
  userId: string,
  sessionId: string,
  deletedAt?: Date,
  deletionRevision?: number,
): void {
  const eventData = JSON.stringify({
    type: 'event',
    event: 'session.delete',
    payload: {
      machineId,
      sessionId,
      ...(deletedAt ? { deletedAt: deletedAt.toISOString() } : {}),
      ...(deletionRevision !== undefined ? { deletionRevision } : {}),
    },
  })
  broadcastAccountEvent(machineId, userId, eventData)
}

function broadcastUserStateUpdate(
  userId: string,
  sessionId: string,
  userState: SessionUserState | null,
): void {
  const eventData = JSON.stringify({
    type: 'event',
    event: 'session.user-state',
    payload: { sessionId, userState },
  })
  if (pubsub.isActive) {
    pubsub.publishToUser(userId, eventData)
    return
  }
  connections.broadcastToClientsOfUser(userId, eventData)
}

async function hydrateSessionsForList(
  sessions: SessionRecord[],
  machineMap: Map<string, string>,
  viewerUserId: string,
): Promise<NianSession[]> {
  const activityMap = await getSessionActivities(
    sessions.filter((session) => !session.deletedAt).map((session) => session.id),
  )
  const ownerIds = [...new Set(sessions.map((session) => session.userId).filter(Boolean))]
  const owners =
    ownerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true, phone: true, email: true },
        })
      : []
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner]))
  return sessions.map((session) =>
    serializeSession(
      session,
      machineMap.get(session.machineId) ?? null,
      activityMap.get(session.id) ?? null,
      viewerUserId,
      ownerMap.get(session.userId) ?? null,
    ),
  )
}

export async function upsertSession(params: {
  id: string
  machineId: string
  userId: string
  agentType?: string
  sessionMode?: 'standard' | 'manager'
  managerConfig?: {
    defaultWorkerAgentType?: string | null
    defaultWorkerModelId?: string | null
  } | null
  agentSessionId?: string | null
  modelId?: string | null
  managerDefaultWorkerAgentType?: string | null
  managerDefaultWorkerModelId?: string | null
  title?: string
  status?: string
  workDir?: string
}): Promise<void> {
  let existing = await prisma.nianSession.findUnique({ where: { id: params.id } })

  if (!existing && params.agentSessionId && params.agentType) {
    existing = await prisma.nianSession.findFirst({
      where: {
        machineId: params.machineId,
        agentType: params.agentType,
        agentSessionId: params.agentSessionId,
      },
    })
  }

  if (existing) {
    const data: Record<string, unknown> = {
      deletedAt: null,
    }
    if (params.agentType !== undefined) data.agentType = params.agentType
    if (params.sessionMode !== undefined) data.sessionMode = params.sessionMode
    if (params.managerConfig !== undefined) data.managerConfig = params.managerConfig
    if (params.agentSessionId !== undefined) data.agentSessionId = params.agentSessionId
    if (params.modelId !== undefined) data.modelId = params.modelId
    if (params.managerDefaultWorkerAgentType !== undefined)
      data.managerDefaultWorkerAgentType = params.managerDefaultWorkerAgentType
    if (params.managerDefaultWorkerModelId !== undefined)
      data.managerDefaultWorkerModelId = params.managerDefaultWorkerModelId
    if (params.title !== undefined) data.title = params.title
    if (params.status !== undefined) data.status = params.status
    if (params.workDir !== undefined) data.workDir = params.workDir
    await prisma.nianSession.update({
      where: { id: existing.id },
      data,
    })
    await upsertSessionProject({
      machineId: existing.machineId,
      workDir: params.workDir ?? existing.workDir,
      agentIdentityId: existing.agentIdentityId,
      sessionScope: existing.sessionScope,
      lastActivityAt: existing.lastActivityAt,
      createdAt: existing.createdAt,
    })
    return
  }

  const session = await prisma.nianSession.create({
    data: {
      id: params.id,
      machineId: params.machineId,
      userId: params.userId,
      agentType: params.agentType ?? 'claude',
      sessionMode: params.sessionMode ?? (params.agentType === 'manager' ? 'manager' : 'standard'),
      managerConfig: params.managerConfig == null ? Prisma.JsonNull : params.managerConfig,
      agentSessionId: params.agentSessionId ?? null,
      modelId: params.modelId ?? null,
      managerDefaultWorkerAgentType: params.managerDefaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId: params.managerDefaultWorkerModelId ?? null,
      title: params.title ?? '',
      status: params.status ?? 'active',
      workDir: params.workDir ?? '',
      lastActivityAt: new Date(),
      deletedAt: null,
    },
  })
  await upsertSessionProject({
    machineId: session.machineId,
    workDir: session.workDir,
    agentIdentityId: session.agentIdentityId,
    sessionScope: session.sessionScope,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
  })
}

export { createSessionForUser } from './session-create.js'

export async function listUserSessions(params: {
  userId: string
  limit: number
  before?: Date
  updatedAfter?: Date
  excludeRoomBound?: boolean
}) {
  const machineMap = await getAccessibleMachineMap(params.userId)
  const machineIds = [...machineMap.keys()]
  if (isDiagnosticUserId(params.userId)) {
    console.log(
      `[listUserSessions] userId=${params.userId} machines=${machineIds.length} (${machineIds.join(',')})`,
    )
  }
  if (machineIds.length === 0) return []
  const managerAgentSessionIds = await getManagerAgentSessionIds(machineIds)
  const audienceFilter = params.excludeRoomBound
    ? {
        agentIdentityId: null,
        roomBinding: { is: null },
        roomNativeSources: { none: { sourceMode: 'room_hook' } },
      }
    : {}

  if (params.updatedAfter) {
    const [sessions, deletions] = await Promise.all([
      prisma.nianSession.findMany({
        where: buildOrdinarySessionWhere(
          { machineId: { in: machineIds } },
          managerAgentSessionIds,
          { ...audienceFilter, userId: params.userId, updatedAt: { gt: params.updatedAfter } },
        ),
        select: buildSessionSelect(params.userId),
        orderBy: { updatedAt: 'asc' },
        take: params.limit,
      }),
      prisma.sessionDeletion.findMany({
        where: {
          machineId: { in: machineIds },
          userId: params.userId,
          deletedAt: { gt: params.updatedAfter },
        },
        orderBy: { deletedAt: 'asc' },
        take: params.limit,
      }),
    ])
    const hydrated = await hydrateSessionsForList(
      sessions as unknown as SessionRecord[],
      machineMap,
      params.userId,
    )
    const tombstones = deletions.map((deletion) =>
      serializeDeletedSession(deletion, machineMap.get(deletion.machineId) ?? null),
    )
    const merged = [...hydrated, ...tombstones]
      .sort(
        (left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime(),
      )
      .slice(0, params.limit)
    if (isDiagnosticUserId(params.userId)) {
      console.log(`[listUserSessions] found ${merged.length} session deltas`)
    }
    return merged
  }

  const sessions = await prisma.nianSession.findMany({
    where: buildOrdinarySessionWhere({ machineId: { in: machineIds } }, managerAgentSessionIds, {
      ...audienceFilter,
      userId: params.userId,
      deletedAt: null,
      ...(params.before ? { lastActivityAt: { lt: params.before } } : {}),
    }),
    select: buildSessionSelect(params.userId),
    orderBy: { lastActivityAt: 'desc' },
    take: params.limit,
  })

  if (isDiagnosticUserId(params.userId)) {
    console.log(`[listUserSessions] found ${sessions.length} sessions`)
  }
  return hydrateSessionsForList(sessions as unknown as SessionRecord[], machineMap, params.userId)
}

export async function getUserSessionIndex(sessionId: string, userId: string) {
  const machineMap = await getAccessibleMachineMap(userId)
  const machineIds = [...machineMap.keys()]
  if (machineIds.length === 0) return null
  const session = await prisma.nianSession.findFirst({
    where: {
      id: sessionId, machineId: { in: machineIds }, userId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH, deletedAt: null,
    },
    select: buildSessionSelect(userId),
  })
  if (!session) return null
  const [hydrated] = await hydrateSessionsForList(
    [session as unknown as SessionRecord],
    machineMap,
    userId,
  )
  return hydrated ?? null
}

export async function listMachineSessions(params: {
  machineId: string
  userId: string
  limit: number
  before?: Date
}) {
  await requireMachineAccess(params.machineId, params.userId)
  const managerAgentSessionIds = await getManagerAgentSessionIds([params.machineId])
  const sessions = await prisma.nianSession.findMany({
    where: buildOrdinarySessionWhere({ machineId: params.machineId }, managerAgentSessionIds, {
      userId: params.userId,
      deletedAt: null,
      ...(params.before ? { lastActivityAt: { lt: params.before } } : {}),
    }),
    select: buildSessionSelect(params.userId),
    orderBy: { lastActivityAt: 'desc' },
    take: params.limit,
  })

  return hydrateSessionsForList(
    sessions as unknown as SessionRecord[],
    new Map<string, string>(),
    params.userId,
  )
}

/**
 * Steward history: only the machine Owner's own steward sessions, never mixed
 * into ordinary project or conversation lists. Steward sessions exist only on
 * machines the caller owns, so a revoked or shared machine returns nothing.
 */
export async function listStewardSessions(params: {
  userId: string
  machineId?: string
  limit: number
  before?: Date
}) {
  const machines = await prisma.machine.findMany({
    where: { userId: params.userId, ...(params.machineId ? { id: params.machineId } : {}) },
    select: { id: true, name: true },
  })
  if (machines.length === 0) return []
  const machineMap = new Map(machines.map((machine) => [machine.id, machine.name ?? '']))
  const sessions = await prisma.nianSession.findMany({
    where: {
      machineId: { in: [...machineMap.keys()] },
      userId: params.userId,
      sessionScope: 'steward',
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletedAt: null,
      ...(params.before ? { lastActivityAt: { lt: params.before } } : {}),
    },
    select: buildSessionSelect(params.userId),
    orderBy: { lastActivityAt: 'desc' },
    take: params.limit,
  })
  return hydrateSessionsForList(sessions as unknown as SessionRecord[], machineMap, params.userId)
}

export async function listProjectSessions(params: {
  machineId: string
  workDir: string
  userId: string
  limit: number
  before?: Date
  order?: 'asc' | 'desc'
}) {
  await requireMachineAccess(params.machineId, params.userId)
  const managerAgentSessionIds = await getManagerAgentSessionIds([params.machineId])
  const workDirCandidates = projectSessionPathCandidates(params.workDir)
  const sessions = await prisma.nianSession.findMany({
    where: buildOrdinarySessionWhere({ machineId: params.machineId }, managerAgentSessionIds, {
      userId: params.userId,
      deletedAt: null,
      workDir: { in: workDirCandidates },
      ...(params.before ? { lastActivityAt: { lt: params.before } } : {}),
    }, { includeProjectWorkers: true }),
    select: buildSessionSelect(params.userId),
    orderBy: { lastActivityAt: params.order ?? 'desc' },
    take: params.limit,
  })
  return hydrateSessionsForList(
    sessions as unknown as SessionRecord[],
    new Map<string, string>(),
    params.userId,
  )
}

export async function listUserSessionActivities(
  userId: string,
): Promise<SessionActivitySnapshot[]> {
  const machineMap = await getAccessibleMachineMap(userId)
  const machineIds = [...machineMap.keys()]
  if (machineIds.length === 0) return []

  const sessions = await prisma.nianSession.findMany({
    where: {
      machineId: { in: machineIds },
      userId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletedAt: null,
    },
    select: { id: true },
  })

  const activityMap = await getSessionActivities(sessions.map((session) => session.id))
  return [...activityMap.values()]
}

export type DeleteSessionResult = {
  deletedAt: string
  alreadyDeleted: boolean
  deletionRevision: number
}

export type CommittedSessionDeletion = DeleteSessionResult & {
  sessionId: string
  userId: string
  machineId: string
}

async function findOwnedSessionDeletion(
  sessionId: string,
  userId: string,
  db: Pick<Prisma.TransactionClient, 'sessionDeletion'> = prisma,
): Promise<CommittedSessionDeletion | null> {
  const deletion = await db.sessionDeletion.findUnique({
    where: { sessionId },
    select: { userId: true, machineId: true, deletedAt: true, deletionRevision: true },
  })
  if (!deletion || deletion.userId !== userId) return null
  return {
    sessionId,
    userId,
    machineId: deletion.machineId,
    deletedAt: deletion.deletedAt.toISOString(),
    alreadyDeleted: true,
    deletionRevision: deletion.deletionRevision,
  }
}

/**
 * Commits the durable deletion barrier and removes the personal projection in
 * the caller's transaction. Room lifecycle code uses this before committing
 * detach/archive so neither half can become visible without the other.
 * Socket broadcasts and daemon cleanup notification deliberately happen only
 * after the outer transaction commits.
 */
export async function commitSessionDeletionInTransaction(
  tx: Prisma.TransactionClient,
  sessionId: string,
  userId: string,
  options: { nativeCleanupPolicy: NativeCleanupPolicy; deletedAt?: Date },
): Promise<CommittedSessionDeletion> {
  const session = await tx.nianSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      machineId: true,
      daemonInstallationId: true,
      agentType: true,
      agentSessionId: true,
      workDir: true,
      deletedAt: true,
      conversationRoomId: true,
      roomNativeSources: {
        select: {
          agentType: true,
          sourceSessionKey: true,
        },
      },
      machine: { select: { daemonInstallationId: true } },
    },
  })
  if (!session) {
    const existingDeletion = await findOwnedSessionDeletion(sessionId, userId, tx)
    if (existingDeletion) return existingDeletion
    throw new Error('Session not found')
  }
  if (session.userId !== userId) throw new Error('Not authorized')
  // The session owns the stable daemon identity that created it; legacy rows
  // may fall back to the machine identity when one is still available.
  const daemonInstallationId =
    session.daemonInstallationId ?? session.machine.daemonInstallationId
  const deletedAt = options.deletedAt ?? new Date()
  const revision = await tx.machine.update({
    where: { id: session.machineId },
    data: { deletionRevision: { increment: 1 } },
    select: { deletionRevision: true },
  })
  await deleteSessionWorkRoomInTransaction(tx, sessionId, session.conversationRoomId)
  // Sessions created before installation identity existed cannot address a daemon
  // for native cleanup. The explicit delete must still remove their cloud record;
  // a tombstone with an invented identity would never be acknowledged.
  if (!daemonInstallationId) {
    await tx.requestLog.deleteMany({ where: { sessionId } })
    await tx.nianSession.delete({ where: { id: sessionId } })
    return {
      sessionId,
      userId: session.userId,
      machineId: session.machineId,
      deletedAt: deletedAt.toISOString(),
      alreadyDeleted: false,
      deletionRevision: revision.deletionRevision,
    }
  }

  const nativeSourceDeletions = collectNativeSourceDeletionInputs(session)
  await tx.sessionDeletion.upsert({
    where: { sessionId },
    create: {
      sessionId,
      userId: session.userId,
      machineId: session.machineId,
      daemonInstallationId,
      deletionRevision: revision.deletionRevision,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      nativeCleanupPolicy: options.nativeCleanupPolicy,
      workDir: session.workDir,
      deletedAt,
    },
    update: {
      userId: session.userId,
      machineId: session.machineId,
      daemonInstallationId,
      deletionRevision: revision.deletionRevision,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      nativeCleanupPolicy: options.nativeCleanupPolicy,
      workDir: session.workDir,
      deletedAt,
      daemonAckedAt: null,
    },
  })
  for (const source of nativeSourceDeletions) {
    const sourceSessionKeyHash = createHash('sha256').update(source.sourceSessionKey).digest('hex')
    await tx.nativeSourceDeletion.upsert({
      where: {
        daemonInstallationId_agentType_sourceSessionKeyHash: {
          daemonInstallationId,
          agentType: source.agentType,
          sourceSessionKeyHash,
        },
      },
      create: {
        accountId: session.userId,
        sessionId,
        machineId: session.machineId,
        daemonInstallationId,
        agentType: source.agentType,
        sourceSessionKey: source.sourceSessionKey,
        sourceSessionKeyHash,
        deletionRevision: revision.deletionRevision,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        deletedAt,
      },
      update: {
        accountId: session.userId,
        sessionId,
        machineId: session.machineId,
        daemonInstallationId,
        sourceSessionKey: source.sourceSessionKey,
        deletionRevision: revision.deletionRevision,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        deletedAt,
        acknowledgedAt: null,
      },
    })
  }
  await tx.requestLog.deleteMany({ where: { sessionId } })
  await tx.nianSession.delete({ where: { id: sessionId } })
  return {
    sessionId,
    userId: session.userId,
    machineId: session.machineId,
    deletedAt: deletedAt.toISOString(),
    alreadyDeleted: false,
    deletionRevision: revision.deletionRevision,
  }
}

export function finalizeCommittedSessionDeletion(deletion: CommittedSessionDeletion): void {
  const deletedAt = new Date(deletion.deletedAt)
  broadcastSessionDelete(
    deletion.machineId,
    deletion.userId,
    deletion.sessionId,
    deletedAt,
    deletion.deletionRevision,
  )
  personalHistoryRelay.closeSession(deletion.sessionId, (machineId, frame) => {
    const data = JSON.stringify(frame)
    if (!connections.sendToMachine(machineId, data)) pubsub.publishToRelay(machineId, data)
  })
  sensitivePersonalRelay.invalidateSession(deletion.sessionId)
  invalidateVoiceBodyCacheForSession(deletion.sessionId)
}

export async function deleteSessionForUser(
  sessionId: string,
  userId: string,
  options: { nativeCleanupPolicy?: NativeCleanupPolicy } = {},
): Promise<DeleteSessionResult> {
  const nativeCleanupPolicy = options.nativeCleanupPolicy ?? 'none'
  try {
    const committed = await prisma.$transaction(async (tx) => {
      return commitSessionDeletionInTransaction(tx, sessionId, userId, {
        nativeCleanupPolicy,
      })
    })
    finalizeCommittedSessionDeletion(committed)
    return {
      deletedAt: committed.deletedAt,
      alreadyDeleted: committed.alreadyDeleted,
      deletionRevision: committed.deletionRevision,
    }
  } catch (error) {
    // Concurrent DELETE requests can both read the row before one transaction
    // wins. Once the winner commits its tombstone, the loser is successful too.
    const existingDeletion = await findOwnedSessionDeletion(sessionId, userId)
    if (existingDeletion) {
      return {
        deletedAt: existingDeletion.deletedAt,
        alreadyDeleted: true,
        deletionRevision: existingDeletion.deletionRevision,
      }
    }
    throw error
  }
}

export async function renameSessionForUser(params: {
  sessionId: string
  userId: string
  title?: string
  modelId?: string | null
  modelSource?: 'agent' | 'session'
  /** Only a steward conversation may move to another AI tool in place. */
  agentType?: string
  managerDefaultWorkerAgentType?: string | null
  managerDefaultWorkerModelId?: string | null
}) {
  const session = await prisma.nianSession.findUnique({
    where: { id: params.sessionId },
    include: {
      agentIdentity: { select: { ownerUserId: true, modelId: true, systemPrompt: true } },
    },
  })
  if (!session || session.deletedAt) {
    throw new Error('Session not found')
  }
  if (session.userId !== params.userId) {
    throw new Error('Not authorized')
  }

  const data: Record<string, unknown> = {}
  const manualTitle = params.title?.trim()
  if (manualTitle) {
    data.title = manualTitle
    data.titleSource = 'shennian_manual'
    data.titleRevision = { increment: 1 }
    data.titleLockedByUser = true
    data.titleOriginEventId = `shennian-manual:${randomUUID()}`
  }
  if (params.modelId !== undefined) data.modelId = params.modelId
  if (params.agentType !== undefined) {
    // The steward keeps one conversation per machine; switching its AI tool must not fork it.
    if (session.sessionScope !== 'steward') throw new Error('Agent switch is unavailable')
    data.agentType = params.agentType
  }
  if (params.modelSource !== undefined) {
    if (
      params.modelSource === 'agent' &&
      (!session.agentIdentity || session.agentIdentity.ownerUserId !== params.userId)
    ) {
      throw new Error('Agent model follow is unavailable')
    }
    data.modelSource = params.modelSource
  }
  if (params.managerDefaultWorkerAgentType !== undefined) {
    data.managerDefaultWorkerAgentType = params.managerDefaultWorkerAgentType
  }
  if (params.managerDefaultWorkerModelId !== undefined) {
    data.managerDefaultWorkerModelId = params.managerDefaultWorkerModelId
  }

  const updated = await prisma.nianSession.update({
    where: { id: params.sessionId },
    data,
    select: BASE_SESSION_SELECT,
  })

  broadcastSessionUpdate(session.machineId, params.userId, {
    id: updated.id,
    updatedAt: updated.updatedAt,
    title: updated.title,
    titleSource: updated.titleSource as NianSession['titleSource'],
    titleRevision: updated.titleRevision,
    titleLockedByUser: updated.titleLockedByUser,
    titleOriginEventId: updated.titleOriginEventId,
    modelId: updated.modelId,
    modelSource: updated.modelSource === 'agent' ? 'agent' : 'session',
    ...(params.agentType !== undefined ? { agentType: updated.agentType } : {}),
    ...(session.agentIdentity
      ? {
          agentDefaultModelId: session.agentIdentity.modelId,
          agentSystemPrompt: session.agentIdentity.systemPrompt,
        }
      : {}),
    managerDefaultWorkerAgentType: updated.managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId: updated.managerDefaultWorkerModelId,
  })

  if (manualTitle && updated.titleOriginEventId) {
    syncCodexThreadTitle({
      machineId: session.machineId,
      sessionId: updated.id,
      agentType: updated.agentType,
      agentSessionId: updated.agentSessionId,
      workDir: updated.workDir,
      title: updated.title,
      titleRevision: updated.titleRevision,
      titleOriginEventId: updated.titleOriginEventId,
    })
  }
}

export async function broadcastAgentRuntimePolicy(params: {
  agentIdentityId: string
  modelId: string | null
  systemPrompt: string
}) {
  const sessions = await prisma.nianSession.findMany({
    where: { agentIdentityId: params.agentIdentityId, deletedAt: null },
    select: { id: true, machineId: true, userId: true, updatedAt: true },
  })
  for (const session of sessions) {
    broadcastSessionUpdate(session.machineId, session.userId, {
      id: session.id,
      updatedAt: session.updatedAt,
      agentDefaultModelId: params.modelId,
      agentSystemPrompt: params.systemPrompt,
    })
  }
}

export async function updateSessionUserState(params: {
  sessionId: string
  userId: string
  pinned?: boolean
  manualUnread?: boolean
  lastReadAt?: Date | null
  readWatermark?: SessionReadWatermark
}): Promise<SessionUserState | null> {
  const session = await prisma.nianSession.findUnique({
    where: { id: params.sessionId },
    select: { id: true, machineId: true, userId: true, dataEpoch: true, deletedAt: true },
  })
  if (!session || session.deletedAt || session.dataEpoch !== SESSION_SYNC_DATA_EPOCH) {
    throw new Error('Session not found')
  }
  if (session.userId !== params.userId) throw new Error('Not authorized')
  await requireMachineAccess(session.machineId, params.userId)

  const now = new Date()
  const nextPinnedAt = params.pinned === undefined ? undefined : params.pinned ? now : null
  const nextManualUnread = params.manualUnread
  const userState = await prisma.$transaction(async (tx) => {
    // Old clients omit readWatermark and intentionally capture the latest
    // server index. New clients submit the exact index that was painted; this
    // prevents a reply landing between paint and PATCH from being marked read.
    const currentIndex = await tx.nianSession.findUnique({
      where: { id: params.sessionId },
      select: {
        deletedAt: true,
        bodyRevision: true,
        visibleMessageCount: true,
        lastVisibleMessageId: true,
        attentionCount: true,
        lastAttentionId: true,
      },
    })
    if (!currentIndex || currentIndex.deletedAt) throw new Error('Session not found')

    const existingUserState = await tx.sessionUserState.findUnique({
      where: {
        userId_sessionId: {
          userId: params.userId,
          sessionId: params.sessionId,
        },
      },
      select: USER_STATE_SELECT,
    })
    const nextLastReadAt =
      params.lastReadAt === undefined
        ? undefined
        : params.lastReadAt === null
          ? null
          : existingUserState?.lastReadAt && existingUserState.lastReadAt > params.lastReadAt
            ? existingUserState.lastReadAt
            : params.lastReadAt
    const captureReadIndex = params.lastReadAt !== undefined
    const requestedIndex = params.readWatermark ?? currentIndex
    const boundedIndex = {
      bodyRevision: Math.min(currentIndex.bodyRevision, Math.max(0, requestedIndex.bodyRevision)),
      visibleMessageCount: Math.min(
        currentIndex.visibleMessageCount,
        Math.max(0, requestedIndex.visibleMessageCount),
      ),
      lastVisibleMessageId:
        requestedIndex.bodyRevision > currentIndex.bodyRevision
          ? currentIndex.lastVisibleMessageId
          : requestedIndex.lastVisibleMessageId,
      attentionCount: Math.min(
        currentIndex.attentionCount,
        Math.max(0, requestedIndex.attentionCount),
      ),
      lastAttentionId:
        requestedIndex.attentionCount > currentIndex.attentionCount
          ? currentIndex.lastAttentionId
          : requestedIndex.lastAttentionId,
    }
    const existingBodyRevision = existingUserState?.lastReadBodyRevision ?? 0
    const existingAttentionCount = existingUserState?.lastReadAttentionCount ?? 0
    const readIndex =
      params.lastReadAt === null
        ? {
            lastReadBodyRevision: 0,
            lastReadVisibleMessageCount: 0,
            lastReadVisibleMessageId: null,
            lastReadAttentionCount: 0,
            lastReadAttentionId: null,
          }
        : {
            lastReadBodyRevision: Math.max(existingBodyRevision, boundedIndex.bodyRevision),
            lastReadVisibleMessageCount:
              boundedIndex.bodyRevision >= existingBodyRevision
                ? boundedIndex.visibleMessageCount
                : (existingUserState?.lastReadVisibleMessageCount ?? 0),
            lastReadVisibleMessageId:
              boundedIndex.bodyRevision >= existingBodyRevision
                ? boundedIndex.lastVisibleMessageId
                : (existingUserState?.lastReadVisibleMessageId ?? null),
            lastReadAttentionCount: Math.max(existingAttentionCount, boundedIndex.attentionCount),
            lastReadAttentionId:
              boundedIndex.attentionCount >= existingAttentionCount
                ? boundedIndex.lastAttentionId
                : (existingUserState?.lastReadAttentionId ?? null),
          }

    const updatedUserState = await tx.sessionUserState.upsert({
      where: {
        userId_sessionId: {
          userId: params.userId,
          sessionId: params.sessionId,
        },
      },
      create: {
        userId: params.userId,
        sessionId: params.sessionId,
        pinnedAt: nextPinnedAt ?? null,
        lastReadAt: nextLastReadAt ?? null,
        ...(captureReadIndex ? readIndex : {}),
        manualUnread: nextManualUnread ?? false,
      },
      update: {
        ...(nextPinnedAt !== undefined ? { pinnedAt: nextPinnedAt } : {}),
        ...(nextLastReadAt !== undefined ? { lastReadAt: nextLastReadAt } : {}),
        ...(captureReadIndex ? readIndex : {}),
        ...(nextManualUnread !== undefined ? { manualUnread: nextManualUnread } : {}),
      },
      select: USER_STATE_SELECT,
    })

    await tx.nianSession.update({
      where: { id: params.sessionId },
      data: { updatedAt: now },
    })
    return updatedUserState
  })

  const serialized = serializeUserState(userState)
  broadcastUserStateUpdate(params.userId, params.sessionId, serialized)
  return serialized
}
