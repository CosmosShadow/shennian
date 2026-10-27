// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-run-recovery.test.ts

import { createHash } from 'node:crypto'
import type { AgentRecoveryResult, AgentSendContext } from '../../agents/adapter.js'
import type { SessionManagerRuntime } from '../types.js'
import type { RunJournalRecord } from '../run-recovery/schema.js'
import type { CompiledManagedAgentPolicy } from '../../security/managed-agent-policy.js'
import { buildManagedAgentPermissionPrompt } from '../../room/managed-prompt-composer.js'
import { configureAdapterForSession, replaceManagedRoomContextToken } from './chat-adapter-config.js'
import { createActiveSession } from './chat-session-lifecycle.js'
import { validateManagedRoomExecutionContext, type ChatSendExecutionContext } from './chat.js'

export async function recoverJournaledRun(
  runtime: SessionManagerRuntime,
  record: RunJournalRecord,
  beforeContinueDispatch: () => void = () => {},
): Promise<AgentRecoveryResult> {
  let managedPolicy: CompiledManagedAgentPolicy | null = null
  let managedToken: string | null = null
  let recoverySystemPrompt: string | null = null
  let recoverySendContext: AgentSendContext | undefined

  if (
    record.source === 'managed_room' ||
    record.source === 'managed_direct' ||
    (record.source === 'manager_event' && Boolean(record.managedPolicyVersion))
  ) {
    const prepared = await runtime.prepareManagedRecovery?.(record)
    if (!prepared) {
      return {
        result: 'recovery_failed',
        reason: 'permission_context_unavailable',
        message: 'managed recovery requires a fresh permission context',
      }
    }
    if (
      prepared.agentType !== record.agentType ||
      prepared.sessionMode !== record.sessionMode ||
      runtime.resolvePath(prepared.workDir) !== runtime.resolvePath(record.workDir) ||
      prepared.managedRoomPromptSnapshot.managedRoomPolicyVersion !== record.managedPolicyVersion ||
      prepared.managedRoomPromptSnapshot.runtimePermissionPolicyHash !== record.managedRuntimePolicyHash
    ) {
      runtime.revokeManagedRoomContextToken?.(prepared.managedRoomContextToken)
      return {
        result: 'recovery_failed',
        reason: 'permission_context_unavailable',
        message: 'managed recovery authority no longer matches the interrupted run',
      }
    }
    managedPolicy = prepared.managedAgentPolicy
    if (record.source === 'manager_event' || record.source === 'managed_direct') {
      // Recovery gets a newly issued private capability. Owner direct turns
      // retain send-only access to their bound Room; Worker provenance does
      // not cross a daemon restart.
      managedToken = prepared.managedRoomContextToken
      recoverySystemPrompt = prepared.systemPrompt
      recoverySendContext = {
        source: 'managed_private',
        recovery: 'upgrade',
        modelSelectionSource: 'upgrade_recovery_model',
      }
    } else {
      const context: ChatSendExecutionContext = {
        source: 'room_activation',
        managedAgentPolicy: prepared.managedAgentPolicy,
        managedRoomPromptSnapshot: prepared.managedRoomPromptSnapshot,
      }
      validateManagedRoomExecutionContext(
        context,
        prepared.systemPrompt,
        prepared.managedRoomContextToken,
      )
      managedToken = prepared.managedRoomContextToken
      recoverySystemPrompt = prepared.systemPrompt
      recoverySendContext = {
        ...context,
        recovery: 'upgrade',
        modelSelectionSource: 'upgrade_recovery_model',
      }
    }
  } else if (record.source === 'manager_worker' && !record.managerWorkerNativeFull) {
    const parentSessionId = record.parentSessionId
    managedPolicy = parentSessionId
      ? runtime.managerRuntime?.getManagedAgentPolicyForWorker(parentSessionId, record.workDir) ?? null
      : null
    if (!managedPolicy) {
      return {
        result: 'recovery_failed',
        reason: 'permission_context_unavailable',
        message: 'manager worker recovery requires the current parent policy',
      }
    }
    const currentPolicyHash = createHash('sha256').update(JSON.stringify({
      requestedPolicy: managedPolicy.requestedPolicy,
      enforcement: managedPolicy.enforcement,
    })).digest('hex')
    if (currentPolicyHash !== record.managedRuntimePolicyHash) {
      return {
        result: 'recovery_failed',
        reason: 'permission_context_unavailable',
        message: 'manager worker policy changed after interruption',
      }
    }
    recoverySystemPrompt = buildManagedAgentPermissionPrompt({
      requestedPolicy: managedPolicy.requestedPolicy,
      enforcement: managedPolicy.enforcement,
      resolvedWorkDir: managedPolicy.adapterPolicy.workDir,
    })
  }
  recoverySendContext ??= {
    source: 'upgrade_recovery',
    recovery: 'upgrade',
    modelSelectionSource: 'upgrade_recovery_model',
  }

  let session = runtime.sessions.get(record.sessionId)
  if (!session) {
    session = await createActiveSession(
      runtime,
      record.sessionId,
      record.agentType,
      record.sessionMode,
      record.workDir,
      record.agentSessionId,
      null,
      null,
      managedPolicy,
      record.nativeSessionVisibility,
    )
  }
  if (managedToken || (managedPolicy && (record.source === 'managed_direct' || record.source === 'manager_event'))) {
    replaceManagedRoomContextToken(runtime, session, managedToken ?? '')
    configureAdapterForSession(
      session.adapter,
      record.sessionId,
      record.agentType,
      null,
      null,
      managedToken,
      managedPolicy,
      runtime.managedRoomExecutor,
    )
  }
  session.journalRunId = record.runId
  session.currentRunId = record.providerRunId ?? `recovery:${record.runId}`
  session.currentRunPhase = 'thinking'
  session.lastProviderActivityAt = Date.now()
  if (
    record.agentType === 'codex' &&
    record.deliveryMode === 'external_owner_queue' &&
    record.agentSessionId &&
    record.externalRunId &&
    runtime.nativeFusion?.restoreExternalObservation({
      sessionId: record.sessionId,
      sourceSessionKey: record.agentSessionId,
      runId: record.externalRunId,
      canonicalMessageId: record.clientMessageId,
      createdAt: Date.parse(record.createdAt),
    })
  ) {
    // Codex Desktop owns this Turn and survives a Shennian daemon restart.
    // Resume passive native-history observation instead of enqueueing a
    // synthetic Continue behind work that is still running or already done.
    return { result: 'reattached' }
  }
  return session.adapter.recoverInterruptedRun({
    sessionId: record.sessionId,
    shennianRunId: record.runId,
    workDir: record.workDir,
    agentSessionId: record.agentSessionId,
    modelId: record.modelId,
    reasoningEffort: record.reasoningEffort,
    providerRunId: record.providerRunId,
    lastObservedEventSeq: record.lastObservedEventSeq,
    continueDispatchState: record.continueDispatchState,
    systemPrompt: recoverySystemPrompt,
    sendContext: recoverySendContext,
    beforeContinueDispatch,
  })
}
