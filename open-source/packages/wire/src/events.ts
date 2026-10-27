import type { Envelope } from './envelope.ts'
import type { SessionRunPhase } from './session.ts'
import type { ToolDetailRef } from './tool-detail.ts'

export type AgentEventPayload =
  | { state: 'init'; sessionId?: string; agentSessionId?: string; runId: string; seq: number }
  | { state: 'start'; sessionId?: string; agentSessionId?: string; runId: string; seq: number }
  | { state: 'heartbeat'; sessionId?: string; runId: string; seq: number; runPhase: SessionRunPhase; canStop?: boolean }
  | { state: 'delta'; sessionId?: string; runId: string; seq: number; text?: string; thinking?: boolean }
  | { state: 'final'; sessionId?: string; agentSessionId?: string; runId: string; seq: number; messageSummary?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { state: 'aborted'; sessionId?: string; runId: string; seq: number }
  | { state: 'error'; sessionId?: string; runId: string; seq: number; message: string; errorCode?: 'acp_auth_required' }
  | { state: 'interrupted_by_upgrade'; sessionId?: string; runId: string; seq: number; reason: string }
  | { state: 'recovery_failed'; sessionId?: string; runId: string; seq: number; reason: string; message?: string }
  | { state: 'approval-pending'; sessionId?: string; runId: string; seq: number; approval?: { title?: string; content?: string; source?: string; actionHint?: string }; permission?: AcpPermissionPrompt }
  | { state: 'tool-call'; sessionId?: string; runId: string; seq: number; name: string; toolCallId?: string; toolStatus?: 'running' | 'completed' | 'failed'; args?: Record<string, unknown>; detailRef?: ToolDetailRef; durationMs?: number }
  | { state: 'tool-result'; sessionId?: string; runId: string; seq: number; name: string; toolCallId?: string; toolStatus?: 'running' | 'completed' | 'failed'; result?: string; detailRef?: ToolDetailRef; durationMs?: number }
  | { state: 'notify'; source: string; text: string }
  | { state: 'history-chunk'; sessionId: string; messages: Envelope[]; hasMore: boolean }
  | { state: 'history-done'; sessionId: string; total: number }

export type AcpPermissionPrompt = {
  id: string
  sessionId?: string
  agentSessionId?: string
  runId?: string
  toolCallId: string
  options: Array<{
    id: string
    name: string
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
  }>
  /** Optional structured input; old clients can still display the approval text. */
  questions?: AgentUserInputQuestion[]
}

export type AgentUserInputQuestion = {
  id: string
  question: string
  header?: string
  isOther?: boolean
  isSecret?: boolean
  options?: Array<{ label: string; description?: string }>
}
