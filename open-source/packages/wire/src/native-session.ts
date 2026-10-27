export type NativeSessionSourceMode =
  | 'codex_rollout_import'
  | 'claude_transcript_import'
  | 'opencode_session_import'
  | 'managed_echo_claim'

export type NativeSessionEventPayload = {
  agentType: 'codex' | 'claude' | 'opencode'
  sourceMode: NativeSessionSourceMode
  sourceSessionKey: string
  sourceEventKey: string
  cursor?: string | null
  role: 'user' | 'agent'
  ts: number
  payload: string
  title?: string
  modelId?: string | null
  workDir?: string
  claimCanonicalMessageId?: string | null
  managedEchoPolicy?: 'suppress_following' | 'import_following'
  terminal?: boolean
}

export type NativeSessionImportBatch = {
  events: NativeSessionEventPayload[]
}
