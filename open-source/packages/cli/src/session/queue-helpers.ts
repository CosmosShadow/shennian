// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/queue-durability-disk.test.ts
import type { QueuedChatMessage } from '@shennian/wire'
import type { LocalQueuedChatMessage } from './queue.js'
import type { SessionManagerRuntime } from './types.js'
import { listSessionRecords } from './store.js'
import type { ManagedAgentDirectTurnOptions } from './queue-types.js'
import type { ManagedWorkerRoomOrigin } from '../manager/registry.js'

export const OWNER_DIRECT_TURN_OPTIONS: ManagedAgentDirectTurnOptions = {
  allowedRoomActions: ['send'],
  propagateWorkerRoomOrigin: false,
}

export const SCHEDULED_ROOM_TURN_OPTIONS: ManagedAgentDirectTurnOptions = {
  allowedRoomActions: ['send'],
  propagateWorkerRoomOrigin: false,
  scheduledTask: true,
}

export function managedDirectTurnOptions(
  managerEvent: { roomOrigin?: ManagedWorkerRoomOrigin } | null | undefined,
  ownerManagedDirect: boolean,
): ManagedAgentDirectTurnOptions | undefined {
  if (managerEvent) return {
    roomOrigin: managerEvent.roomOrigin,
    allowedRoomActions: managerEvent.roomOrigin ? ['send'] : [],
    managerEvent: true,
  }
  // An Owner direct turn is private for reading/Manager orchestration, but the
  // bound Agent still represents its Room identity and may explicitly publish
  // the Owner-requested result there. Keep read/pause unavailable, and do not
  // let Workers created in this private turn inherit the Room send origin.
  return ownerManagedDirect ? OWNER_DIRECT_TURN_OPTIONS : undefined
}

export function findDuplicateQueuedMessage<T extends QueuedChatMessage & { origin?: 'app' | 'external' | 'room' }>(
  pending: T[],
  message: T,
): T | null {
  const stableId = normalizeQueueStableMessageId(message)
  if (stableId) {
    return pending.find((item) => normalizeQueueStableMessageId(item) === stableId) ?? null
  }
  if (message.origin !== 'external') return null
  const key = externalQueuedMessageDedupeKey(message)
  return pending.find((item) => externalQueuedMessageDedupeKey(item) === key) ?? null
}

export function stripLocalQueueFields(message: LocalQueuedChatMessage): QueuedChatMessage {
  const {
    dispatchBlock: _dispatchBlock,
    origin: _origin,
    managedRoom: _managedRoom,
    managedAgentDirect: _managedAgentDirect,
    trigger: _trigger,
    externalQueuedSubmissionId: _externalQueuedSubmissionId,
    ...publicMessage
  } = message
  return publicMessage
}

export function takeCompatibleBatch(pending: LocalQueuedChatMessage[]): LocalQueuedChatMessage[] {
  const lanePriority = pending.reduce<number | null>((selected, message) => {
    const priority = triggerPriority(message)
    return selected === null || priority < selected ? priority : selected
  }, null)
  if (lanePriority === null) return []
  const lane = pending.filter((message) => triggerPriority(message) === lanePriority)
  const first = lane[0]
  if (!first) return []
  // Owner-authored messages are separate user actions. Draining several of
  // them into one Provider prompt makes independent instructions conflict and
  // prevents the UI's per-message controls from having truthful semantics.
  // Room lanes remain mailbox-style batches. Manager-to-Worker messages are
  // separate turns too: combining a queued follow-up with the Worker's first
  // prompt changes the canonical message body and makes retry identity unsafe.
  if (isControllableQueueMessage(first)) return [first]
  if (first.trigger?.kind === 'manager_worker' || first.trigger?.kind === 'scheduled') return [first]
  const key = queueCompatibilityKey(first)
  const batch: LocalQueuedChatMessage[] = []
  for (const message of lane) {
    if (queueCompatibilityKey(message) !== key) break
    batch.push(message)
  }
  return batch
}

export function isControllableQueueMessage(message: LocalQueuedChatMessage): boolean {
  if (message.origin === 'external' || message.origin === 'room' || message.managedRoom) return false
  const kind = message.trigger?.kind
  return kind == null || kind === 'personal' || kind === 'managed_direct'
}

export function normalizeQueuedModelId(modelId?: string | null): string | undefined {
  const trimmed = modelId?.trim()
  return trimmed || undefined
}

export function takeControllableMessage(
  pending: LocalQueuedChatMessage[],
  targetId: string,
): LocalQueuedChatMessage[] {
  const target = pending.find(
    (message) => message.id === targetId && isControllableQueueMessage(message),
  )
  return target ? [target] : []
}

function triggerPriority(message: LocalQueuedChatMessage): number {
  const kind = (triggerCompatibilityKey(message) as { kind: string }).kind
  if (kind === 'personal' || kind === 'managed_direct') return 0
  if (kind === 'manager_event' || kind === 'manager_worker') return 1
  return 2
}

function triggerCompatibilityKey(message: LocalQueuedChatMessage): unknown {
  const trigger = message.trigger
  if (!trigger) {
    if (message.managedRoom) return { kind: 'room_activation', registryKey: message.managedRoom.registryKey }
    return message.managedAgentDirect ? { kind: 'managed_direct' } : { kind: 'personal' }
  }
  if (trigger.kind === 'room_activation') {
    return { kind: trigger.kind, registryKey: trigger.registryKey }
  }
  if (trigger.kind === 'manager_worker') {
    return {
      kind: trigger.kind,
      parentSessionId: trigger.parentSessionId,
      roomOrigin: trigger.roomOrigin ?? null,
    }
  }
  if (trigger.kind === 'manager_event') {
    return {
      kind: trigger.kind,
      roomOrigin: trigger.roomOrigin ?? null,
    }
  }
  return { kind: trigger.kind }
}

function queueCompatibilityKey(message: LocalQueuedChatMessage): string {
  return JSON.stringify({
    agentType: message.agentType,
    sessionMode: message.sessionMode ?? null,
    workDir: message.workDir,
    agentSessionId: message.agentSessionId ?? null,
    modelId: normalizeQueuedModelId(message.modelId) ?? null,
    systemPrompt: message.systemPrompt ?? null,
    reasoningEffort: message.reasoningEffort ?? null,
    managerConfig: message.managerConfig ?? null,
    managerDefaultWorkerAgentType: message.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: message.managerDefaultWorkerModelId ?? null,
    externalChannel: message.externalChannel ?? null,
    replyTarget: message.replyTarget ?? null,
    roomRegistryKey: message.managedRoom?.registryKey ?? null,
    roomInputKind: message.managedRoom
      ? message.text.trimStart().startsWith('[群事件]\n') ? 'event' : 'message'
      : null,
    trigger: triggerCompatibilityKey(message),
  })
}

export function formatQueuedBatch(batch: LocalQueuedChatMessage[]): string {
  if (batch.every((message) => message.managedRoom)) {
    if (batch.every((message) => message.text.trimStart().startsWith('[群事件]\n'))) {
      return `[群事件]\n${batch
        .map((message) => message.text.trim().slice('[群事件]\n'.length))
        .filter(Boolean)
        .join('\n\n')}`
    }
    return `[群消息]\n${batch
      .map((message) => stripRoomDeliveryHeader(message.text))
      .filter(Boolean)
      .join('\n\n')}`
  }
  return `[连续用户消息]\n${batch.map((message, index) =>
    `<消息 ${index + 1}>\n${message.text.trim()}`,
  ).join('\n\n')}`
}

function stripRoomDeliveryHeader(text: string): string {
  const trimmed = text.trim()
  const compact = trimmed.match(/^\[群消息\][ \t]+<([^>\n]+)>\n([\s\S]*)$/)
  if (compact) return `<${compact[1]}>\n${compact[2]}`
  if (trimmed.startsWith('[群消息]\n')) return trimmed.slice('[群消息]\n'.length)
  return trimmed
}

function externalQueuedMessageDedupeKey(message: QueuedChatMessage): string {
  const stableId = normalizeQueueStableMessageId(message)
  if (stableId) return `id:${stableId}`
  return [
    'body',
    normalizeExternalBatchText(message.text),
    ...(message.attachments ?? []).map(
      (attachment) => attachment.path || `${attachment.name}:${attachment.mimeType}`,
    ),
  ].join('\n')
}

function normalizeQueueStableMessageId(message: QueuedChatMessage): string {
  const clientId = typeof message.clientMessageId === 'string' ? message.clientMessageId.trim() : ''
  if (clientId) return clientId
  const queueId = typeof message.id === 'string' ? message.id.trim() : ''
  if (queueId && !queueId.startsWith('queue-')) return queueId
  return ''
}

export function dedupeQueuedAttachments(
  attachments: NonNullable<QueuedChatMessage['attachments']>,
): NonNullable<QueuedChatMessage['attachments']> | undefined {
  const seen = new Set<string>()
  const result: NonNullable<QueuedChatMessage['attachments']> = []
  for (const attachment of attachments) {
    const key = attachment.path || `${attachment.name}:${attachment.mimeType}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(attachment)
  }
  return result.length ? result : undefined
}

function normalizeExternalBatchText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyQueueError(message: string, fallback: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('managed claim session conflicts with source binding')) {
    return 'managed_claim_source_binding_conflict'
  }
  const symbolicCode = normalized.match(
    /\b(?:managed_(?:agent|room)|agent_validation|acp|native|codex)_[a-z0-9_]+\b/,
  )?.[0]
  if (symbolicCode) return symbolicCode
  if (normalized.includes('no rollout found')) return 'missing_rollout'
  if (normalized.includes('managed_room_permission_snapshot_mismatch')) {
    return 'managed_room_permission_snapshot_mismatch'
  }
  if (normalized.includes('managed_room_prompt_snapshot_mismatch')) {
    return 'managed_room_prompt_snapshot_mismatch'
  }
  if (normalized.includes('managed_room_turn_preparer_unavailable')) {
    return 'managed_room_turn_preparer_unavailable'
  }
  if (normalized.includes('timeout')) return 'timeout'
  if (normalized.includes('connection')) return 'connection_error'
  return fallback
}

export function resolveManagedRoomNativeSessionId(
  runtime: SessionManagerRuntime,
  message: LocalQueuedChatMessage,
): string | null {
  if (runtime.sessions.has(message.sessionId)) return null
  const candidate = listSessionRecords().find(
    (record) => record.sessionId === message.sessionId,
  )?.agentSessionId?.trim()
  if (!candidate || candidate.startsWith('managed:')) return null
  return candidate
}
