export {
  RelayClient,
  MultiplexRelayClient,
  type RelayOptions,
  type MultiplexRelayOptions,
  type RelayState,
  DEFAULT_RELAY_CONNECTIVITY_SNAPSHOT,
} from './relay'
export {
  RelayConnectionError,
  RelayManager,
  type RelayClientHandle,
  type RelayEventHandler,
} from './relay-manager'
export {
  SyncEngine,
  type ApiClient,
  type ChangeNotifier,
  type SyncEngineOptions,
} from './sync-engine'
export type {
  AgentStore,
  ClientIndexStore,
  ClientDataStore,
  LocalRoomJoinRequest,
  LocalRoomMember,
  LocalRoomSummary,
  LocalRoomSyncState,
  LocalSessionDeletion,
  RoomStore,
} from './storage'

// Stores
export { useSessionsStore } from './stores/sessions'
export {
  getRuntimeMetricSnapshot,
  incrementRuntimeMetric,
  recordRuntimeDuration,
  resetRuntimeMetrics,
  setRuntimeGauge,
  setRuntimeMetricsEnabled,
  type RuntimeMetricSnapshot,
} from './runtime-metrics'
export { useMachinesStore } from './stores/machines'
export { useProjectsStore } from './stores/projects'
export { useSheetsStore } from './stores/sheets'
export type { PendingAttachment, AttachContext, PickedFile } from './stores/sheets'
export {
  useChatStore,
  envelopeToChatMessage,
  chatMessageToEnvelope,
  isToolMessage,
  PENDING_CHAT_RUN_ID,
  type ToolCall,
  type ChatAttachment,
  type MessageStatus,
  type ErrorInfo,
  type ChatMessage,
  type ChatRunPhase,
} from './stores/chat'
export { createAuthStore, type User, type AuthStorage } from './stores/auth'

// Hooks
export { createUseRelay } from './hooks/useRelay'
export { createUseSync, getSyncEngine, getRelayManager, type UseSyncDeps } from './hooks/useSync'
export { subscribeRelayConnectivity } from './relay-manager-lifecycle'
export { createUseSessionPreviews } from './hooks/useSessionPreviews'
export {
  extractPreviewText,
  buildSessionMessagePreview,
  formatSessionPreviewForDisplay,
  isToolCallPayload,
  trimPreviewText,
  SESSION_PREVIEW_MAX_LEN,
} from './lib/session-preview'

// Lib
export { createApiClient, ApiError, type ApiClientOptions } from './lib/api'
export { generateTraceId, getCurrentTraceId, setCurrentTraceId } from './lib/trace'
export { initLogReporter, reportLog, type LogReportEntry } from './lib/log-reporter'
export {
  AGENT_ABBREV,
  AGENT_DISPLAY_NAME,
  AGENT_HEX,
  AGENT_BADGE_COLORS,
  AGENT_BG_COLORS,
  AGENT_TEXT_COLORS,
  AGENT_RING_COLORS,
  getAgentDisplayName,
  getAgentAbbreviation,
} from './lib/agentTheme'
export {
  getLiveSessionActivitySnapshot,
  SESSION_ACTIVITY_STALE_MS,
  getSessionLiveActivity,
  getSessionListMetaLabel,
  getSessionListSummary,
  getSessionSortActivityAt,
  canSessionUseExternalChannelAgent,
  hasSessionExternalChannel,
  isSessionPinned,
  hasSessionUnread,
  isSessionWorking,
  sortSessions,
  filterManagerSubstrateSessions,
  isManagerWorkerSession,
} from './lib/session-list'
export {
  buildProjectKey,
  filterProjectSessions,
  getProjectDisplayName,
  getProjectDirName,
  groupSessionsIntoProjects,
  sortProjects,
  type SessionProject,
} from './lib/project-list'
export {
  buildEntitlements,
  hasCapability,
  normalizeAccountTier,
  type AccountTier,
  type EntitlementCapabilities,
  type EntitlementKey,
  type UserEntitlements,
} from './lib/entitlements'
export {
  deriveCompactAgentParticipation,
  isAgentRuntimeOffline,
  projectAgentWorkspaceRuntimeUnavailable,
  type CompactAgentParticipation,
} from './lib/agent-participation'
export {
  applyIncomingRoomMessageUnread,
  isOwnHumanRoomMessage,
  type RoomUnreadProjection,
} from './lib/room-unread'
export {
  normalizeAgentWorkspacePermissionPolicy,
  type AgentWorkspaceWithPermissionPolicy,
} from './lib/agent-permissions'

// i18n
export { default as en } from './i18n/en'
export { default as zh } from './i18n/zh'
