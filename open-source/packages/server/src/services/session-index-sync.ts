// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-index-sync.test.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_TITLE_SOURCE_PRIORITY,
  hasRequiredSessionSyncCapabilities,
  isInternalSession,
  isStewardSession,
  isSessionTitleSource,
  sanitizeSessionPreview,
  type DaemonSessionIndexProjection,
  type NianSession,
  type SessionIndexUpdate,
  type SessionTitleSource,
} from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { rejectSessionSync } from './session-sync-rejection.js'
import {
  TASK_COMPLETION_PUSH_SUPPRESSION_MS,
  buildTerminalNotificationSnapshot,
  kickTaskCompletionPushWorker,
} from './task-completion-push.js'
import { invalidateVoiceBodyCacheForSession } from './voice-body-cache.js'

const SESSION_TITLE_MAX_LENGTH = 120

function normalizeSessionTitle(title: string): string {
  if (title.length <= SESSION_TITLE_MAX_LENGTH) return title
  let normalized = title.slice(0, SESSION_TITLE_MAX_LENGTH)
  const last = normalized.charCodeAt(normalized.length - 1)
  if (last >= 0xD800 && last <= 0xDBFF) normalized = normalized.slice(0, -1)
  return normalized
}

export type SessionIndexApplyResult = {
  sessionId: string
  indexRevision: number
  applied: boolean
  sessionPatch?: Partial<NianSession> & Pick<NianSession, 'id'>
}

export async function applySessionIndexUpdate(
  machineId: string,
  ownerId: string,
  update: SessionIndexUpdate,
): Promise<SessionIndexApplyResult> {
  // Older daemons could append an ellipsis after taking a 120-character
  // preview, producing a 121-character fallback title. Title length is a
  // display/storage concern, not grounds for quarantining the whole index.
  if (typeof update.session.title === 'string') {
    update.session.title = normalizeSessionTitle(update.session.title)
  }
  validateUpdate(update)
  const publisher = await prisma.machine.findUnique({
    where: { id: machineId },
    select: {
      userId: true,
      online: true,
      sessionSyncProtocolVersion: true,
      sessionSyncDataEpoch: true,
      sessionSyncCapabilities: true,
      daemonInstallationId: true,
    },
  })
  if (!publisher || publisher.userId !== ownerId) {
    rejectSessionSync('ownership_transferred', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (
    !publisher.online ||
    publisher.sessionSyncProtocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    publisher.sessionSyncDataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    !hasRequiredSessionSyncCapabilities(
      Array.isArray(publisher.sessionSyncCapabilities)
        ? publisher.sessionSyncCapabilities as string[]
        : null,
    ) ||
    publisher.daemonInstallationId !== update.daemonInstallationId
  ) {
    rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  const incoming = update.session
  const deletion = await prisma.sessionDeletion.findUnique({
    where: { sessionId: incoming.id },
    select: {
      daemonInstallationId: true,
      dataEpoch: true,
      deletionRevision: true,
    },
  })
  if (deletion?.daemonInstallationId === update.daemonInstallationId
    && deletion.dataEpoch === SESSION_SYNC_DATA_EPOCH) {
    rejectSessionSync('session_deleted', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      authoritativeRevision: deletion.deletionRevision,
    })
  }
  const existing = await prisma.nianSession.findUnique({
    where: { id: incoming.id },
    select: {
      machineId: true,
      userId: true,
      daemonInstallationId: true,
      dataEpoch: true,
      indexRevision: true,
      nativeSessionVisibility: true,
      sessionScope: true,
      agentType: true,
      sessionMode: true,
      agentIdentityId: true,
      title: true,
      titleSource: true,
      titleRevision: true,
      titleLockedByUser: true,
      titleOriginEventId: true,
      localReadyAt: true,
      firstUserMessageId: true,
      firstUserBodyRevision: true,
      attentionCount: true,
      lastAttentionId: true,
      roomBinding: { select: { id: true } },
    },
  })
  if (isInternalSession({ ...existing, id: incoming.id }) || isInternalSession(incoming)) {
    incoming.nativeSessionVisibility = 'internal'
  }
  // Steward ownership is one-way: a stale or legacy projection can neither demote it nor grant it later.
  if (existing) {
    if (isStewardSession(existing)) incoming.sessionScope = 'steward'
    else if (isStewardSession(incoming)) rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
  if (existing) {
    if (existing.machineId !== machineId || existing.userId !== ownerId || existing.roomBinding) {
      rejectSessionSync(existing.roomBinding ? 'room_authority_conflict' : 'ownership_transferred', {
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      })
    }
    if (existing.daemonInstallationId !== update.daemonInstallationId) {
      rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
    }
    if (existing.dataEpoch != null && existing.dataEpoch !== update.dataEpoch) rejectSessionSync('epoch_mismatch', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
    })
    assertBoundaryConsistency(existing, incoming)
    assertAttentionConsistency(existing, incoming)
    if (incoming.indexRevision <= existing.indexRevision) {
      return { sessionId: incoming.id, indexRevision: incoming.indexRevision, applied: false }
    }
    let current = existing
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const applied = await prisma.$transaction(async (tx) => {
        const updated = await tx.nianSession.updateMany({
          where: {
            id: incoming.id,
            machineId,
            userId: ownerId,
            indexRevision: { lt: incoming.indexRevision },
            titleRevision: current.titleRevision,
            nativeSessionVisibility: current.nativeSessionVisibility,
          },
          data: indexData(incoming, current),
        })
        if (updated.count !== 1) return false
        await enqueueTerminalNotification(tx, ownerId, incoming, current.attentionCount ?? 0)
        return true
      })
      if (applied) {
        invalidateVoiceBodyCacheForSession(incoming.id)
        kickTaskCompletionPushWorker()
        return {
          sessionId: incoming.id,
          indexRevision: incoming.indexRevision,
          applied: true,
          sessionPatch: buildSessionPatch(machineId, ownerId, incoming, mergeTitle(current, incoming)),
        }
      }
      const refreshed = await prisma.nianSession.findUnique({
        where: { id: incoming.id },
        select: {
          machineId: true,
          userId: true,
          daemonInstallationId: true,
          dataEpoch: true,
          indexRevision: true,
          nativeSessionVisibility: true,
          sessionScope: true,
          agentType: true,
          sessionMode: true,
          agentIdentityId: true,
          title: true,
          titleSource: true,
          titleRevision: true,
          titleLockedByUser: true,
          titleOriginEventId: true,
          localReadyAt: true,
          firstUserMessageId: true,
          firstUserBodyRevision: true,
          attentionCount: true,
          lastAttentionId: true,
          roomBinding: { select: { id: true } },
        },
      })
      if (!refreshed) throw new Error('session index disappeared during update')
      assertExistingOwnership(refreshed, machineId, ownerId, update.daemonInstallationId)
      assertBoundaryConsistency(refreshed, incoming)
      assertAttentionConsistency(refreshed, incoming)
      if (incoming.indexRevision <= refreshed.indexRevision) {
        return { sessionId: incoming.id, indexRevision: incoming.indexRevision, applied: false }
      }
      if (isInternalSession({ ...refreshed, id: incoming.id })) incoming.nativeSessionVisibility = 'internal'
      if (isStewardSession(refreshed)) incoming.sessionScope = 'steward'
      current = refreshed
    }
    throw new Error('session index update contention')
  }

  await prisma.$transaction(async (tx) => {
    await tx.nianSession.create({
      data: {
        id: incoming.id,
        machineId,
        userId: ownerId,
        daemonInstallationId: update.daemonInstallationId,
        ...indexData(incoming),
        userStates: {
          create: {
            userId: ownerId,
            lastReadAttentionCount: 0,
            lastReadAttentionId: null,
          },
        },
      },
    })
    await enqueueTerminalNotification(tx, ownerId, incoming, 0)
  })
  invalidateVoiceBodyCacheForSession(incoming.id)
  kickTaskCompletionPushWorker()
  return {
    sessionId: incoming.id,
    indexRevision: incoming.indexRevision,
    applied: true,
    sessionPatch: buildSessionPatch(machineId, ownerId, incoming, mergeTitle(undefined, incoming)),
  }
}

function buildSessionPatch(
  machineId: string,
  ownerId: string,
  session: DaemonSessionIndexProjection,
  title: ExistingTitle,
): Partial<NianSession> & Pick<NianSession, 'id'> {
  return {
    id: session.id,
    machineId,
    userId: ownerId,
    agentType: session.agentType,
    sessionMode: session.sessionMode ?? 'standard',
    nativeSessionVisibility: session.nativeSessionVisibility ?? 'user',
    sessionScope: session.sessionScope ?? 'personal',
    managerConfig: session.managerConfig ?? null,
    agentSessionId: session.agentSessionId,
    modelId: session.modelId,
    managerDefaultWorkerAgentType: session.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: session.managerDefaultWorkerModelId ?? null,
    title: title.title,
    titleSource: title.titleSource as SessionTitleSource,
    titleRevision: title.titleRevision,
    titleLockedByUser: title.titleLockedByUser,
    titleOriginEventId: title.titleOriginEventId,
    status: session.status,
    workDir: session.workDir,
    lastMessagePreview: session.lastMessagePreview,
    lastMessagePreviewMessageId: session.lastMessagePreviewMessageId,
    lastMessagePreviewAt: session.lastMessagePreviewAt,
    lastVisibleEventAt: session.lastVisibleEventAt,
    bodyStorageMode: 'machine_local',
    localReady: true,
    bodyRevision: session.bodyRevision,
    indexRevision: session.indexRevision,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    firstAvailableSeq: session.firstAvailableSeq,
    visibleMessageCount: session.visibleMessageCount,
    lastVisibleMessageId: session.lastVisibleMessageId,
    attentionCount: session.attentionCount,
    lastAttentionId: session.lastAttentionId,
    lastBodyCommittedAt: session.lastBodyCommittedAt,
    deletionRevision: session.deletionRevision,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    deletedAt: session.deletedAt,
  }
}

type ExistingTitle = {
  title: string
  titleSource: string
  titleRevision: number
  titleLockedByUser: boolean
  titleOriginEventId: string | null
}

type ExistingIndexState = ExistingTitle & {
  localReadyAt: Date | null
  firstUserMessageId: string | null
  firstUserBodyRevision: number | null
  attentionCount?: number
  lastAttentionId?: string | null
}

function indexData(session: DaemonSessionIndexProjection, existing?: ExistingIndexState) {
  const title = mergeTitle(existing, session)
  return {
    agentType: session.agentType,
    sessionMode: session.sessionMode ?? 'standard',
    nativeSessionVisibility: session.nativeSessionVisibility ?? 'user',
    sessionScope: session.sessionScope ?? 'personal',
    managerConfig: session.managerConfig == null
      ? Prisma.JsonNull
      : session.managerConfig as Prisma.InputJsonValue,
    agentSessionId: session.agentSessionId,
    modelId: session.modelId,
    managerDefaultWorkerAgentType: session.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: session.managerDefaultWorkerModelId ?? null,
    ...title,
    status: session.status,
    workDir: session.workDir,
    lastMessagePreview: session.lastMessagePreview,
    lastMessagePreviewMessageId: session.lastMessagePreviewMessageId,
    lastMessagePreviewAt: parseOptionalDate(session.lastMessagePreviewAt),
    ...(session.lastVisibleEventAt !== undefined
      ? { lastVisibleEventAt: parseOptionalDate(session.lastVisibleEventAt) }
      : {}),
    bodyStorageMode: 'machine_local',
    localReadyAt: existing?.localReadyAt ?? new Date(),
    firstUserMessageId: session.firstUserBoundary.messageId,
    firstUserBodyRevision: session.firstUserBoundary.bodyRevision,
    bodyRevision: session.bodyRevision,
    indexRevision: session.indexRevision,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    firstAvailableSeq: session.firstAvailableSeq,
    visibleMessageCount: session.visibleMessageCount,
    lastVisibleMessageId: session.lastVisibleMessageId,
    attentionCount: session.attentionCount,
    lastAttentionId: session.lastAttentionId,
    lastBodyCommittedAt: parseOptionalDate(session.lastBodyCommittedAt),
    deletionRevision: session.deletionRevision,
    lastActivityAt: parseDate(session.lastActivityAt, 'lastActivityAt'),
    createdAt: parseDate(session.createdAt, 'createdAt'),
    updatedAt: parseDate(session.updatedAt, 'updatedAt'),
    deletedAt: parseOptionalDate(session.deletedAt),
  }
}

function validateUpdate(update: SessionIndexUpdate): void {
  if (update.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION) rejectSessionSync('upgrade_required', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  if (update.dataEpoch !== SESSION_SYNC_DATA_EPOCH) rejectSessionSync('epoch_mismatch', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  if (!isBoundedString(update.daemonInstallationId, 191)) rejectSessionSync('invalid_identity', {
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  })
  const session = update.session as DaemonSessionIndexProjection & Record<string, unknown>
  if (session.nativeSessionVisibility !== undefined && session.nativeSessionVisibility !== 'user' && session.nativeSessionVisibility !== 'internal') {
    throw new Error('invalid native session visibility')
  }
  if (session.sessionScope !== undefined && session.sessionScope !== 'personal' && session.sessionScope !== 'steward') {
    throw new Error('invalid session scope')
  }
  for (const forbidden of ['machineId', 'userId', 'canManage', 'ownerName', 'ownerPhone', 'ownerEmail']) {
    if (forbidden in session) throw new Error(`daemon session index contains server-owned field: ${forbidden}`)
  }
  if (!isBoundedString(session.id, 191) || !isBoundedString(session.agentType, 191)) {
    throw new Error('invalid session index identity')
  }
  if (!isRevision(session.indexRevision) || session.indexRevision < 1
    || !isRevision(session.bodyRevision) || !isRevision(session.deletionRevision)
    || !isRevision(session.titleRevision) || !isRevision(session.visibleMessageCount)
    || !isRevision(session.attentionCount)) {
    throw new Error('invalid session index revision')
  }
  if (session.bodyStorageMode !== 'machine_local') throw new Error('personal session body must be machine_local')
  if (session.localReady !== true) throw new Error('missing_user_boundary: daemon session is not local-ready')
  if (session.firstUserBoundary?.role !== 'user'
    || !isBoundedString(session.firstUserBoundary.messageId, 191)
    || !isRevision(session.firstUserBoundary.bodyRevision)
    || session.firstUserBoundary.bodyRevision < 1
    || session.firstUserBoundary.bodyRevision > session.bodyRevision
    || session.visibleMessageCount < 1) {
    throw new Error('missing_user_boundary: invalid first user boundary proof')
  }
  if (!['active', 'completed', 'failed'].includes(session.status)) throw new Error('invalid session status')
  if ((session.attentionCount === 0 && session.lastAttentionId != null)
    || (session.attentionCount > 0 && !isBoundedString(session.lastAttentionId, 191))) {
    throw new Error('invalid session attention watermark')
  }
  if (!isSessionTitleSource(session.titleSource)) {
    throw new Error('upgrade_required: explicit titleSource is required')
  }
  if (typeof session.title !== 'string' || session.title.length > SESSION_TITLE_MAX_LENGTH) {
    throw new Error('invalid title')
  }
  if (session.titleSource !== 'first_user_fallback' && !session.title.trim()) {
    throw new Error('non-fallback title cannot be empty')
  }
  if (session.titleLockedByUser !== (session.titleSource === 'shennian_manual')) {
    throw new Error('title lock conflicts with title source')
  }
  if (session.titleOriginEventId != null
    && (typeof session.titleOriginEventId !== 'string' || session.titleOriginEventId.length > 191)) {
    throw new Error('invalid titleOriginEventId')
  }
  if (session.titleSource === 'shennian_manual' && !session.titleOriginEventId) {
    throw new Error('manual title origin is required')
  }
  if (session.lastMessagePreview != null) {
    if (!isBoundedString(session.lastMessagePreview, 200)) {
      throw new Error('lastMessagePreview exceeds 200 characters')
    }
    if (sanitizeSessionPreview(session.lastMessagePreview, 200) !== session.lastMessagePreview) {
      throw new Error('lastMessagePreview contains unsafe or non-canonical content')
    }
    if (!isBoundedString(session.lastMessagePreviewMessageId, 191)
      || session.lastMessagePreviewAt == null) {
      throw new Error('lastMessagePreview requires message identity and canonical timestamp')
    }
    parseDate(session.lastMessagePreviewAt, 'lastMessagePreviewAt')
  } else if (session.lastMessagePreviewMessageId != null || session.lastMessagePreviewAt != null) {
    throw new Error('empty lastMessagePreview cannot carry preview identity or timestamp')
  }
  if (session.lastVisibleEventAt !== undefined && session.lastVisibleEventAt !== null) {
    const visibleEventAt = parseDate(session.lastVisibleEventAt, 'lastVisibleEventAt')
    const activityAt = parseDate(session.lastActivityAt, 'lastActivityAt')
    if (visibleEventAt.getTime() > activityAt.getTime()) {
      throw new Error('lastVisibleEventAt cannot exceed lastActivityAt')
    }
    if (session.lastMessagePreviewAt &&
      visibleEventAt.getTime() < parseDate(session.lastMessagePreviewAt, 'lastMessagePreviewAt').getTime()) {
      throw new Error('lastVisibleEventAt cannot precede lastMessagePreviewAt')
    }
  }
}

function assertBoundaryConsistency(
  existing: Pick<ExistingIndexState, 'localReadyAt' | 'firstUserMessageId' | 'firstUserBodyRevision'>,
  incoming: DaemonSessionIndexProjection,
): void {
  if (!existing.localReadyAt) return
  if (existing.firstUserMessageId !== incoming.firstUserBoundary.messageId
    || existing.firstUserBodyRevision !== incoming.firstUserBoundary.bodyRevision) {
    throw new Error('first user boundary identity conflict')
  }
}

function assertAttentionConsistency(
  existing: Pick<ExistingIndexState, 'attentionCount' | 'lastAttentionId'>,
  incoming: DaemonSessionIndexProjection,
): void {
  const existingCount = existing.attentionCount ?? 0
  const existingId = existing.lastAttentionId ?? null
  if (incoming.attentionCount < existingCount) {
    throw new Error('session attention watermark moved backwards')
  }
  if (incoming.attentionCount === existingCount
    && incoming.lastAttentionId !== existingId) {
    throw new Error('session attention identity conflict')
  }
}

async function enqueueTerminalNotification(
  tx: Prisma.TransactionClient,
  userId: string,
  session: DaemonSessionIndexProjection,
  previousAttentionCount: number,
): Promise<void> {
  // Managed Workers and Manager orchestration turns are implementation detail.
  // User-facing Room messages have their own notification path.
  if (isInternalSession(session)) return
  if (session.status !== 'completed' && session.status !== 'failed') return
  if (session.attentionCount <= previousAttentionCount || !session.lastAttentionId) return
  const terminalState = session.status === 'failed' ? 'error' : 'final'
  const notification = buildTerminalNotificationSnapshot({
    title: session.title,
    preview: session.lastMessagePreview,
    previewMessageId: session.lastMessagePreviewMessageId,
    previewAt: session.lastMessagePreviewAt ? new Date(session.lastMessagePreviewAt) : null,
    terminalAt: new Date(session.lastActivityAt),
    terminalState,
  })
  await tx.sessionTerminalNotification.upsert({
    where: {
      sessionId_terminalAttentionId: {
        sessionId: session.id,
        terminalAttentionId: session.lastAttentionId,
      },
    },
    create: {
      sessionId: session.id,
      userId,
      terminalBodyRevision: session.bodyRevision,
      terminalAttentionId: session.lastAttentionId,
      terminalAttentionCount: session.attentionCount,
      terminalState,
      ...notification,
      // Give a foreground App time to commit its authoritative read watermark.
      // The Worker checks that watermark again immediately before delivery.
      availableAt: new Date(Date.now() + TASK_COMPLETION_PUSH_SUPPRESSION_MS),
    },
    update: {},
  })
}

function mergeTitle(
  existing: ExistingTitle | undefined,
  incoming: DaemonSessionIndexProjection,
): ExistingTitle {
  const candidate: ExistingTitle = {
    title: incoming.title,
    titleSource: incoming.titleSource,
    titleRevision: incoming.titleRevision,
    titleLockedByUser: incoming.titleLockedByUser,
    titleOriginEventId: incoming.titleOriginEventId,
  }
  if (!existing) return candidate
  // Prisma returns every selected property at runtime. The structural
  // ExistingTitle type does not strip ownership/relation fields, so never
  // return the query object itself and later spread it into update data.
  const current: ExistingTitle = {
    title: existing.title,
    titleSource: existing.titleSource,
    titleRevision: existing.titleRevision,
    titleLockedByUser: existing.titleLockedByUser,
    titleOriginEventId: existing.titleOriginEventId,
  }
  if (!isSessionTitleSource(existing.titleSource)) {
    throw new Error('stored titleSource is invalid')
  }
  const currentSource = existing.titleSource as SessionTitleSource
  const incomingPriority = SESSION_TITLE_SOURCE_PRIORITY[incoming.titleSource]
  const currentPriority = SESSION_TITLE_SOURCE_PRIORITY[currentSource]
  if (incomingPriority < currentPriority || incoming.titleRevision < existing.titleRevision) {
    return current
  }
  if (incoming.titleRevision === existing.titleRevision) {
    const sameTitle = incoming.title === existing.title && incoming.titleSource === currentSource
      && incoming.titleLockedByUser === existing.titleLockedByUser
    if (sameTitle) return current
    // A managed fallback and a later native title can race at revision 1.
    // Authority is the deterministic tie-breaker; equal authority with
    // different content remains a real identity conflict.
    if (incomingPriority > currentPriority) return candidate
    throw new Error('title revision conflict')
  }
  return candidate
}

function assertExistingOwnership(
  existing: { machineId: string; userId: string; daemonInstallationId: string | null; roomBinding: unknown },
  machineId: string,
  ownerId: string,
  daemonInstallationId: string,
): void {
  if (existing.machineId !== machineId || existing.userId !== ownerId || existing.roomBinding) {
    rejectSessionSync(existing.roomBinding ? 'room_authority_conflict' : 'ownership_transferred', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
    })
  }
  if (existing.daemonInstallationId !== daemonInstallationId) {
    rejectSessionSync('invalid_identity', { authoritativeEpoch: SESSION_SYNC_DATA_EPOCH })
  }
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
function parseDate(value: string, field: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid ${field}`)
  return parsed
}
function parseOptionalDate(value: string | null | undefined): Date | null {
  return value == null ? null : parseDate(value, 'optional date')
}
