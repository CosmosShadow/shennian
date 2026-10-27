// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import {
  buildUserMessagePayload,
  type AgentType,
  type ExternalChannelSessionStatus,
  type QueuedChatMessage,
  type ReqFrame,
  type SessionDeliveryState,
  type SessionDurableSendAck,
  type SessionListProjection,
  type SessionMode,
} from '@shennian/wire'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import type { AgentSendResult } from '../../agents/adapter.js'
import { reportLog } from '../../log-reporter.js'
import type { ManagedWorkerRoomOrigin } from '../../manager/registry.js'
import { getPersonalSyncIdentity } from '../../personal-sync/epoch.js'
import { buildManagedAgentPermissionPrompt } from '../../room/managed-prompt-composer.js'
import { parsePersonalAttachmentReferences } from '../attachment-reference.js'
import {
  assertFinishedAttachmentReferences,
  markAttachmentReferences,
} from '../attachment-transfer-store.js'
import { requestSessionIndexPublish } from '../index-publisher.js'
import { isTrustedManagerEvent } from '../manager-event-authority.js'
import { mergeProjectedSessions } from '../projection.js'
import {
  appendMessage,
  getDaemonInstallationId,
  getMessageDeliveryStatus,
  listSessionRecords,
  recordSession,
  upsertMessage,
} from '../store.js'
import {
  STEWARD_SYSTEM_PROMPT,
  isStewardSessionId,
  pinStewardWorkDir,
} from '../../steward/session.js'
import { rememberStewardTurn, takeStewardHandover } from '../../steward/failover.js'
import type { ActiveSession, SessionManagerRuntime } from '../types.js'
import {
  configureAdapterForSession,
  maybeResolveClaudeImportedWorkDir,
  replaceManagedRoomContextToken,
  revokeManagedRoomContextToken,
} from './chat-adapter-config.js'
import {
  resolveNativeSessionVisibility,
  sendSessionUpdateEvent,
  validateManagedRoomExecutionContext,
  type ChatSendExecutionContext,
} from './chat-context.js'
import { getNativeSourceAgentType } from './chat-events.js'
import { emitSyntheticAbort } from './chat-abort.js'
import {
  createActiveSession,
  disposeSession,
  prepareAdapterTurn,
  rememberProcessedReqId,
  sendAdapterTurn,
} from './chat-session-lifecycle.js'
export {
  sendSessionUpdateEvent,
  validateManagedRoomExecutionContext,
  type ChatSendExecutionContext,
} from './chat-context.js'

function formatAgentSendFailure(agentType: AgentType, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return `Agent send failed: ${raw}`
}




export async function handleChatSend(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
  context?: ChatSendExecutionContext,
): Promise<void> {
  const managedRoomToken = context
    ? ((req.params as { managedRoomContextToken?: string | null }).managedRoomContextToken ?? null)
    : null
  let transferredToTurn = false
  try {
    await handleChatSendImpl(runtime, req, context, () => {
      transferredToTurn = true
    })
  } finally {
    if (managedRoomToken && !transferredToTurn) {
      runtime.revokeManagedRoomContextToken?.(managedRoomToken)
    }
  }
}

async function handleChatSendImpl(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
  context: ChatSendExecutionContext | undefined,
  transferManagedRoomTokenToTurn: () => void,
): Promise<void> {
  if (runtime.processedReqIds.has(req.id)) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true })
    return
  }

  const {
    sessionId,
    text,
    agentType,
    sessionMode: incomingSessionMode,
    managerConfig,
    workDir,
    agentSessionId: incomingAgentSid,
    modelId,
    modelSelectionSource,
    systemPrompt,
    managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId,
    reasoningEffort,
    clientMessageId,
    sessionListProjection,
    waitForDispatch,
    responseId,
    managedRoomContextToken,
    suppressExternalOwnerEcho,
    queuedBatchItems,
    managedWorkerParentSessionId,
    managerWorkerRoomOrigin,
    managerWorkerNativeFull,
    managedRecoverySource,
  } = req.params as {
    sessionId: string
    text: string
    agentType: string
    sessionMode?: SessionMode
    managerConfig?: import('@shennian/wire').ManagerConfig | null
    workDir: string
    agentSessionId?: string | null
    modelId?: string
    modelSelectionSource?: import('../../agents/pi-turn-diagnostics.js').PiModelSelectionSource
    systemPrompt?: string | null
    managerDefaultWorkerAgentType?: AgentType | null
    managerDefaultWorkerModelId?: string | null
    reasoningEffort?: string | null
    clientMessageId?: string
    sessionListProjection?: SessionListProjection[]
    waitForDispatch?: boolean
    responseId?: string
    roomContextRegistryKey?: string | null
    managedRoomContextToken?: string | null
    suppressExternalOwnerEcho?: boolean
    queuedBatchItems?: QueuedChatMessage[]
    managedWorkerParentSessionId?: string
    managerWorkerRoomOrigin?: ManagedWorkerRoomOrigin
    managerWorkerNativeFull?: boolean
    managedRecoverySource?: 'managed_room' | 'managed_direct' | 'manager_event'
    externalChannel?: ExternalChannelSessionStatus | null
    replyTarget?: string | null
  }
  const replyId = responseId || req.id
  const internalManagerParams = req.params as Record<string, unknown>
  if ((
    internalManagerParams.managerEventId || internalManagerParams.managerEventRoomOrigin ||
    managedWorkerParentSessionId || managerWorkerRoomOrigin || managerWorkerNativeFull || managedRecoverySource
  ) && !isTrustedManagerEvent(req)) throw new Error('manager_event_source_untrusted')
  mergeProjectedSessions(sessionListProjection)
  const incomingExternalChannel = null
  const incomingReplyTarget = ''

  if (context?.source === 'room_activation') {
    validateManagedRoomExecutionContext(context, systemPrompt, managedRoomContextToken)
    if (agentType === 'manager') {
      throw new Error('managed_agent_manager_mode_unsupported')
    }
  }
  if (context?.source === 'manager_event') {
    if (!context.managedAgentPolicy) throw new Error('managed_agent_policy_missing')
    if (context.standalone) {
      if (managedRoomContextToken || !systemPrompt?.trim()) throw new Error('standalone_agent_context_invalid')
    } else if (!managedRoomContextToken || !/^mrc_[A-Za-z0-9_-]{43}$/.test(managedRoomContextToken)) {
      throw new Error('managed_room_context_unavailable')
    }
  }

  rememberProcessedReqId(runtime, req.id)

  if (!sessionId || !text) {
    runtime.processedReqIds.delete(req.id)
    runtime.client.sendRes({
      type: 'res',
      id: replyId,
      ok: false,
      error: 'sessionId and text are required',
    })
    return
  }

  if (runtime.recoveryBarrier?.isDispatchFrozen()) {
    runtime.processedReqIds.delete(req.id)
    runtime.client.sendRes({
      type: 'res',
      id: replyId,
      ok: false,
      error: 'upgrade_in_progress',
    })
    return
  }
  if (runtime.recoveryBarrier?.isRecovering(sessionId)) {
    await runtime.recoveryBarrier.wait(sessionId)
  }

  const requestedAgentType = agentType as AgentType
  const requestedSessionMode: SessionMode =
    requestedAgentType === 'manager' || incomingSessionMode === 'manager' ? 'manager' : 'standard'
  if (requestedSessionMode === 'manager') {
    runtime.managerRuntime?.setManagerWorkerDefaults(
      sessionId,
      managerDefaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId ?? null,
    )
  }
  const resolvedReasoningEffort =
    (requestedAgentType === 'claude' ||
      requestedAgentType === 'codex' ||
      requestedAgentType === 'workbuddy' ||
      requestedAgentType === 'pi-coding-agent' ||
      requestedAgentType.startsWith('acp:')) &&
    typeof reasoningEffort === 'string' &&
    reasoningEffort.trim()
      ? reasoningEffort.trim()
      : undefined
  const adapterSendContext = context?.source === 'room_activation'
    ? {
        source: 'room_activation' as const,
        ...(requestedAgentType === 'pi-coding-agent'
          ? { modelSelectionSource: modelSelectionSource ?? (modelId ? 'request_model' : 'pi_default_model') }
          : {}),
      }
    : context?.source === 'manager_event'
      ? {
          source: 'managed_private' as const,
          ...(requestedAgentType === 'pi-coding-agent'
            ? { modelSelectionSource: modelSelectionSource ?? (modelId ? 'request_model' : 'pi_default_model') }
            : {}),
        }
      : requestedAgentType === 'pi-coding-agent'
        ? {
            source: 'personal' as const,
            modelSelectionSource: modelSelectionSource ?? (modelId ? 'request_model' : 'pi_default_model'),
          }
        : undefined
  // The steward's directory is pinned by the daemon; the client's workDir is ignored.
  const stewardRequested = isStewardSessionId(sessionId) ||
    (req.params as Record<string, unknown>).sessionScope === 'steward'
  const resolvedWorkDir = stewardRequested
    ? pinStewardWorkDir()
    : runtime.resolvePath(
      maybeResolveClaudeImportedWorkDir(
        requestedAgentType,
        workDir || os.homedir(),
        incomingAgentSid,
      ) || os.homedir(),
    )
  const inheritedManagedAgentPolicy = context?.managedAgentPolicy ?? (
    managedWorkerParentSessionId
      ? runtime.managerRuntime?.getManagedAgentPolicyForWorker(
          managedWorkerParentSessionId,
          resolvedWorkDir,
        ) ?? null
      : null
  )
  if (managedWorkerParentSessionId && !managerWorkerNativeFull && !inheritedManagedAgentPolicy) {
    throw new Error('managed_worker_permission_context_unavailable')
  }
  // Steward scope is attested by the Relay from the Server session row (or already
  // stored locally); it is never taken from the client's own claim.
  const stewardSession = stewardRequested
  if (stewardSession) {
    if (requestedSessionMode !== 'standard') throw new Error('steward_session_mode_invalid')
    if (!isStewardSessionId(sessionId) && listSessionRecords().some((record) => record.sessionId === sessionId)) {
      throw new Error('steward_scope_conflict')
    }
    if (!isStewardSessionId(sessionId)) {
      recordSession({ sessionId, agentType: requestedAgentType, workDir: pinStewardWorkDir(), sessionScope: 'steward' })
    }
  }
  const nativeSessionVisibility = resolveNativeSessionVisibility(
    sessionId, requestedAgentType, requestedSessionMode,
    !(context?.source === 'manager_event' && context.standalone) &&
      Boolean(inheritedManagedAgentPolicy || managedWorkerParentSessionId || context),
  )
  if (stewardSession) rememberStewardTurn(sessionId, String(text ?? ''))
  const resolvedSystemPrompt = stewardSession
    ? [STEWARD_SYSTEM_PROMPT, takeStewardHandover(sessionId)].filter(Boolean).join('\n')
    : managedWorkerParentSessionId && inheritedManagedAgentPolicy
    ? buildManagedAgentPermissionPrompt({
        requestedPolicy: inheritedManagedAgentPolicy.requestedPolicy,
        enforcement: inheritedManagedAgentPolicy.enforcement,
        resolvedWorkDir: inheritedManagedAgentPolicy.adapterPolicy.workDir,
      })
    : systemPrompt ?? null
  const displayWorkDir = resolvedWorkDir
  const normalizedAttachments = parsePersonalAttachmentReferences(
    (req.params as Record<string, unknown>).attachments,
  )
  if (normalizedAttachments?.length) {
    assertFinishedAttachmentReferences(resolvedWorkDir, normalizedAttachments)
  }
  const materializedAttachments = {
    text,
    attachments: normalizedAttachments,
    localized: false,
  }
  let session = runtime.sessions.get(sessionId)

  if (session) {
    session.lastActiveAt = Date.now()
    const sessionDrifted =
      session.agentType !== requestedAgentType ||
      (session.sessionMode ?? (session.agentType === 'manager' ? 'manager' : 'standard')) !==
        requestedSessionMode ||
      session.workDir !== resolvedWorkDir ||
      (session.sessionScope === 'steward') !== stewardSession ||
      (session.nativeSessionVisibility ?? 'user') !== nativeSessionVisibility ||
      JSON.stringify(session.externalChannel ?? null) !==
        JSON.stringify(incomingExternalChannel ?? null)

    if (sessionDrifted) {
      runtime.sessions.delete(sessionId)
      try {
        await disposeSession(runtime, session)
      } catch {
        runtime.processedReqIds.delete(req.id)
      }
      session = undefined
    } else if (incomingAgentSid && session.agentSessionId !== incomingAgentSid) {
      try {
        await session.adapter.resume(incomingAgentSid)
        session.agentSessionId = incomingAgentSid
      } catch {
        runtime.sessions.delete(sessionId)
        try {
          await disposeSession(runtime, session)
        } catch {
          runtime.processedReqIds.delete(req.id)
        }
        session = undefined
      }
    }
  }

  if (!session) {
    try {
      session = await createActiveSession(
        runtime,
        sessionId,
        requestedAgentType,
        requestedSessionMode,
        resolvedWorkDir,
        incomingAgentSid,
        incomingExternalChannel,
        incomingReplyTarget,
        inheritedManagedAgentPolicy,
        nativeSessionVisibility,
      )
    } catch (err) {
      const message =
        err instanceof Error && err.message.startsWith('Unsupported agent:')
          ? err.message
          : `Failed to start ${agentType}: ${err instanceof Error ? err.message : String(err)}`
      console.error(
        `[chat.send] start failed reqId=${req.id} sessionId=${sessionId} agentType=${agentType} workDir=${resolvedWorkDir} agentSessionId=${incomingAgentSid ?? ''}: ${message}`,
      )
      runtime.client.sendEvent({
        type: 'event',
        event: 'agent',
        payload: {
          state: 'error',
          sessionId,
          message,
          runId: '',
          seq: 0,
        },
      })
      runtime.processedReqIds.delete(req.id)
      runtime.client.sendRes({
        type: 'res',
        id: replyId,
        ok: false,
        error: message,
      })
      return
    }
  }

  const userEnvelope = {
    id: clientMessageId ?? `user-${req.id}`,
    sessionId,
    role: req.params.scheduledDelivery === true ? 'agent' : 'user',
    ts: Date.now(),
    payload: req.params.scheduledDelivery === true ? '' : buildUserMessagePayload(
      materializedAttachments.text,
      materializedAttachments.attachments as typeof normalizedAttachments,
    ),
  } as const
  const queuedBatchEnvelopes =
    Array.isArray(queuedBatchItems) && queuedBatchItems.length > 0
      ? queuedBatchItems.map((message) => ({
          id: message.clientMessageId ?? message.id,
          sessionId,
          role: managedRecoverySource === 'manager_event' || req.params.scheduledDelivery === true ? 'agent' as const : 'user' as const,
          // Room inputs appear as soon as they are durably received and retain
          // the authoritative Room timestamp even when Provider execution waits.
          ts: managedRecoverySource === 'manager_event' || context?.source === 'room_activation'
            ? Date.parse(message.createdAt)
            : userEnvelope.ts,
          payload: req.params.scheduledDelivery === true ? '' : buildUserMessagePayload(message.text, message.attachments),
        }))
      : null
  // Scheduled input retains only an invisible receipt for retry deduplication.
  const committedUserEnvelopes = queuedBatchEnvelopes ?? [userEnvelope]
  const existingDelivery = getMessageDeliveryStatus(sessionId, userEnvelope.id)
  const resumingQueuedMessage = existingDelivery.state === 'queued'
  if (existingDelivery.state !== 'not_found' && !resumingQueuedMessage) {
    runtime.client.sendRes({ type: 'res', id: replyId, ok: true, payload: existingDelivery })
    return
  }

  // A reused built-in steward may outlive its 30-minute schedule grant.
  // Refresh only on an authenticated new turn, never by accepting an expired IPC grant.
  if (stewardSession && requestedAgentType === 'shennian') {
    configureAdapterForSession(session.adapter, sessionId, requestedAgentType)
  }

  if (waitForDispatch) {
    if (context?.source === 'room_activation' || context?.source === 'manager_event') {
      // Codex prepareSend may start app-server and create the managed thread.
      // Bind the per-turn Room tools before that preparation so the thread is
      // created with the fail-closed dynamic tool surface already available.
      configureAdapterForSession(
        session.adapter,
        sessionId,
        requestedAgentType,
        incomingExternalChannel,
        incomingReplyTarget,
        managedRoomContextToken,
        context.managedAgentPolicy,
        runtime.managedRoomExecutor,
      )
    }
    try {
      await prepareAdapterTurn(
        session.adapter,
        materializedAttachments.text,
        modelId,
        resolvedReasoningEffort,
        materializedAttachments.attachments as typeof normalizedAttachments,
        resolvedSystemPrompt,
        adapterSendContext,
      )
    } catch (error) {
      runtime.processedReqIds.delete(req.id)
      runtime.sessions.delete(sessionId)
      await disposeSession(runtime, session)
      runtime.client.sendRes({
        type: 'res',
        id: replyId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
  }
  reportLog({
    level: 'info',
    sessionId,
    wsEvent: 'chat.send.start',
    metadata: {
      reqId: req.id,
      agentType: requestedAgentType,
      sessionMode: requestedSessionMode,
      managerConfig: managerConfig ?? null,
      modelId,
      managerDefaultWorkerAgentType: managerDefaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId: managerDefaultWorkerModelId ?? null,
      reasoningEffort: resolvedReasoningEffort,
      ...(context?.source === 'room_activation'
        ? { managedRoomPromptSnapshot: context.managedRoomPromptSnapshot }
        : {}),
    },
  })

  const durableAck = (
    deliveryState: SessionDeliveryState,
    bodyRevision: number,
  ): SessionDurableSendAck => ({
    ...getPersonalSyncIdentity(getDaemonInstallationId()),
    sessionId,
    clientMessageId: userEnvelope.id,
    messageId: userEnvelope.id,
    deliveryState,
    bodyRevision,
    committedAt: new Date(userEnvelope.ts).toISOString(),
  })
  const registerManagedClaim = (sendResult?: AgentSendResult): void => {
    runtime.nativeFusion?.registerManagedSend({
      sessionId,
      agentType: requestedAgentType,
      sourceAgentType: getNativeSourceAgentType(requestedAgentType, modelId),
      canonicalMessageId: userEnvelope.id,
      sourceSessionKey: session.agentSessionId ?? incomingAgentSid ?? null,
      text: materializedAttachments.text,
      managedEchoPolicy:
        sendResult?.deliveryMode === 'external_owner_queue' && !suppressExternalOwnerEcho
          ? 'import_following'
          : 'suppress_following',
      externalRunId:
        sendResult?.deliveryMode === 'external_owner_queue'
          ? `codex-external-${sendResult.queuedSubmissionId ?? userEnvelope.id}`
          : null,
    })
  }
  const markDispatchPending = (): void => {
    if (session.currentRunId) return
    session.currentRunId = `dispatch:${req.id}`
    session.currentRunPhase = 'thinking'
    session.nextEventSeq = 0
    session.lastProviderActivityAt = Date.now()
  }
  const beginRunJournal = (): void => {
    if (!runtime.runJournal || session.journalRunId) return
    const journalRunId = `run:${randomUUID()}`
    runtime.runJournal.begin({
      daemonInstallationId: getDaemonInstallationId(),
      sessionId,
      runId: journalRunId,
      clientMessageId: userEnvelope.id,
      agentType: requestedAgentType,
      sessionMode: requestedSessionMode,
      workDir: resolvedWorkDir,
      agentSessionId: session.agentSessionId ?? incomingAgentSid ?? null,
      modelId: modelId ?? null,
      reasoningEffort: resolvedReasoningEffort ?? null,
      nativeSessionVisibility,
      providerRunId: null,
      source: managedRecoverySource === 'manager_event'
        ? 'manager_event'
        : managedRecoverySource === 'managed_direct'
          ? 'managed_direct'
          : context?.source === 'room_activation' ? 'managed_room'
          : managedWorkerParentSessionId
          ? 'manager_worker'
          : 'personal',
      parentSessionId: managedWorkerParentSessionId ?? null,
      managerWorkerNativeFull: managerWorkerNativeFull === true,
      roomContextRegistryKey: typeof req.params.roomContextRegistryKey === 'string'
        ? req.params.roomContextRegistryKey
        : null,
      activationCauseMessageId: typeof req.params.activationCauseMessageId === 'string'
        ? req.params.activationCauseMessageId
        : null,
      rootCauseMessageId: typeof req.params.rootCauseMessageId === 'string'
        ? req.params.rootCauseMessageId
        : null,
      activationSequence: typeof req.params.activationSequence === 'string'
        ? req.params.activationSequence
        : null,
      activationHopCount: typeof req.params.activationHopCount === 'number'
        ? req.params.activationHopCount
        : null,
      managedPolicyVersion:
        context?.source === 'room_activation'
          ? context.managedRoomPromptSnapshot.managedRoomPolicyVersion
          : context?.source === 'manager_event'
            ? context.managedRoomPolicyVersion
          : null,
      managedRuntimePolicyHash: (context?.source === 'room_activation'
        ? context.managedRoomPromptSnapshot.runtimePermissionPolicyHash
        : context?.source === 'manager_event'
          ? context.managedRuntimePolicyHash
        : null) ?? (
        inheritedManagedAgentPolicy
          ? createHash('sha256').update(JSON.stringify({
              requestedPolicy: inheritedManagedAgentPolicy.requestedPolicy,
              enforcement: inheritedManagedAgentPolicy.enforcement,
            })).digest('hex')
          : null
      ),
    })
    session.journalRunId = journalRunId
  }
  const commitUserBeforeDispatch = (): SessionDurableSendAck => {
    registerManagedClaim()
    if (resumingQueuedMessage) {
      // Persist the dispatch timestamp before the adapter emits its start or
      // reply events. Waiting for its ACK briefly exposes the old queue time.
      let primaryBodyRevision = 0
      for (const [index, envelope] of committedUserEnvelopes.entries()) {
        const revision = upsertMessage(sessionId, envelope, 'queued')
        if (index === 0) primaryBodyRevision = revision
      }
      return durableAck('queued', primaryBodyRevision)
    }
    try {
      sendSessionUpdateEvent(runtime, {
        sessionId,
        agentType: requestedAgentType,
        sessionMode: requestedSessionMode,
        managerConfig: managerConfig ?? null,
        workDir: displayWorkDir,
        agentSessionId: session.agentSessionId ?? incomingAgentSid ?? null,
        modelId,
        managerDefaultWorkerAgentType: managerDefaultWorkerAgentType ?? null,
        managerDefaultWorkerModelId: managerDefaultWorkerModelId ?? null,
      })
      let primaryBodyRevision = 0
      for (const [index, envelope] of committedUserEnvelopes.entries()) {
        const bodyRevision = queuedBatchEnvelopes
          ? upsertMessage(sessionId, envelope, 'committed')
          : appendMessage(sessionId, envelope, 'committed')
        if (index === 0) primaryBodyRevision = bodyRevision
      }
      markAttachmentReferences(resolvedWorkDir, normalizedAttachments ?? [])
      requestSessionIndexPublish(runtime.client)
      return durableAck('committed', primaryBodyRevision)
    } catch (error) {
      runtime.nativeFusion?.cancelManagedSend?.(userEnvelope.id)
      throw error
    }
  }
  const persistRunDelivery = (sendResult?: AgentSendResult): void => {
    if (!session.journalRunId) return
    runtime.runJournal?.update(sessionId, session.journalRunId, {
      deliveryMode: sendResult?.deliveryMode === 'external_owner_queue'
        ? 'external_owner_queue'
        : 'direct',
      externalRunId: sendResult?.deliveryMode === 'external_owner_queue'
        ? `codex-external-${sendResult.queuedSubmissionId ?? userEnvelope.id}`
        : null,
    })
  }
  const markAccepted = (sendResult?: AgentSendResult): SessionDurableSendAck => {
    // Some adapters (notably Codex app-server) emit `start` synchronously
    // during `send()` before chat.send has acknowledged dispatch. Do not wipe
    // that live run state here, or later chat.enqueue calls will think the
    // session is idle and bypass the daemon queue.
    if (!session.currentRunId) {
      session.nextEventSeq = 0
    }
    persistRunDelivery(sendResult)
    registerManagedClaim(sendResult)
    const state: SessionDeliveryState =
      sendResult?.deliveryMode === 'external_owner_queue' ? 'queued' : 'executing'
    let primaryBodyRevision = 0
    for (const [index, envelope] of committedUserEnvelopes.entries()) {
      const bodyRevision = upsertMessage(sessionId, envelope, state)
      if (index === 0) primaryBodyRevision = bodyRevision
    }
    requestSessionIndexPublish(runtime.client)
    return durableAck(state, primaryBodyRevision)
  }
  const handleSendFailure = async (err: unknown, respondToReq: boolean) => {
    runtime.nativeFusion?.cancelManagedSend?.(userEnvelope.id)
    const message = formatAgentSendFailure(requestedAgentType, err)
    console.error(
      `[chat.send] send failed reqId=${req.id} sessionId=${sessionId} agentType=${agentType} workDir=${resolvedWorkDir} agentSessionId=${session.agentSessionId ?? incomingAgentSid ?? ''}: ${message}`,
    )
    const pendingAuthentication = session.adapter.hasPendingAuthenticationRetry?.() === true
    if (pendingAuthentication) {
      // Keep the live adapter and committed user action so protocol-driven auth can
      // reinitialize the same ACP client and retry that action exactly once.
      if (respondToReq) {
        runtime.client.sendRes({
          type: 'res',
          id: replyId,
          ok: true,
          payload: durableAck('queued', 0),
        })
      }
      return
    }
    runtime.sessions.delete(sessionId)
    if (session.journalRunId) {
      runtime.runJournal?.update(sessionId, session.journalRunId, { phase: 'terminal' })
      runtime.runJournal?.remove(sessionId, session.journalRunId)
      runtime.recoveryBarrier?.end(sessionId)
      session.journalRunId = null
    }
    try {
      await disposeSession(runtime, session)
    } catch {
      /* best-effort cleanup */
    }
    runtime.client.sendEvent({
      type: 'event',
      event: 'agent',
      payload: {
        state: 'error',
        sessionId,
        message,
        runId: '',
        seq: 0,
      },
    })
    if (!respondToReq) {
      const errorEnvelope = {
        id: `agent-error-${req.id}-${Date.now()}`,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: message,
      } as const
      appendMessage(sessionId, errorEnvelope)
      requestSessionIndexPublish(runtime.client)
    }
    if (respondToReq) {
      runtime.processedReqIds.delete(req.id)
      runtime.client.sendRes({
        type: 'res',
        id: replyId,
        ok: false,
        error: message,
      })
    }
  }

  if (waitForDispatch) {
    try {
      commitUserBeforeDispatch()
    } catch (err) {
      runtime.processedReqIds.delete(req.id)
      runtime.client.sendRes({
        type: 'res',
        id: replyId,
        ok: false,
        error: `Durable message commit failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }
    // The journal is the durable evidence that a Provider turn exists. Never
    // expose a blocking dispatch:* state before that evidence is committed.
    beginRunJournal()
    markDispatchPending()
    let sendResult: void | AgentSendResult
    try {
      if (context?.source === 'room_activation' || context?.source === 'manager_event') {
        replaceManagedRoomContextToken(runtime, session, managedRoomContextToken!)
        transferManagedRoomTokenToTurn()
      }
      const attachments = materializedAttachments.attachments as typeof normalizedAttachments
      if (managedWorkerParentSessionId) runtime.managerRuntime?.prepareWorkerTurnOrigin(sessionId, managerWorkerRoomOrigin)
      sendResult = await sendAdapterTurn(
        session.adapter,
        materializedAttachments.text,
        modelId,
        resolvedReasoningEffort,
        attachments,
        resolvedSystemPrompt,
        adapterSendContext,
      )
      reportLog({
        level: 'info',
        sessionId,
        wsEvent: 'chat.send.done',
        metadata: { reqId: req.id },
      })
    } catch (err) {
      if (managedWorkerParentSessionId) runtime.managerRuntime?.prepareWorkerTurnOrigin(sessionId)
      if (session.adapter.hasPendingAuthenticationRetry?.()) {
        let queuedRevision = 0
        for (const [index, envelope] of committedUserEnvelopes.entries()) {
          const bodyRevision = upsertMessage(sessionId, envelope, 'queued')
          if (index === 0) queuedRevision = bodyRevision
        }
        requestSessionIndexPublish(runtime.client)
        await handleSendFailure(err, false)
        runtime.client.sendRes({
          type: 'res',
          id: replyId,
          ok: true,
          payload: durableAck('queued', queuedRevision),
        })
        return
      }
      let failedRevision = 0
      for (const [index, envelope] of committedUserEnvelopes.entries()) {
        const bodyRevision = upsertMessage(sessionId, envelope, 'failed')
        if (index === 0) failedRevision = bodyRevision
      }
      requestSessionIndexPublish(runtime.client)
      const failureMessage = formatAgentSendFailure(requestedAgentType, err)
      await handleSendFailure(err, false)
      runtime.client.sendRes({
        type: 'res',
        id: replyId,
        ok: true,
        payload: {
          ...durableAck('failed', failedRevision),
          failureMessage,
        },
      })
      return
    }
    const ack = markAccepted(sendResult ?? undefined)
    runtime.client.sendRes({
      type: 'res',
      id: replyId,
      ok: true,
      payload: {
        ...ack,
        ...(materializedAttachments.localized ? { localizedAttachments: true } : {}),
        ...(sendResult?.deliveryMode === 'external_owner_queue'
          ? {
              queued: true,
              deliveryMode: sendResult.deliveryMode,
              queuedSubmissionId: sendResult.queuedSubmissionId,
            }
          : {}),
      },
    })
    reportLog({
      level: 'info',
      sessionId,
      wsEvent: 'chat.send.res',
      metadata: { reqId: req.id, ok: true },
    })
    return
  }

  let committedAck: SessionDurableSendAck
  try {
    committedAck = commitUserBeforeDispatch()
  } catch (err) {
    runtime.processedReqIds.delete(req.id)
    runtime.client.sendRes({
      type: 'res',
      id: replyId,
      ok: false,
      error: `Durable message commit failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }
  beginRunJournal()
  markDispatchPending()
  if (context?.source === 'room_activation' || context?.source === 'manager_event') {
    configureAdapterForSession(
      session.adapter,
      sessionId,
      requestedAgentType,
      incomingExternalChannel,
      incomingReplyTarget,
      managedRoomContextToken,
      context.managedAgentPolicy,
      runtime.managedRoomExecutor,
    )
    replaceManagedRoomContextToken(runtime, session, managedRoomContextToken!)
    transferManagedRoomTokenToTurn()
  }
  markAccepted()
  runtime.client.sendRes({
    type: 'res',
    id: replyId,
    ok: true,
    payload: {
      ...committedAck,
      ...(materializedAttachments.localized ? { localizedAttachments: true } : {}),
    },
  })
  reportLog({
    level: 'info',
    sessionId,
    wsEvent: 'chat.send.res',
    metadata: { reqId: req.id, ok: true },
  })

  const asyncAttachments = materializedAttachments.attachments as typeof normalizedAttachments
  if (managedWorkerParentSessionId) runtime.managerRuntime?.prepareWorkerTurnOrigin(sessionId, managerWorkerRoomOrigin)
  const sendPromise = sendAdapterTurn(
    session.adapter,
    materializedAttachments.text,
    modelId,
    resolvedReasoningEffort,
    asyncAttachments,
    resolvedSystemPrompt,
    adapterSendContext,
  )
  void sendPromise
    .then((sendResult) => {
      if (sendResult?.deliveryMode === 'external_owner_queue') {
        persistRunDelivery(sendResult)
        registerManagedClaim(sendResult)
        for (const envelope of committedUserEnvelopes) {
          upsertMessage(sessionId, envelope, 'queued')
        }
        requestSessionIndexPublish(runtime.client)
      }
      reportLog({
        level: 'info',
        sessionId,
        wsEvent: 'chat.send.done',
        metadata: { reqId: req.id },
      })
    })
    .catch((err) => {
      if (managedWorkerParentSessionId) runtime.managerRuntime?.prepareWorkerTurnOrigin(sessionId)
      upsertMessage(
        sessionId,
        userEnvelope,
        session.adapter.hasPendingAuthenticationRetry?.() ? 'queued' : 'failed',
      )
      requestSessionIndexPublish(runtime.client)
      void handleSendFailure(err, false)
    })
}

// A stuck Agent may not answer "stop" either. Past this the run is ended by force so the user is
// never left with a Stop button that does nothing.
export const STOP_TIMEOUT_MS = 20_000

async function stopWithinDeadline(session: ActiveSession, timeoutMs: number): Promise<'stopped' | 'timed_out'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), timeoutMs)
  })
  try {
    return await Promise.race([session.adapter.stop().then(() => 'stopped' as const), deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function handleChatAbort(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
  stopTimeoutMs = STOP_TIMEOUT_MS,
): Promise<void> {
  const { sessionId, discardPending } = req.params as {
    sessionId: string
    discardPending?: boolean
  }
  const session = runtime.sessions.get(sessionId)
  if (session) {
    if (session.journalRunId) {
      runtime.runJournal?.markAborted(sessionId, session.journalRunId)
    }
    // Revoke the daemon-side Turn capability before waiting for the Agent to
    // acknowledge interruption. No new Room action may start during stop.
    revokeManagedRoomContextToken(runtime, session)
    let outcome: 'stopped' | 'timed_out'
    try {
      outcome = await stopWithinDeadline(session, stopTimeoutMs)
    } catch {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: 'agent_stop_failed',
      })
      return
    }
    const stoppedRunId = session.currentRunId
    emitSyntheticAbort(runtime, sessionId)
    if (outcome === 'timed_out') {
      // Forget the unresponsive Agent. Its shutdown keeps running in the background and any late
      // output from it is no longer routed here; the next message starts a fresh Agent process.
      runtime.sessions.delete(sessionId)
      session.adapter.removeAllListeners()
      void session.adapter.stop().catch(() => {})
      console.error(`[chat.abort] agent did not stop within ${stopTimeoutMs}ms; ended the run by force sessionId=${sessionId}`)
      upsertMessage(sessionId, {
        id: `stop-forced-${stoppedRunId ?? req.id}`,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: 'AI 没有响应“停止”请求，神念已强制结束这一轮。可以直接发送新消息继续；如果反复出现，请检查这台电脑上该 AI 的运行状态。',
      })
      requestSessionIndexPublish(runtime.client)
    }
    runtime.activityPublisher?.publish(sessionId, null)
  }
  if (discardPending === true) runtime.chatQueue?.purgeSession(sessionId)
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true })
}
