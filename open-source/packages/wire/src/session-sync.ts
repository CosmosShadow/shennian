// @arch open-source/docs/wire.md
// @test src/__tests__/session-sync.test.ts

import type { Envelope } from './envelope.ts'
import type { ProjectFsOpaqueCapability } from './project-fs.ts'
import type { AgentType, ManagerConfig, SessionMode, SessionScope } from './session.ts'

export const SESSION_SYNC_PROTOCOL_VERSION = 2 as const
export type SessionSyncProtocolVersion = typeof SESSION_SYNC_PROTOCOL_VERSION

/**
 * Monotonic authority generation for personal Session data. This is shared by
 * daemon, Server and App; implementations must not carry a private cache epoch.
 */
export const SESSION_SYNC_DATA_EPOCH = 2 as const
export type SessionSyncDataEpoch = typeof SESSION_SYNC_DATA_EPOCH

export const SESSION_SYNC_RELEASE_GATE = {
  minCliVersion: '0.3.65',
  minAppBuild: { ios: 51, android: 12 },
  minDesktopVersion: '0.4.0',
} as const

export const SESSION_SYNC_REQUIRED_CAPABILITIES = [
  'session_index_v1',
  'session_body_revision_v1',
  'session_history_subscription_v1',
  'local_canonical_v1',
  'session_title_authority_v1',
  'session_title_seed_v1',
  'session_tool_detail_v1',
  'voice_session_body_relay_v1',
  'native_source_tombstone_v1',
  'session_durable_send_v1',
  'daemon_installation_identity_v1',
  'session_user_boundary_v1',
  'session_terminal_outbox_v1',
  'session_list_preview_v1',
  'session_attention_v1',
  'session_data_epoch_v2',
  'session_structured_rejection_v2',
  'machine_personal_authority_v2',
] as const

/**
 * Additive capabilities are advertised by new daemons but are not part of the
 * epoch-wide minimum gate. This lets the App roll out background replication
 * while old daemons keep serving the compatible visible-session snapshot path.
 */
export const SESSION_SYNC_ADDITIVE_CAPABILITIES = [
  'session_body_replica_v1',
  'session_body_replica_stream_v1',
  'active_run_recovery_v1',
  'external_updater_v1',
  'room_message_delivery_v1',
] as const

export const SESSION_SYNC_ADVERTISED_CAPABILITIES = [
  ...SESSION_SYNC_REQUIRED_CAPABILITIES,
  ...SESSION_SYNC_ADDITIVE_CAPABILITIES,
] as const

export const SESSION_SYNC_EVENT_NAMES = [
  'session.index.updated',
  'session.body.delta',
  'session.body.replica.delta',
  'session.body.replica.error',
] as const

export const SESSION_HISTORY_LIMITS = {
  defaultSnapshotMessages: 100,
  maxSnapshotMessages: 500,
  defaultPageMessages: 100,
  maxPageMessages: 500,
  maxDeltaMutations: 200,
  maxMutationBytes: 256 * 1024,
  maxReplicaPageBytes: 4 * 1024 * 1024,
  maxSubscriptionsPerClient: 4,
  maxSubscriptionsPerSession: 8,
  maxReplicaStreamsPerDaemon: 8,
} as const

/**
 * Known capabilities accepted by the handshake projection. A capability can be
 * known before a daemon is allowed to advertise it; advertisement must follow
 * the implementation-specific rollout gate.
 */
export type SessionSyncCapability =
  | (typeof SESSION_SYNC_ADVERTISED_CAPABILITIES)[number]
  | ProjectFsOpaqueCapability
export type SessionSyncEventName = (typeof SESSION_SYNC_EVENT_NAMES)[number]
export type SessionBodyStorageMode = 'machine_local'
export type NativeCleanupPolicy = 'none' | 'auto'

export type PersonalSyncIdentity = {
  protocolVersion: SessionSyncProtocolVersion
  dataEpoch: SessionSyncDataEpoch
  daemonInstallationId: string
}
export type SessionTitleSource =
  | 'shennian_manual'
  | 'agent_native'
  | 'shennian_generated'
  | 'first_user_fallback'

export const SESSION_TITLE_SOURCE_PRIORITY: Readonly<Record<SessionTitleSource, number>> = {
  first_user_fallback: 0,
  shennian_generated: 1,
  agent_native: 2,
  shennian_manual: 3,
}

export function isSessionTitleSource(value: unknown): value is SessionTitleSource {
  return typeof value === 'string' && value in SESSION_TITLE_SOURCE_PRIORITY
}

export type SessionTitleSetParams = PersonalSyncIdentity & {
  sessionId: string
  agentType: AgentType
  agentSessionId: string | null
  workDir: string
  title: string
  titleSource: 'shennian_manual'
  titleRevision: number
  titleOriginEventId: string
}

export type SessionTitleGenerationEligibility =
  | 'agent_native_unavailable'
  | 'terminal'
  | 'grace_elapsed'

/**
 * Ephemeral daemon -> Server request. titleSeed must never be persisted or
 * placed in an at-least-once event buffer by either side.
 */
export type SessionTitleGenerateParams = PersonalSyncIdentity & {
  sessionId: string
  requestId: string
  titleSeed: string
  baseTitleRevision: number
  eligibility: SessionTitleGenerationEligibility
}

export type SessionTitleGenerateResponse =
  | {
      generated: true
      title: string
      titleSource: 'shennian_generated'
      titleRevision: number
      titleOriginEventId: string
    }
  | {
      generated: false
      reason: 'not_eligible' | 'superseded' | 'generator_unavailable' | 'generation_failed'
    }

export type SessionSyncErrorCode =
  | 'upgrade_required'
  | 'epoch_mismatch'
  | 'session_deleted'
  | 'ownership_transferred'
  | 'token_revoked'
  | 'room_authority_conflict'
  | 'invalid_payload'
  | 'invalid_identity'
  | 'revision_gap'
  | 'snapshot_compacted'
  | 'machine_offline'
  | 'history_unavailable'
  | 'subscription_not_found'
  | 'subscription_limit_exceeded'
  | 'response_too_large'
  | 'temporary_unavailable'

export const SESSION_SYNC_REQUIRED_ACTIONS = [
  'retry',
  'reset_epoch',
  'purge_session',
  'quarantine_record',
  'refresh_machine_ownership',
  'upgrade_client',
  'stop',
] as const

export type SessionSyncRequiredAction = (typeof SESSION_SYNC_REQUIRED_ACTIONS)[number]

export type SessionSyncRejection = {
  code: SessionSyncErrorCode
  retryable: boolean
  requiredAction: SessionSyncRequiredAction
  authoritativeEpoch?: SessionSyncDataEpoch
  authoritativeRevision?: number
  message?: string
}

/** Privacy-safe regression cases shared by the cross-client hard-cut tests. */
export const PERSONAL_SYNC_FAILURE_FIXTURES = [
  {
    id: 'legacy_index_replay_after_server_reset',
    ingress: 'session.index.updated',
    condition: 'stale_data_epoch',
    expectedCode: 'epoch_mismatch',
    expectedAction: 'reset_epoch',
  },
  {
    id: 'personal_index_targets_room_session',
    ingress: 'session.index.updated',
    condition: 'room_binding_exists',
    expectedCode: 'room_authority_conflict',
    expectedAction: 'quarantine_record',
  },
  {
    id: 'history_response_not_durably_applied',
    ingress: 'session.history.open',
    condition: 'network_success_cache_revision_zero',
    expectedCode: 'revision_gap',
    expectedAction: 'stop',
  },
  {
    id: 'native_path_move_replays_attention',
    ingress: 'session.index.updated',
    condition: 'same_source_event_identity',
    expectedCode: 'invalid_payload',
    expectedAction: 'quarantine_record',
  },
] as const satisfies ReadonlyArray<{
  id: string
  ingress: string
  condition: string
  expectedCode: SessionSyncErrorCode
  expectedAction: SessionSyncRequiredAction
}>

export type SessionSyncError = {
  code: SessionSyncErrorCode
  message?: string
  requiredProtocolVersion?: SessionSyncProtocolVersion
  requiredCapabilities?: SessionSyncCapability[]
  expectedRevision?: number
  actualRevision?: number
  retryable: boolean
  requiredAction: SessionSyncRequiredAction
  authoritativeEpoch?: SessionSyncDataEpoch
  authoritativeRevision?: number
}

export type PersonalAttachmentReference = {
  path: string
  name: string
  mimeType: string
  kind: 'file' | 'image' | 'folder'
  byteSize: number
  sha256: string
}

export type SessionDeliveryState =
  | 'queued'
  | 'committed'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type SessionDurableSendAck<
  TState extends SessionDeliveryState = SessionDeliveryState,
> = PersonalSyncIdentity & {
  sessionId: string
  clientMessageId: string
  messageId: string
  deliveryState: TState
  bodyRevision: number
  committedAt: string
}

export type SessionMessageStatusParams = PersonalSyncIdentity & {
  sessionId: string
  clientMessageId: string
}

export type SessionMessageStatusResponse =
  | (PersonalSyncIdentity & { state: 'not_found'; sessionId: string; clientMessageId: string })
  | {
      [TState in SessionDeliveryState]: { state: TState } & SessionDurableSendAck<TState>
    }[SessionDeliveryState]

export function getMissingSessionSyncCapabilities(
  capabilities: readonly string[] | null | undefined,
): SessionSyncCapability[] {
  const available = new Set(capabilities ?? [])
  return SESSION_SYNC_REQUIRED_CAPABILITIES.filter((capability) => !available.has(capability))
}

export function hasRequiredSessionSyncCapabilities(
  capabilities: readonly string[] | null | undefined,
): capabilities is readonly SessionSyncCapability[] {
  return getMissingSessionSyncCapabilities(capabilities).length === 0
}

export type SessionHistoryOpenParams = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  cachedBodyRevision?: number
  limit?: number
  beforeSequence?: number
}

export type SessionHistorySyncParams = PersonalSyncIdentity & {
  sessionId: string
  syncId: string
  afterRevision: number
  limit?: number
}

export type SessionHistoryMessage = {
  sequence: number
  revision: number
  message: Envelope
  deliveryState?: SessionDeliveryState
}

export type SessionHistorySnapshot = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  storageMode: SessionBodyStorageMode
  snapshotRevision: number
  firstAvailableSeq: number | null
  lastAvailableSeq: number | null
  hasOlder: boolean
  messages: SessionHistoryMessage[]
}

export type SessionHistoryPageParams = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  beforeSequence: number
  limit?: number
}

export type SessionHistoryPage = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  snapshotRevision: number
  firstAvailableSeq: number | null
  hasOlder: boolean
  messages: SessionHistoryMessage[]
}

export type VoiceSessionBodyWindowParams = PersonalSyncIdentity & {
  sessionId: string
  callId: string
  bodyRevision?: number
  limit?: number
  maxBytes?: number
}

export type VoiceSessionBodyWindow = PersonalSyncIdentity & {
  sessionId: string
  callId: string
  bodyRevision: number
  messages: Envelope[]
  truncated: boolean
}

export type SessionHistoryCloseParams = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
}

export type SessionHistoryCloseResponse = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  closed: true
}

export type SessionBodyMutation = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  revision: number
  mutation: 'append' | 'upsert' | 'tombstone'
  messageId: string
  sequence: number
  message?: Envelope
  deliveryState?: SessionDeliveryState
}

/** Candidate for an authorized Session-to-Room migration; no network route uses it yet. */
export type SessionRoomImportMutation = Omit<SessionBodyMutation, 'subscriptionId'> & {
  schemaVersion: 1
  mutationId: string
  contentHash: string
  committedAt: string
}

export type SessionBodyDeltaEvent = PersonalSyncIdentity & {
  sessionId: string
  subscriptionId: string
  fromRevision: number
  toRevision: number
  mutations: SessionBodyMutation[]
}

/**
 * One-shot, resumable body replication page. Unlike history.open this does not
 * create a live subscription. Mutations remain contiguous from fromRevision;
 * targetRevision is the daemon high-water captured for this page.
 */
export type SessionHistorySyncPage = PersonalSyncIdentity & {
  sessionId: string
  syncId: string
  fromRevision: number
  toRevision: number
  targetRevision: number
  hasMore: boolean
  mutations: SessionBodyMutation[]
}

/**
 * One foreground App installation owns at most one body replica stream for a
 * daemon generation. The daemon registers the stream before capturing these
 * high-water marks, so mutations committed during subscribe cannot be lost.
 */
export type SessionBodyReplicaSubscribeParams = PersonalSyncIdentity & {
  appInstallationId: string
  streamId: string
  generation: number
}

export type SessionBodyReplicaHighWater = {
  sessionId: string
  bodyRevision: number
}

export type SessionBodyReplicaSubscribeResponse = PersonalSyncIdentity & {
  appInstallationId: string
  streamId: string
  generation: number
  highWatermarks: SessionBodyReplicaHighWater[]
}

export type SessionBodyReplicaUnsubscribeParams = PersonalSyncIdentity & {
  appInstallationId: string
  streamId: string
  generation: number
}

export type SessionBodyReplicaUnsubscribeResponse = PersonalSyncIdentity & {
  appInstallationId: string
  streamId: string
  generation: number
  closed: true
}

export type SessionBodyReplicaDeltaBatch = {
  sessionId: string
  fromRevision: number
  toRevision: number
  mutations: SessionBodyMutation[]
}

export type SessionBodyReplicaDeltaEvent = PersonalSyncIdentity & {
  appInstallationId: string
  streamId: string
  generation: number
  batches: SessionBodyReplicaDeltaBatch[]
}

export type SessionBodyReplicaErrorEvent = {
  streamId: string
  generation?: number
  appInstallationId?: string
  rejection: SessionSyncRejection
}

/**
 * Machine-authored personal-session projection. Ownership, machine display
 * fields and viewer permissions are server authority and therefore never
 * accepted from a daemon payload.
 */
export type DaemonSessionIndexProjection = {
  nativeSessionVisibility?: 'user' | 'internal'
  sessionScope?: SessionScope
  id: string
  agentType: AgentType
  sessionMode?: SessionMode
  managerConfig?: ManagerConfig | null
  agentSessionId: string | null
  modelId: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  title: string
  titleSource: SessionTitleSource
  titleRevision: number
  titleLockedByUser: boolean
  titleOriginEventId: string | null
  status: 'active' | 'completed' | 'failed'
  workDir: string
  lastMessagePreview: string | null
  /** Stable identity and canonical timestamp of lastMessagePreview. */
  lastMessagePreviewMessageId: string | null
  lastMessagePreviewAt: string | null
  /** Latest canonical user-visible text or tool event; optional for older daemons. */
  lastVisibleEventAt?: string | null
  bodyStorageMode: SessionBodyStorageMode
  /**
   * Set only after the daemon has durably committed the first canonical user
   * message. A pre-user agent/tool projection is never publishable.
   */
  localReady: true
  firstUserBoundary: {
    role: 'user'
    messageId: string
    bodyRevision: number
  }
  bodyRevision: number
  indexRevision: number
  firstAvailableSeq: number | null
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  /** User-attention results, independent from canonical body/message cardinality. */
  attentionCount: number
  lastAttentionId: string | null
  lastBodyCommittedAt: string | null
  deletionRevision: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type SessionIndexUpdate = PersonalSyncIdentity & {
  session: DaemonSessionIndexProjection
}

export type NativeSourceDeletionRef = {
  agentType: AgentType
  sourceSessionKey: string
}

/**
 * Durable Server tombstone command. The daemon must persist every source
 * barrier before deleting any derived local state or acknowledging revision.
 */
export type SessionDeletionCommand = {
  sessionId: string
  deletionRevision: number
  deletedAt: string
  /** Origin working directory; required by project-scoped lifecycle tools such as Gemini. */
  workDir?: string
  nativeCleanupPolicy: NativeCleanupPolicy
  sources: NativeSourceDeletionRef[]
}

export type SessionDeletionsSyncParams = PersonalSyncIdentity & {
  afterRevision: number
}

export type SessionDeletionsSyncResponse = PersonalSyncIdentity & {
  /** Highest pruned revision the daemon may durably baseline before applying returned commands. */
  baselineRevision: number
  latestRevision: number
  deletions: SessionDeletionCommand[]
}

export type SessionDeletionsAckParams = PersonalSyncIdentity & {
  deletionRevision: number
}

export type SessionDeletionsAckResponse = PersonalSyncIdentity & {
  deletionRevision: number
  acknowledged: true
}
