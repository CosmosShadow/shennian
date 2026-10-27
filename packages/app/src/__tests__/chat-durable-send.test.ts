// @covers packages/app/src/features/chat/utils/durableSend.ts

import { describe, expect, it, vi } from 'vitest'
import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import {
  parseMessageStatusResponse,
  recoverOrRetryDurableSend,
  requestChatAbort,
  requireDurableSendAck,
  sendWithDurableRecovery,
} from '../features/chat/utils/durableSend'

const expected = {
  protocolVersion: 2 as const,
  dataEpoch: 2 as const,
  daemonInstallationId: 'daemon-1',
  sessionId: 'session-1',
  clientMessageId: 'client-1',
}
const ack = {
  protocolVersion: 2 as const, dataEpoch: 2 as const, daemonInstallationId: 'daemon-1',
  sessionId: 'session-1', clientMessageId: 'client-1', messageId: 'client-1',
  deliveryState: 'queued' as const, bodyRevision: 7,
  committedAt: '2026-09-01T12:00:00.000Z',
}

describe('chat durable send response validation', () => {
  it('accepts abort only after the daemon acknowledges it', async () => {
    const accepted = vi.fn().mockResolvedValue({ ok: true })
    await expect(requestChatAbort(accepted, { sessionId: 'session-1' })).resolves.toBeUndefined()
    expect(accepted).toHaveBeenCalledWith({
      type: 'req',
      method: 'chat.abort',
      params: { sessionId: 'session-1' },
    })

    const rejected = vi.fn().mockResolvedValue({ ok: false, error: 'agent_stop_failed' })
    await expect(requestChatAbort(rejected, { sessionId: 'session-1' }))
      .rejects.toThrow('agent_stop_failed')
  })

  it('accepts only a daemon durable ACK with the expected stable identity', () => {
    expect(requireDurableSendAck({ ok: true, payload: ack }, expected)).toEqual(ack)
    expect(() => requireDurableSendAck({ ok: true, payload: { queued: true } }, expected))
      .toThrow('Invalid daemon durable ACK')
    expect(() => requireDurableSendAck({
      ok: true, payload: { ...ack, clientMessageId: 'other-client' },
    }, expected)).toThrow('Invalid daemon durable ACK')
    expect(() => requireDurableSendAck({
      ok: true, payload: { ...ack, dataEpoch: 1 },
    }, expected)).toThrow('Invalid daemon durable ACK')
  })

  it('distinguishes not_found from a recoverable durable status', () => {
    expect(parseMessageStatusResponse({
      ok: true,
      payload: { state: 'not_found', ...expected },
    }, expected)).toEqual({ state: 'not_found', ...expected })
    expect(parseMessageStatusResponse({
      ok: true,
      payload: { state: 'queued', ...ack },
    }, expected)).toMatchObject({ state: 'queued', bodyRevision: 7 })
    expect(() => parseMessageStatusResponse({
      ok: true,
      payload: { state: 'executing', ...ack },
    }, expected)).toThrow('Invalid daemon message status')
  })

  it('recovers a lost ACK by querying status without sending a duplicate', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce({ ok: true, payload: { state: 'queued', ...ack } })
    await expect(sendWithDurableRecovery(
      send,
      { type: 'req', method: 'chat.enqueue', params: expected },
      expected,
    )).resolves.toMatchObject({ ack, response: null })
    expect(send.mock.calls.map(([frame]) => frame.method)).toEqual([
      'chat.enqueue',
      'session.message.status',
    ])
  })

  it('treats a negative enqueue response as uncertain until daemon status resolves it', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'canonical commit failed' })
      .mockResolvedValueOnce({ ok: true, payload: { state: 'queued', ...ack } })
    await expect(sendWithDurableRecovery(
      send,
      { type: 'req', method: 'chat.enqueue', params: expected },
      expected,
    )).resolves.toMatchObject({ ack, response: null })
    expect(send.mock.calls.map(([frame]) => frame.method)).toEqual([
      'chat.enqueue',
      'session.message.status',
    ])
  })

  it('does not retry a Desktop stopped-thread rejection', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: false,
      error: CODEX_DESKTOP_SEND_UNAVAILABLE,
    })
    await expect(sendWithDurableRecovery(
      send,
      { type: 'req', method: 'chat.enqueue', params: expected },
      expected,
    )).rejects.toThrow(CODEX_DESKTOP_SEND_UNAVAILABLE)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retries the original frame once when a negative response is followed by not_found', async () => {
    const frame = { type: 'req' as const, method: 'chat.enqueue' as const, params: expected }
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'queue write failed' })
      .mockResolvedValueOnce({ ok: true, payload: { state: 'not_found', ...expected } })
      .mockResolvedValueOnce({ ok: true, payload: ack })

    await expect(sendWithDurableRecovery(send, frame, expected)).resolves.toMatchObject({ ack })
    expect(send.mock.calls.map(([request]) => request.method)).toEqual([
      'chat.enqueue', 'session.message.status', 'chat.enqueue',
    ])
    expect(send).toHaveBeenNthCalledWith(3, frame)
  })

  it('retries with the same clientMessageId only after status proves not_found', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { state: 'not_found', ...expected } })
      .mockResolvedValueOnce({ ok: true, payload: ack })
    const frame = { type: 'req' as const, method: 'chat.enqueue' as const, params: expected }
    await expect(recoverOrRetryDurableSend(send, frame, expected))
      .resolves.toMatchObject({ ack })
    expect(send).toHaveBeenNthCalledWith(2, frame)
    expect((send.mock.calls[1]?.[0] as typeof frame).params.clientMessageId).toBe('client-1')
  })
})
