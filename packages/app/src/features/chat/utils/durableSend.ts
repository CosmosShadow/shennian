// @arch docs/architecture/data-sync.md#81-手机发送本地队列与可确认-ack
// @test src/__tests__/chat-durable-send.test.ts

import type {
  PersonalSyncIdentity,
  ResFrame,
  ReqFrame,
  SessionDeliveryState,
  SessionDurableSendAck,
  SessionMessageStatusResponse,
} from '@shennian/wire'
import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import { ChatSendRejectedError } from './screen'

const DELIVERY_STATES = new Set<SessionDeliveryState>([
  'queued',
  'committed',
  'executing',
  'completed',
  'failed',
  'cancelled',
])

type ExpectedIdentity = {
  sessionId: string
  clientMessageId: string
} & PersonalSyncIdentity

type SendRequest = (frame: Omit<ReqFrame, 'id'>) => Promise<unknown>

export type DurableSendResult = {
  ack: SessionDurableSendAck
  response: unknown | null
}

export async function requestChatAbort(
  send: SendRequest,
  params: Omit<ReqFrame, 'id'>['params'],
): Promise<void> {
  const response = (await send({
    type: 'req',
    method: 'chat.abort',
    params,
  })) as Pick<ResFrame, 'ok' | 'error'> | null | undefined
  if (!response?.ok) throw new Error(response?.error || 'Agent stop was not acknowledged')
}

function validateAck(value: unknown, expected: ExpectedIdentity): SessionDurableSendAck {
  const ack = value as Partial<SessionDurableSendAck> | null | undefined
  if (
    !ack ||
    ack.sessionId !== expected.sessionId ||
    ack.clientMessageId !== expected.clientMessageId ||
    ack.protocolVersion !== expected.protocolVersion ||
    ack.dataEpoch !== expected.dataEpoch ||
    ack.daemonInstallationId !== expected.daemonInstallationId ||
    typeof ack.messageId !== 'string' || !ack.messageId ||
    typeof ack.deliveryState !== 'string' ||
    !DELIVERY_STATES.has(ack.deliveryState as SessionDeliveryState) ||
    !Number.isSafeInteger(ack.bodyRevision) || Number(ack.bodyRevision) < 1 ||
    typeof ack.committedAt !== 'string' ||
    !Number.isFinite(new Date(ack.committedAt).getTime())
  ) {
    throw new Error('Invalid daemon durable ACK')
  }
  return ack as SessionDurableSendAck
}

export function requireDurableSendAck(
  response: Pick<ResFrame, 'ok' | 'error' | 'payload'>,
  expected: ExpectedIdentity,
): SessionDurableSendAck {
  if (!response.ok) throw new ChatSendRejectedError(response.error ?? 'Chat send failed')
  return validateAck(response.payload, expected)
}

export function parseMessageStatusResponse(
  response: Pick<ResFrame, 'ok' | 'error' | 'payload'>,
  expected: ExpectedIdentity,
): SessionMessageStatusResponse {
  if (!response.ok) throw new Error(response.error ?? 'Message status unavailable')
  const status = response.payload as Partial<SessionMessageStatusResponse> | null | undefined
  if (
    status?.state === 'not_found' &&
    status.sessionId === expected.sessionId &&
    status.clientMessageId === expected.clientMessageId &&
    status.protocolVersion === expected.protocolVersion &&
    status.dataEpoch === expected.dataEpoch &&
    status.daemonInstallationId === expected.daemonInstallationId
  ) {
    return status as SessionMessageStatusResponse
  }
  const ack = validateAck(status, expected)
  if ((status as { state?: unknown }).state !== ack.deliveryState) {
    throw new Error('Invalid daemon message status')
  }
  return status as SessionMessageStatusResponse
}

export function isTerminalDeliveryState(state: SessionDeliveryState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

export async function requestDurableMessageStatus(
  send: SendRequest,
  expected: ExpectedIdentity,
): Promise<SessionMessageStatusResponse> {
  const response = await send({
    type: 'req',
    method: 'session.message.status',
    params: expected,
  })
  return parseMessageStatusResponse(
    response as { ok: boolean; error?: string; payload?: unknown },
    expected,
  )
}

export async function recoverOrRetryDurableSend(
  send: SendRequest,
  enqueueFrame: Omit<ReqFrame, 'id'>,
  expected: ExpectedIdentity,
): Promise<DurableSendResult> {
  const status = await requestDurableMessageStatus(send, expected)
  if (status.state !== 'not_found') return { ack: status, response: null }
  const response = await send(enqueueFrame)
  return {
    ack: requireDurableSendAck(
      response as { ok: boolean; error?: string; payload?: unknown },
      expected,
    ),
    response,
  }
}

export async function sendWithDurableRecovery(
  send: SendRequest,
  enqueueFrame: Omit<ReqFrame, 'id'>,
  expected: ExpectedIdentity,
): Promise<DurableSendResult> {
  let response: unknown
  try {
    response = await send(enqueueFrame)
  } catch {
    return recoverOrRetryDurableSend(send, enqueueFrame, expected)
  }
  // A negative response is not proof that the daemon failed before its first
  // durable write. For example, the queue file may have been renamed before a
  // later canonical commit failed. Resolve the stable message identity against
  // daemon-local status before deciding whether the composer may be restored.
  if (!(response as { ok?: unknown } | null | undefined)?.ok) {
    if (
      (response as { error?: unknown } | null | undefined)?.error ===
        CODEX_DESKTOP_SEND_UNAVAILABLE
    ) {
      throw new ChatSendRejectedError(CODEX_DESKTOP_SEND_UNAVAILABLE)
    }
    return recoverOrRetryDurableSend(send, enqueueFrame, expected)
  }
  return {
    ack: requireDurableSendAck(
      response as { ok: boolean; error?: string; payload?: unknown },
      expected,
    ),
    response,
  }
}
