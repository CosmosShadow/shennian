// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts

import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from './types.js'
import { handleChatAbort, handleChatSend, type ChatSendExecutionContext } from './handlers/chat.js'
import { TerminalQueuedChatDispatchError, type PreparedManagedRoomTurn } from './queue.js'
import { markTrustedManagerEvent } from './manager-event-authority.js'

export function managedChatContext(prepared: PreparedManagedRoomTurn): ChatSendExecutionContext {
  return {
    source: 'room_activation',
    managedAgentPolicy: prepared.managedAgentPolicy,
    managedRoomPromptSnapshot: prepared.managedRoomPromptSnapshot,
  }
}

export function managedManagerEventContext(
  prepared: PreparedManagedRoomTurn,
): ChatSendExecutionContext {
  return {
    source: 'manager_event',
    ...(prepared.standalone ? { standalone: true as const } : {}),
    managedAgentPolicy: prepared.managedAgentPolicy,
    managedRoomPolicyVersion: prepared.managedRoomPromptSnapshot.managedRoomPolicyVersion,
    managedRuntimePolicyHash: prepared.managedRoomPromptSnapshot.runtimePermissionPolicyHash,
  }
}

export async function dispatchManagedChat(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
  prepared: PreparedManagedRoomTurn,
): Promise<void> {
  await handleChatSend(runtime, markTrustedManagerEvent(req), managedChatContext(prepared))
}

export async function dispatchQueuedChat(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
  prepared?: PreparedManagedRoomTurn,
): Promise<{ deliveryMode?: string; queuedSubmissionId?: string }> {
  const captured: {
    value: {
      ok?: boolean
      error?: string
      payload?: {
        deliveryState?: string
        failureMessage?: string
        deliveryMode?: string
        queuedSubmissionId?: string
      }
    } | null
  } = { value: null }
  const localClient = new Proxy(runtime.client, {
    get: (target, property) => {
      if (property === 'sendRes') {
        return (value: typeof captured.value) => {
          captured.value = value
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await handleChatSend(
    { ...runtime, client: localClient },
    markTrustedManagerEvent(req),
    prepared
      ? (req.params as { managedRecoverySource?: string; scheduledDelivery?: boolean }).managedRecoverySource === 'managed_room' ||
        (req.params as { scheduledDelivery?: boolean }).scheduledDelivery === true
        ? managedChatContext(prepared)
        : managedManagerEventContext(prepared)
      : undefined,
  )
  if (captured.value?.payload?.deliveryState === 'failed') {
    throw new TerminalQueuedChatDispatchError(
      captured.value.payload.failureMessage ?? captured.value.error ?? 'queued_chat_dispatch_failed',
    )
  }
  if (!captured.value?.ok) throw new Error(captured.value?.error ?? 'queued_chat_dispatch_failed')
  return {
    deliveryMode: captured.value.payload?.deliveryMode,
    queuedSubmissionId: captured.value.payload?.queuedSubmissionId,
  }
}

export async function interruptQueuedChat(
  runtime: SessionManagerRuntime,
  sessionId: string,
): Promise<void> {
  const captured: { value: { ok?: boolean; error?: string } | null } = { value: null }
  const localClient = new Proxy(runtime.client, {
    get: (target, property) => property === 'sendRes'
      ? (value: typeof captured.value) => { captured.value = value }
      : typeof Reflect.get(target, property, target) === 'function'
        ? Reflect.get(target, property, target).bind(target)
        : Reflect.get(target, property, target),
  })
  await handleChatAbort(
    { ...runtime, client: localClient },
    { type: 'req', id: `queue-promote-abort-${Date.now()}`, method: 'chat.abort', params: {
      sessionId,
      discardPending: false,
    } } as ReqFrame,
  )
  if (!captured.value?.ok) throw new Error(captured.value?.error ?? 'agent_stop_failed')
}
