import { usePendingComposerCards } from './usePendingComposerCards'
import { withStewardContext } from '../../steward/contextualSteward'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/chat-screen-utils.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Keyboard } from 'react-native'
import * as Crypto from 'expo-crypto'
import {
  useChatStore,
  useMachinesStore,
  useSessionsStore,
  type ChatMessage,
} from '@shennian/shared'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type ChatQueueSnapshot,
  type PersonalSyncIdentity,
  type SessionDurableSendAck,
} from '@shennian/wire'
import { ensureLocalSession } from '../../sessions/ensureLocalSession'
import { hasExpectedPersonalSyncIdentity, toPersistedDraftAttachments, toPersonalAttachmentReferences, toDraftUploadTasks, samePersistedDraft } from '../utils/sendDraft'
import { useAuthStore } from '../../../config/auth'
import { applySessionActivity } from '../../../config/sync'
import { composeAttachmentMessageContent, stripAttachmentRefs } from '../utils/attachments'
import {
  shouldRestoreComposerAfterSendError,
  shouldKeepPendingRunAfterAck,
  buildSessionPreview,
  PENDING_RUN_ACK_GRACE_MS,
} from '../utils/screen'
import { buildChatSendParams } from '../utils/sendParams'
import { getChatDraft, removeChatDraft, saveChatDraft } from '../utils/draftStorage'
import {
  flushChatOutboundStorage,
  getChatOutboundMessages,
  removeChatOutboundMessage,
  saveChatOutboundAck,
  saveChatOutboundMessage,
  subscribeChatOutboundMessages,
  type ChatOutboundMessage,
} from '../utils/outboundStorage'
import {
  recoverOrRetryDurableSend,
  requestChatAbort,
  sendWithDurableRecovery,
} from '../utils/durableSend'
import { mutateActiveChatSession } from '../utils/activeSessionMutation'
import { usePersonalAiDataConsent } from '../../privacy/useAiDataConsent'
import { restoreFailedSendDraft } from '../utils/failedSendDraft'
import {
  useChatOutboundRecovery, type PendingSendState, type QueuedMessageEditState,
  type HandleSendOptions, type Options,
} from './useChatOutboundRecovery'
export type { UploadTaskLike } from './useChatOutboundRecovery'

export function useChatSendController({
  agentType,
  sessionMode,
  currentRunId: _currentRunId,
  input, messageContext,
  isTyping,
  isUploading,
  machineId,
  messages,
  pendingAttachments,
  relayState,
  replacePendingAttachments,
  sessionAgentSessionId,
  sessionId,
  setInput,
  startPendingRun,
  clearPendingRun,
  clearPendingAttachments,
  addMessage,
  onMessageSubmitted,
  onSendRejected,
  updateMessageStatus,
  updateMessageError,
  send,
  textInputRef,
  voicePhase,
  workDir,
  modelId,
  systemPrompt,
  managerDefaultWorkerAgentType,
  managerDefaultWorkerModelId,
  reasoningEffort,
  sessionListProjection,
  externalChannel,
}: Options) {
  const requestPersonalAiDataConsent = usePersonalAiDataConsent()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const isLocalDraft = useSessionsStore((state) => state.sessions.find((s) => s.id === sessionId)?.localCreationState === 'draft')
  const daemonInstallationId = useMachinesStore((state) =>
    machineId
      ? state.machines.find((machine) => machine.id === machineId)?.daemonInstallationId ?? null
      : null,
  )
  const targetMachineOffline = useMachinesStore((state) =>
    machineId ? state.machines.find((machine) => machine.id === machineId)?.online === false : false,
  )
  const personalSyncIdentity = useMemo<PersonalSyncIdentity | null>(
    () => daemonInstallationId ? ({
      protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      daemonInstallationId,
    }) : null,
    [daemonInstallationId],
  )
  const [draftReadySessionId, setDraftReadySessionId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [queuedMessageEdit, setQueuedMessageEdit] = useState<QueuedMessageEditState | null>(null)
  const [queueAction, setQueueAction] = useState<{ id: string; kind: 'delete' | 'promote' } | null>(null)
  const [queueActionFailed, setQueueActionFailed] = useState(false)
  const [outboundRevision, setOutboundRevision] = useState(0)
  // Sends made while the Agent is busy show as a pending card from the tap,
  // before the daemon ACK returns the real queue snapshot.
  const [optimisticSends, setOptimisticSends] = useState<Array<{ sessionId: string; message: ChatMessage }>>([])
  const queueSnapshot = useChatStore((state) => state.queue)
  const sendingRef = useRef(false)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRunFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingClearedInputRef = useRef<string | null>(null)
  const pendingSendRef = useRef<PendingSendState | null>(null)
  // The first idle send briefly exists in durable storage before the daemon
  // claims it. Suppress that internal hand-off even if snapshots race.
  const transientIdleDispatchIdsRef = useRef(new Set<string>())
  const composerRef = useRef({ text: input, attachments: pendingAttachments })
  composerRef.current = { text: input, attachments: pendingAttachments }

  useEffect(
    () => subscribeChatOutboundMessages(() => setOutboundRevision((revision) => revision + 1)),
    [],
  )

  const cancelPendingRunFallback = useCallback(() => {
    if (!pendingRunFallbackRef.current) return
    clearTimeout(pendingRunFallbackRef.current)
    pendingRunFallbackRef.current = null
  }, [])

  // The ACK only proves the message is durable. The optimistic running state
  // must survive until the daemon's first real activity replaces it, so the
  // Stop button never flickers back to Send. This timer is the escape hatch
  // for a run that never reports activity (no-op once a real run took over).
  const armPendingRunFallback = useCallback((sessionId: string) => {
    cancelPendingRunFallback()
    pendingRunFallbackRef.current = setTimeout(() => {
      pendingRunFallbackRef.current = null
      mutateActiveChatSession(sessionId, (state) => state.clearPendingRun())
    }, PENDING_RUN_ACK_GRACE_MS)
  }, [cancelPendingRunFallback])

  useEffect(() => cancelPendingRunFallback, [cancelPendingRunFallback])

  const localPendingOutbound = useMemo(
    () => sessionId
      ? getChatOutboundMessages(accountId, sessionId).filter(
          (message) => message.deliveryState === 'local_pending',
        )
      : [],
    [accountId, outboundRevision, sessionId],
  )

  useEffect(() => {
    transientIdleDispatchIdsRef.current.clear()
  }, [sessionId])

  const restoreRejectedSend = useCallback((pending: PendingSendState) => {
    const active = useChatStore.getState().sessionId === pending.sessionId
    const draft = restoreFailedSendDraft(
      accountId, pending.sessionId, pending.userMsg, pending.draft,
      active ? composerRef.current : undefined,
    )
    if (!active) return
    pendingClearedInputRef.current = null
    composerRef.current = draft
    setInput(draft.text)
    replacePendingAttachments(draft.attachments)
  }, [accountId, replacePendingAttachments, setInput])

  useEffect(() => {
    if (isLocalDraft || !sessionId || !personalSyncIdentity || relayState !== 'connected') return
    let cancelled = false
    send({
      type: 'req',
      method: 'chat.queue.get',
      params: { ...personalSyncIdentity, sessionId },
    })
      .then((response) => {
        if (cancelled) return
        const res = response as { ok?: boolean; payload?: { queue?: ChatQueueSnapshot } }
        if (
          res.ok && res.payload?.queue &&
          hasExpectedPersonalSyncIdentity(res.payload.queue, personalSyncIdentity)
        ) {
          useChatStore.getState().setQueue(res.payload.queue)
        }
      })
      .catch((err) => {
        console.debug?.('[ChatSend] queue snapshot refresh failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [isLocalDraft, personalSyncIdentity, relayState, send, sessionId])

  useEffect(() => {
    if (!sessionId) return
    for (const message of getChatOutboundMessages(accountId, sessionId)) {
      // Old versions kept rejected (never committed) sends as failed placeholders.
      if (message.deliveryState === 'failed' && !message.messageId) {
        restoreFailedSendDraft(accountId, sessionId, message)
        continue
      }
      // A process restart loses the in-flight create Promise, not the outbox item.
      // Surface a retry using the same IDs instead of leaving an eternal sending bubble.
      const restored = message.status === 'sending' && message.deliveryState === 'sending'
        ? { ...message, status: 'uncertain' as const }
        : message
      mutateActiveChatSession(sessionId, (state) => state.upsertMessage(restored))
    }
  }, [accountId, isLocalDraft, sessionId])

  useEffect(() => {
    if (!sessionId) {
      setQueuedMessageEdit(null)
      pendingClearedInputRef.current = null
      setInput('')
      replacePendingAttachments([])
      setDraftReadySessionId(null)
      return
    }

    const draft = getChatDraft(accountId, sessionId)
    setQueuedMessageEdit(null)
    pendingClearedInputRef.current = null
    setInput(draft?.text ?? '')
    replacePendingAttachments(toDraftUploadTasks(draft?.attachments ?? []))
    setDraftReadySessionId(sessionId)
  }, [accountId, replacePendingAttachments, sessionId, setInput])

  useEffect(() => {
    if (!sessionId || draftReadySessionId !== sessionId) return
    if (queuedMessageEdit?.sessionId === sessionId) return

    if (
      pendingSendRef.current?.draft?.sessionId === sessionId &&
      input.length === 0 &&
      pendingAttachments.length === 0
    ) {
      return
    }

    saveChatDraft(accountId, sessionId, {
      text: input,
      attachments: toPersistedDraftAttachments(pendingAttachments),
    })
  }, [accountId, draftReadySessionId, input, pendingAttachments, queuedMessageEdit, sessionId])

  const finishPendingSend = useCallback(
    (pending: PendingSendState, options?: { preserveForReconciliation?: boolean }) => {
      if (pendingSendRef.current === pending && !options?.preserveForReconciliation) {
        pendingSendRef.current = null
      }
      setIsSending(false)
      sendingRef.current = false
    },
    [],
  )

  const persistAcceptedSend = useCallback((pending: PendingSendState) => {
    if (pending.persisted) return
    pending.persisted = true

    applySessionActivity(
      pending.sessionId,
      new Date(pending.userMsg.ts).toISOString(),
      buildSessionPreview(pending.userMsg) ?? undefined,
      { markRead: true, userMessage: true },
    )

    // The daemon durable ACK is the commit point. Keep the outbound projection
    // until the same message ID arrives through canonical history; that closes
    // the ACK-before-delta race without creating a second body copy.
  }, [])

  const acceptPendingSend = useCallback(
    (
      pending: PendingSendState,
      ack: SessionDurableSendAck,
      queueMessageId?: string,
    ) => {
      if (pending.accepted) return
      pending.accepted = true
      console.log(
        `[ChatSend] durable ACK ${ack.deliveryState}, sessionId=${pending.sessionId.slice(0, 8)}`,
      )

      const storedDraft = getChatDraft(accountId, pending.sessionId)
      if (!storedDraft || samePersistedDraft(storedDraft, pending.draft)) {
        removeChatDraft(accountId, pending.sessionId)
      }

      const failed = ack.deliveryState === 'failed' || ack.deliveryState === 'cancelled'
      const queued = ack.deliveryState === 'queued'
      if (!queued) transientIdleDispatchIdsRef.current.delete(pending.userMsg.id)
      const nextMessage: ChatMessage = {
        ...pending.userMsg,
        status: failed ? 'error' : queued ? 'sending' : 'sent',
        ...(queueMessageId ? { queueMessageId } : {}),
      }
      const keepPendingRun = shouldKeepPendingRunAfterAck(ack.deliveryState)
      mutateActiveChatSession(pending.sessionId, (state) => {
        state.upsertMessage(nextMessage)
        if (failed) {
          state.updateMessageError(pending.userMsg.id, {
            type: 'agent_error',
            message: ack.deliveryState === 'cancelled' ? 'Message cancelled' : 'Message failed',
          })
        } else {
          state.updateMessageStatus(pending.userMsg.id, queued ? 'sending' : 'sent')
        }
        if (!keepPendingRun) state.clearPendingRun()
      })
      if (keepPendingRun) armPendingRunFallback(pending.sessionId)
      saveChatOutboundAck(accountId, pending.sessionId, nextMessage, ack)
      persistAcceptedSend(pending)
      finishPendingSend(pending)
    },
    [accountId, armPendingRunFallback, clearPendingRun, finishPendingSend, persistAcceptedSend, updateMessageError, updateMessageStatus],
  )

  useChatOutboundRecovery({ accountId, isLocalDraft, personalSyncIdentity, relayState, send, sessionId })

  const handleSend = useCallback(
    async (options?: HandleSendOptions): Promise<boolean> => {
      if (sendingRef.current) return false
      sendingRef.current = true

      const rawInput = options?.textOverride ?? input
      const messageAttachments = pendingAttachments.map((attachment) => ({
        path: attachment.path,
        name: attachment.name,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
        previewData: attachment.previewData,
      }))
      const reqAttachments = toPersonalAttachmentReferences(messageAttachments)
      const text = withStewardContext(composeAttachmentMessageContent(rawInput, messageAttachments), messageContext)
      if (
        !text ||
        !sessionId ||
        useChatStore.getState().sessionId !== sessionId ||
        !personalSyncIdentity ||
        (!options?.bypassVoicePhaseGuard &&
          (voicePhase === 'listening' || voicePhase === 'refining')) ||
        isSending ||
        isUploading ||
        reqAttachments.length !== pendingAttachments.length
      ) {
        sendingRef.current = false
        return false
      }

      if (!(await requestPersonalAiDataConsent())) { sendingRef.current = false; return false }

      const userMsg: ChatMessage = {
        id: `user-${Crypto.randomUUID()}`,
        role: 'user',
        ts: Date.now(),
        content: text,
        attachments: messageAttachments,
        status: 'sending',
      }
      const agentBusy = Boolean(_currentRunId || isTyping || queueSnapshot?.busy)
      if (!agentBusy) {
        transientIdleDispatchIdsRef.current.add(userMsg.id)
      }
      const machineIsOffline = useMachinesStore
        .getState()
        .machines.find((machine) => machine.id === machineId)?.online === false
      const showAsPendingCard = agentBusy && relayState === 'connected' && !machineIsOffline
      if (showAsPendingCard) {
        // The card and the store message land in one render, so the transcript
        // never shows a bubble that the pending card is about to replace.
        setOptimisticSends((sends) => [...sends, { sessionId, message: userMsg }])
      } else {
        // Sending explicitly leaves history reading before the composer/keyboard resize.
        onMessageSubmitted?.()
      }
      addMessage(userMsg)
      saveChatOutboundMessage(accountId, sessionId, userMsg)
      const pendingSend: PendingSendState = {
        sessionId,
        machineId,
        userMsg,
        draft: {
          sessionId,
          text: rawInput,
          attachments: pendingAttachments.map((attachment) => ({ ...attachment })),
        },
        accepted: false,
        persisted: false,
      }
      pendingSendRef.current = pendingSend
      pendingClearedInputRef.current = rawInput
      setInput('')
      clearPendingAttachments()
      textInputRef.current?.clear?.()
      Keyboard.dismiss()

      if (relayState !== 'connected' || machineIsOffline) {
        saveChatOutboundMessage(accountId, sessionId, userMsg, {
          deliveryState: 'local_pending',
        })
        try {
          await flushChatOutboundStorage()
          const storedDraft = getChatDraft(accountId, sessionId)
          if (!storedDraft || samePersistedDraft(storedDraft, pendingSend.draft)) {
            removeChatDraft(accountId, sessionId)
          }
          finishPendingSend(pendingSend)
          return true
        } catch {
          restoreRejectedSend(pendingSend)
          finishPendingSend(pendingSend)
          return false
        }
      }

      setIsSending(true)
      cancelPendingRunFallback()
      startPendingRun()
      const enqueueFrame = {
        type: 'req' as const,
        method: 'chat.enqueue' as const,
        params: buildChatSendParams({
          ...personalSyncIdentity,
          sessionId,
          text,
          agentType,
          sessionMode,
          workDir,
          agentSessionId: sessionAgentSessionId,
          modelId,
          systemPrompt,
          managerDefaultWorkerAgentType,
          managerDefaultWorkerModelId,
          reasoningEffort,
          clientMessageId: userMsg.id,
          queueMessageId: userMsg.id,
          sessionListProjection,
          attachments: reqAttachments,
          externalChannel,
        }),
      }
      const acceptResult = (result: { ack: SessionDurableSendAck; response: unknown | null }) => {
        const { ack, response } = result
        const payload = (response as {
          payload?: SessionDurableSendAck & {
            queueMessageId?: string
            queue?: ChatQueueSnapshot
          }
        } | null)?.payload
        const queue = payload?.queue && hasExpectedPersonalSyncIdentity(payload.queue, personalSyncIdentity)
          ? payload.queue
          : undefined
        if (queue) useChatStore.getState().setQueue(queue)
        const queued = queue?.pending.find(
          (message) => (message.clientMessageId || message.id) === userMsg.id,
        )
        acceptPendingSend(pendingSend, ack, queued?.id ?? payload?.queueMessageId)
      }
      try {
        await flushChatOutboundStorage()
        await ensureLocalSession(sessionId)
        acceptResult(await sendWithDurableRecovery(
          send,
          enqueueFrame,
          { ...personalSyncIdentity, sessionId, clientMessageId: userMsg.id },
        ))
      } catch (err) {
        if (pendingSend.accepted) return true
        transientIdleDispatchIdsRef.current.delete(userMsg.id)
        mutateActiveChatSession(sessionId, (state) => state.clearPendingRun())
        const shouldRestoreComposer = shouldRestoreComposerAfterSendError(err)
        if (shouldRestoreComposer) {
          restoreRejectedSend(pendingSend)
          if (useChatStore.getState().sessionId === sessionId && useAuthStore.getState().user?.id === accountId) onSendRejected?.(err)
        } else if (getChatOutboundMessages(accountId, sessionId).some((m) => m.id === userMsg.id)) {
          mutateActiveChatSession(sessionId, (state) =>
            state.updateMessageStatus(userMsg.id, 'uncertain'),
          )
          saveChatOutboundMessage(accountId, sessionId, {
            ...userMsg,
            status: 'uncertain',
          }, { deliveryState: 'unconfirmed' })
        }
        finishPendingSend(pendingSend, {
          preserveForReconciliation: !shouldRestoreComposer,
        })
        return !shouldRestoreComposer
      } finally {
        // The daemon queue snapshot (if queued) now owns the card; otherwise the
        // message was dispatched or failed and belongs in the transcript.
        if (showAsPendingCard) {
          setOptimisticSends((sends) => sends.filter((entry) => entry.message.id !== userMsg.id))
        }
      }
      return true
    },
    [
      acceptPendingSend,
      accountId,
      restoreRejectedSend,
      onMessageSubmitted,
      onSendRejected,
      addMessage,
      agentType,
      cancelPendingRunFallback,
      clearPendingAttachments,
      clearPendingRun,
      finishPendingSend,
      input, messageContext,
      _currentRunId,
      queueSnapshot,
      isSending,
      isTyping,
      isUploading,
      machineId,
      modelId,
      managerDefaultWorkerAgentType,
      managerDefaultWorkerModelId,
      pendingAttachments,
      personalSyncIdentity,
      relayState,
      reasoningEffort,
      replacePendingAttachments,
      send,
      sessionAgentSessionId,
      sessionListProjection,
      sessionId,
      setInput,
      startPendingRun,
      textInputRef,
      requestPersonalAiDataConsent,
      updateMessageError,
      voicePhase,
      workDir,
    ],
  )

  const restoreComposerAfterQueuedEdit = useCallback(
    (edit: QueuedMessageEditState) => {
      pendingClearedInputRef.current = null
      setInput(edit.previousDraft.text)
      replacePendingAttachments(
        edit.previousDraft.attachments.map((attachment) => ({ ...attachment })),
      )
      setQueuedMessageEdit(null)
    },
    [replacePendingAttachments, setInput],
  )

  const handleBeginEditQueued = useCallback(
    (queueMessageId: string) => {
      if (!sessionId || !queueMessageId || queuedMessageEdit) return
      const queued = useChatStore
        .getState()
        .queue?.pending.find((message) => message.id === queueMessageId)
      if (!queued || queued.sessionId !== sessionId) return

      setQueuedMessageEdit({
        sessionId,
        queueMessageId,
        clientMessageId: queued.clientMessageId || queued.id,
        previousDraft: {
          sessionId,
          text: input,
          attachments: pendingAttachments.map((attachment) => ({ ...attachment })),
        },
      })
      pendingClearedInputRef.current = null
      setInput(stripAttachmentRefs(queued.text, queued.attachments).trim())
      replacePendingAttachments(toDraftUploadTasks(queued.attachments ?? []))
      setTimeout(() => textInputRef.current?.focus?.(), 0)
    },
    [
      input,
      pendingAttachments,
      queuedMessageEdit,
      replacePendingAttachments,
      sessionId,
      setInput,
      textInputRef,
    ],
  )

  const handleCancelEditQueued = useCallback(() => {
    if (queuedMessageEdit) restoreComposerAfterQueuedEdit(queuedMessageEdit)
  }, [queuedMessageEdit, restoreComposerAfterQueuedEdit])

  useEffect(() => {
    if (
      !queuedMessageEdit ||
      queueSnapshot?.sessionId !== queuedMessageEdit.sessionId ||
      queueSnapshot.pending.some((message) => message.id === queuedMessageEdit.queueMessageId)
    ) {
      return
    }
    restoreComposerAfterQueuedEdit(queuedMessageEdit)
  }, [queueSnapshot, queuedMessageEdit, restoreComposerAfterQueuedEdit])

  const handleDeleteQueued = useCallback(
    async (queueMessageId: string) => {
      if (!sessionId || !queueMessageId) return
      const localPending = getChatOutboundMessages(accountId, sessionId).find(
        (message) =>
          message.id === queueMessageId && message.deliveryState === 'local_pending',
      )
      if (localPending) {
        removeChatOutboundMessage(accountId, sessionId, localPending.id)
        mutateActiveChatSession(sessionId, (state) => {
          state.setMessages(state.messages.filter((message) => message.id !== localPending.id))
        })
        return
      }
      if (!personalSyncIdentity) return
      const matching = useChatStore
        .getState()
        .messages.find((message) => message.queueMessageId === queueMessageId)
      try {
        setQueueActionFailed(false)
        setQueueAction({ id: queueMessageId, kind: 'delete' })
        const response = (await send({
          type: 'req',
          method: 'chat.queue.delete',
          params: { ...personalSyncIdentity, sessionId, queueMessageId },
        })) as { ok?: boolean; error?: string; payload?: { queue?: ChatQueueSnapshot } }
        if (
          response.ok === false || !response.payload?.queue ||
          !hasExpectedPersonalSyncIdentity(response.payload.queue, personalSyncIdentity)
        ) {
          throw new Error(response.error || 'Queued message cancellation was not acknowledged')
        }
        mutateActiveChatSession(sessionId, (state) => {
          state.removeQueuedMessage(queueMessageId)
          state.setQueue(response.payload!.queue!)
        })
        if (matching) removeChatOutboundMessage(accountId, sessionId, matching.id)
        if (queuedMessageEdit?.queueMessageId === queueMessageId) {
          restoreComposerAfterQueuedEdit(queuedMessageEdit)
        }
      } catch (err) {
        console.error('[ChatSend] delete queued failed', err)
        setQueueActionFailed(true)
      } finally {
        setQueueAction(null)
      }
    },
    [accountId, personalSyncIdentity, queuedMessageEdit, restoreComposerAfterQueuedEdit, send, sessionId],
  )

  const handlePromoteQueued = useCallback(async (queueMessageId: string) => {
    if (!sessionId || !personalSyncIdentity || !queueMessageId || queueAction) return
    try {
      setQueueActionFailed(false)
      setQueueAction({ id: queueMessageId, kind: 'promote' })
      const response = (await send({
        type: 'req', method: 'chat.queue.promote',
        params: { ...personalSyncIdentity, sessionId, queueMessageId },
      })) as { ok?: boolean; error?: string; payload?: { queue?: ChatQueueSnapshot } }
      if (
        response.ok === false || !response.payload?.queue ||
        !hasExpectedPersonalSyncIdentity(response.payload.queue, personalSyncIdentity)
      ) throw new Error(response.error || 'Queued message promotion was not acknowledged')
      mutateActiveChatSession(sessionId, (state) => state.setQueue(response.payload!.queue!))
    } catch (err) {
      console.error('[ChatSend] promote queued failed', err)
      setQueueActionFailed(true)
    } finally {
      setQueueAction(null)
    }
  }, [personalSyncIdentity, queueAction, send, sessionId])

  const handleSubmitEditQueued = useCallback(async (): Promise<boolean> => {
    const edit = queuedMessageEdit
    if (!sessionId || !personalSyncIdentity || !edit || edit.sessionId !== sessionId || sendingRef.current) return false
    const attachments = toPersistedDraftAttachments(pendingAttachments)
    const refs = toPersonalAttachmentReferences(attachments)
    if (refs.length !== attachments.length) return false
    const text = composeAttachmentMessageContent(input, attachments)
    if (!text) return false

    sendingRef.current = true
    setIsSending(true)
    try {
      const response = (await send({
        type: 'req',
        method: 'chat.queue.edit',
        params: {
          ...personalSyncIdentity,
          sessionId,
          queueMessageId: edit.queueMessageId,
          text,
          attachments: refs,
        },
      })) as { ok?: boolean; error?: string; payload?: { queue?: ChatQueueSnapshot } }
      if (
        response.ok === false || !response.payload?.queue ||
        !hasExpectedPersonalSyncIdentity(response.payload.queue, personalSyncIdentity)
      ) {
        throw new Error(response.error || 'Queued message edit was not acknowledged')
      }
      let updated: ChatMessage | undefined
      mutateActiveChatSession(sessionId, (state) => {
        state.setQueue(response.payload!.queue!)
        updated = useChatStore.getState().messages.find(
          (message) => message.id === edit.clientMessageId,
        )
      })
      if (updated) {
        saveChatOutboundMessage(accountId, sessionId, updated, {
          clientMessageId: edit.clientMessageId,
          deliveryState: 'queued',
        })
      }
      restoreComposerAfterQueuedEdit(edit)
      return true
    } catch (err) {
      console.error('[ChatSend] edit queued failed', err)
      return false
    } finally {
      sendingRef.current = false
      setIsSending(false)
    }
  }, [
    accountId,
    input,
    pendingAttachments,
    personalSyncIdentity,
    queuedMessageEdit,
    restoreComposerAfterQueuedEdit,
    send,
    sessionId,
  ])

  const handleAbort = useCallback(async () => {
    if (!sessionId || !personalSyncIdentity || isStopping) return
    setIsStopping(true)
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    stopTimerRef.current = setTimeout(() => setIsStopping(false), 10000)
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('abort timeout')), 8000),
      )
      await Promise.race([
        requestChatAbort(send, {
          ...personalSyncIdentity,
          sessionId,
          agentType,
          agentSessionId: sessionAgentSessionId ?? null,
          workDir,
        }),
        timeout,
      ])
      mutateActiveChatSession(sessionId, (state) => state.clearPendingRun())
    } catch {
      // A rejection or lost ACK is not proof that the native Agent stopped.
      // Keep the last authoritative activity until daemon activity says otherwise.
    }
  }, [agentType, clearPendingRun, isStopping, personalSyncIdentity, send, sessionAgentSessionId, sessionId, workDir])

  useEffect(() => {
    if (!isTyping) {
      setIsStopping(false)
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current)
        stopTimerRef.current = null
      }
    }
  }, [isTyping])

  const handleResend = useCallback((messageId?: string) => {
    if (
      !sessionId ||
      !personalSyncIdentity ||
      sendingRef.current ||
      isSending ||
      relayState !== 'connected' ||
      targetMachineOffline
    ) return
    const storedOutbound = getChatOutboundMessages(accountId, sessionId)
    const localPending = messageId
      ? storedOutbound.find(
          (message) => message.id === messageId && message.deliveryState === 'local_pending',
        )
      : storedOutbound.find((message) => message.deliveryState === 'local_pending')
    if (messageId && !localPending) return
    if (!localPending && isTyping) return
    const errorMsg: ChatMessage | ChatOutboundMessage | undefined = localPending ?? [...messages]
      .reverse()
      .find((m) => m.role === 'user' && (m.status === 'error' || m.status === 'uncertain'))
    if (!errorMsg) return
    sendingRef.current = true
    updateMessageStatus(errorMsg.id, 'sending')
    saveChatOutboundMessage(
      accountId,
      sessionId,
      { ...errorMsg, status: 'sending' },
      {
        deliveryState: localPending ? 'local_pending' : 'sending',
        lastAttemptAt: new Date().toISOString(),
      },
    )
    const text = errorMsg.content
    const attachments = errorMsg.attachments ?? []
    const reqAttachments = toPersonalAttachmentReferences(attachments)
    const pendingSend: PendingSendState = {
      sessionId,
      machineId,
      userMsg: errorMsg,
      draft: null,
      accepted: false,
      persisted: false,
    }
    if (reqAttachments.length !== attachments.length) {
      restoreRejectedSend(pendingSend)
      sendingRef.current = false
      return
    }
    pendingSendRef.current = pendingSend
    setIsSending(true)
    cancelPendingRunFallback()
    if (!isTyping) startPendingRun()
    const enqueueFrame = {
      type: 'req' as const,
      method: 'chat.enqueue' as const,
      params: buildChatSendParams({
        ...personalSyncIdentity,
        sessionId,
        text,
        agentType,
        sessionMode,
        workDir,
        agentSessionId: sessionAgentSessionId,
        modelId,
        managerDefaultWorkerAgentType,
        managerDefaultWorkerModelId,
        reasoningEffort,
        clientMessageId: errorMsg.id,
        queueMessageId: errorMsg.id,
        sessionListProjection,
        attachments: reqAttachments,
        externalChannel,
      }),
    }
    void flushChatOutboundStorage().then(() => ensureLocalSession(sessionId)).then(() => recoverOrRetryDurableSend(
      send,
      enqueueFrame,
      { ...personalSyncIdentity, sessionId, clientMessageId: errorMsg.id },
    ))
      .then(({ ack, response }) => {
        const payload = (response as {
          payload?: SessionDurableSendAck & { queueMessageId?: string; queue?: ChatQueueSnapshot }
        } | null)?.payload
        const queue = payload?.queue && hasExpectedPersonalSyncIdentity(payload.queue, personalSyncIdentity)
          ? payload.queue
          : undefined
        if (queue) useChatStore.getState().setQueue(queue)
        const queued = queue?.pending.find(
          (message) => (message.clientMessageId || message.id) === errorMsg.id,
        )
        acceptPendingSend(pendingSend, ack, queued?.id ?? payload?.queueMessageId)
      })
      .catch((err) => {
        if (pendingSend.accepted) return
        mutateActiveChatSession(sessionId, (state) => state.clearPendingRun())
        if (shouldRestoreComposerAfterSendError(err)) {
          restoreRejectedSend(pendingSend)
          if (useChatStore.getState().sessionId === sessionId && useAuthStore.getState().user?.id === accountId) onSendRejected?.(err)
        } else if (localPending) {
          mutateActiveChatSession(sessionId, (state) =>
            state.updateMessageStatus(errorMsg.id, 'sending'),
          )
          saveChatOutboundMessage(
            accountId,
            sessionId,
            { ...errorMsg, status: 'sending' },
            { deliveryState: 'local_pending', lastAttemptAt: new Date().toISOString() },
          )
        } else if (getChatOutboundMessages(accountId, sessionId).some((m) => m.id === errorMsg.id)) {
          mutateActiveChatSession(sessionId, (state) =>
            state.updateMessageStatus(errorMsg.id, 'uncertain'),
          )
          saveChatOutboundMessage(
            accountId,
            sessionId,
            { ...errorMsg, status: 'uncertain' },
            { deliveryState: 'unconfirmed' },
          )
        }
        finishPendingSend(pendingSend)
      })
  }, [
    acceptPendingSend,
    restoreRejectedSend,
    onSendRejected,
    accountId,
    agentType,
    clearPendingRun,
    finishPendingSend,
    isSending,
    isTyping,
    machineId,
    messages,
    modelId,
    managerDefaultWorkerAgentType,
    managerDefaultWorkerModelId,
    personalSyncIdentity,
    relayState,
    reasoningEffort,
    send,
    sessionAgentSessionId,
    sessionListProjection,
    sessionId,
    cancelPendingRunFallback,
    startPendingRun,
    targetMachineOffline,
    updateMessageError,
    updateMessageStatus,
    workDir,
  ])

  useEffect(() => {
    const next = localPendingOutbound[0]
    if (
      !next ||
      relayState !== 'connected' ||
      isSending ||
      sendingRef.current ||
      targetMachineOffline
    ) return
    const elapsed = Date.now() - new Date(next.lastAttemptAt).getTime()
    const timer = setTimeout(() => handleResend(next.id), Math.max(0, 3000 - elapsed))
    return () => clearTimeout(timer)
  }, [handleResend, isSending, localPendingOutbound, relayState, targetMachineOffline])

  const handleImageLongPress = useCallback(
    (
      translate: (key: string, fallback: string) => string,
      onViewImage: () => void,
      onSaveImage: () => void,
    ) => {
      Alert.alert(translate('image_options', '图片'), undefined, [
        {
          text: translate('save_image', '保存图片'),
          onPress: onSaveImage,
        },
        {
          text: translate('view_image', '查看原图'),
          onPress: onViewImage,
        },
        { text: translate('cancel', '取消'), style: 'cancel' },
      ])
    },
    [],
  )

  const { controllablePending, localPendingIds } = usePendingComposerCards({ agentType, sessionMode, workDir, sessionAgentSessionId, modelId, systemPrompt, managerDefaultWorkerAgentType, managerDefaultWorkerModelId, reasoningEffort, externalChannel, sessionId, personalSyncIdentity, localPendingOutbound, optimisticSends, queueSnapshot, transientIdleDispatchIds: transientIdleDispatchIdsRef.current })

  return {
    handleAbort,
    handleResend,
    handleImageLongPress,
    handleSend,
    handleBeginEditQueued,
    handleCancelEditQueued,
    handleSubmitEditQueued,
    handleDeleteQueued,
    handlePromoteQueued,
    controllablePending,
    localPendingIds,
    queueAction,
    queueActionFailed,
    editingQueueMessageId: queuedMessageEdit?.queueMessageId ?? null,
    isSending,
    isStopping,
    pendingClearedInputRef,
    sendingRef,
  }
}
