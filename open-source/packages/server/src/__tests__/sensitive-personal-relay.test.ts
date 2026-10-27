// @covers src/relay/sensitive-personal-relay.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReqFrame } from '@shennian/wire'
import {
  getSensitivePersonalIdentity,
  SensitivePersonalRelay,
} from '../relay/sensitive-personal-relay.js'

const identity = { protocolVersion: 2 as const, dataEpoch: 2 as const, daemonInstallationId: 'install-1' }

function socket() {
  return { OPEN: 1, readyState: 1, send: vi.fn() }
}

function request(id: string, toolCallId = 'tool-1', detailRevision = 7): ReqFrame {
  return {
    type: 'req', id, method: 'session.tool.detail',
    params: { ...identity, sessionId: 'session-1', toolCallId, detailRevision, maxBytes: 4096 },
  }
}

function statusRequest(id: string): ReqFrame {
  return {
    type: 'req', id, method: 'session.message.status',
    params: { ...identity, sessionId: 'session-1', clientMessageId: 'client-1' },
  }
}

function historySyncRequest(id: string, afterRevision = 0): ReqFrame {
  return {
    type: 'req', id, method: 'session.history.sync',
    params: {
      ...identity, sessionId: 'session-1', syncId: `sync-${id}`,
      afterRevision, limit: 200,
    },
  }
}

function attachmentChunkRequest(id: string, data = 'eA=='): ReqFrame {
  return {
    type: 'req', id, method: 'fs.transfer.chunk',
    params: {
      ...identity,
      transferId: 'attachment_12345678', rootPath: '/project', offset: 0, data,
    },
  }
}

describe('sensitive personal relay', () => {
  const relays: SensitivePersonalRelay[] = []
  afterEach(() => {
    for (const relay of relays) relay.reset()
    relays.length = 0
    vi.useRealTimers()
  })

  function relay() {
    const value = new SensitivePersonalRelay()
    relays.push(value)
    return value
  }

  it('routes a tool detail response only to its requesting socket', () => {
    const value = relay()
    const owner = socket()
    const other = socket()
    const ownerRequest = request('request-owner')
    value.registerClientRequest({ socket: owner as never, machineId: 'machine-1', frame: ownerRequest, mode: 'multiplex' })
    value.registerClientRequest({ socket: other as never, machineId: 'machine-1', frame: request('request-other'), mode: 'multiplex' })
    value.observeForwardedRequest('machine-1', ownerRequest)

    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: ownerRequest.id, ok: true,
      payload: {
        ...identity,
        sessionId: 'session-1', toolCallId: 'tool-1', detailRevision: 7,
        detailStatus: 'available', result: 'safe', resultOmitted: false,
        redacted: true, byteSize: 4, expiresAt: new Date().toISOString(), source: 'local-tool-index',
      },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('"type":"relay"'))
    expect(other.send).not.toHaveBeenCalled()
  })

  it('routes message status only to the requesting socket and never broadcasts it', () => {
    const value = relay()
    const owner = socket()
    const other = socket()
    const frame = statusRequest('message-status-owner')
    value.registerClientRequest({
      socket: owner as never, machineId: 'machine-1', frame, mode: 'multiplex',
    })
    value.registerClientRequest({
      socket: other as never, machineId: 'machine-1',
      frame: statusRequest('message-status-other'), mode: 'multiplex',
    })
    value.observeForwardedRequest('machine-1', frame)

    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: frame.id, ok: true,
      payload: {
        ...identity,
        state: 'queued', sessionId: 'session-1', clientMessageId: 'client-1',
        messageId: 'client-1', deliveryState: 'queued', bodyRevision: 2,
        committedAt: '2026-09-01T12:00:00.000Z',
      },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('message-status-owner'))
    expect(other.send).not.toHaveBeenCalled()
  })

  it('validates and routes a history sync page only to its requesting socket', () => {
    const value = relay()
    const owner = socket()
    const other = socket()
    const frame = historySyncRequest('history-sync-owner', 7)
    expect(getSensitivePersonalIdentity(frame)).toEqual({
      kind: 'history_sync', ...identity, sessionId: 'session-1',
      syncId: 'sync-history-sync-owner', afterRevision: 7, limit: 200,
    })
    value.registerClientRequest({
      socket: owner as never, machineId: 'machine-1', frame, mode: 'multiplex',
    })
    value.registerClientRequest({
      socket: other as never, machineId: 'machine-1',
      frame: historySyncRequest('history-sync-other', 7), mode: 'multiplex',
    })
    value.observeForwardedRequest('machine-1', frame)

    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: frame.id, ok: true,
      payload: {
        ...identity, sessionId: 'session-1', syncId: 'sync-history-sync-owner',
        fromRevision: 7, toRevision: 7, targetRevision: 7,
        hasMore: false, mutations: [],
      },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('history-sync-owner'))
    expect(other.send).not.toHaveBeenCalled()
  })

  it('rejects malformed history sync cursors before relay registration', () => {
    expect(getSensitivePersonalIdentity(historySyncRequest('negative', -1))).toBeNull()
    const tooLarge = historySyncRequest('too-large')
    tooLarge.params.limit = 201
    expect(getSensitivePersonalIdentity(tooLarge)).toBeNull()
  })

  it('routes attachment acknowledgements only to the requesting socket without retaining bytes', () => {
    const value = relay()
    const owner = socket()
    const other = socket()
    const frame = attachmentChunkRequest('attachment-owner')
    expect(getSensitivePersonalIdentity(frame)).toEqual({
      kind: 'attachment_transfer', ...identity,
      method: 'fs.transfer.chunk', transferId: 'attachment_12345678',
    })
    value.registerClientRequest({
      socket: owner as never, machineId: 'machine-1', frame, mode: 'multiplex',
    })
    value.registerClientRequest({
      socket: other as never, machineId: 'machine-1',
      frame: attachmentChunkRequest('attachment-other'), mode: 'multiplex',
    })
    value.observeForwardedRequest('machine-1', frame)
    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: frame.id, ok: true,
      payload: { ...identity, transferId: 'attachment_12345678', written: 1, nextOffset: 1 },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('attachment-owner'))
    expect(other.send).not.toHaveBeenCalled()
    expect(JSON.stringify(getSensitivePersonalIdentity(frame))).not.toContain('eA==')
  })

  it('rejects oversized attachment chunks before relay registration', () => {
    expect(getSensitivePersonalIdentity(
      attachmentChunkRequest('attachment-large', 'x'.repeat(1_398_105)),
    )).toBeNull()
  })

  it('consumes oversized machine responses and returns structured unavailable', () => {
    const value = relay()
    const owner = socket()
    const frame = request('request-large')
    value.registerClientRequest({ socket: owner as never, machineId: 'machine-1', frame, mode: 'legacy' })
    value.observeForwardedRequest('machine-1', frame)

    expect(value.routeMachineFrame('machine-1', JSON.stringify({
      type: 'res', id: frame.id, ok: true,
      payload: { ...identity, result: 'x'.repeat(12_000) },
    }))).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('response_too_large'))
  })

  it('does not claim a response from another machine', () => {
    const value = relay()
    const frame = request('request-wrong-machine')
    value.observeForwardedRequest('machine-1', frame)
    expect(value.routeMachineFrame('machine-2', JSON.stringify({
      type: 'res', id: frame.id, ok: true, payload: {},
    }))).toBe(false)
  })

  it('returns structured machine_offline and destroys the route', () => {
    const value = relay()
    const owner = socket()
    const frame = request('request-offline')
    value.registerClientRequest({ socket: owner as never, machineId: 'machine-1', frame, mode: 'legacy' })
    value.observeForwardedRequest('machine-1', frame)

    expect(value.rejectMachineOffline(frame.id)).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('machine_offline'))
    expect(value.rejectMachineOffline(frame.id)).toBe(false)
  })

  it('rejects in-flight body status and tool detail requests when the session is deleted', () => {
    const value = relay()
    const detailSocket = socket()
    const statusSocket = socket()
    value.registerClientRequest({
      socket: detailSocket as never, machineId: 'machine-1',
      frame: request('detail-delete'), mode: 'legacy',
    })
    value.registerClientRequest({
      socket: statusSocket as never, machineId: 'machine-1',
      frame: statusRequest('status-delete'), mode: 'legacy',
    })

    value.invalidateSession('session-1')

    expect(detailSocket.send).toHaveBeenCalledWith(expect.stringContaining('session_deleted'))
    expect(statusSocket.send).toHaveBeenCalledWith(expect.stringContaining('session_deleted'))
    expect(value.rejectMachineOffline('detail-delete')).toBe(false)
    expect(value.rejectMachineOffline('status-delete')).toBe(false)
  })

  it('returns machine_offline without claiming not_found for message status', () => {
    const value = relay()
    const owner = socket()
    const frame = statusRequest('message-status-offline')
    value.registerClientRequest({
      socket: owner as never, machineId: 'machine-1', frame, mode: 'legacy',
    })
    expect(value.rejectMachineOffline(frame.id)).toBe(true)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('"ok":false'))
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('machine_offline'))
    expect(owner.send).not.toHaveBeenCalledWith(expect.stringContaining('not_found'))
  })

  it('does not let a second client replace an in-flight request id', () => {
    const value = relay()
    const frame = request('duplicate-id')
    value.registerClientRequest({ socket: socket() as never, machineId: 'machine-1', frame, mode: 'legacy' })
    expect(() => value.registerClientRequest({
      socket: socket() as never, machineId: 'machine-1', frame, mode: 'legacy',
    })).toThrow('request_id_conflict')
  })

  it('expires an unanswered one-shot route with a structured reason', () => {
    vi.useFakeTimers()
    const value = relay()
    const owner = socket()
    const frame = request('request-timeout')
    value.registerClientRequest({ socket: owner as never, machineId: 'machine-1', frame, mode: 'legacy' })

    vi.advanceTimersByTime(15_001)
    expect(owner.send).toHaveBeenCalledWith(expect.stringContaining('request_timeout'))
    expect(value.rejectMachineOffline(frame.id)).toBe(false)
  })
})
