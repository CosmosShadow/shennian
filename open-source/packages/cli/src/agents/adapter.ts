// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agents-e2e.ts

import type {
  AgentType,
  ChatAttachmentMeta,
  ExternalChannelSessionStatus,
  ModelInfo,
  SessionRunPhase,
} from '@shennian/wire'
import { EventEmitter } from 'node:events'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'
import { RECOVERY_CONTINUE_TEXT } from '../session/run-recovery/schema.js'

export type AgentEvent = {
  state: string
  runId: string
  seq: number
  text?: string
  thinking?: boolean
  runPhase?: SessionRunPhase
  name?: string
  toolCallId?: string
  toolStatus?: 'running' | 'completed' | 'failed'
  args?: Record<string, unknown>
  result?: string
  durationMs?: number
  message?: string
  errorCode?: 'acp_auth_required' | 'auth_required' | 'auth_retrying'
  approval?: {
    title?: string
    content?: string
    source?: string
    actionHint?: string
  }
  permission?: {
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
    questions?: import('@shennian/wire').AgentUserInputQuestion[]
  }
  usage?: { inputTokens: number; outputTokens: number }
  title?: string
  source?: string
  agentSessionId?: string
}

// Shared across every adapter so a tool/item name is judged "needs a user
// decision" the same way regardless of which agent (Codex, Claude, ACP-based
// agents, ...) produced it.
const APPROVAL_LIKE_NAME_PATTERN = /approval|permission|confirm|user[_-]?input|request[_-]?user|ask.*question|exit.*plan/i

export function isApprovalLikeName(name: unknown): boolean {
  if (typeof name !== 'string') return false
  return APPROVAL_LIKE_NAME_PATTERN.test(name)
}

/** Pulls a short human-readable summary out of a tool call's raw input, whatever its shape. */
export function summarizeToolInput(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') return input.trim().slice(0, 600) || undefined
  const record = typeof input === 'object' ? (input as Record<string, unknown>) : null
  if (record) {
    if (Array.isArray(record.questions)) {
      const text = record.questions
        .map((question) =>
          question && typeof question === 'object' ? (question as Record<string, unknown>).question : undefined,
        )
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
      if (text) return text.slice(0, 600)
    }
    const primary = [
      record.question,
      record.command,
      record.file_path,
      record.path,
      record.url,
      record.pattern,
      record.prompt,
      record.reason,
      record.message,
    ].find((value) => typeof value === 'string' && value.trim())
    if (typeof primary === 'string') return primary.trim().slice(0, 600)
  }
  try {
    return JSON.stringify(input).slice(0, 600)
  } catch {
    return undefined
  }
}

export type AgentSendResult = {
  deliveryMode?: 'direct' | 'external_owner_queue'
  queuedSubmissionId?: string
}

export type AgentSendContext = {
  source: 'personal' | 'room_activation' | 'managed_private' | 'published_agent' | 'upgrade_recovery'
  /** Local diagnostic provenance only; never derived from Room/Session identifiers. */
  modelSelectionSource?: import('./pi-turn-diagnostics.js').PiModelSelectionSource
  /** Marks internal recovery input; it must never be persisted as user-authored text. */
  recovery?: 'upgrade'
}

export type AgentActiveInput = {
  text: string
  attachments?: ChatAttachmentMeta[]
  clientMessageId?: string
}

export type ImportedAgentMessage = {
  /** Stable within repeated imports of the same provider session. */
  sourceId: string
  role: 'user' | 'agent'
  payload: string
}

export type AgentSessionOptions = {
  models: ModelInfo[]
  modes: Array<{ id: string; name: string; description?: string }>
}

export type AgentStartOptions = {
  /** Test-only callers can disable provider-native history persistence. */
  persistNativeSession?: boolean
  /** Internal ownership hint, not a guarantee about a third-party client's sidebar. */
  nativeSessionVisibility?: 'user' | 'internal'
}

export type AgentRecoveryCapabilities = {
  inspectTerminal: boolean
  reattachRun: boolean
  resumeRun: boolean
  resumeSession: boolean
}

export type AgentRecoveryInput = {
  sessionId: string
  shennianRunId: string
  workDir: string
  agentSessionId: string | null
  modelId?: string | null
  reasoningEffort?: string | null
  providerRunId: string | null
  lastObservedEventSeq: number
  continueDispatchState: 'none' | 'intent' | 'accepted'
  systemPrompt?: string | null
  sendContext?: AgentSendContext
  /** Durable provider-level de-duplication fence, invoked immediately before Continue. */
  beforeContinueDispatch?: () => void
}

export type AgentRecoveryInspection = {
  state: 'terminal' | 'active' | 'interrupted' | 'unknown'
  providerRunId?: string | null
  runPhase?: SessionRunPhase | null
}

export type AgentRecoveryResult =
  | { result: 'terminal_reconciled' }
  | { result: 'reattached' }
  | { result: 'resumed' }
  | { result: 'continued' }
  | { result: 'interrupted_by_upgrade'; reason: 'resume_unsupported' | 'missing_agent_session' }
  | {
      result: 'recovery_failed'
      reason:
        | 'continue_dispatch_outcome_unknown'
        | 'provider_session_missing'
        | 'provider_identity_mismatch'
        | 'authentication_required'
        | 'permission_context_unavailable'
        | 'provider_error'
      message?: string
    }

export interface AgentAdapterEvents {
  agentEvent: [event: AgentEvent]
  nativeSession: [provider: AgentType, agentSessionId: string]
  /** The provider reported its model/mode choices; read them via getSessionOptions(). */
  sessionOptions: []
  error: [error: Error]
}

/** Adapters emit nativeSession(provider, id) synchronously before sending a turn.
 * The session lifecycle listener durably registers ownership; a listener error
 * must abort the turn, not be swallowed as a best-effort telemetry failure. */
export abstract class AgentAdapter extends EventEmitter<AgentAdapterEvents> {
  abstract readonly type: AgentType

  /** Explicit fail-closed default; resumable adapters must opt in. */
  get recoveryCapabilities(): AgentRecoveryCapabilities {
    return {
      inspectTerminal: false,
      reattachRun: false,
      resumeRun: false,
      resumeSession: false,
    }
  }

  /** Explicit fail-closed capability for adding input to the current provider turn. */
  get supportsActiveInput(): boolean {
    return false
  }
  injectActiveInput?(input: AgentActiveInput): Promise<void>

  configure?(options: {
    sessionId?: string
    codexSettings?: import('@shennian/wire').CodexConversationSettings
    externalChannel?: ExternalChannelSessionStatus | null
    env?: NodeJS.ProcessEnv
    managedAgentPolicy?: CompiledManagedAgentPolicy | null
    managedRoomContextToken?: string | null
    managedRoomExecutor?: ManagedRoomExecutor | null
  }): void
  getStatus?(): Promise<{
    active: boolean
    runId?: string | null
    runPhase?: SessionRunPhase | null
    canStop?: boolean
  }>
  setTitle?(agentSessionId: string, title: string, workDir?: string): Promise<void>
  respondToPermission?(permissionId: string, optionId: string): Promise<void>
  authenticate?(methodId: string): Promise<void>
  hasPendingAuthenticationRetry?(): boolean
  resumeAfterExternalAuthentication?(): Promise<void>
  getSessionOptions?(): AgentSessionOptions
  logout?(): Promise<void>
  listExternalSessions?(options?: { cwd?: string }): Promise<import('@shennian/wire').AcpExternalSessionInfo[]>
  loadExternalSession?(agentSessionId: string): Promise<ImportedAgentMessage[]>
  closeExternalSession?(agentSessionId: string): Promise<void>
  deleteExternalSession?(agentSessionId: string): Promise<void>
  abstract start(
    sessionId: string,
    workDir: string,
    agentSessionId?: string | null,
    options?: AgentStartOptions,
  ): Promise<void>
  prepareSend?(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    systemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void>
  abstract send(
    text: string,
    modelId?: string,
    reasoningEffort?: string,
    attachments?: ChatAttachmentMeta[],
    systemPrompt?: string | null,
    context?: AgentSendContext,
  ): Promise<void | AgentSendResult>
  abstract resume(agentSessionId: string): Promise<void>
  abstract stop(): Promise<void>

  async inspectInterruptedRun(input: AgentRecoveryInput): Promise<AgentRecoveryInspection> {
    if (!this.getStatus) return { state: 'interrupted', providerRunId: input.providerRunId }
    const status = await this.getStatus().catch(() => null)
    if (!status?.active) return { state: 'interrupted', providerRunId: input.providerRunId }
    return {
      state: 'active',
      providerRunId: status.runId ?? input.providerRunId,
      runPhase: status.runPhase,
    }
  }

  /**
   * The coordinator starts this adapter with the exact persisted native
   * Session before calling recoverInterruptedRun. No original prompt/history
   * is accepted by this API, so a recovery cannot accidentally replay it.
   */
  async recoverInterruptedRun(input: AgentRecoveryInput): Promise<AgentRecoveryResult> {
    const inspection = await this.inspectInterruptedRun(input)
    if (inspection.state === 'terminal' && this.recoveryCapabilities.inspectTerminal) {
      return { result: 'terminal_reconciled' }
    }
    if (inspection.state === 'active' && this.recoveryCapabilities.reattachRun) {
      return { result: 'reattached' }
    }
    if (!input.agentSessionId) {
      return { result: 'interrupted_by_upgrade', reason: 'missing_agent_session' }
    }
    if (!this.recoveryCapabilities.resumeSession) {
      return { result: 'interrupted_by_upgrade', reason: 'resume_unsupported' }
    }
    if (input.continueDispatchState !== 'none') {
      return { result: 'recovery_failed', reason: 'continue_dispatch_outcome_unknown' }
    }
    try {
      input.beforeContinueDispatch?.()
      await this.send(
        RECOVERY_CONTINUE_TEXT,
        input.modelId ?? undefined,
        input.reasoningEffort ?? undefined,
        undefined,
        input.systemPrompt,
        input.sendContext,
      )
      return { result: 'continued' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const normalized = message.toLowerCase()
      return {
        result: 'recovery_failed',
        reason: normalized.includes('auth') || normalized.includes('login')
          ? 'authentication_required'
          : normalized.includes('permission') || normalized.includes('capability')
            ? 'permission_context_unavailable'
            : normalized.includes('session') && normalized.includes('not')
              ? 'provider_session_missing'
              : 'provider_error',
        message: message.slice(0, 500),
      }
    }
  }
}

const registry = new Map<AgentType, () => AgentAdapter>()

export function registerAgent(type: AgentType, factory: () => AgentAdapter): void {
  registry.set(type, factory)
}

export function unregisterAgent(type: AgentType): void {
  registry.delete(type)
}

export function createAgent(type: AgentType): AgentAdapter | null {
  const factory = registry.get(type)
  return factory ? factory() : null
}

export function getRegisteredAgents(): AgentType[] {
  return [...registry.keys()]
}
