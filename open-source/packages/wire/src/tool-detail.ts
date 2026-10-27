// @arch open-source/docs/wire.md
// @test src/__tests__/types.test.ts

import type { PersonalSyncIdentity } from './session-sync.ts'

export const SESSION_TOOL_DETAIL_LIMITS = {
  defaultMaxBytes: 32 * 1024,
  minMaxBytes: 4 * 1024,
  maxMaxBytes: 64 * 1024,
  responseTtlMs: 5 * 60 * 1_000,
  relayTimeoutMs: 15 * 1_000,
} as const

export type ToolDetailStatus = 'available' | 'not_found' | 'unsupported' | 'unavailable'

export type ToolDetailUnavailableReason =
  | 'not_found'
  | 'revision_mismatch'
  | 'machine_offline'
  | 'request_timeout'
  | 'response_too_large'
  | 'unsupported'

export type ToolDetailSource =
  | 'local-session-store'
  | 'local-tool-index'
  | 'native-local-index'
  | 'unavailable'

export type ToolDetailRef = {
  runId?: string
  sourceSeq?: number
  toolIndex?: number
}

export type SessionToolDetailRequest = PersonalSyncIdentity & {
  sessionId: string
  toolCallId: string
  detailRevision: number
  maxBytes?: number
}

export type SessionToolDetailResponse = PersonalSyncIdentity & {
  sessionId: string
  toolCallId: string
  detailRevision: number
  detailStatus: ToolDetailStatus
  status?: 'running' | 'completed' | 'failed'
  command?: string
  argsSummary?: unknown
  result?: string
  resultOmitted: boolean
  redacted: boolean
  byteSize: number
  expiresAt: string
  source: ToolDetailSource
  reason?: ToolDetailUnavailableReason
}
