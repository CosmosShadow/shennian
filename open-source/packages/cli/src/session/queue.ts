// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts
import { removeQueuedBatch, logQueueLifecycle, markExternalQueued } from './queue-persistence.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { admitProjectTurn, CoordinationWaiting, validateCoordinationSession } from '../project-coordination/admission.js'
import { projectCoordinationStore } from '../project-coordination/store.js'
import { QueueRetryScheduler } from './queue-retry.js'
import {
  findDuplicateQueuedMessage,
  stripLocalQueueFields,
  takeCompatibleBatch,
  formatQueuedBatch,
  dedupeQueuedAttachments,
  classifyQueueError,
  normalizeQueuedModelId,
  resolveManagedRoomNativeSessionId,
  managedDirectTurnOptions,
  SCHEDULED_ROOM_TURN_OPTIONS,
} from './queue-helpers.js'
import {
  CODEX_DESKTOP_SEND_UNAVAILABLE,
  type ChatQueueSnapshot,
  type ReqFrame,
} from '@shennian/wire'
import { isCodexThreadTailInterrupted } from '../native-fusion/codex-files.js'
import type { LocalReqDispatcher } from '../manager/runtime.js'
import type { ActiveSession, SessionManagerRuntime } from './types.js'
import { mergeProjectedSessions } from './projection.js'
import {
  assertFinishedAttachmentReferences,
  markAttachmentReferences,
} from './attachment-transfer-store.js'
import {
  appendMessage,
  getMessageDeliveryStatus,
  listSessionRecords,
  recordSession,
  tombstoneMessage,
  upsertMessage,
} from './store.js'
import { handleQueueDispatchFailure, queueBlockedUntil, resolveQueueRecoveryNotice } from './queue-dispatch-failure.js'
import { resetCommandSpecCache } from '../agents/command-spec.js'
import { requestSessionIndexPublish } from './index-publisher.js'
import type { ManagedRoomTriggerContext } from './turn-trigger.js'
import {
  clearPersistedManagerRoomOrigins,
  purgeQueuedSessionData,
  readQueue,
  writeQueue,
} from './queue-storage.js'
import { parsePersonalAttachmentReferences } from './attachment-reference.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { isStewardSessionId, pinStewardWorkDir } from '../steward/session.js'
import { classifyStewardFailure } from '../steward/failover.js'
import { tryStewardFailover } from './handlers/steward.js'
import { isTrustedManagerEvent } from './manager-event-authority.js'
import {
  getQueueSnapshot,
  handleQueueDelete,
  handleQueueEdit,
  handleQueueGet,
  handleQueuePromote,
} from './queue-control.js'
import {
  TerminalQueuedChatDispatchError,
  queueEnvelope,
  queueMessageFromParams,
  type InternalEnqueueParams,
  type LocalQueuedChatMessage,
} from './queue-message.js'
export { purgeQueuedSessionData } from './queue-storage.js'
export type ManagedRoomQueueContext = ManagedRoomTriggerContext
export type {
  PreparedManagedTurnContext,
  PreparedManagedRoomTurn,
  ManagedRoomEnqueueParams,
  ManagedAgentDirectTurnPreparer,
} from './queue-types.js'
import type {
  PreparedManagedRoomTurn,
  ManagedRoomEnqueueParams,
  ManagedAgentDirectTurnPreparer,
} from './queue-types.js'
export { TerminalQueuedChatDispatchError } from './queue-message.js'
export type { LocalQueuedChatMessage } from './queue-message.js'
export class ChatQueueManager {
  validateScheduledTarget?: (target: {
    sessionId: string
    bindingId?: string
    roomId?: string
  }) => Promise<string>
  async enqueueScheduled(req: ReqFrame): Promise<boolean> {
    return this.handleEnqueue(req, true)
  }
  private draining = new Set<string>()
  private promoting = new Set<string>()
  private disposed = false
  private readonly retries = new QueueRetryScheduler((sessionId) => {
    this.wakeSession(sessionId)
  })
  private readonly deletions = new NativeSourceDeletionStore()
  private inFlightMessageIds = new Map<string, Set<string>>()
  private deferredLogState = new Map<string, { at: number; pendingCount: number }>()
  private prepareManagedRoomTurn:
    | ((contexts: ManagedRoomQueueContext[]) => Promise<PreparedManagedRoomTurn>)
    | null = null
  private prepareManagedAgentDirectTurn: ManagedAgentDirectTurnPreparer | null = null
  constructor(
    private opts: {
      getRuntime: () => SessionManagerRuntime
      dispatchReq: LocalReqDispatcher
      dispatchManagedReq?: (req: ReqFrame, prepared: PreparedManagedRoomTurn) => Promise<void>
      dispatchQueuedReq: (
        req: ReqFrame,
        prepared?: PreparedManagedRoomTurn,
      ) => Promise<void | { deliveryMode?: string; queuedSubmissionId?: string }>
      interruptQueuedSession?: (sessionId: string) => Promise<void>
    },
  ) {
    clearPersistedManagerRoomOrigins()
    const timer = setTimeout(() => this.drainIdleQueues(), 0)
    timer.unref?.()
  }
  stop(): void {
    this.disposed = true
    this.retries.stop()
  }
  getSnapshot(sessionId: string): ChatQueueSnapshot {
    return getQueueSnapshot(
      {
        getRuntime: this.opts.getRuntime,
        inFlightMessageIds: this.inFlightMessageIds,
        broadcast: (id) => this.broadcast(id),
      },
      sessionId,
    )
  }

  private async switchUnavailableSteward(
    sessionId: string,
    message: LocalQueuedChatMessage,
    error: unknown,
  ): Promise<boolean> {
    const text = error instanceof Error ? error.message : String(error)
    // Dispatch failures are retried by design; only "cannot run at all" justifies another AI tool.
    if (classifyStewardFailure(text) === 'crashed' || !message.text) return false
    return tryStewardFailover(
      this.opts.getRuntime(), sessionId, { agentType: message.agentType },
      { state: 'error', runId: '', message: text }, message.text,
    ).catch(() => false)
  }

  private isImmediateSendAvailable(sessionId: string): boolean {
    const runtime = this.opts.getRuntime()
    const active = runtime.sessions.get(sessionId)
    if (!active?.currentRunId) return true
    if (!active.journalRunId) return false
    return runtime.runJournal?.get(sessionId, active.journalRunId)?.deliveryMode === 'direct'
  }

  setManagedRoomTurnPreparer(
    prepare: (contexts: ManagedRoomQueueContext[]) => Promise<PreparedManagedRoomTurn>,
  ): void {
    this.prepareManagedRoomTurn = prepare
  }

  setManagedAgentDirectTurnPreparer(prepare: ManagedAgentDirectTurnPreparer): void {
    this.prepareManagedAgentDirectTurn = prepare
  }

  async enqueueManagedRoomBatch(
    inputs: Array<{
      params: ManagedRoomEnqueueParams
      context: ManagedRoomQueueContext
    }>,
  ): Promise<void> {
    if (inputs.length === 0) return
    const runtime = this.opts.getRuntime()
    const queue = readQueue()
    const touchedSessions = new Set<string>()
    const canonicalMessages = new Map<string, LocalQueuedChatMessage>()
    let queueChanged = false

    for (const input of inputs) {
      const params = input.params
      if (this.deletions.hasSession(params.sessionId)) {
        delete queue.sessions[params.sessionId]
        queueChanged = true
        continue
      }
      if (!params.sessionId || !params.text || !params.agentType || !params.workDir) {
        throw new Error('sessionId, text, agentType and workDir are required')
      }
      const message = queueMessageFromParams({
        ...getPersonalSyncIdentity(getDaemonInstallationId()),
        ...params,
      }) as LocalQueuedChatMessage
      if (
        typeof params.roomMessageCreatedAt === 'string' &&
        Number.isFinite(Date.parse(params.roomMessageCreatedAt))
      ) {
        message.createdAt = new Date(params.roomMessageCreatedAt).toISOString()
      }
      message.origin = 'room'
      message.managedRoom = input.context
      message.trigger = { kind: 'room_activation', ...input.context }
      const pending = queue.sessions[params.sessionId] ?? []
      const duplicate = findDuplicateQueuedMessage(pending, message)
      const messageIdentity = message.clientMessageId ?? message.id
      const existingDelivery = getMessageDeliveryStatus(params.sessionId, messageIdentity)
      if (!duplicate && existingDelivery.state === 'not_found') {
        pending.push(message)
        queue.sessions[params.sessionId] = pending
        canonicalMessages.set(`${message.sessionId}\0${messageIdentity}`, message)
        touchedSessions.add(params.sessionId)
        queueChanged = true
      } else if (duplicate && existingDelivery.state === 'not_found') {
        canonicalMessages.set(`${duplicate.sessionId}\0${messageIdentity}`, duplicate)
        touchedSessions.add(params.sessionId)
      } else if (duplicate && existingDelivery.state === 'queued') {
        touchedSessions.add(params.sessionId)
      } else if (duplicate) {
        const remaining = pending.filter((item) => item.id !== duplicate.id)
        if (remaining.length) queue.sessions[params.sessionId] = remaining
        else delete queue.sessions[params.sessionId]
        queueChanged = true
      }
    }

    if (queueChanged) writeQueue(queue)
    let commitError: unknown
    // A dead or unwritable Session must not strand unrelated recipients after
    // the shared queue rename. Commit/drain independently; failed commits keep
    // their stable queue ID and recover through the scheduler.
    for (const sessionId of touchedSessions) {
      try {
        for (const message of canonicalMessages.values()) {
          if (message.sessionId !== sessionId) continue
          appendMessage(sessionId, queueEnvelope(message), 'queued')
          recordSession({
            sessionId,
            agentType: message.agentType,
            sessionMode: message.sessionMode,
            managerConfig: message.managerConfig,
            workDir: message.workDir,
            agentSessionId: resolveManagedRoomNativeSessionId(runtime, message),
            modelId: message.modelId,
          })
        }
        logQueueLifecycle('enqueue.persisted', sessionId, {
          origin: 'room',
          pendingCount: readQueue().sessions[sessionId]?.length ?? 0,
        })
        this.broadcast(sessionId)
        this.wakeSession(sessionId)
      } catch (error) {
        commitError = error
        logQueueLifecycle(
          'enqueue.commit-failed',
          sessionId,
          {
            failureClass: classifyQueueError(
              error instanceof Error ? error.message : '',
              'canonical_commit_failed',
            ),
          },
          'error',
        )
        this.retries.schedule(sessionId, true)
      }
    }
    if (touchedSessions.size) requestSessionIndexPublish(runtime.client)
    if (commitError) throw commitError
  }

  async handleEnqueue(req: ReqFrame, trustedSchedule = false): Promise<boolean> {
    const runtime = this.opts.getRuntime()
    const submitted = req.params as InternalEnqueueParams
    if (submitted.scheduledTask && !trustedSchedule) throw new Error('schedule_source_untrusted')
    if (
      (submitted.managerEventId ||
        submitted.managerEventRoomOrigin ||
        submitted.managedWorkerParentSessionId ||
        submitted.managerWorkerRoomOrigin ||
        req.params.managerWorkerNativeFull ||
        req.params.managedRecoverySource) &&
      !isTrustedManagerEvent(req)
    ) {
      throw new Error('manager_event_source_untrusted')
    }
    const workerControllerSessionId =
      !trustedSchedule && !submitted.managedWorkerParentSessionId
        ? runtime.managerRuntime?.getWorkerControllerSessionId?.(
            String(submitted.sessionId ?? ''),
            String(submitted.workDir ?? ''),
          )
        : null
    const incomingBase: InternalEnqueueParams = workerControllerSessionId
      ? { ...submitted, managedWorkerParentSessionId: workerControllerSessionId }
      : submitted
    // Steward scope is Relay-attested (or already stored). The daemon, not the phone,
    // decides where a steward runs: the client's workDir is ignored and pinned to the
    // fixed workspace. Dispatch re-derives the scope from the stored record.
    const stewardEnqueue = (
      isStewardSessionId(String(incomingBase.sessionId ?? '')) || incomingBase.sessionScope === 'steward'
    )
    if (stewardEnqueue) {
      if ((incomingBase.sessionMode ?? 'standard') !== 'standard') throw new Error('steward_session_mode_invalid')
      if (!isStewardSessionId(incomingBase.sessionId)
        && listSessionRecords().some((record) => record.sessionId === incomingBase.sessionId)) {
        throw new Error('steward_scope_conflict')
      }
    }
    const incoming: InternalEnqueueParams = stewardEnqueue
      ? { ...incomingBase, workDir: pinStewardWorkDir(), sessionMode: 'standard' }
      : incomingBase
    validateCoordinationSession(runtime, incoming)
    const scheduledManaged = Boolean(trustedSchedule && incoming.scheduledTask?.bindingId)
    mergeProjectedSessions(incoming.sessionListProjection)
    if (!incoming.sessionId || !incoming.text || !incoming.agentType || !incoming.workDir) {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: 'sessionId, text, agentType and workDir are required',
      })
      return false
    }

    const privatePrepareOptions = scheduledManaged
      ? SCHEDULED_ROOM_TURN_OPTIONS
      : managedDirectTurnOptions(
          incoming.managerEventId ? { roomOrigin: incoming.managerEventRoomOrigin } : null,
          Boolean(incoming.managedAgentDirect),
        )
    const preparedDirect =
      incoming.managedAgentDirect || scheduledManaged
        ? await this.prepareManagedAgentDirectTurn?.(incoming.sessionId, privatePrepareOptions)
        : null
    if ((incoming.managedAgentDirect || scheduledManaged) && !preparedDirect) {
      throw new Error('managed_agent_context_unavailable')
    }
    const persisted = preparedDirect
      ? listSessionRecords().find((record) => record.sessionId === incoming.sessionId)
      : null
    const params: InternalEnqueueParams = preparedDirect
      ? {
          ...incoming,
          ...preparedDirect,
          agentType: preparedDirect.agentType,
          sessionMode: preparedDirect.sessionMode,
          managerConfig: preparedDirect.managerConfig,
          workDir: preparedDirect.workDir,
          agentSessionId: preparedDirect.agentSessionId?.startsWith('managed:')
            ? persisted?.agentSessionId && !persisted.agentSessionId.startsWith('managed:')
              ? persisted.agentSessionId
              : null
            : preparedDirect.agentSessionId,
          modelId: preparedDirect.effectiveModelId !== undefined
            ? normalizeQueuedModelId(preparedDirect.effectiveModelId)
            : persisted?.modelId ?? undefined,
          // Private turns use a narrow token and never inherit delivery metadata.
          systemPrompt: preparedDirect.systemPrompt,
          externalChannel: incoming.managedAgentDirect ? null : incoming.externalChannel,
          replyTarget: incoming.managedAgentDirect ? null : incoming.replyTarget,
          managerDefaultWorkerAgentType: preparedDirect.managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId: preparedDirect.managerDefaultWorkerModelId,
        }
      : incoming

    const resolvedWorkDir = runtime.resolvePath(params.workDir)
    const normalizedAttachments = parsePersonalAttachmentReferences(params.attachments)
    if (normalizedAttachments?.length) {
      assertFinishedAttachmentReferences(resolvedWorkDir, normalizedAttachments)
    }
    const materialized = { text: params.text, attachments: normalizedAttachments, localized: false }

    const activeSession = runtime.sessions.get(params.sessionId)
    if (
      params.agentType === 'codex' &&
      params.agentSessionId &&
      activeSession?.currentRunId?.startsWith('dispatch:') &&
      isCodexThreadTailInterrupted(params.agentSessionId)
    ) {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: false,
        error: CODEX_DESKTOP_SEND_UNAVAILABLE,
      })
      return false
    }

    // A managed direct preflight proves the Relay-attested Session still has a
    // local binding and gives us trusted routing fields for the durable record.
    // The capability itself is per-turn: dispatch re-prepares it after the
    // scheduler claims the queue item, so never retain the preflight token.
    if (preparedDirect?.managedRoomContextToken) {
      runtime.revokeManagedRoomContextToken?.(preparedDirect.managedRoomContextToken)
    }

    const isBusy = await this.isSessionBusy(params.sessionId)
    const queue = readQueue()
    const pending = queue.sessions[params.sessionId] ?? []

    const message = queueMessageFromParams({
      ...params,
      text: materialized.text,
      attachments: materialized.attachments,
      // Mutable authorization output is reconstructed at the Provider
      // boundary. Persist only the stable trigger and routing facts.
      systemPrompt: preparedDirect ? null : params.systemPrompt,
    }) as LocalQueuedChatMessage
    if (preparedDirect) {
      if (incoming.managedAgentDirect) message.managedAgentDirect = true
      if (message.trigger?.kind !== 'manager_event' && message.trigger?.kind !== 'scheduled') {
        message.trigger = { kind: 'managed_direct' }
      }
    }
    const messageIdentity = message.clientMessageId ?? message.id
    const existingDelivery = getMessageDeliveryStatus(params.sessionId, messageIdentity)
    if (existingDelivery.state !== 'not_found') {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: true,
        payload: {
          queued: existingDelivery.state === 'queued',
          queueMessageId: message.id,
          ...existingDelivery,
          queue: this.getSnapshot(params.sessionId),
        },
      })
      return true
    }

    // Stable client IDs are idempotency keys for every origin. A prior attempt
    // may have durably renamed the queue file and then failed its canonical
    // commit; reusing that ID must heal the canonical state, not enqueue a
    // second turn. External messages retain body-based dedupe only when they do
    // not carry a stable source ID.
    const duplicate = findDuplicateQueuedMessage(pending, message)
    if (!duplicate) {
      queue.sessions[params.sessionId] = [...pending, message]
      writeQueue(queue)
    }
    const durableMessage = duplicate ?? message
    recordSession({
      sessionId: durableMessage.sessionId,
      agentType: durableMessage.agentType,
      sessionMode: durableMessage.sessionMode,
      managerConfig: durableMessage.managerConfig,
      workDir: durableMessage.workDir,
      agentSessionId: durableMessage.agentSessionId,
      modelId: durableMessage.modelId,
      ...(stewardEnqueue ? { sessionScope: 'steward' as const } : {}),
    })
    appendMessage(durableMessage.sessionId, queueEnvelope(durableMessage), 'queued')
    if (!stewardEnqueue && !durableMessage.managedRoom && !durableMessage.managedAgentDirect) {
      projectCoordinationStore.enqueue(resolvedWorkDir, durableMessage.sessionId, durableMessage.text,
        durableMessage.agentType, durableMessage.clientMessageId ?? durableMessage.id)
    }
    markAttachmentReferences(
      runtime.resolvePath(durableMessage.workDir),
      durableMessage.attachments ?? [],
    )
    requestSessionIndexPublish(runtime.client)
    logQueueLifecycle('enqueue.persisted', params.sessionId, {
      origin: params.origin ?? 'app',
      queueMessageId: durableMessage.id,
      pendingCount: (readQueue().sessions[params.sessionId] ?? []).length,
    })
    this.broadcast(params.sessionId)
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        queued: true,
        queueMessageId: duplicate?.id ?? message.id,
        ...getMessageDeliveryStatus(
          params.sessionId,
          duplicate?.clientMessageId ?? duplicate?.id ?? message.clientMessageId ?? message.id,
        ),
        queue: this.getSnapshot(params.sessionId),
        ...(materialized.localized ? { localizedAttachments: true } : {}),
      },
    })
    if (!isBusy) this.wakeSession(params.sessionId)
    else this.retries.schedule(params.sessionId)
    return true
  }

  async handleGet(req: ReqFrame): Promise<void> {
    await handleQueueGet(this.queueControlContext(), req)
  }

  async handleEdit(req: ReqFrame): Promise<void> {
    await handleQueueEdit(this.queueControlContext(), req)
  }

  async handleDelete(req: ReqFrame): Promise<void> {
    await handleQueueDelete(this.queueControlContext(), req)
  }

  private queueControlContext() {
    return {
      getRuntime: this.opts.getRuntime,
      inFlightMessageIds: this.inFlightMessageIds,
      broadcast: (sessionId: string) => this.broadcast(sessionId),
    }
  }

  async handlePromote(req: ReqFrame): Promise<void> {
    await handleQueuePromote(
      {
        ...this.queueControlContext(),
        promoting: this.promoting,
        draining: this.draining,
        isImmediateSendAvailable: (id) => this.isImmediateSendAvailable(id),
        canInjectActiveBatch: (active, batch) => this.canInjectActiveBatch(active, batch),
        interruptQueuedSession: this.opts.interruptQueuedSession,
        dispatchQueuedMessages: (batch) => this.dispatchQueuedMessages(batch),
        markExternalQueued: (batch, id) => markExternalQueued(batch, id),
        removeBatch: (id, batch) => removeQueuedBatch(id, batch),
        wakeSession: (id) => this.wakeSession(id),
      },
      req,
    )
  }

  isDispatching(sessionId: string): boolean {
    return this.inFlightMessageIds.has(sessionId)
  }

  noteTerminal(sessionId: string): void {
    // A native user boundary normally removes the external-owner projection
    // first. Terminal is the compatibility fallback for older observers that
    // can report completion but not the claim callback.
    const externalQueued = readQueue().sessions[sessionId]?.find((message) =>
      Boolean(message.externalQueuedSubmissionId),
    )
    if (externalQueued) {
      this.noteExternalClaim(sessionId, externalQueued.clientMessageId ?? externalQueued.id)
    }
    this.wakeSession(sessionId)
  }

  purgeSession(sessionId: string): void {
    purgeQueuedSessionData(sessionId)
    this.retries.cancel(sessionId)
  }

  /**
   * Drop Room messages that have not crossed the Provider boundary yet. A
   * paused Binding must not replay messages collected while it was paused when
   * the owner resumes it later. The currently dispatched batch is excluded: it
   * already crossed that boundary and is no longer cancellable as queue work.
   */
  discardPendingManagedRoomMessages(sessionId: string): number {
    if (this.deletions.hasSession(sessionId)) {
      const count = readQueue().sessions[sessionId]?.length ?? 0
      this.purgeSession(sessionId)
      return count
    }
    const queue = readQueue()
    const pending = queue.sessions[sessionId] ?? []
    const inFlight = this.inFlightMessageIds.get(sessionId) ?? new Set<string>()
    const discarded = pending.filter((message) => message.managedRoom && !inFlight.has(message.id))
    if (discarded.length === 0) return 0
    const remaining = pending.filter((message) => !discarded.includes(message))
    if (remaining.length) queue.sessions[sessionId] = remaining
    else delete queue.sessions[sessionId]
    writeQueue(queue)
    for (const message of discarded) {
      tombstoneMessage(sessionId, message.clientMessageId ?? message.id)
    }
    requestSessionIndexPublish(this.opts.getRuntime().client)
    logQueueLifecycle('managed-room.discarded-paused', sessionId, {
      discardedCount: discarded.length,
      pendingCount: remaining.length,
    })
    this.broadcast(sessionId)
    return discarded.length
  }

  private wakeSession(sessionId: string): void {
    void this.drainNext(sessionId).catch(() => {
      logQueueLifecycle('drain.retry-required', sessionId, {}, 'error')
      this.retries.schedule(sessionId, true)
    })
  }

  private drainIdleQueues(): void {
    if (this.disposed) return
    const queue = readQueue()
    for (const sessionId of Object.keys(queue.sessions)) {
      this.wakeSession(sessionId)
    }
  }

  private async drainNext(sessionId: string): Promise<void> {
    if (this.disposed || this.draining.has(sessionId) || this.promoting.has(sessionId)) return
    this.draining.add(sessionId)
    let drainAgain = false
    let transientFailure = false
    let dispatchedBatch: LocalQueuedChatMessage[] = []
    try {
      if (this.deletions.hasSession(sessionId)) {
        this.purgeSession(sessionId)
        return
      }
      if (await this.isSessionBusy(sessionId)) {
        const pendingCount = readQueue().sessions[sessionId]?.length ?? 0
        const previous = this.deferredLogState.get(sessionId)
        const now = Date.now()
        if (!previous || previous.pendingCount !== pendingCount || now - previous.at >= 30_000) {
          logQueueLifecycle('drain.deferred', sessionId, { pendingCount })
          this.deferredLogState.set(sessionId, { at: now, pendingCount })
        }
        return
      }
      this.deferredLogState.delete(sessionId)
      const queue = readQueue()
      const originalPending = queue.sessions[sessionId] ?? []
      const pending = originalPending.filter((message) => {
        const identity = message.clientMessageId ?? message.id
        const state = getMessageDeliveryStatus(sessionId, identity).state
        return state === 'queued' || state === 'not_found'
      })
      if (pending.length !== originalPending.length) {
        if (pending.length) queue.sessions[sessionId] = pending
        else delete queue.sessions[sessionId]
        writeQueue(queue)
        logQueueLifecycle('drain.pruned-terminal', sessionId, {
          prunedCount: originalPending.length - pending.length,
          pendingCount: pending.length,
        })
      }
      // The current Codex owner has already accepted this message into its
      // native queue. Keep the Shennian projection until native fusion sees
      // the real user boundary; dispatching it again after a restart would
      // duplicate the turn.
      if (pending.some((message) => Boolean(message.externalQueuedSubmissionId))) {
        this.broadcast(sessionId)
        return
      }
      const batch = takeCompatibleBatch(pending)
      if (batch.length === 0) {
        this.broadcast(sessionId)
        return
      }
      if (queueBlockedUntil(batch)) return
      // Only configuration blocks (retryAt > 0) can be fixed by re-reading the environment.
      if (batch.some((message) => (message.dispatchBlock?.retryAt ?? 0) > 0)) resetCommandSpecCache()
      dispatchedBatch = batch
      this.inFlightMessageIds.set(sessionId, new Set(batch.map((message) => message.id)))
      logQueueLifecycle('dispatch.start', sessionId, {
        batchCount: batch.length,
        queueMessageId: batch[0]!.id,
        origin: batch[0]!.origin ?? 'app',
      })
      this.broadcast(sessionId)
      for (const message of batch) upsertMessage(sessionId, queueEnvelope(message), 'queued')
      const dispatchResult = await this.dispatchQueuedMessages(batch)
      if (dispatchResult.deliveryMode === 'external_owner_queue') {
        markExternalQueued(batch, dispatchResult.queuedSubmissionId)
        resolveQueueRecoveryNotice(batch)
        if (batch.some((message) => message.dispatchBlock)) requestSessionIndexPublish(this.opts.getRuntime().client)
        logQueueLifecycle('dispatch.external-queued', sessionId, {
          batchCount: batch.length,
          queueMessageId: batch[0]!.id,
        })
        this.broadcast(sessionId)
        return
      }
      const remainingCount = removeQueuedBatch(sessionId, batch)
      resolveQueueRecoveryNotice(batch)
      if (batch.some((message) => message.dispatchBlock)) requestSessionIndexPublish(this.opts.getRuntime().client)
      logQueueLifecycle('dispatch.accepted', sessionId, {
        batchCount: batch.length,
        queueMessageId: batch[0]!.id,
        pendingCount: remainingCount,
      })
      this.deferredLogState.delete(sessionId)
      drainAgain = remainingCount > 0
      this.broadcast(sessionId)
    } catch (error) {
      if (error instanceof CoordinationWaiting) return
      const admitted = dispatchedBatch[0]
      if (admitted) projectCoordinationStore.dispatchFailed(this.opts.getRuntime().resolvePath(admitted.workDir),
        admitted.sessionId, admitted.clientMessageId ?? admitted.id)
      // A steward whose AI tool is not installed / not signed in continues on the next tool.
      const first = dispatchedBatch[0]
      if (first && isStewardSessionId(sessionId) && await this.switchUnavailableSteward(sessionId, first, error)) {
        removeQueuedBatch(sessionId, dispatchedBatch)
        this.broadcast(sessionId)
        return
      }
      const outcome = handleQueueDispatchFailure({
        error, sessionId, batch: dispatchedBatch,
        publish: () => requestSessionIndexPublish(this.opts.getRuntime().client),
        isManagedWorker: Boolean(this.opts.getRuntime().managerRuntime?.isManagedWorkerSession(sessionId)),
        removeBatch: () => removeQueuedBatch(sessionId, dispatchedBatch),
        log: (event, fields) => logQueueLifecycle(event, sessionId, fields, 'error'),
      })
      drainAgain = outcome.drainAgain
      transientFailure = outcome.transientFailure
      this.broadcast(sessionId)
    } finally {
      this.inFlightMessageIds.delete(sessionId)
      this.draining.delete(sessionId)
      const remaining = readQueue().sessions[sessionId] ?? []
      if (remaining.length) {
        this.broadcast(sessionId)
        if (remaining.some((message) => Boolean(message.externalQueuedSubmissionId))) {
          this.retries.cancel(sessionId)
        } else if (drainAgain) queueMicrotask(() => this.wakeSession(sessionId))
        else this.retries.schedule(sessionId, transientFailure, queueBlockedUntil(takeCompatibleBatch(remaining)))
      } else this.retries.cancel(sessionId)
    }
  }

  noteExternalClaim(sessionId: string, canonicalMessageId: string): void {
    const queue = readQueue()
    const pending = queue.sessions[sessionId] ?? []
    const next = pending.filter(
      (message) => (message.clientMessageId ?? message.id) !== canonicalMessageId,
    )
    if (next.length === pending.length) return
    if (next.length) queue.sessions[sessionId] = next
    else delete queue.sessions[sessionId]
    writeQueue(queue)
    this.broadcast(sessionId)
  }

  private canInjectActiveBatch(active: ActiveSession, batch: LocalQueuedChatMessage[]): boolean {
    if (
      !active.adapter.supportsActiveInput ||
      !active.adapter.injectActiveInput ||
      !active.journalRunId
    )
      return false
    const journal = this.opts.getRuntime().runJournal?.get(batch[0]!.sessionId, active.journalRunId)
    // Managed-direct turns rebuild short-lived Room policy at dispatch time;
    // the active journal cannot yet prove that prompt/capability snapshot, so
    // fail closed to stop + new turn rather than mixing authority via steer.
    const expectedSource =
      batch[0]!.trigger?.kind === 'managed_direct' || batch[0]!.managedAgentDirect
        ? null
        : 'personal'
    return Boolean(
      expectedSource &&
      batch[0]!.systemPrompt == null &&
      journal &&
      journal.source === expectedSource &&
      journal.deliveryMode === 'direct' &&
      journal.agentType === batch[0]!.agentType &&
      journal.workDir === active.workDir &&
      journal.agentSessionId === active.agentSessionId &&
      journal.modelId === (batch[0]!.modelId ?? null) &&
      journal.reasoningEffort === (batch[0]!.reasoningEffort ?? null),
    )
  }

  private async dispatchQueuedMessages(
    batch: LocalQueuedChatMessage[],
  ): Promise<{ deliveryMode?: string; queuedSubmissionId?: string }> {
    const first = batch[0]!
    admitProjectTurn(this.opts.getRuntime(), batch, Object.keys(readQueue().sessions))
    const scheduled = first.trigger?.kind === 'scheduled' ? first.trigger : null
    if (
      scheduled &&
      (await this.validateScheduledTarget?.({ sessionId: first.sessionId, ...scheduled })) !==
        'ready'
    ) {
      throw new TerminalQueuedChatDispatchError('schedule_target_unavailable')
    }
    const roomContexts = batch.flatMap((message) => {
      if (message.trigger?.kind === 'room_activation') {
        const { kind: _kind, ...context } = message.trigger
        return [context]
      }
      return !message.trigger && message.managedRoom ? [message.managedRoom] : []
    })
    const managerEvent = batch.find((message) => message.trigger?.kind === 'manager_event')?.trigger
    const ownerManagedDirect = batch.some(
      (message) =>
        message.trigger?.kind === 'managed_direct' || Boolean(message.managedAgentDirect),
    )
    const directManaged = ownerManagedDirect || Boolean(scheduled?.bindingId)
    const workerTrigger = batch.find(
      (message) => message.trigger?.kind === 'manager_worker',
    )?.trigger
    const privateManagedTurn = Boolean(managerEvent?.kind === 'manager_event') || ownerManagedDirect
    const prepared =
      roomContexts.length > 0
        ? await this.prepareManagedRoomTurn?.(roomContexts)
        : directManaged || (managerEvent?.kind === 'manager_event' && !isStewardSessionId(first.sessionId))
          ? await this.prepareManagedAgentDirectTurn?.(
              first.sessionId,
              scheduled?.bindingId
                ? SCHEDULED_ROOM_TURN_OPTIONS
                : managedDirectTurnOptions(
                    managerEvent?.kind === 'manager_event' ? managerEvent : null,
                    ownerManagedDirect,
                  ),
            )
          : undefined
    if (roomContexts.length > 0 && !prepared)
      throw new Error('managed_room_turn_preparer_unavailable')
    if (directManaged && !prepared) throw new Error('managed_agent_context_unavailable')
    if (
      managerEvent?.kind === 'manager_event' &&
      this.opts.getRuntime().managerRuntime?.isManagedRoomBoundManager(first.sessionId) &&
      !prepared
    ) {
      throw new Error('managed_agent_context_unavailable')
    }
    const pendingIds = new Set(
      (readQueue().sessions[first.sessionId] ?? []).map((message) => message.id),
    )
    if (
      this.disposed ||
      this.deletions.hasSession(first.sessionId) ||
      batch.some((message) => !pendingIds.has(message.id))
    ) {
      if (prepared?.managedRoomContextToken) {
        this.opts.getRuntime().revokeManagedRoomContextToken?.(prepared.managedRoomContextToken)
      }
      // Shutdown retains pending work for the replacement daemon; retirement
      // cancels it. Do not conflate the two terminal boundaries.
      if (this.disposed) throw new Error('queue_stopped')
      throw new TerminalQueuedChatDispatchError('queued_dispatch_cancelled')
    }
    const trustedRoom = prepared ?? null
    const trustedRoomManagerConfig =
      trustedRoom?.sessionMode === 'manager' ? trustedRoom.managerConfig : null
    const text = batch.length === 1 ? first.text : formatQueuedBatch(batch)
    const attachments = dedupeQueuedAttachments(
      batch.flatMap((message) => message.attachments ?? []),
    )
    const usePreparedManagerIdentity =
      directManaged || (managerEvent?.kind === 'manager_event' && Boolean(prepared))
    const agentSessionId = usePreparedManagerIdentity
      ? prepared!.agentSessionId?.startsWith('managed:')
        ? resolveManagedRoomNativeSessionId(this.opts.getRuntime(), first)
        : prepared!.agentSessionId
      : roomContexts.length > 0
        ? resolveManagedRoomNativeSessionId(this.opts.getRuntime(), first)
        : (first.agentSessionId ?? null)
    const persisted = prepared
      ? listSessionRecords().find((record) => record.sessionId === first.sessionId)
      : null
    const resolvedModelId =
      prepared?.effectiveModelId !== undefined
        ? normalizeQueuedModelId(prepared.effectiveModelId)
        : normalizeQueuedModelId(persisted?.modelId) ?? normalizeQueuedModelId(first.modelId)
    const modelSelectionSource =
      prepared?.effectiveModelId !== undefined
        ? 'room_effective_model'
        : normalizeQueuedModelId(persisted?.modelId)
          ? 'persisted_session_model'
          : normalizeQueuedModelId(first.modelId)
            ? 'queued_message_model'
            : 'pi_default_model'
    return (
      (await this.opts.dispatchQueuedReq(
        {
          type: 'req',
          id: `queue-send-${first.id}-${Date.now()}`,
          method: 'chat.send',
          params: {
            ...getPersonalSyncIdentity(getDaemonInstallationId()),
            sessionId: first.sessionId,
            text,
            agentType: usePreparedManagerIdentity ? prepared!.agentType : first.agentType,
            // Managed Room mode is resolved again from the current trusted Room
            // context. Never let stale durable queue metadata enable Manager mode.
            sessionMode: trustedRoom?.sessionMode ?? first.sessionMode,
            managerConfig: trustedRoom ? trustedRoomManagerConfig : first.managerConfig,
            workDir: usePreparedManagerIdentity ? prepared!.workDir : first.workDir,
            agentSessionId,
            modelId: resolvedModelId,
            modelSelectionSource,
            // Private prompts omit the full Room auto-reply policy.
            systemPrompt: prepared?.systemPrompt ?? first.systemPrompt ?? null,
            managerDefaultWorkerAgentType: trustedRoom
              ? trustedRoom.managerDefaultWorkerAgentType
              : first.managerDefaultWorkerAgentType,
            managerDefaultWorkerModelId: trustedRoom
              ? trustedRoom.managerDefaultWorkerModelId
              : first.managerDefaultWorkerModelId,
            reasoningEffort: first.reasoningEffort ?? undefined,
            clientMessageId: first.clientMessageId ?? first.id,
            attachments,
            externalChannel: privateManagedTurn ? undefined : first.externalChannel,
            replyTarget: privateManagedTurn ? undefined : first.replyTarget,
            roomContextRegistryKey: privateManagedTurn
              ? undefined
              : prepared?.roomContextRegistryKey,
            activationCauseMessageId: privateManagedTurn
              ? undefined
              : roomContexts.at(-1)?.causeMessageId,
            rootCauseMessageId: privateManagedTurn
              ? undefined
              : roomContexts.at(-1)?.rootCauseMessageId,
            activationSequence: privateManagedTurn ? undefined : roomContexts.at(-1)?.sequence,
            activationHopCount: privateManagedTurn ? undefined : roomContexts.at(-1)?.hopCount,
            managedRecoverySource:
              managerEvent?.kind === 'manager_event'
                ? 'manager_event'
                : directManaged
                  ? 'managed_direct'
                  : roomContexts.length > 0
                    ? 'managed_room'
                    : undefined,
            managerEventId:
              managerEvent?.kind === 'manager_event' ? managerEvent.eventId : undefined,
            managedWorkerParentSessionId:
              workerTrigger?.kind === 'manager_worker' ? workerTrigger.parentSessionId : undefined,
            managerWorkerRoomOrigin:
              workerTrigger?.kind === 'manager_worker' ? workerTrigger.roomOrigin : undefined,
            managerWorkerNativeFull:
              workerTrigger?.kind === 'manager_worker'
                ? this.opts
                    .getRuntime()
                    .managerRuntime?.isExternalWorkerController(
                      workerTrigger.parentSessionId,
                      first.workDir,
                    ) || undefined
                : undefined,
            // Private tokens expose Manager tools; Room actions remain restricted.
            managedRoomContextToken: prepared?.managedRoomContextToken,
            scheduledDelivery: Boolean(scheduled),
            suppressExternalOwnerEcho: roomContexts.length > 0 || Boolean(scheduled) || undefined,
            queuedBatchItems: batch.map((message) => {
              const publicMessage = stripLocalQueueFields(message)
              return privateManagedTurn
                ? {
                    ...publicMessage,
                    systemPrompt: prepared?.systemPrompt ?? null,
                    externalChannel: null,
                    replyTarget: null,
                  }
                : publicMessage
            }),
            waitForDispatch: true,
          },
        },
        prepared ?? undefined,
      )) ?? {}
    )
  }

  private async isSessionBusy(sessionId: string): Promise<boolean> {
    const barrier = this.opts.getRuntime().recoveryBarrier
    if (barrier?.isDispatchFrozen() || barrier?.isRecovering(sessionId)) return true
    const active = this.opts.getRuntime().sessions.get(sessionId)
    if (!active) return false
    if (active.currentRunId) {
      const canRecoverStaleDispatch =
        active.currentRunId.startsWith('dispatch:') &&
        Boolean(this.opts.getRuntime().runJournal) &&
        !active.journalRunId
      if (!canRecoverStaleDispatch) return true
      const status = active.adapter.getStatus
        ? await active.adapter.getStatus().catch(() => null)
        : null
      if (status?.active) return true
      logQueueLifecycle('drain.recovered-stale-dispatch', sessionId, {
        staleRunId: active.currentRunId,
      })
      active.currentRunId = null
      active.currentRunPhase = null
    }
    if (!active.adapter.getStatus) return false
    const status = await active.adapter.getStatus().catch(() => null)
    if (!status?.active) return false
    if (status.runId) {
      active.currentRunId = status.runId
      active.currentRunPhase = status.runPhase ?? active.currentRunPhase
    }
    return true
  }

  private broadcast(sessionId: string): void {
    this.opts.getRuntime().client.sendEvent({
      type: 'event',
      event: 'session.queue.update',
      payload: { queue: this.getSnapshot(sessionId) },
    })
  }
}
