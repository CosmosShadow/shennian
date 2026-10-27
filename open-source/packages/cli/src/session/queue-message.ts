// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-chat-queue-1.test.ts

import { randomUUID } from 'node:crypto'
import {
  buildUserMessagePayload,
  type AgentType,
  type ChatEnqueueParams,
  type QueuedChatMessage,
} from '@shennian/wire'
import { parsePersonalAttachmentReferences } from './attachment-reference.js'
import { normalizeQueuedModelId } from './queue-helpers.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import type { ManagedRoomTriggerContext, TurnTrigger } from './turn-trigger.js'
import type { ManagedWorkerRoomOrigin } from '../manager/registry.js'

export type LocalQueuedChatMessage = QueuedChatMessage & {
  origin?: 'app' | 'external' | 'room'
  trigger?: TurnTrigger
  /** Legacy persisted fields remain readable until all v1 queue files drain. */
  managedRoom?: ManagedRoomTriggerContext
  managedAgentDirect?: true
  /** Provider was not reached; `notice` marks the message that owns the private "waiting for recovery" notice. */
  dispatchBlock?: { code: string; retryAt: number; attempts?: number; notice?: true }
  /** Codex accepted this item into an externally-owned native queue. */
  externalQueuedSubmissionId?: string
}

export type InternalEnqueueParams = ChatEnqueueParams & {
  managedWorkerParentSessionId?: string
  scheduledTask?: { id: string; bindingId?: string; roomId?: string }
  managerEventId?: string
  managerEventRoomOrigin?: ManagedWorkerRoomOrigin
  managerWorkerRoomOrigin?: ManagedWorkerRoomOrigin
}

export class TerminalQueuedChatDispatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TerminalQueuedChatDispatchError'
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function queueMessageFromParams(params: InternalEnqueueParams): LocalQueuedChatMessage {
  const timestamp = nowIso()
  const trigger: TurnTrigger = params.scheduledTask
    ? { kind: 'scheduled', taskId: params.scheduledTask.id, bindingId: params.scheduledTask.bindingId, roomId: params.scheduledTask.roomId }
    : params.managedWorkerParentSessionId
    ? {
        kind: 'manager_worker',
        parentSessionId: params.managedWorkerParentSessionId,
        roomOrigin: params.managerWorkerRoomOrigin,
      }
    : params.managerEventId
      ? {
          kind: 'manager_event',
          eventId: params.managerEventId,
          ...(params.managerEventRoomOrigin
            ? { roomOrigin: params.managerEventRoomOrigin }
            : {}),
        }
      : params.managedAgentDirect
        ? { kind: 'managed_direct' }
        : { kind: 'personal' }
  return {
    ...getPersonalSyncIdentity(getDaemonInstallationId()),
    id: params.queueMessageId || params.clientMessageId || `queue-${randomUUID()}`,
    sessionId: params.sessionId,
    text: params.text,
    agentType: params.agentType as AgentType,
    sessionMode: params.sessionMode,
    managerConfig: params.managerConfig,
    workDir: params.workDir,
    agentSessionId: params.agentSessionId ?? null,
    modelId: normalizeQueuedModelId(params.modelId) ?? null,
    systemPrompt: params.systemPrompt ?? null,
    managerDefaultWorkerAgentType: params.managerDefaultWorkerAgentType ?? null,
    managerDefaultWorkerModelId: params.managerDefaultWorkerModelId ?? null,
    reasoningEffort: params.reasoningEffort ?? null,
    clientMessageId: params.clientMessageId ?? null,
    attachments: parsePersonalAttachmentReferences(params.attachments),
    externalChannel: params.externalChannel ?? null,
    replyTarget: params.replyTarget ?? null,
    origin: params.origin,
    createdAt: timestamp,
    updatedAt: timestamp,
    trigger,
  } as LocalQueuedChatMessage
}

export function queueEnvelope(message: LocalQueuedChatMessage) {
  return {
    id: message.clientMessageId ?? message.id,
    sessionId: message.sessionId,
    role: message.trigger?.kind === 'manager_event' || message.trigger?.kind === 'scheduled' ? 'agent' as const : 'user' as const,
    ts: Date.parse(message.createdAt),
    // Keep a private receipt for durable idempotency without storing the task prompt in history.
    payload: message.trigger?.kind === 'scheduled' ? '' : buildUserMessagePayload(message.text, message.attachments),
  }
}
