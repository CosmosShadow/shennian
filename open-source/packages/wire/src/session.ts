// @arch open-source/docs/wire.md
// @test open-source/packages/shared/src/__tests__/sync-engine.test.ts

import type { NativeSessionSourceMode } from './native-session.js'
import type {
  PersonalAttachmentReference,
  PersonalSyncIdentity,
  SessionBodyStorageMode,
  SessionTitleSource,
} from './session-sync.js'

export type BuiltinAgentType =
  | 'shennian'
  | 'claude'
  | 'codex'
  | 'workbuddy'
  | 'gemini'
  | 'cursor'
  | 'openclaw'
  | 'opencode'
  | 'pi'
  | 'pi-coding-agent'
  | 'manager'
export type CustomAgentType = `custom:${string}`
/** Stable Agent Client Protocol integrations discovered on the target machine. */
export type AcpAgentType = `acp:${string}`
export type AgentType = BuiltinAgentType | CustomAgentType | AcpAgentType

/** The external Codex owner stopped its last turn, so its native queue is paused. */
export const CODEX_DESKTOP_SEND_UNAVAILABLE = 'codex_desktop_send_unavailable'

export const DISABLED_BUILTIN_AGENT_TYPES = [
  'gemini',
  'openclaw',
] as const satisfies readonly BuiltinAgentType[]
export const AVAILABLE_BUILTIN_AGENT_TYPES = [
  'shennian',
  'claude',
  'codex',
  'workbuddy',
  // Gemini CLI is intentionally hidden from new sessions. Keep the historical
  // AgentType and adapter intact so persisted sessions remain readable.
  'cursor',
  'opencode',
  'pi',
  'pi-coding-agent',
] as const satisfies readonly BuiltinAgentType[]

const AVAILABLE_BUILTIN_AGENT_TYPE_SET = new Set<BuiltinAgentType>(AVAILABLE_BUILTIN_AGENT_TYPES)

export type ModelInfo = {
  id: string
  name: string
  description?: string
  provider?: string
  isDefault?: boolean
  supportedReasoningEfforts?: Array<{
    id: string
    name: string
    description?: string
  }>
  defaultReasoningEffort?: string
  additionalSpeedTiers?: string[]
}

/** Runtime options returned by an active ACP session; absent before session/new or load. */
export type AcpSessionOptions = {
  models: ModelInfo[]
  modes: Array<{ id: string; name: string; description?: string }>
}

export type AgentConfigStatus = 'missing' | 'detected' | 'managed' | 'error'

export type AgentConfigSummary = {
  /** Configuration state on the target machine; secrets are never included. */
  status: AgentConfigStatus
  /** Where the daemon detected the configuration. */
  source?: 'env' | 'config-file' | 'keychain' | 'shennian' | 'unknown'
  tokenPresent?: boolean
  /** Masked token suffix only, e.g. ••••abcd. */
  tokenHint?: string
  /** Host part only; never includes credentials or paths. */
  baseUrlHost?: string
  error?: string
  updatedAt?: string
}

export type AgentRuntimeSummary = {
  /** Version of the Agent CLI selected by the Shennian daemon. */
  cliVersion?: string
  /** Version bundled with the locally installed desktop app, when detectable. */
  desktopVersion?: string
  /** Compatibility is only reported when both versions are known. */
  compatibility?: 'compatible' | 'version_mismatch'
  /** Shennian never upgrades third-party Agents automatically. */
  upgradeAction?: 'manual'
}

export type AgentIntegration = 'deep' | 'acp'
export type AgentAuthState = 'ready' | 'required' | 'unknown' | 'error'

export type AcpCapabilitySummary = {
  protocolVersion: 1
  listSessions: boolean
  loadSession: boolean
  resumeSession: boolean
  closeSession: boolean
  deleteSession: boolean
  terminal: boolean
  fileRead: boolean
  fileWrite: boolean
  permission: boolean
  modelConfig: boolean
}

export type AcpAuthMethodSummary = {
  id: string
  name: string
  type: 'agent' | 'terminal'
}

export type AgentDisplayMetadata = {
  name: string
  abbreviation?: string
  version?: string
}

export type AcpCatalogPlatform =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'windows-aarch64'
  | 'windows-x86_64'

export type AcpCatalogCandidate = {
  id: string
  name: string
  version: string
  commands: string[]
  args: string[]
  /** Package hints are inspected locally only; the daemon never installs them. */
  npmPackage?: string
  uvPackage?: string
  website?: string
  duplicateOf?: BuiltinAgentType
}

export type AcpCatalogSnapshot = {
  revision: string
  digest: string
  fetchedAt: string
  sourceVersion: string
  platform: AcpCatalogPlatform
  candidates: AcpCatalogCandidate[]
}

export type AcpExternalSessionInfo = {
  agentSessionId: string
  cwd: string
  title?: string
  updatedAt?: string
}

/** Complete scope for an external ACP session; vendor ids are never global. */
export type AcpExternalSessionIdentity = {
  machineId: string
  agentType: AcpAgentType
  agentSessionId: string
}

export type AgentInfo = {
  type: AgentType
  models: ModelInfo[]
  /** True when this runtime can back an ordinary Shennian session. */
  supportsStandardSession?: boolean
  /** New personal sessions never implicitly import history from other sessions. */
  supportsFreshPersonalContext?: boolean
  /** True when this integrated runtime can back a persistent Shennian Agent identity. */
  supportsAgent?: boolean
  /** Agent execution modes implemented by this runtime on the current machine. */
  supportedAgentExecutionModes?: import('./agent-workspace.ts').ManagedAgentExecutionMode[]
  /** User-facing grouping. Omitted by older daemons and interpreted as deep. */
  integration?: AgentIntegration
  /** Non-secret metadata used for dynamic ACP display fallbacks. */
  display?: AgentDisplayMetadata
  /** Stable ACP v1 capabilities negotiated with the installed local Agent. */
  acpCapabilities?: AcpCapabilitySummary
  /** Non-secret authentication choices advertised during ACP initialize. */
  acpAuthMethods?: AcpAuthMethodSummary[]
  /** Conservative auth projection; authMethods alone never imply required. */
  authState?: AgentAuthState
  /** Registry snapshot used to discover the Agent, when applicable. */
  catalogRevision?: string
  /** @deprecated Legacy restricted-mode gate; use the explicit Agent fields above. */
  supportsManagedAgent?: boolean
  /** @deprecated Use supportedAgentExecutionModes. */
  supportsManagedNativeFull?: boolean
  /** True when Manager mode can create this provider as a worker. */
  supportsWorker?: boolean
  /** True only after this real provider passed Manager-mode runtime validation. */
  supportsManagerMode?: boolean
  /** True when a managed Room turn can receive explicit Room tools. */
  supportsRoomTools?: boolean
  /** True when the public temporary Worker controller may target this runtime. */
  supportsExternalWorkerTarget?: boolean
  /** Per-machine Agent provider config summary (additive, non-secret). */
  config?: AgentConfigSummary
  /** Non-secret runtime version and compatibility summary. */
  runtime?: AgentRuntimeSummary
  /** Conservative per-machine protection baseline; absent on older daemons. */
  managedAgentProtection?: import('./agent-workspace.ts').ManagedAgentRuntimeProtection
}

/** New daemons declare Agent eligibility explicitly; legacy daemons used two mode-specific flags. */
export function agentInfoSupportsAgent(agent: AgentInfo): boolean {
  if (typeof agent.supportsAgent === 'boolean') return agent.supportsAgent
  return agent.supportsManagedAgent === true || agent.supportsManagedNativeFull === true
}

/** Resolve an execution mode without changing the meaning of legacy capability fields. */
export function agentInfoSupportsExecutionMode(
  agent: AgentInfo,
  mode: import('./agent-workspace.ts').ManagedAgentExecutionMode,
): boolean {
  if (Array.isArray(agent.supportedAgentExecutionModes)) {
    return agent.supportedAgentExecutionModes.includes(mode)
  }
  return mode === 'native-full'
    ? agent.supportsManagedNativeFull === true
    : agent.supportsManagedAgent === true
}

export type SessionMode = 'standard' | 'manager'

/**
 * Product ownership of a personal Session. Missing means `personal`, so legacy
 * clients, daemons and rows keep their ordinary behaviour. `steward` sessions
 * belong to the machine Owner's Shennian steward and stay out of ordinary
 * project and conversation lists; they are read through the steward history.
 */
export type SessionScope = 'personal' | 'steward'

export function isStewardSession(session: { sessionScope?: string | null }): boolean {
  return session.sessionScope === 'steward'
}

export type ManagerConfig = {
  defaultWorkerAgentType?: AgentType | null
  defaultWorkerModelId?: string | null
}

export function isAvailableBuiltinAgentType(value: string): value is BuiltinAgentType {
  return AVAILABLE_BUILTIN_AGENT_TYPE_SET.has(value as BuiltinAgentType)
}

export function isAvailableAgentType(value: string): value is AgentType {
  return value.startsWith('custom:')
    || /^acp:[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
    || isAvailableBuiltinAgentType(value)
}

export function filterAvailableAgentTypes(values: readonly string[]): AgentType[] {
  const filtered: AgentType[] = []
  const seen = new Set<AgentType>()

  for (const value of values) {
    if (!isAvailableAgentType(value) || seen.has(value)) continue
    seen.add(value)
    filtered.push(value)
  }

  return filtered
}

export function filterAvailableAgentInfos(agents?: readonly AgentInfo[]): AgentInfo[] {
  if (!agents?.length) return []

  const filtered: AgentInfo[] = []
  const seen = new Set<AgentType>()

  for (const agent of agents) {
    if (!isAvailableAgentType(agent.type) || seen.has(agent.type)) continue
    seen.add(agent.type)
    filtered.push(agent)
  }

  return filtered
}

export type SessionUserState = {
  userId: string
  sessionId: string
  pinnedAt?: string | null
  lastReadAt?: string | null
  /** Index watermark captured atomically when the user marks this session read. */
  lastReadBodyRevision?: number
  lastReadVisibleMessageCount?: number
  lastReadVisibleMessageId?: string | null
  lastReadAttentionCount?: number
  lastReadAttentionId?: string | null
  manualUnread?: boolean
  /** Local desired read watermark has not yet been acknowledged by Server. */
  readSyncPending?: boolean
  updatedAt: string
}

/** Exact lightweight index state the user actually saw before marking a Session read. */
export type SessionReadWatermark = {
  bodyRevision: number
  visibleMessageCount: number
  lastVisibleMessageId: string | null
  attentionCount: number
  lastAttentionId: string | null
}

export type SessionRunPhase =
  | 'thinking'
  | 'tool_running'
  | 'streaming_text'
  | 'waiting_approval'
  | 'waiting_user_input'

export type SessionActivitySnapshot = {
  sessionId: string
  runId: string
  runPhase: SessionRunPhase
  startedAt: string
  updatedAt: string
  /** Number of tool calls observed in the active run. */
  toolCallCount?: number
  /** True when the daemon owns a live control channel that can stop the active run. */
  canStop?: boolean
  /** Optional owner projection for runs controlled by a native desktop host. */
  owner?: 'shennian' | 'external'
  /** Human-readable native owner. Older clients safely ignore this field. */
  ownerLabel?: string
  /** External-owner lifecycle. `runPhase` remains the backwards-compatible projection. */
  lifecycle?: 'queued' | 'running'
}

export type ExternalChannelSessionStatus = {
  configured?: boolean
  connected: boolean
  type?: string | null
  channelId?: string | null
  machineId?: string | null
  name?: string | null
  canReply?: boolean | null
  systemPrompt?: string | null
  wechatRpaSource?: string | null
  wechatRpaGroups?: Array<{ name: string }> | null
  pollIntervalMs?: number | null
  recentLimit?: number | null
  idleSeconds?: number | null
  forceForeground?: boolean | null
  noRestore?: boolean | null
  downloadAttachments?: boolean | null
  downloadAttachmentsDir?: string | null
  selfNickname?: string | null
  cloudOcrUrl?: string | null
  cloudOcrMode?: string | null
  wechatRpaRuntimeState?:
    | 'idle_waiting'
    | 'syncing'
    | 'interrupted'
    | 'retrying'
    | 'cooldown'
    | null
  wechatRpaLastRunAt?: string | null
  wechatRpaLastMessageAt?: string | null
  wechatRpaLastInterruptedAt?: string | null
  wechatRpaPendingReplyCount?: number | null
  wechatRpaPendingReplies?: WeChatRpaPendingReplyProjection[] | null
  wechatRpaLastError?: string | null
  wechatRpaLastRunId?: string | null
  wechatRpaLastTracePath?: string | null
  wechatRpaLastTraceSummary?: string | null
  wechatRpaRecentTaskSummaries?: WeChatRpaTaskSummary[] | null
  wechatRpaLastCloudOcrAt?: string | null
  wechatRpaLastCloudOcrPurpose?: string | null
  wechatRpaLastCloudOcrRequestId?: string | null
  wechatRpaLastCloudOcrImageHash?: string | null
  wechatRpaLastCloudOcrUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  } | null
  wechatRpaPreflightChecks?: WeChatRpaPreflightCheck[] | null
  wechatRpaServerDecisionAvailable?: boolean | null
  wechatRpaPrivacyConsentAccepted?: boolean | null
}

export type WeChatRpaPendingReplyProjection = {
  replyId?: string | null
  idempotencyKey: string
  status: 'queued' | 'sending' | 'sent_unconfirmed' | string
  conversationName?: string | null
  reasonCode?: string | null
  nextAttemptAt?: string | null
  queuedAt?: string | null
  lastAttemptAt?: string | null
  attemptCount?: number | null
  commitStage?: string | null
}

export type WeChatRpaTaskSummary = {
  at: string
  status: 'blocked' | 'failed' | 'interrupted' | 'sent' | 'received'
  runId?: string | null
  summary: string
}

export type WeChatRpaPreflightCode =
  | 'ok'
  | 'mac_only'
  | 'platform_unsupported'
  | 'enterprise_required'
  | 'privacy_consent_required'
  | 'server_decision_unavailable'
  | 'same_machine_required'
  | 'local_agent_unavailable'
  | 'helper_not_ready'
  | 'permission_screen_recording_missing'
  | 'permission_accessibility_missing'
  | 'permission_automation_missing'
  | 'wechat_not_running'
  | 'wechat_window_unavailable'
  | 'wechat_window_unresponsive'
  | 'wechat_recovery_failed'
  | 'wechat_single_main_window_required'
  | 'pending_server_decision'
  | 'network_unavailable'
  | 'waiting_retry'
  | 'unknown'

export type WeChatRpaPreflightCheck = {
  code: WeChatRpaPreflightCode
  ok: boolean
  severity?: 'blocking' | 'warning'
  message?: string
}

export type NianSession = {
  id: string
  /** Device-local lifecycle only; never sent as canonical session metadata. */
  localCreationState?: 'draft' | 'created'
  /** Client-local user-message sort watermark; not canonical server metadata. */
  lastUserMessageAt?: string | null
  agentIdentityId?: string | null
  machineId: string
  userId: string
  agentType: AgentType
  /** Missing on legacy records/clients and normalized to standard, except legacy agentType=manager. */
  sessionMode?: SessionMode
  /** Internal orchestration stays out of personal discovery; linked details remain readable. */
  nativeSessionVisibility?: 'user' | 'internal'
  /** Missing on legacy records and normalized to personal. Immutable once a session is steward. */
  sessionScope?: SessionScope
  managerConfig?: ManagerConfig | null
  agentSessionId: string | null
  sourceMode?: NativeSessionSourceMode | null
  modelId?: string | null
  /** Agent-owned conversations follow the Agent model until explicitly overridden. */
  modelSource?: 'agent' | 'session'
  /** Owner-only live Agent policy used when modelSource is agent. */
  agentDefaultModelId?: string | null
  /** Owner-only live Agent prompt applied at the start of the next run. */
  agentSystemPrompt?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  title: string
  titleSource?: SessionTitleSource
  titleRevision?: number
  titleLockedByUser?: boolean
  titleOriginEventId?: string | null
  status: 'active' | 'completed' | 'failed'
  workDir: string
  lastMessagePreview?: string | null
  /** Stable identity and canonical timestamp of the displayed list preview. */
  lastMessagePreviewMessageId?: string | null
  lastMessagePreviewAt?: string | null
  /** Latest canonical timeline event visible to the user, including tool activity. */
  lastVisibleEventAt?: string | null
  bodyStorageMode?: SessionBodyStorageMode
  /**
   * False only for a Server-created shell that has not yet committed its first
   * canonical user message on the origin daemon.
   */
  localReady?: boolean
  bodyRevision?: number
  indexRevision?: number
  /** Personal data authority generation; absent only for Room/legacy projections. */
  dataEpoch?: import('./session-sync.ts').SessionSyncDataEpoch
  firstAvailableSeq?: number | null
  visibleMessageCount?: number
  lastVisibleMessageId?: string | null
  /** Completed/error/approval results that require user attention. */
  attentionCount?: number
  lastAttentionId?: string | null
  lastBodyCommittedAt?: string | null
  deletionRevision?: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  machineName?: string | null
  ownerName?: string | null
  ownerPhone?: string | null
  ownerEmail?: string | null
  canManage?: boolean
  sharedMachineSession?: boolean
  userState?: SessionUserState | null
  activity?: SessionActivitySnapshot | null
  externalChannel?: ExternalChannelSessionStatus | null
}

export type SessionListProjection = Pick<
  NianSession,
  | 'id'
  | 'machineId'
  | 'userId'
  | 'agentType'
  | 'sessionMode'
  | 'nativeSessionVisibility'
  | 'sessionScope'
  | 'managerConfig'
  | 'agentSessionId'
  | 'modelId'
  | 'managerDefaultWorkerAgentType'
  | 'managerDefaultWorkerModelId'
  | 'title'
  | 'titleSource'
  | 'titleRevision'
  | 'titleLockedByUser'
  | 'titleOriginEventId'
  | 'status'
  | 'workDir'
  | 'lastMessagePreview'
  | 'lastMessagePreviewMessageId'
  | 'lastMessagePreviewAt'
  | 'lastVisibleEventAt'
  | 'bodyStorageMode'
  | 'bodyRevision'
  | 'indexRevision'
  | 'dataEpoch'
  | 'firstAvailableSeq'
  | 'visibleMessageCount'
  | 'lastVisibleMessageId'
  | 'attentionCount'
  | 'lastAttentionId'
  | 'lastBodyCommittedAt'
  | 'deletionRevision'
  | 'lastActivityAt'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'machineName'
  | 'ownerName'
  | 'ownerPhone'
  | 'ownerEmail'
  | 'canManage'
  | 'sharedMachineSession'
  | 'activity'
  | 'externalChannel'
>

export type ChatSendParams = PersonalSyncIdentity & {
  sessionId: string
  text: string
  agentType: string
  sessionMode?: SessionMode
  /** Relay-attested from the Server session row; a client-supplied value is discarded. */
  sessionScope?: SessionScope
  managerConfig?: ManagerConfig | null
  workDir: string
  agentSessionId?: string | null
  modelId?: string
  systemPrompt?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  reasoningEffort?: string | null
  clientMessageId?: string
  sessionListProjection?: SessionListProjection[]
  attachments?: Array<
    PersonalAttachmentReference & {
      /** @deprecated Removed by the hard-cutover attachment migration. */
      previewData?: string
    }
  >
  externalChannel?: ExternalChannelSessionStatus | null
  replyTarget?: string | null
}

export type QueuedChatMessage = PersonalSyncIdentity & {
  id: string
  sessionId: string
  text: string
  agentType: AgentType
  sessionMode?: SessionMode
  sessionScope?: SessionScope
  managerConfig?: ManagerConfig | null
  workDir: string
  agentSessionId?: string | null
  modelId?: string | null
  systemPrompt?: string | null
  managerDefaultWorkerAgentType?: AgentType | null
  managerDefaultWorkerModelId?: string | null
  reasoningEffort?: string | null
  clientMessageId?: string | null
  attachments?: Array<
    PersonalAttachmentReference & {
      /** @deprecated Removed by the hard-cutover attachment migration. */
      previewData?: string
    }
  >
  externalChannel?: ExternalChannelSessionStatus | null
  replyTarget?: string | null
  createdAt: string
  updatedAt: string
  /** Presentation state for the shared pending-message panel. */
  pendingState?: 'waiting' | 'submitting' | 'provider_queued'
  /** Whether the current client may delete this item before Provider claim. */
  canDelete?: boolean
  /** Whether the daemon currently has a truthful immediate-send path. */
  canPromote?: boolean
}

export type ChatQueueSnapshot = PersonalSyncIdentity & {
  sessionId: string
  busy: boolean
  pending: QueuedChatMessage[]
  /** Owner-authored messages that may be deleted or promoted by the current UI. */
  controllablePending?: QueuedChatMessage[]
  /** All owner-authored pending items that belong in the shared composer panel. */
  visiblePending?: QueuedChatMessage[]
}

export type ChatEnqueueParams = ChatSendParams & {
  queueMessageId?: string
  origin?: 'app' | 'external'
  /** Relay-attested. Clients must not set this field directly. */
  managedAgentDirect?: true
}

export type ChatQueueGetParams = PersonalSyncIdentity & {
  sessionId: string
}

export type ChatQueueEditParams = PersonalSyncIdentity & {
  sessionId: string
  queueMessageId: string
  text: string
  attachments?: Array<
    PersonalAttachmentReference & {
      /** @deprecated Removed by the hard-cutover attachment migration. */
      previewData?: string
    }
  >
}

export type ChatQueueDeleteParams = PersonalSyncIdentity & {
  sessionId: string
  queueMessageId: string
}

export type ChatQueuePromoteParams = PersonalSyncIdentity & {
  sessionId: string
  /** Send this owner-authored pending message now without merging adjacent items. */
  queueMessageId: string
}

export type ChatQueuePromoteResult = {
  queue: ChatQueueSnapshot
  promotedMessageIds: string[]
  mode: 'injected' | 'restarted' | 'idle'
}

export type SessionResumeParams = PersonalSyncIdentity & {
  sessionId: string
  agentSessionId: string | null
}

export type SessionHistoryParams = PersonalSyncIdentity & {
  sessionId: string
  limit?: number
  before?: number
}

export type FsLsParams = { path: string; rootPath?: string }
export type FsReadParams = { path: string; rootPath?: string }

/** Visibility is separate from access: an Owner can still open linked internal details. */
export function isInternalSession(session: {
  id: string
  nativeSessionVisibility?: string | null
  sessionScope?: string | null
  agentType?: string
  sessionMode?: string | null
  agentIdentityId?: string | null
}): boolean {
  return session.nativeSessionVisibility === 'internal'
    || isStewardSession(session)
    || session.id.startsWith('sess_worker_')
    || session.agentType === 'manager'
    || session.sessionMode === 'manager'
    || Boolean(session.agentIdentityId)
}
