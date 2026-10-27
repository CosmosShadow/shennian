// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-cloud-history.test.ts
import { randomBytes } from 'node:crypto'
import {
  SESSION_HISTORY_LIMITS, SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION,
  buildUserMessagePayload, parseUserMessagePayload,
  type SessionBodyMutation, type SessionHistorySyncPage, type SessionHistorySyncParams,
} from '@shennian/wire'
import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { sendServerReqToMachine } from '../relay/server-requests.js'

export const cloudPersonalHistoryEnabled = () => process.env.SHENNIAN_CLOUD_PERSONAL_HISTORY_ENABLED === 'true'
const MAX_BYTES = 4 * 1024 * 1024
const eligible = {
  deletedAt: null,
  bodyStorageMode: 'machine_local',
  OR: [
    { sessionScope: 'personal', nativeSessionVisibility: 'user', sessionMode: 'standard', agentIdentityId: null,
      NOT: [{ id: { startsWith: 'sess_worker_' } }, { agentType: 'manager' }] },
    // Steward is intentionally internal in the ordinary project list, but its
    // visible conversation is the mobile home, not a private Worker log.
    { sessionScope: 'steward', sessionMode: 'standard', agentIdentityId: null },
  ],
  conversationRoomId: null,
  roomBinding: { is: null },
  dataEpoch: SESSION_SYNC_DATA_EPOCH,
  daemonInstallationId: { not: null },
} satisfies Prisma.NianSessionWhereInput

export function validateCloudHistoryPage(value: unknown, request: SessionHistorySyncParams): SessionHistorySyncPage {
  const page = value as SessionHistorySyncPage
  const identity = (item: { protocolVersion: number; dataEpoch: number; daemonInstallationId: string }) =>
    item.protocolVersion === SESSION_SYNC_PROTOCOL_VERSION && item.dataEpoch === SESSION_SYNC_DATA_EPOCH
      && item.daemonInstallationId === request.daemonInstallationId
  if (!page || !identity(page) || page.sessionId !== request.sessionId || page.syncId !== request.syncId
    || page.fromRevision !== request.afterRevision || !Number.isSafeInteger(page.toRevision)
    || !Number.isSafeInteger(page.targetRevision) || page.targetRevision < page.toRevision
    || page.toRevision < page.fromRevision || page.hasMore !== (page.toRevision < page.targetRevision)
    || !Array.isArray(page.mutations) || page.mutations.length > SESSION_HISTORY_LIMITS.maxDeltaMutations
    || page.mutations.length !== page.toRevision - page.fromRevision
    || (page.hasMore && page.mutations.length === 0)
    || Buffer.byteLength(JSON.stringify(page), 'utf8') > MAX_BYTES) throw new Error('invalid_cloud_history_page')
  for (const [index, item] of page.mutations.entries()) {
    if (!item || !identity(item) || item.sessionId !== request.sessionId || item.subscriptionId !== request.syncId
      || item.revision !== page.fromRevision + index + 1 || typeof item.messageId !== 'string' || !item.messageId
      || item.messageId.length > 191 || !Number.isSafeInteger(item.sequence) || item.sequence < 1
      || !['append', 'upsert', 'tombstone'].includes(item.mutation)
      || (item.deliveryState !== undefined && !['queued', 'committed', 'executing', 'completed', 'failed', 'cancelled'].includes(item.deliveryState))
      || (item.mutation !== 'tombstone' && (!item.message || item.message.id !== item.messageId
        || item.message.sessionId !== request.sessionId || !['user', 'agent'].includes(item.message.role)
        || !Number.isFinite(item.message.ts) || typeof item.message.payload !== 'string'))) {
      throw new Error('invalid_cloud_history_mutation')
    }
  }
  return page
}

// Preserve only the existing visible replication contract, not private source
// event IDs/hashes/logs that an old daemon may include as additional fields.
function durableMutation(item: SessionBodyMutation): SessionBodyMutation {
  const user = item.message?.role === 'user' ? parseUserMessagePayload(item.message.payload) : null
  const payload = user && typeof user.content === 'string' ? buildUserMessagePayload(user.content, user.attachments?.map(attachment => ({
    path: attachment.path, name: attachment.name, mimeType: attachment.mimeType, kind: attachment.kind,
    ...(attachment.byteSize !== undefined ? { byteSize: attachment.byteSize } : {}),
    ...(attachment.sha256 ? { sha256: attachment.sha256 } : {}),
  }))) : item.message?.payload
  return {
    protocolVersion: item.protocolVersion, dataEpoch: item.dataEpoch,
    daemonInstallationId: item.daemonInstallationId, sessionId: item.sessionId,
    subscriptionId: '', revision: item.revision, mutation: item.mutation,
    messageId: item.messageId, sequence: item.sequence,
    ...(item.mutation !== 'tombstone' && item.message ? { message: {
      id: item.message.id, sessionId: item.message.sessionId, role: item.message.role,
      ts: item.message.ts, payload: payload!,
    } } : {}),
    ...(item.deliveryState ? { deliveryState: item.deliveryState } : {}),
  }
}

/** One bounded page per session; the durable index is also the retry/backfill queue. */
export async function syncPersonalCloudHistoryBatch(now = new Date()): Promise<void> {
  if (!cloudPersonalHistoryEnabled()) return
  const sessions = await prisma.nianSession.findMany({
    where: { ...eligible, cloudBodyNextAttemptAt: { lte: now },
      bodyRevision: { gt: prisma.nianSession.fields.cloudBodyRevision },
      machine: { online: true, paired: true, remoteAccessDisabledAt: null,
        sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION, sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH },
    },
    orderBy: [{ cloudBodyNextAttemptAt: 'asc' }, { id: 'asc' }], take: 8,
    select: { id: true, userId: true, machineId: true, daemonInstallationId: true,
      cloudBodyRevision: true, cloudBodyNextAttemptAt: true,
      machine: { select: { userId: true, daemonInstallationId: true } } },
  })
  await Promise.all(sessions.map(async session => {
    const claim = await prisma.nianSession.updateMany({
      where: { id: session.id, cloudBodyRevision: session.cloudBodyRevision, cloudBodyNextAttemptAt: session.cloudBodyNextAttemptAt },
      data: { cloudBodyNextAttemptAt: new Date(now.getTime() + 60_000) },
    })
    if (!claim.count) return
    // Defer invalid/stale identities too, otherwise eight old rows could keep
    // occupying the first batch and starve every valid conversation behind them.
    if (!session.daemonInstallationId || session.machine.userId !== session.userId
      || session.machine.daemonInstallationId !== session.daemonInstallationId) return
    try {
      const params: SessionHistorySyncParams = {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: session.daemonInstallationId, sessionId: session.id,
        syncId: `cloud_${randomBytes(12).toString('hex')}`, afterRevision: session.cloudBodyRevision,
        limit: SESSION_HISTORY_LIMITS.maxDeltaMutations,
      }
      const response = await sendServerReqToMachine(session.machineId, { type: 'req', method: 'session.history.sync', params }, 30_000)
      if (!response.ok) throw new Error('cloud_source_unavailable')
      const page = validateCloudHistoryPage(response.payload, params)
      if (page.toRevision === page.fromRevision) throw new Error('cloud_source_behind')
      await prisma.$transaction(async tx => {
        // CAS both cursor and authorization after the network wait. Deletion,
        // transfer, pause and a competing Worker cannot resurrect old data.
        const advanced = await tx.nianSession.updateMany({
          where: { ...eligible, id: session.id, userId: session.userId, machineId: session.machineId,
            daemonInstallationId: params.daemonInstallationId, cloudBodyRevision: page.fromRevision,
            machine: { userId: session.userId, paired: true, remoteAccessDisabledAt: null,
              daemonInstallationId: params.daemonInstallationId } },
          data: { cloudBodyRevision: page.toRevision, cloudBodyNextAttemptAt: now },
        })
        if (!advanced.count) return
        await tx.personalSessionCloudMutation.createMany({ data: page.mutations.map(item => ({
          sessionId: session.id, revision: item.revision, dataEpoch: params.dataEpoch,
          daemonInstallationId: params.daemonInstallationId,
          payload: durableMutation(item) as unknown as Prisma.InputJsonValue,
        })) })
      })
    } catch {
      console.warn('[personal-cloud-history] source page not committed', { sessionId: session.id })
      // Claim expiry is a durable retry deadline. Never log message payloads;
      // a failed/partial transaction cannot advance the cloud cursor.
    }
  }))
}

export async function readPersonalCloudHistory(userId: string, params: SessionHistorySyncParams): Promise<SessionHistorySyncPage> {
  if (!cloudPersonalHistoryEnabled()) throw new Error('cloud_history_disabled')
  return prisma.$transaction(async tx => {
    const session = await tx.nianSession.findFirst({
      where: { ...eligible, id: params.sessionId, userId, daemonInstallationId: params.daemonInstallationId,
        machine: { userId, paired: true, remoteAccessDisabledAt: null, daemonInstallationId: params.daemonInstallationId } },
      select: { cloudBodyRevision: true, bodyRevision: true },
    })
    if (!session) throw new Error('cloud_history_not_found')
    const targetRevision = session.cloudBodyRevision
    if (params.afterRevision > targetRevision) throw new Error('cloud_history_behind')
    if (params.afterRevision === targetRevision && targetRevision < session.bodyRevision) throw new Error('cloud_history_pending')
    const rows = await tx.personalSessionCloudMutation.findMany({
      where: { sessionId: params.sessionId, dataEpoch: params.dataEpoch,
        daemonInstallationId: params.daemonInstallationId, revision: { gt: params.afterRevision, lte: targetRevision } },
      orderBy: { revision: 'asc' }, take: Math.min(params.limit ?? 200, SESSION_HISTORY_LIMITS.maxDeltaMutations),
    })
    const mutations: SessionBodyMutation[] = []
    let bytes = 0
    for (const row of rows) {
      const item = { ...(row.payload as unknown as SessionBodyMutation), subscriptionId: params.syncId }
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8')
      if (mutations.length && bytes + size > MAX_BYTES - 2048) break
      if (size > MAX_BYTES - 2048) throw new Error('cloud_history_too_large')
      bytes += size
      mutations.push(item)
    }
    const page = { protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: params.daemonInstallationId, sessionId: params.sessionId, syncId: params.syncId,
      fromRevision: params.afterRevision, toRevision: mutations.at(-1)?.revision ?? params.afterRevision,
      targetRevision, hasMore: false, mutations }
    page.hasMore = page.toRevision < targetRevision
    return validateCloudHistoryPage(page, params)
  })
}
