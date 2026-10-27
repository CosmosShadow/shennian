// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-store.test.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_TITLE_SOURCE_PRIORITY,
  isInternalSession,
  isToolPayload,
  parseStewardSayPayload,
  sessionPreviewFromPayload,
  STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX,
  type AgentType,
  type CodexConversationSettings,
  type Envelope,
  type ManagerConfig,
  type SessionDeliveryState,
  type SessionIndexUpdate,
  type SessionMessageStatusResponse,
  type SessionMode,
  type SessionScope,
  type SessionTitleGenerateResponse,
  type SessionTitleGenerationEligibility,
  type SessionTitleSource,
} from '@shennian/wire'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { registerInternalNativeSource } from '../native-fusion/source-visibility.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { PERSONAL_SYNC_V1_ROOT_NAME, resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import { CanonicalSessionStore } from './canonical-store.js'

export { PERSONAL_SYNC_V1_ROOT_NAME }

const SESSION_TITLE_MAX_LENGTH = 120

function normalizeSessionTitle(title: string): string {
  if (title.length <= SESSION_TITLE_MAX_LENGTH) return title
  let normalized = title.slice(0, SESSION_TITLE_MAX_LENGTH)
  const last = normalized.charCodeAt(normalized.length - 1)
  if (last >= 0xD800 && last <= 0xDBFF) normalized = normalized.slice(0, -1)
  return normalized
}

export type LocalSessionRecord = {
  daemonInstallationId: string
  sessionId: string
  agentType: AgentType
  sessionMode?: SessionMode
  nativeSessionVisibility?: 'user' | 'internal'
  /** Sticky: a session is steward from creation or never. Missing means personal. */
  sessionScope?: SessionScope
  codexSettings?: CodexConversationSettings
  managerConfig?: ManagerConfig | null
  workDir: string
  agentSessionId?: string | null
  modelId?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  status?: 'active' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastMessagePreview?: string | null
  lastMessagePreviewMessageId: string | null
  lastMessagePreviewAt: string | null
  lastVisibleEventAt?: string | null
  localReady: boolean
  firstUserMessageId: string | null
  firstUserBodyRevision: number | null
  bodyRevision: number
  indexRevision: number
  title: string
  titleSource: SessionTitleSource
  titleRevision: number
  titleLockedByUser: boolean
  titleOriginEventId: string | null
  firstAvailableSeq: number | null
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  attentionCount: number
  lastAttentionId: string | null
  /** Local-only replay ledger. This field is never included in SessionIndexUpdate. */
  seenAttentionIds?: string[]
  lastBodyCommittedAt: string | null
  deletionRevision: number
  deletedAt: string | null
  syncedIndexRevision: number
  indexSyncState?: 'pending' | 'applied' | 'quarantined' | 'terminal'
  indexSyncStateRevision?: number
  indexSyncAttempts?: number
  indexSyncNextAttemptAt?: string | null
  indexSyncErrorCode?: string | null
  indexQuarantineCode?: string | null
  /** Local attempt marker only. The ephemeral titleSeed is never stored. */
  titleGenerationAttemptedAt: string | null
  /** Local retry schedule for a request that did not produce a title. */
  titleGenerationNextAttemptAt?: string | null
  titleGenerationAttempts?: number
}

let defaultStore: CanonicalSessionStore | null = null
let defaultStoreRoot: string | null = null

function personalSyncRoot(): string {
  return resolvePersonalSyncV1Path()
}

function getStore(): CanonicalSessionStore {
  const root = path.join(personalSyncRoot(), 'canonical')
  if (!defaultStore || defaultStoreRoot !== root) {
    defaultStore = new CanonicalSessionStore(root, getDaemonInstallationId())
    defaultStoreRoot = root
  }
  return defaultStore
}

function sessionIndexFile(): string {
  return path.join(personalSyncRoot(), 'session-index.json')
}

function readSessionIndex(): Record<string, LocalSessionRecord> {
  const file = sessionIndexFile()
  if (!fs.existsSync(file)) return {}
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, LocalSessionRecord>
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid personal session index: ${file}`)
  }
  const daemonInstallationId = getDaemonInstallationId()
  for (const record of Object.values(parsed)) {
    if (record.daemonInstallationId !== daemonInstallationId) {
      throw new Error(`personal session index belongs to another daemon installation: ${file}`)
    }
  }
  return parsed
}

function writeSessionIndex(index: Record<string, LocalSessionRecord>): void {
  atomicWriteJson(sessionIndexFile(), index)
}

function previewFromEnvelope(envelope: Envelope): string | null {
  return sessionPreviewFromPayload(envelope.payload, 120)
}

export { getDaemonInstallationId }

function assertSessionWritable(sessionId: string): void {
  if (new NativeSourceDeletionStore({
    rootDir: personalSyncRoot(),
    daemonInstallationId: getDaemonInstallationId(),
  }).hasSession(sessionId)) throw new Error(`session_deleted:${sessionId}`)
}

export function recordSession(input: {
  sessionId: string
  agentType: AgentType
  sessionMode?: SessionMode
  nativeSessionVisibility?: 'user' | 'internal'
  /** Honored only when the session does not exist yet; never changes an existing session. */
  sessionScope?: SessionScope
  codexSettings?: CodexConversationSettings
  managerConfig?: ManagerConfig | null
  workDir: string
  agentSessionId?: string | null
  modelId?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  status?: 'active' | 'completed' | 'failed'
  lastActivityAt?: string
  lastMessagePreview?: string | null
  lastMessagePreviewMessageId?: string | null
  lastMessagePreviewAt?: string | null
  lastVisibleEventAt?: string | null
  localReady?: boolean
  firstUserMessageId?: string | null
  firstUserBodyRevision?: number | null
  title?: string
  titleSource?: SessionTitleSource
  titleRevision?: number
  titleLockedByUser?: boolean
  titleOriginEventId?: string | null
  /** Stable terminal/approval identity; a repeated identity is idempotent. */
  attentionId?: string | null
  deletedAt?: string | null
}): LocalSessionRecord {
  assertSessionWritable(input.sessionId)
  getDaemonInstallationId()
  const index = readSessionIndex()
  const existing = index[input.sessionId]
  const now = new Date().toISOString()
  const bodyRevision = getStore().getManifest(input.sessionId)?.bodyRevision ?? existing?.bodyRevision ?? 0
  const manifest = getStore().getManifest(input.sessionId)
  const titleState = resolveTitleState(existing, input)
  const nextAttentionId = input.attentionId?.trim() || null
  const seenAttentionIds = Array.from(new Set([
    ...(existing?.seenAttentionIds ?? []),
    ...(existing?.lastAttentionId ? [existing.lastAttentionId] : []),
  ]))
  const advancesAttention = Boolean(
    nextAttentionId && !seenAttentionIds.includes(nextAttentionId),
  )
  const previewTuple = input.lastMessagePreview === null
    ? { preview: null, messageId: null, at: null }
    : input.lastMessagePreview !== undefined
      && input.lastMessagePreviewMessageId
      && input.lastMessagePreviewAt
      ? {
          preview: input.lastMessagePreview,
          messageId: input.lastMessagePreviewMessageId,
          at: input.lastMessagePreviewAt,
        }
      : {
          preview: existing?.lastMessagePreview ?? null,
          messageId: existing?.lastMessagePreviewMessageId ?? null,
          at: existing?.lastMessagePreviewAt ?? null,
        }
  const incomingVisibleAtMs = Date.parse(input.lastVisibleEventAt ?? '')
  const existingVisibleAtMs = Date.parse(existing?.lastVisibleEventAt ?? '')
  const lastVisibleEventAt = Number.isFinite(incomingVisibleAtMs) && (
    !Number.isFinite(existingVisibleAtMs) || incomingVisibleAtMs >= existingVisibleAtMs
  )
    ? input.lastVisibleEventAt!
    : existing?.lastVisibleEventAt ?? null
  const sessionScope: SessionScope = existing
    ? (existing.sessionScope === 'steward' ? 'steward' : 'personal')
    : (input.sessionScope === 'steward' ? 'steward' : 'personal')
  const record: LocalSessionRecord = {
    daemonInstallationId: getDaemonInstallationId(),
    sessionId: input.sessionId,
    agentType: input.agentType,
    sessionMode: input.sessionMode ?? existing?.sessionMode,
    sessionScope,
    nativeSessionVisibility: isInternalSession({ ...existing, id: input.sessionId }) || isInternalSession({
      ...existing, ...input, id: input.sessionId, sessionMode: input.sessionMode ?? existing?.sessionMode,
      sessionScope,
    }) ? 'internal' : 'user',
    codexSettings: input.codexSettings ?? existing?.codexSettings,
    managerConfig: input.managerConfig ?? existing?.managerConfig ?? null,
    workDir: input.workDir,
    agentSessionId: input.agentSessionId ?? existing?.agentSessionId ?? null,
    modelId: input.modelId ?? existing?.modelId ?? null,
    managerDefaultWorkerAgentType: input.managerDefaultWorkerAgentType ?? existing?.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: input.managerDefaultWorkerModelId ?? existing?.managerDefaultWorkerModelId ?? null,
    status: input.status ?? existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastActivityAt: input.lastActivityAt ?? existing?.lastActivityAt ?? now,
    lastMessagePreview: previewTuple.preview,
    lastMessagePreviewMessageId: previewTuple.messageId,
    lastMessagePreviewAt: previewTuple.at,
    lastVisibleEventAt,
    localReady: existing?.localReady === true || input.localReady === true,
    firstUserMessageId: existing?.firstUserMessageId ?? input.firstUserMessageId ?? null,
    firstUserBodyRevision:
      existing?.firstUserBodyRevision ?? input.firstUserBodyRevision ?? null,
    bodyRevision,
    indexRevision: (existing?.indexRevision ?? 0) + 1,
    ...titleState,
    firstAvailableSeq: manifest?.firstAvailableSeq ?? existing?.firstAvailableSeq ?? null,
    visibleMessageCount: manifest?.visibleMessageCount ?? existing?.visibleMessageCount ?? 0,
    lastVisibleMessageId: manifest?.lastVisibleMessageId ?? existing?.lastVisibleMessageId ?? null,
    attentionCount: (existing?.attentionCount ?? 0) + (advancesAttention ? 1 : 0),
    lastAttentionId: advancesAttention
      ? nextAttentionId
      : (existing?.lastAttentionId ?? null),
    seenAttentionIds: advancesAttention && nextAttentionId
      ? [...seenAttentionIds, nextAttentionId]
      : seenAttentionIds,
    lastBodyCommittedAt: manifest?.lastBodyCommittedAt ?? existing?.lastBodyCommittedAt ?? null,
    deletionRevision: existing?.deletionRevision ?? 0,
    deletedAt: input.deletedAt ?? existing?.deletedAt ?? null,
    syncedIndexRevision: existing?.syncedIndexRevision ?? 0,
    indexSyncState: 'pending',
    indexSyncStateRevision: (existing?.indexRevision ?? 0) + 1,
    indexSyncAttempts: 0,
    indexSyncNextAttemptAt: null,
    indexSyncErrorCode: null,
    // Quarantine is scoped to the rejected immutable revision. A later local
    // mutation produces a new projection and must be validated independently.
    indexQuarantineCode: null,
    // Older daemons treated every request as a permanent one-shot. Release
    // that legacy marker when the record next mutates so affected sessions can
    // enter the retryable protocol.
    titleGenerationAttemptedAt: existing?.titleGenerationAttemptedAt
      && existing.titleGenerationNextAttemptAt !== undefined
      ? existing.titleGenerationAttemptedAt
      : null,
    titleGenerationNextAttemptAt: existing?.titleGenerationNextAttemptAt ?? null,
    titleGenerationAttempts: existing?.titleGenerationAttempts ?? 0,
  }
  if (record.nativeSessionVisibility === 'internal' && record.agentSessionId) {
    registerInternalNativeSource(record.sessionId, record.agentType, record.agentSessionId)
  }
  index[input.sessionId] = record
  writeSessionIndex(index)
  return record
}

export function listSessionRecords(): LocalSessionRecord[] {
  return Object.values(readSessionIndex())
}

export function purgeSessionRecord(sessionId: string): void {
  if (!sessionId) throw new Error('sessionId is required')
  const index = readSessionIndex()
  if (!index[sessionId]) return
  delete index[sessionId]
  writeSessionIndex(index)
}

export function purgeCanonicalSession(sessionId: string): void {
  getStore().purgeSession(sessionId)
}

function migrateLegacyOversizedTitles(): void {
  const index = readSessionIndex()
  let changed = false
  const now = new Date().toISOString()
  for (const [sessionId, record] of Object.entries(index)) {
    const title = normalizeSessionTitle(record.title)
    if (title === record.title) continue
    const indexRevision = record.indexRevision + 1
    index[sessionId] = {
      ...record,
      title,
      indexRevision,
      indexSyncState: 'pending',
      indexSyncStateRevision: indexRevision,
      indexSyncAttempts: 0,
      indexSyncNextAttemptAt: null,
      indexSyncErrorCode: null,
      indexQuarantineCode: null,
      updatedAt: now,
    }
    changed = true
  }
  if (changed) writeSessionIndex(index)
}

export function listPendingSessionIndexUpdates(): SessionIndexUpdate[] {
  const daemonInstallationId = getDaemonInstallationId()
  migrateLegacyPreviewTuples()
  migrateLegacyVisibleEventAt()
  migrateLegacyOversizedTitles()
  return listSessionRecords()
    .filter((record) => {
      const stateApplies = record.indexSyncStateRevision === record.indexRevision
      if (record.indexQuarantineCode) return false
      if (stateApplies && (record.indexSyncState === 'quarantined' || record.indexSyncState === 'terminal')) {
        return false
      }
      if (stateApplies && record.indexSyncNextAttemptAt
        && Date.parse(record.indexSyncNextAttemptAt) > Date.now()) return false
      return record.indexRevision > record.syncedIndexRevision
      && record.localReady
      && Boolean(record.firstUserMessageId)
      && record.firstUserBodyRevision != null
    })
    .sort((left, right) => left.indexRevision - right.indexRevision)
    .map((record) => {
      const hasPreviewTuple = Boolean(
        record.lastMessagePreview &&
        record.lastMessagePreviewMessageId &&
        record.lastMessagePreviewAt,
      )
      return {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId,
        session: {
          id: record.sessionId,
          agentType: record.agentType,
          sessionMode: record.sessionMode,
          nativeSessionVisibility: record.nativeSessionVisibility,
          ...(record.sessionScope === 'steward' ? { sessionScope: 'steward' as const } : {}),
          managerConfig: record.managerConfig,
          agentSessionId: record.agentSessionId ?? null,
          modelId: record.modelId ?? null,
          managerDefaultWorkerAgentType: record.managerDefaultWorkerAgentType ?? null,
          managerDefaultWorkerModelId: record.managerDefaultWorkerModelId ?? null,
          title: record.title,
          titleSource: record.titleSource,
          titleRevision: record.titleRevision,
          titleLockedByUser: record.titleLockedByUser,
          titleOriginEventId: record.titleOriginEventId,
          status: record.status ?? 'active',
          workDir: record.workDir,
          lastMessagePreview: hasPreviewTuple ? record.lastMessagePreview! : null,
          lastMessagePreviewMessageId: hasPreviewTuple ? record.lastMessagePreviewMessageId : null,
          lastMessagePreviewAt: hasPreviewTuple ? record.lastMessagePreviewAt : null,
          lastVisibleEventAt: record.lastVisibleEventAt ?? record.lastMessagePreviewAt ?? null,
          bodyStorageMode: 'machine_local',
          localReady: true,
          firstUserBoundary: {
            role: 'user',
            messageId: record.firstUserMessageId!,
            bodyRevision: record.firstUserBodyRevision!,
          },
          bodyRevision: record.bodyRevision,
          indexRevision: record.indexRevision,
          firstAvailableSeq: record.firstAvailableSeq,
          visibleMessageCount: record.visibleMessageCount,
          lastVisibleMessageId: record.lastVisibleMessageId,
          attentionCount: record.attentionCount ?? 0,
          lastAttentionId: record.lastAttentionId ?? null,
          lastBodyCommittedAt: record.lastBodyCommittedAt,
          deletionRevision: record.deletionRevision,
          lastActivityAt: record.lastActivityAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          deletedAt: record.deletedAt,
        },
      }
    })
}

export function acknowledgeSessionIndexUpdate(sessionId: string, indexRevision: number): void {
  const index = readSessionIndex()
  const existing = index[sessionId]
  if (!existing || indexRevision <= existing.syncedIndexRevision) return
  if (indexRevision > existing.indexRevision) {
    throw new Error(`cannot acknowledge future index revision ${indexRevision} for ${sessionId}`)
  }
  index[sessionId] = {
    ...existing,
    syncedIndexRevision: indexRevision,
    indexSyncState: 'applied',
    indexSyncStateRevision: indexRevision,
    indexSyncAttempts: 0,
    indexSyncNextAttemptAt: null,
    indexSyncErrorCode: null,
  }
  writeSessionIndex(index)
}

export function markAllSessionIndexesForRepublish(): number {
  const index = readSessionIndex()
  let changed = 0
  const now = new Date().toISOString()
  for (const [sessionId, record] of Object.entries(index)) {
    if (record.deletedAt || record.indexQuarantineCode || !record.localReady) continue
    const indexRevision = record.indexRevision + 1
    index[sessionId] = {
      ...record,
      indexRevision,
      indexSyncState: 'pending',
      indexSyncStateRevision: indexRevision,
      indexSyncAttempts: 0,
      indexSyncNextAttemptAt: null,
      indexSyncErrorCode: null,
      updatedAt: now,
    }
    changed += 1
  }
  if (changed > 0) writeSessionIndex(index)
  return changed
}

export function recordSessionIndexRejection(input: {
  sessionId: string
  indexRevision: number
  code: string
  disposition: 'retry' | 'quarantined' | 'terminal'
  now?: number
  maxAttempts?: number
}): 'retry' | 'quarantined' | 'terminal' {
  const index = readSessionIndex()
  const existing = index[input.sessionId]
  if (!existing || existing.indexRevision !== input.indexRevision) return 'terminal'
  const priorAttempts = existing.indexSyncStateRevision === input.indexRevision
    ? existing.indexSyncAttempts ?? 0
    : 0
  const attempts = priorAttempts + 1
  let disposition = input.disposition
  if (disposition === 'retry' && attempts >= (input.maxAttempts ?? 8)) disposition = 'terminal'
  const now = input.now ?? Date.now()
  const retryDelay = Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1_000)
  const jitter = Math.round(retryDelay * 0.2 * (Math.random() * 2 - 1))
  index[input.sessionId] = {
    ...existing,
    indexSyncState: disposition === 'retry' ? 'pending' : disposition,
    indexSyncStateRevision: input.indexRevision,
    indexSyncAttempts: attempts,
    indexSyncNextAttemptAt: disposition === 'retry'
      ? new Date(now + retryDelay + jitter).toISOString()
      : null,
    indexSyncErrorCode: input.code,
    indexQuarantineCode: disposition === 'quarantined'
      ? input.code
      : existing.indexQuarantineCode ?? null,
  }
  writeSessionIndex(index)
  return disposition
}

export type SessionTitleGenerationCandidate = {
  sessionId: string
  requestId: string
  titleSeed: string
  baseTitleRevision: number
  eligibility: SessionTitleGenerationEligibility
}

const TITLE_GENERATION_GRACE_MS = 2 * 60_000

/**
 * Claims each fallback at most once. Only the durable attempt timestamp is
 * written; the bounded seed returned to the caller never enters local JSON.
 */
export function claimSessionTitleGenerationCandidates(
  nowMs = Date.now(),
  graceMs = TITLE_GENERATION_GRACE_MS,
): SessionTitleGenerationCandidate[] {
  const index = readSessionIndex()
  const claimed: SessionTitleGenerationCandidate[] = []
  const attemptedAt = new Date(nowMs).toISOString()
  for (const record of Object.values(index)) {
    if (record.titleSource !== 'first_user_fallback' || record.titleLockedByUser
      || record.titleGenerationAttemptedAt || !record.title.trim()
      || record.syncedIndexRevision < record.indexRevision
      || (record.titleGenerationNextAttemptAt
        && Date.parse(record.titleGenerationNextAttemptAt) > nowMs)) continue

    const terminal = record.status === 'completed' || record.status === 'failed'
    const enoughVisibleContext = record.visibleMessageCount >= 2
    let eligibility: SessionTitleGenerationEligibility | null = null
    if (record.agentType === 'claude' && enoughVisibleContext) {
      eligibility = 'agent_native_unavailable'
    } else if (terminal) {
      eligibility = 'terminal'
    } else if (enoughVisibleContext && nowMs - Date.parse(record.createdAt) >= graceMs) {
      eligibility = 'grace_elapsed'
    }
    if (!eligibility) continue

    const titleSeed = sessionPreviewFromPayload(record.title, 240)
    if (!titleSeed) continue
    const requestId = crypto.randomUUID()
    index[record.sessionId] = {
      ...record,
      titleGenerationAttemptedAt: attemptedAt,
      titleGenerationNextAttemptAt: null,
      titleGenerationAttempts: (record.titleGenerationAttempts ?? 0) + 1,
    }
    claimed.push({
      sessionId: record.sessionId,
      requestId,
      titleSeed,
      baseTitleRevision: record.titleRevision,
      eligibility,
    })
  }
  if (claimed.length > 0) writeSessionIndex(index)
  return claimed
}

export function deferSessionTitleGeneration(
  sessionId: string,
  nowMs = Date.now(),
): string | null {
  const index = readSessionIndex()
  const existing = index[sessionId]
  if (!existing?.titleGenerationAttemptedAt || existing.titleSource !== 'first_user_fallback') {
    return null
  }
  const attempts = Math.max(1, existing.titleGenerationAttempts ?? 1)
  const delayMs = Math.min(10 * 60_000, 30_000 * (2 ** Math.min(attempts - 1, 5)))
  const nextAttemptAt = new Date(nowMs + delayMs).toISOString()
  index[sessionId] = {
    ...existing,
    titleGenerationAttemptedAt: null,
    titleGenerationNextAttemptAt: nextAttemptAt,
  }
  writeSessionIndex(index)
  return nextAttemptAt
}

export function applyGeneratedSessionTitle(
  sessionId: string,
  result: Extract<SessionTitleGenerateResponse, { generated: true }>,
): boolean {
  const index = readSessionIndex()
  const existing = index[sessionId]
  if (!existing || existing.titleLockedByUser
    || SESSION_TITLE_SOURCE_PRIORITY[existing.titleSource]
      >= SESSION_TITLE_SOURCE_PRIORITY.shennian_generated
    || result.titleRevision <= existing.titleRevision) return false
  recordSession({
    sessionId,
    agentType: existing.agentType,
    sessionMode: existing.sessionMode,
    managerConfig: existing.managerConfig,
    workDir: existing.workDir,
    agentSessionId: existing.agentSessionId,
    modelId: existing.modelId,
    status: existing.status,
    title: result.title,
    titleSource: 'shennian_generated',
    titleRevision: result.titleRevision,
    titleLockedByUser: false,
    titleOriginEventId: result.titleOriginEventId,
  })
  return true
}

export function appendMessage(
  sessionId: string,
  envelope: Envelope,
  deliveryState?: SessionDeliveryState,
): number {
  assertSessionWritable(sessionId)
  getDaemonInstallationId()
  const result = getStore().append(sessionId, envelope, deliveryState)
  updateIndexAfterCommit(sessionId, envelope, result.bodyRevision)
  return result.bodyRevision
}

export function upsertMessage(
  sessionId: string,
  envelope: Envelope,
  deliveryState?: SessionDeliveryState,
): number {
  assertSessionWritable(sessionId)
  getDaemonInstallationId()
  const result = getStore().upsert(sessionId, envelope, deliveryState)
  updateIndexAfterCommit(sessionId, envelope, result.bodyRevision)
  return result.bodyRevision
}

export function getMessageDeliveryStatus(
  sessionId: string,
  clientMessageId: string,
): SessionMessageStatusResponse {
  const state = getStore().getMessageState(sessionId, clientMessageId)
  if (!state || state.tombstoned || !state.message || !state.deliveryState) {
    return {
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId: getDaemonInstallationId(),
      state: 'not_found', sessionId, clientMessageId,
    }
  }
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId: getDaemonInstallationId(),
    state: state.deliveryState,
    sessionId,
    clientMessageId,
    messageId: state.message.id,
    deliveryState: state.deliveryState,
    bodyRevision: state.lastRevision,
    committedAt: new Date(state.message.ts).toISOString(),
  } as SessionMessageStatusResponse
}

export function tombstoneMessage(sessionId: string, messageId: string): number {
  assertSessionWritable(sessionId)
  getDaemonInstallationId()
  const result = getStore().tombstone(sessionId, messageId)
  const index = readSessionIndex()
  const existing = index[sessionId]
  if (existing) {
    const previewTuple = messageId === existing.lastMessagePreviewMessageId
      ? latestPreviewTuple(sessionId)
      : {
          preview: existing.lastMessagePreview ?? null,
          messageId: existing.lastMessagePreviewMessageId ?? null,
          at: existing.lastMessagePreviewAt ?? null,
        }
    index[sessionId] = {
      ...existing,
      bodyRevision: result.bodyRevision,
      indexRevision: existing.indexRevision + 1,
      indexSyncState: 'pending',
      indexSyncStateRevision: existing.indexRevision + 1,
      indexSyncAttempts: 0,
      indexSyncNextAttemptAt: null,
      indexSyncErrorCode: null,
      updatedAt: new Date().toISOString(),
      lastMessagePreview: previewTuple.preview,
      lastMessagePreviewMessageId: previewTuple.messageId,
      lastMessagePreviewAt: previewTuple.at,
      lastVisibleEventAt: latestVisibleEventAt(sessionId),
    }
    writeSessionIndex(index)
  }
  return result.bodyRevision
}

function updateIndexAfterCommit(sessionId: string, envelope: Envelope, bodyRevision: number): void {
  const index = readSessionIndex()
  const existing = index[sessionId]
  if (!existing) return
  // The steward conversation shows only the user's messages and `steward_say`; the
  // Agent's own text must never leak into the list preview.
  const hiddenStewardOutput = existing.sessionScope === 'steward'
    && envelope.role === 'agent'
    && !parseStewardSayPayload(envelope.payload)
  // The one opening line the daemon writes to satisfy the server's "needs a user
  // turn" rule is bookkeeping, not something the user said — it must not surface
  // as the terminal conversation's list preview either.
  const hiddenTerminalOpen = envelope.id.startsWith(STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX)
  const rawPreview = previewFromEnvelope(envelope)
  const preview = hiddenStewardOutput || hiddenTerminalOpen ? null : rawPreview
  // Hidden from the list preview, but its fixed text still names the conversation.
  const titleText = hiddenTerminalOpen ? rawPreview : preview
  const previewTuple = preview
    ? {
        lastMessagePreview: preview,
        lastMessagePreviewMessageId: envelope.id,
        lastMessagePreviewAt: new Date(envelope.ts).toISOString(),
      }
    : null
  const visibleEventAt = preview || isToolPayload(envelope.payload)
    ? new Date(envelope.ts).toISOString()
    : existing.lastVisibleEventAt
  const manifest = getStore().getManifest(sessionId)
  const firstUserFallback = envelope.role === 'user' && titleText && !existing.title
    ? {
        title: normalizeSessionTitle(titleText),
        titleSource: 'first_user_fallback' as const,
        titleRevision: existing.titleRevision + 1,
        titleLockedByUser: false,
        titleOriginEventId: envelope.id,
      }
    : null
  const firstUserBoundary = envelope.role === 'user' && !existing.localReady
    ? {
        localReady: true,
        firstUserMessageId: envelope.id,
        firstUserBodyRevision: bodyRevision,
      }
    : null
  index[sessionId] = {
    ...existing,
    ...(firstUserFallback ?? {}),
    ...(firstUserBoundary ?? {}),
    bodyRevision,
    indexRevision: existing.indexRevision + 1,
    indexSyncState: 'pending',
    indexSyncStateRevision: existing.indexRevision + 1,
    indexSyncAttempts: 0,
    indexSyncNextAttemptAt: null,
    indexSyncErrorCode: null,
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date(envelope.ts).toISOString(),
    lastVisibleEventAt: visibleEventAt,
    ...(previewTuple ?? {}),
    firstAvailableSeq: manifest?.firstAvailableSeq ?? existing.firstAvailableSeq,
    visibleMessageCount: manifest?.visibleMessageCount ?? existing.visibleMessageCount,
    lastVisibleMessageId: manifest?.lastVisibleMessageId ?? existing.lastVisibleMessageId,
    attentionCount: existing.attentionCount ?? 0,
    lastAttentionId: existing.lastAttentionId ?? null,
    lastBodyCommittedAt: manifest?.lastBodyCommittedAt ?? existing.lastBodyCommittedAt,
  }
  writeSessionIndex(index)
}

function latestPreviewTuple(sessionId: string): {
  preview: string | null
  messageId: string | null
  at: string | null
} {
  let beforeSequence: number | undefined
  do {
    const page = getStore().readPage(sessionId, { limit: 500, beforeSequence })
    for (let index = page.entries.length - 1; index >= 0; index -= 1) {
      const entry = page.entries[index]
      if (entry.message.id.startsWith(STEWARD_TERMINAL_OPEN_MESSAGE_ID_PREFIX)) continue
      const preview = previewFromEnvelope(entry.message)
      if (!preview) continue
      return {
        preview,
        messageId: entry.message.id,
        at: new Date(entry.message.ts).toISOString(),
      }
    }
    if (!page.hasOlder || page.entries.length === 0) break
    beforeSequence = page.entries[0]!.sequence
  } while (beforeSequence !== undefined)
  return { preview: null, messageId: null, at: null }
}

function latestVisibleEventAt(sessionId: string): string | null {
  let beforeSequence: number | undefined
  do {
    const page = getStore().readPage(sessionId, { limit: 500, beforeSequence })
    for (let index = page.entries.length - 1; index >= 0; index -= 1) {
      const message = page.entries[index].message
      if (!previewFromEnvelope(message) && !isToolPayload(message.payload)) continue
      return new Date(message.ts).toISOString()
    }
    if (!page.hasOlder || page.entries.length === 0) break
    beforeSequence = page.entries[0]!.sequence
  } while (beforeSequence !== undefined)
  return null
}

function migrateLegacyVisibleEventAt(): void {
  const index = readSessionIndex()
  let changed = false
  const now = new Date().toISOString()
  for (const [sessionId, record] of Object.entries(index)) {
    if (Object.prototype.hasOwnProperty.call(record, 'lastVisibleEventAt')) continue
    const indexRevision = record.indexRevision + 1
    index[sessionId] = {
      ...record,
      lastVisibleEventAt: latestVisibleEventAt(sessionId) ?? record.lastMessagePreviewAt ?? null,
      indexRevision,
      indexSyncState: 'pending',
      indexSyncStateRevision: indexRevision,
      indexSyncAttempts: 0,
      indexSyncNextAttemptAt: null,
      indexSyncErrorCode: null,
      updatedAt: now,
    }
    changed = true
  }
  if (changed) writeSessionIndex(index)
}

function migrateLegacyPreviewTuples(): void {
  const index = readSessionIndex()
  let changed = false
  const now = new Date().toISOString()
  for (const [sessionId, record] of Object.entries(index)) {
    if (
      Object.prototype.hasOwnProperty.call(record, 'lastMessagePreviewMessageId') &&
      Object.prototype.hasOwnProperty.call(record, 'lastMessagePreviewAt')
    ) continue
    const tuple = latestPreviewTuple(sessionId)
    index[sessionId] = {
      ...record,
      lastMessagePreview: tuple.preview,
      lastMessagePreviewMessageId: tuple.messageId,
      lastMessagePreviewAt: tuple.at,
      indexRevision: record.indexRevision + 1,
      indexSyncState: 'pending',
      indexSyncStateRevision: record.indexRevision + 1,
      indexSyncAttempts: 0,
      indexSyncNextAttemptAt: null,
      indexSyncErrorCode: null,
      updatedAt: now,
    }
    changed = true
  }
  if (changed) writeSessionIndex(index)
}

function resolveTitleState(
  existing: LocalSessionRecord | undefined,
  input: {
    title?: string
    titleSource?: SessionTitleSource
    titleRevision?: number
    titleLockedByUser?: boolean
    titleOriginEventId?: string | null
  },
): Pick<
  LocalSessionRecord,
  'title' | 'titleSource' | 'titleRevision' | 'titleLockedByUser' | 'titleOriginEventId'
> {
  const current = {
    title: existing?.title ?? '',
    titleSource: existing?.titleSource ?? 'first_user_fallback' as SessionTitleSource,
    titleRevision: existing?.titleRevision ?? 0,
    titleLockedByUser: existing?.titleLockedByUser ?? false,
    titleOriginEventId: existing?.titleOriginEventId ?? null,
  }
  const title = normalizeSessionTitle(input.title?.trim() ?? '')
  if (!title) return current
  if (!input.titleSource) throw new Error('titleSource is required with title')
  if (current.title && current.titleSource === 'first_user_fallback'
    && input.titleSource === 'first_user_fallback') return current
  const locked = input.titleSource === 'shennian_manual'
  if (input.titleLockedByUser !== undefined && input.titleLockedByUser !== locked) {
    throw new Error('titleLockedByUser conflicts with titleSource')
  }
  const sameTitle = title === current.title && input.titleSource === current.titleSource
  const revision = input.titleRevision ?? current.titleRevision + (sameTitle ? 0 : 1)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid titleRevision')
  const incomingPriority = SESSION_TITLE_SOURCE_PRIORITY[input.titleSource]
  const currentPriority = SESSION_TITLE_SOURCE_PRIORITY[current.titleSource]
  if (incomingPriority < currentPriority || revision < current.titleRevision) return current
  // Native parsers can observe the same title on every subsequent source
  // event. Those observations do not create a new title identity: retaining
  // the first origin keeps an unchanged title projection byte-for-byte
  // idempotent instead of manufacturing a same-revision conflict upstream.
  if (sameTitle && revision === current.titleRevision) return current
  if (revision === current.titleRevision && !sameTitle) return current
  return {
    title,
    titleSource: input.titleSource,
    titleRevision: revision,
    titleLockedByUser: locked,
    titleOriginEventId: input.titleOriginEventId ?? current.titleOriginEventId,
  }
}

export function readMessages(sessionId: string, opts?: { limit?: number; before?: number }): Envelope[] {
  const limit = opts?.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 500
  const page = getStore().readRecent(sessionId, limit)
  let messages = page.messages
  if (opts?.before !== undefined) messages = messages.filter((message) => message.ts < opts.before!)
  return [...messages].sort((a, b) => b.ts - a.ts)
}

export function listSessions(): string[] {
  return getStore().listSessionIds()
}

export function getCanonicalSessionStore(): CanonicalSessionStore {
  return getStore()
}

function atomicWriteJson(file: string, value: unknown): void {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let fd: number | undefined
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    renameSyncWithRetry(temp, file)
    if (process.platform !== 'win32') {
      const directoryFd = fs.openSync(directory, 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temp) } catch {}
  }
}
