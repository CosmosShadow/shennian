// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-screen-utils.test.ts

import {
  CODEX_DESKTOP_SEND_UNAVAILABLE,
  type ChatQueueSnapshot,
  type QueuedChatMessage,
  type ResFrame,
} from '@shennian/wire'
import {
  buildSessionMessagePreview,
  type ChatMessage,
} from '@shennian/shared'

const PENDING_RUN_ID = '__pending__'

/** How long an ACKed send may wait for the daemon's first real activity. */
export const PENDING_RUN_ACK_GRACE_MS = 15_000

/**
 * A durable ACK only proves the message is stored. Unless it already ended,
 * the optimistic running state stays until real activity takes over.
 */
export function shouldKeepPendingRunAfterAck(deliveryState: string): boolean {
  return deliveryState !== 'failed' && deliveryState !== 'cancelled' && deliveryState !== 'completed'
}

export function withoutPendingCardMessages<T extends { id: string; role: string }>(
  messages: T[],
  pending: QueuedChatMessage[],
): T[] {
  const ids = new Set(pending.map((message) => message.clientMessageId || message.id))
  return messages.filter((message) => message.role !== 'user' || !ids.has(message.id))
}

// Local cards win over daemon cards, and daemon cards win over optimistic ones,
// so a card is replaced in place once a more authoritative source knows the ID.
export function mergePendingCards(
  local: QueuedChatMessage[],
  daemon: QueuedChatMessage[],
  optimistic: QueuedChatMessage[] = [],
): QueuedChatMessage[] {
  const cardId = (message: QueuedChatMessage) => message.clientMessageId || message.id
  const localIds = new Set(local.map((message) => message.id))
  const daemonCards = daemon.filter((message) => !localIds.has(cardId(message)))
  const knownIds = new Set([...localIds, ...daemonCards.map(cardId)])
  const optimisticCards = optimistic.filter((message) => !knownIds.has(cardId(message)))
  return [...local, ...daemonCards, ...optimisticCards]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function getControllablePendingForPanel(
  queue: ChatQueueSnapshot | null,
  sessionId: string | null | undefined,
  transientIdleDispatchIds?: ReadonlySet<string>,
): QueuedChatMessage[] {
  if (!queue || !sessionId || queue.sessionId !== sessionId) return []
  const pending = queue.visiblePending ?? queue.controllablePending ?? []
  if (!queue.busy && !pending.some((message) => message.pendingState === 'provider_queued')) {
    return []
  }
  // An idle send is durably queued for a moment before the scheduler claims it.
  // Suppress only that internal transition. Once an external Codex owner has
  // accepted the item, it remains a real pending card until native claim.
  return pending.filter(
    (message) =>
      message.pendingState === 'provider_queued' ||
      !transientIdleDispatchIds?.has(message.id),
  )
}

export function shouldDisableChatVoiceInput({
  sessionId,
  readOnlySession,
  machineOffline,
  relayState,
  isSending,
}: {
  sessionId: string | null | undefined
  readOnlySession: boolean
  machineOffline: boolean
  relayState: string
  isSending: boolean
}): boolean {
  return !sessionId || readOnlySession || machineOffline || relayState !== 'connected' || isSending
}

export function shouldShowChatStopButton({
  isTyping,
  canSend,
  canStop,
}: {
  isTyping: boolean
  canSend: boolean
  canStop?: boolean
}): boolean {
  // Older activity snapshots did not carry canStop. Preserve their behavior,
  // but never advertise control over a run owned by Codex Desktop.
  return isTyping && !canSend && canStop !== false
}

export function classifyChatSendError(
  relayState: string,
  err: unknown,
): { type: 'network' | 'cli_unreachable' | 'agent_error'; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (relayState !== 'connected' || /network|disconnect|websocket/i.test(msg)) {
    return { type: 'network', message: msg }
  }
  if (/timeout|not connected|unreachable|daemon/i.test(msg)) {
    return { type: 'cli_unreachable', message: msg }
  }
  return { type: 'agent_error', message: msg }
}

export class ChatSendRejectedError extends Error {}

export function isEphemeralDesktopSendFailure(error: unknown): boolean {
  return error instanceof ChatSendRejectedError && error.message === CODEX_DESKTOP_SEND_UNAVAILABLE
}

export function ensureChatSendAccepted(response: Pick<ResFrame, 'ok' | 'error'>): void {
  if (response.ok) return
  throw new ChatSendRejectedError(response.error ?? 'Chat send failed')
}

export function shouldRestoreComposerAfterSendError(error: unknown): boolean {
  if (error instanceof ChatSendRejectedError) return true
  const message = error instanceof Error ? error.message : String(error)

  // A transport timeout or an already-written socket closing only means the ACK
  // was lost. The daemon may still have accepted the request, so restoring the
  // same text would make a delivered message look unsent and invite duplicates.
  return !/timed?\s*out|timeout|network|websocket|socket.*(?:closed|lost|hang up)|client disconnected|econnreset|etimedout|epipe|connection (?:closed|lost|reset)/i.test(
    message,
  )
}

export function isExternalOwnerQueueAccepted(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return record.queued === true && record.deliveryMode === 'external_owner_queue'
}

export function hasAcceptedPendingRun(
  currentRunId: string | null | undefined,
  runIdAtSend?: string | null,
): boolean {
  return Boolean(currentRunId && currentRunId !== PENDING_RUN_ID && currentRunId !== runIdAtSend)
}

export function hasAgentMessageSince(messages: ChatMessage[], userTs: number): boolean {
  return messages.some((message) => message.role === 'agent' && message.ts >= userTs)
}

export function shouldShowBottomWorkingIndicator(
  runPhase:
    | 'idle'
    | 'thinking'
    | 'tool_running'
    | 'streaming_text'
    | 'waiting_approval'
    | 'waiting_user_input',
  messages: ChatMessage[],
): boolean {
  if (
    runPhase === 'thinking' ||
    runPhase === 'tool_running' ||
    runPhase === 'waiting_approval' ||
    runPhase === 'waiting_user_input'
  )
    return true
  if (runPhase !== 'streaming_text') return false

  const lastMessage = messages[messages.length - 1]
  return !lastMessage || lastMessage.role === 'user'
}

export function buildSessionPreview(message: ChatMessage | undefined): string | null {
  if (!message) return null
  return buildSessionMessagePreview(message.content, message.attachments, { maxLength: 80 }) || null
}

/**
 * Session rows must describe the latest readable chat item, not merely the
 * final array entry. Tool/control items can legally trail the last visible
 * assistant response.
 */
export function buildLatestSessionPreview(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const preview = buildSessionPreview(messages[index])
    if (preview) return preview
  }
  return null
}
