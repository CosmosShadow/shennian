// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/run-recovery-journal.test.ts

import { isAvailableAgentType, type AgentType, type SessionMode } from '@shennian/wire'

export const RUN_JOURNAL_SCHEMA_VERSION = 1 as const
export const RECOVERY_CONTINUE_TEXT = 'Continue.' as const

export type RunJournalPhase =
  | 'dispatching'
  | 'running'
  | 'waiting_approval'
  | 'recovering'
  | 'terminal'
  | 'interrupted_by_upgrade'
  | 'recovery_failed'
  | 'aborted'

export type RunRecoverySource = 'personal' | 'managed_room' | 'managed_direct' | 'manager_event' | 'manager_worker'

export type ContinueDispatchState = 'none' | 'intent' | 'accepted'
export type RunDeliveryMode = 'direct' | 'external_owner_queue'

export type RunJournalRecord = {
  schemaVersion: typeof RUN_JOURNAL_SCHEMA_VERSION
  daemonInstallationId: string
  sessionId: string
  runId: string
  clientMessageId: string
  agentType: AgentType
  sessionMode: SessionMode
  workDir: string
  agentSessionId: string | null
  modelId: string | null
  reasoningEffort: string | null
  nativeSessionVisibility: 'user' | 'internal'
  providerRunId: string | null
  lastObservedEventSeq: number
  phase: RunJournalPhase
  source: RunRecoverySource
  parentSessionId: string | null
  /** Public Skill workers use the host's normal full-access provider policy. */
  managerWorkerNativeFull?: boolean
  roomContextRegistryKey: string | null
  activationCauseMessageId: string | null
  rootCauseMessageId: string | null
  activationSequence: string | null
  activationHopCount: number | null
  managedPolicyVersion?: string | null
  managedRuntimePolicyHash?: string | null
  upgradeJobId: string | null
  interruptionReason: 'daemon_crash' | 'planned_upgrade' | 'os_restart' | null
  continueDispatchState: ContinueDispatchState
  deliveryMode: RunDeliveryMode
  externalRunId: string | null
  recoveryAttempts: number
  /** Non-sensitive stable reason used to replay a pending terminal commit. */
  recoveryReason?: string | null
  createdAt: string
  updatedAt: string
}

const PHASES = new Set<RunJournalPhase>([
  'dispatching',
  'running',
  'waiting_approval',
  'recovering',
  'terminal',
  'interrupted_by_upgrade',
  'recovery_failed',
  'aborted',
])
const SOURCES = new Set<RunRecoverySource>([
  'personal',
  'managed_room',
  'managed_direct',
  'manager_event',
  'manager_worker',
])
const CONTINUE_STATES = new Set<ContinueDispatchState>(['none', 'intent', 'accepted'])
const SESSION_MODES = new Set<SessionMode>(['standard', 'manager'])

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${field}`)
  return value
}

function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid ${field}`)
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!Number.isFinite(Date.parse(result))) throw new Error(`invalid ${field}`)
  return result
}

/** Strict parsing keeps corrupt or future records out of the recovery path. */
export function parseRunJournalRecord(value: unknown): RunJournalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid run journal record')
  }
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== RUN_JOURNAL_SCHEMA_VERSION) {
    throw new Error(`unsupported run journal schema: ${String(input.schemaVersion)}`)
  }
  const agentType = requiredString(input.agentType, 'agentType')
  if (!isAvailableAgentType(agentType)) throw new Error('invalid agentType')
  if (!PHASES.has(input.phase as RunJournalPhase)) throw new Error('invalid phase')
  if (!SOURCES.has(input.source as RunRecoverySource)) throw new Error('invalid source')
  if (!CONTINUE_STATES.has(input.continueDispatchState as ContinueDispatchState)) {
    throw new Error('invalid continueDispatchState')
  }
  if (
    input.deliveryMode != null &&
    input.deliveryMode !== 'direct' &&
    input.deliveryMode !== 'external_owner_queue'
  ) throw new Error('invalid deliveryMode')
  if (!SESSION_MODES.has(input.sessionMode as SessionMode)) throw new Error('invalid sessionMode')
  if (!Number.isSafeInteger(input.lastObservedEventSeq) || Number(input.lastObservedEventSeq) < -1) {
    throw new Error('invalid lastObservedEventSeq')
  }
  if (!Number.isSafeInteger(input.recoveryAttempts) || Number(input.recoveryAttempts) < 0) {
    throw new Error('invalid recoveryAttempts')
  }
  if (input.activationHopCount != null && (
    !Number.isSafeInteger(input.activationHopCount) || Number(input.activationHopCount) < 0
  )) throw new Error('invalid activationHopCount')
  if (input.source === 'managed_room' && (
    !input.roomContextRegistryKey ||
    !input.activationCauseMessageId ||
    !input.rootCauseMessageId ||
    !input.activationSequence ||
    input.activationHopCount == null ||
    !input.managedPolicyVersion ||
    !input.managedRuntimePolicyHash
  )) throw new Error('managed room recovery identity is incomplete')
  if (input.source === 'manager_worker' && (
    !input.parentSessionId || (!input.managerWorkerNativeFull && !input.managedRuntimePolicyHash)
  )) {
    throw new Error('manager worker recovery identity is incomplete')
  }
  const reason = input.interruptionReason
  if (reason != null && reason !== 'daemon_crash' && reason !== 'planned_upgrade' && reason !== 'os_restart') {
    throw new Error('invalid interruptionReason')
  }
  return {
    schemaVersion: RUN_JOURNAL_SCHEMA_VERSION,
    daemonInstallationId: requiredString(input.daemonInstallationId, 'daemonInstallationId'),
    sessionId: requiredString(input.sessionId, 'sessionId'),
    runId: requiredString(input.runId, 'runId'),
    clientMessageId: requiredString(input.clientMessageId, 'clientMessageId'),
    agentType: agentType as AgentType,
    sessionMode: input.sessionMode as SessionMode,
    workDir: requiredString(input.workDir, 'workDir'),
    agentSessionId: optionalString(input.agentSessionId, 'agentSessionId'),
    modelId: optionalString(input.modelId, 'modelId'),
    reasoningEffort: optionalString(input.reasoningEffort, 'reasoningEffort'),
    nativeSessionVisibility: input.nativeSessionVisibility === 'internal' ? 'internal' : 'user',
    providerRunId: optionalString(input.providerRunId, 'providerRunId'),
    lastObservedEventSeq: Number(input.lastObservedEventSeq),
    phase: input.phase as RunJournalPhase,
    source: input.source as RunRecoverySource,
    parentSessionId: optionalString(input.parentSessionId, 'parentSessionId'),
    managerWorkerNativeFull: input.managerWorkerNativeFull === true,
    roomContextRegistryKey: optionalString(input.roomContextRegistryKey, 'roomContextRegistryKey'),
    activationCauseMessageId: optionalString(input.activationCauseMessageId, 'activationCauseMessageId'),
    rootCauseMessageId: optionalString(input.rootCauseMessageId, 'rootCauseMessageId'),
    activationSequence: optionalString(input.activationSequence, 'activationSequence'),
    activationHopCount: input.activationHopCount == null ? null : Number(input.activationHopCount),
    managedPolicyVersion: optionalString(input.managedPolicyVersion, 'managedPolicyVersion'),
    managedRuntimePolicyHash: optionalString(input.managedRuntimePolicyHash, 'managedRuntimePolicyHash'),
    upgradeJobId: optionalString(input.upgradeJobId, 'upgradeJobId'),
    interruptionReason: reason as RunJournalRecord['interruptionReason'],
    continueDispatchState: input.continueDispatchState as ContinueDispatchState,
    // Schema v1 records written before delivery ownership was persisted all
    // used adapter recovery, so keep that compatibility path for old files.
    deliveryMode: input.deliveryMode === 'external_owner_queue'
      ? 'external_owner_queue'
      : 'direct',
    externalRunId: optionalString(input.externalRunId, 'externalRunId'),
    recoveryAttempts: Number(input.recoveryAttempts),
    recoveryReason: optionalString(input.recoveryReason, 'recoveryReason'),
    createdAt: timestamp(input.createdAt, 'createdAt'),
    updatedAt: timestamp(input.updatedAt, 'updatedAt'),
  }
}

export function isRecoverableJournalPhase(phase: RunJournalPhase): boolean {
  return phase === 'dispatching' || phase === 'running' || phase === 'waiting_approval' || phase === 'recovering'
}
