import type { NativeSessionEventPayload, SessionTitleSource } from '@shennian/wire'

export type NativeRepairHint = 'codex_app_context_wrapper'

export const NATIVE_SCANNER_STATE_SCHEMA_VERSION = 1 as const

export type NativeFileCursor = {
  daemonInstallationId?: string
  offset: number
  mtimeMs: number
  fileIdentity?: string
  classification: 'live' | 'historical'
  awaitingUserBoundary?: boolean
  sessionCreatedAtMs?: number
  eventWatermarkTs?: number
  eventKeysAtWatermark?: string[]
  sourceBoundaryEstablished?: Record<string, boolean>
  sources?: Array<{
    agentType: 'codex' | 'claude' | 'opencode'
    sourceSessionKey: string
  }>
}

export type NativeScannerState = {
  schemaVersion: typeof NATIVE_SCANNER_STATE_SCHEMA_VERSION
  fusionEpochMs: number
  daemonInstallationId: string
  files: Record<string, NativeFileCursor>
  /** Provider-native sessions that are internal implementation details, never personal chats. */
  ignoredSources?: Record<string, true>
  /** Durable provenance for internal sources; retained after runs and sessions retire. */
  internalSourceOwners?: Record<string, { sessionId: string; registeredAt: string }>
  codexWindowsPathParserFixed?: boolean
  codexAppContextWrapperFixed?: boolean
}

export type ParsedNativeEvent = NativeSessionEventPayload & {
  /** Terminal outcome observed in the native source; `terminal` remains the wire-compatible flag. */
  terminalState?: 'completed' | 'failed' | 'aborted'
  repairHint?: NativeRepairHint
  sourceSessionCreatedAtMs?: number
  claimSessionId?: string | null
  canonicalMessageKey?: string
  canonicalMutation?: 'append' | 'upsert'
  localDisposition?: 'managed_echo_suppressed'
  titleSource?: Extract<SessionTitleSource, 'agent_native' | 'first_user_fallback'>
  localToolDetail?: {
    toolCallId: string
    detailRevision: number
    name: string
    args?: unknown
    result?: unknown
    status: 'running' | 'completed' | 'failed'
    durationMs?: number
  }
}

export type PendingManagedClaim = {
  sessionId: string
  agentType: string
  sourceAgentType: 'codex' | 'claude' | 'opencode'
  canonicalMessageId: string
  textHash: string
  createdAt: number
  sourceSessionKey?: string | null
  managedEchoPolicy: 'suppress_following' | 'import_following'
  externalRunId?: string | null
}

export type ExternalOwnerObservation = {
  sessionId: string
  sourceSessionKey: string
  runId: string
  canonicalMessageId: string
  state: 'queued' | 'running'
  createdAt: number
  lastPublishedAt: number
}

export type ManagedSuppressionWindow = {
  sessionId: string
  agentType: 'codex' | 'claude' | 'opencode'
  sourceSessionKey: string
  claimSourceEventKey: string
  startedAt: number
  endsAt: number
}
