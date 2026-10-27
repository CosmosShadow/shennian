// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts

import type {
  ChatQueueDeleteParams,
  ChatQueueEditParams,
  ChatQueueGetParams,
  ChatQueueSnapshot,
  ReqFrame,
} from '@shennian/wire'
import type { ActiveSession, SessionManagerRuntime } from './types.js'
import {
  assertFinishedAttachmentReferences,
  markAttachmentReferences,
} from './attachment-transfer-store.js'
import { parsePersonalAttachmentReferences } from './attachment-reference.js'
import { requestSessionIndexPublish } from './index-publisher.js'
import {
  dedupeQueuedAttachments,
  formatQueuedBatch,
  isControllableQueueMessage,
  stripLocalQueueFields,
  takeControllableMessage,
} from './queue-helpers.js'
import { nowIso, queueEnvelope, type LocalQueuedChatMessage } from './queue-message.js'
import { readQueue, writeQueue } from './queue-storage.js'
import { tombstoneMessage, upsertMessage } from './store.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { getNativeSourceAgentType } from './handlers/chat-events.js'

export type QueueControlContext = {
  getRuntime: () => SessionManagerRuntime
  inFlightMessageIds: Map<string, Set<string>>
  broadcast: (sessionId: string) => void
}

export type QueuePromotionContext = QueueControlContext & {
  promoting: Set<string>
  draining: Set<string>
  isImmediateSendAvailable: (sessionId: string) => boolean
  canInjectActiveBatch: (active: ActiveSession, batch: LocalQueuedChatMessage[]) => boolean
  interruptQueuedSession?: (sessionId: string) => Promise<void>
  dispatchQueuedMessages: (
    batch: LocalQueuedChatMessage[],
  ) => Promise<{ deliveryMode?: string; queuedSubmissionId?: string }>
  markExternalQueued: (batch: LocalQueuedChatMessage[], queuedSubmissionId?: string) => void
  removeBatch: (sessionId: string, batch: LocalQueuedChatMessage[]) => number
  wakeSession: (sessionId: string) => void
}

export function getQueueSnapshot(
  context: QueueControlContext,
  sessionId: string,
): ChatQueueSnapshot {
  const pending = readQueue().sessions[sessionId] ?? []
  const inFlight = context.inFlightMessageIds.get(sessionId)
  const active = context.getRuntime().sessions.get(sessionId)
  const immediateSendAvailable =
    !active?.currentRunId ||
    Boolean(
      active.journalRunId &&
      context.getRuntime().runJournal?.get(sessionId, active.journalRunId)?.deliveryMode ===
        'direct',
    )
  const visiblePending = pending.filter(isControllableQueueMessage).map((message) => ({
    ...stripLocalQueueFields(message),
    pendingState: message.externalQueuedSubmissionId
      ? ('provider_queued' as const)
      : inFlight?.has(message.id)
        ? ('submitting' as const)
        : ('waiting' as const),
    canDelete: !message.externalQueuedSubmissionId && !inFlight?.has(message.id),
    canPromote:
      !message.externalQueuedSubmissionId && !inFlight?.has(message.id) && immediateSendAvailable,
  }))
  return {
    ...getPersonalSyncIdentity(getDaemonInstallationId()),
    sessionId,
    busy: Boolean(active?.currentRunId),
    pending: pending.map(stripLocalQueueFields),
    controllablePending: pending
      .filter(
        (message) =>
          isControllableQueueMessage(message) &&
          !message.externalQueuedSubmissionId &&
          !inFlight?.has(message.id),
      )
      .map(stripLocalQueueFields),
    visiblePending,
  }
}

export async function handleQueueGet(context: QueueControlContext, req: ReqFrame): Promise<void> {
  const runtime = context.getRuntime()
  const params = req.params as ChatQueueGetParams
  if (!params.sessionId) {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'sessionId is required' })
    return
  }
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { queue: getQueueSnapshot(context, params.sessionId) },
  })
}

export async function handleQueueEdit(context: QueueControlContext, req: ReqFrame): Promise<void> {
  const runtime = context.getRuntime()
  const params = req.params as ChatQueueEditParams
  if (!params.sessionId || !params.queueMessageId || !params.text) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'sessionId, queueMessageId and text are required',
    })
    return
  }
  const queue = readQueue()
  const pending = queue.sessions[params.sessionId] ?? []
  const index = pending.findIndex((message) => message.id === params.queueMessageId)
  if (index < 0) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'Queued message not found',
    })
    return
  }
  if (
    !isControllableQueueMessage(pending[index]!) ||
    Boolean(pending[index]!.externalQueuedSubmissionId) ||
    context.inFlightMessageIds.get(params.sessionId)?.has(params.queueMessageId)
  ) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'managed_agent_queue_mutation_forbidden',
    })
    return
  }
  const editedAttachments = parsePersonalAttachmentReferences(params.attachments)
  const resolvedWorkDir = runtime.resolvePath(pending[index]!.workDir)
  if (editedAttachments?.length)
    assertFinishedAttachmentReferences(resolvedWorkDir, editedAttachments)
  pending[index] = {
    ...pending[index],
    text: params.text,
    attachments: editedAttachments,
    updatedAt: nowIso(),
  }
  queue.sessions[params.sessionId] = pending
  writeQueue(queue)
  upsertMessage(params.sessionId, queueEnvelope(pending[index]!), 'queued')
  if (pending[index]!.attachments?.length)
    markAttachmentReferences(resolvedWorkDir, pending[index]!.attachments ?? [])
  requestSessionIndexPublish(runtime.client)
  context.broadcast(params.sessionId)
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { queue: getQueueSnapshot(context, params.sessionId) },
  })
}

export async function handleQueueDelete(
  context: QueueControlContext,
  req: ReqFrame,
): Promise<void> {
  const runtime = context.getRuntime()
  const params = req.params as ChatQueueDeleteParams
  if (!params.sessionId || !params.queueMessageId) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'sessionId and queueMessageId are required',
    })
    return
  }
  const queue = readQueue()
  const pending = queue.sessions[params.sessionId] ?? []
  const deleted = pending.find((message) => message.id === params.queueMessageId)
  if (
    deleted &&
    (!isControllableQueueMessage(deleted) ||
      Boolean(deleted.externalQueuedSubmissionId) ||
      context.inFlightMessageIds.get(params.sessionId)?.has(params.queueMessageId))
  ) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'managed_agent_queue_mutation_forbidden',
    })
    return
  }
  const next = pending.filter((message) => message.id !== params.queueMessageId)
  if (next.length === pending.length) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'Queued message not found',
    })
    return
  }
  if (next.length) queue.sessions[params.sessionId] = next
  else delete queue.sessions[params.sessionId]
  writeQueue(queue)
  tombstoneMessage(
    params.sessionId,
    deleted?.clientMessageId ?? deleted?.id ?? params.queueMessageId,
  )
  requestSessionIndexPublish(runtime.client)
  context.broadcast(params.sessionId)
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { queue: getQueueSnapshot(context, params.sessionId) },
  })
}

export async function handleQueuePromote(
  context: QueuePromotionContext,
  req: ReqFrame,
): Promise<void> {
  const runtime = context.getRuntime()
  const params = req.params as import('@shennian/wire').ChatQueuePromoteParams
  const fail = (error: string) =>
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error })
  if (!params.sessionId || !params.queueMessageId) {
    fail('sessionId and queueMessageId are required')
    return
  }
  if (context.promoting.has(params.sessionId)) {
    fail('queue_promotion_in_progress')
    return
  }
  context.promoting.add(params.sessionId)
  let batch: LocalQueuedChatMessage[] = []
  try {
    while (context.draining.has(params.sessionId)) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    batch = takeControllableMessage(
      readQueue().sessions[params.sessionId] ?? [],
      params.queueMessageId,
    )
    if (!batch.length) {
      fail('Queued message not found')
      return
    }
    if (
      batch[0]!.externalQueuedSubmissionId ||
      !context.isImmediateSendAvailable(params.sessionId)
    ) {
      fail('queue_immediate_send_unavailable')
      return
    }
    context.inFlightMessageIds.set(params.sessionId, new Set(batch.map((message) => message.id)))
    const active = runtime.sessions.get(params.sessionId)
    let mode: 'injected' | 'restarted' | 'idle' = 'idle'
    if (active?.currentRunId) {
      if (context.canInjectActiveBatch(active, batch)) {
        const injectedText = batch.length === 1 ? batch[0]!.text : formatQueuedBatch(batch)
        const canonicalMessageId = batch[0]!.clientMessageId ?? batch[0]!.id
        runtime.nativeFusion?.registerManagedSend({
          sessionId: params.sessionId,
          agentType: batch[0]!.agentType,
          sourceAgentType: getNativeSourceAgentType(batch[0]!.agentType, batch[0]!.modelId),
          canonicalMessageId,
          sourceSessionKey: active.agentSessionId,
          text: injectedText,
          managedEchoPolicy: 'suppress_following',
        })
        const dispatchedAt = Date.now()
        try {
          await active.adapter.injectActiveInput!({
            text: injectedText,
            attachments: dedupeQueuedAttachments(
              batch.flatMap((message) => message.attachments ?? []),
            ),
            clientMessageId: canonicalMessageId,
          })
        } catch (error) {
          runtime.nativeFusion?.cancelManagedSend(canonicalMessageId)
          throw error
        }
        for (const message of batch) {
          upsertMessage(
            params.sessionId,
            { ...queueEnvelope(message), ts: dispatchedAt },
            'executing',
          )
        }
        context.removeBatch(params.sessionId, batch)
        mode = 'injected'
      } else {
        if (!context.interruptQueuedSession) throw new Error('queue_interrupt_unavailable')
        await context.interruptQueuedSession(params.sessionId)
        const result = await context.dispatchQueuedMessages(batch)
        if (result.deliveryMode === 'external_owner_queue') {
          context.markExternalQueued(batch, result.queuedSubmissionId)
        } else {
          context.removeBatch(params.sessionId, batch)
          mode = 'restarted'
        }
      }
    } else {
      const result = await context.dispatchQueuedMessages(batch)
      if (result.deliveryMode === 'external_owner_queue') {
        context.markExternalQueued(batch, result.queuedSubmissionId)
      } else context.removeBatch(params.sessionId, batch)
    }
    requestSessionIndexPublish(runtime.client)
    context.broadcast(params.sessionId)
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: {
        queue: getQueueSnapshot(context, params.sessionId),
        promotedMessageIds: batch.map((message) => message.id),
        mode,
      },
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : 'queue_promotion_failed')
    context.broadcast(params.sessionId)
  } finally {
    context.inFlightMessageIds.delete(params.sessionId)
    context.promoting.delete(params.sessionId)
    if (readQueue().sessions[params.sessionId]?.length) context.wakeSession(params.sessionId)
  }
}
