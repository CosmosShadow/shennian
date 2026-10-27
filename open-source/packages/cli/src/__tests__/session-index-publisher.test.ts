// @covers src/session/index-publisher.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listPending, acknowledge, claimTitleCandidates, applyGeneratedTitle, deferTitleGeneration, recordReject } = vi.hoisted(() => ({
  listPending: vi.fn(),
  acknowledge: vi.fn(),
  claimTitleCandidates: vi.fn(),
  applyGeneratedTitle: vi.fn(),
  deferTitleGeneration: vi.fn(),
  recordReject: vi.fn((input: { disposition: string }) => input.disposition),
}))
vi.mock('../session/store.js', () => ({
  listPendingSessionIndexUpdates: listPending,
  acknowledgeSessionIndexUpdate: acknowledge,
  claimSessionTitleGenerationCandidates: claimTitleCandidates,
  applyGeneratedSessionTitle: applyGeneratedTitle,
  deferSessionTitleGeneration: deferTitleGeneration,
  recordSessionIndexRejection: recordReject,
  listSessionRecords: vi.fn(() => []),
  purgeCanonicalSession: vi.fn(),
  purgeSessionRecord: vi.fn(),
}))

import { publishPendingSessionIndexes } from '../session/index-publisher.js'
import { SessionSyncRejectedError } from '../relay/client.js'

function update(revision: number, sessionId = 'session-1') {
  return {
    protocolVersion: 2,
    dataEpoch: 2,
    daemonInstallationId: 'daemon-1',
    session: { id: sessionId, indexRevision: revision },
  }
}

describe('session index publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPending.mockReturnValue([])
    claimTitleCandidates.mockReturnValue([])
    recordReject.mockImplementation((input: { disposition: string }) => input.disposition)
  })

  it('publishes the latest dirty projection and clears it only after ACK', async () => {
    listPending.mockReturnValue([update(4)])
    const client = { sendBufferedEvent: vi.fn(async () => {}), sendReq: vi.fn() }
    await publishPendingSessionIndexes(client as never)
    expect(client.sendBufferedEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'session.index.updated', id: 'session-index-daemon-1-session-1-4',
    }), 60_000)
    expect(acknowledge).toHaveBeenCalledWith('session-1', 4)
  })

  it('does not clear dirty state when relay persistence fails', async () => {
    listPending.mockReturnValue([update(5)])
    const client = { sendBufferedEvent: vi.fn(async () => { throw new Error('offline') }), sendReq: vi.fn() }
    await expect(publishPendingSessionIndexes(client as never)).rejects.toThrow('one or more session indexes failed')
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('terminalizes an unstructured rejection and continues later sessions', async () => {
    listPending.mockReturnValue([update(5, 'poisoned'), update(2, 'healthy')])
    const client = {
      sendBufferedEvent: vi.fn(async (frame: { payload: { session: { id: string } } }) => {
        if (frame.payload.session.id === 'poisoned') throw new Error('title revision conflict')
      }),
      sendReq: vi.fn(),
    }

    await expect(publishPendingSessionIndexes(client as never)).resolves.toBeUndefined()
    expect(client.sendBufferedEvent).toHaveBeenCalledTimes(2)
    expect(acknowledge).toHaveBeenCalledWith('healthy', 2)
    expect(acknowledge).not.toHaveBeenCalledWith('poisoned', 5)
    expect(recordReject).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'poisoned', disposition: 'terminal', code: 'unstructured_rejection',
    }))
  })

  it('quarantines a permanently invalid record without retrying the batch', async () => {
    listPending.mockReturnValue([update(7, 'invalid')])
    const client = {
      sendBufferedEvent: vi.fn(async () => {
        throw new SessionSyncRejectedError({
          code: 'invalid_identity', retryable: false, requiredAction: 'quarantine_record',
        })
      }),
      sendReq: vi.fn(),
    }

    await expect(publishPendingSessionIndexes(client as never)).resolves.toBeUndefined()
    expect(recordReject).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'invalid', indexRevision: 7, disposition: 'quarantined',
    }))
  })

  it('stops the old connection on ownership transfer without clearing canonical', async () => {
    listPending.mockReturnValue([update(8, 'moved')])
    const client = {
      sendBufferedEvent: vi.fn(async () => {
        throw new SessionSyncRejectedError({
          code: 'ownership_transferred', retryable: false,
          requiredAction: 'refresh_machine_ownership',
        })
      }),
      sendReq: vi.fn(),
      disconnect: vi.fn(),
    }

    await publishPendingSessionIndexes(client as never)
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(recordReject).toHaveBeenCalledWith(expect.objectContaining({ disposition: 'terminal' }))
  })

  it('single-flights concurrent publish attempts', async () => {
    listPending.mockReturnValue([update(6)])
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const client = { sendBufferedEvent: vi.fn(() => blocked), sendReq: vi.fn() }
    const first = publishPendingSessionIndexes(client as never)
    const second = publishPendingSessionIndexes(client as never)
    expect(first).toBe(second)
    expect(client.sendBufferedEvent).toHaveBeenCalledTimes(1)
    listPending.mockReturnValue([])
    release()
    await first
  })

  it('sends an ephemeral titleSeed only through a non-buffered request and applies the result', async () => {
    claimTitleCandidates
      .mockReturnValueOnce([{
        sessionId: 'session-1', requestId: 'seed-1', titleSeed: '修复手机同步',
        baseTitleRevision: 1, eligibility: 'grace_elapsed',
      }])
      .mockReturnValue([])
    applyGeneratedTitle.mockReturnValue(true)
    const client = {
      sendBufferedEvent: vi.fn(async () => {}),
      sendReq: vi.fn(async () => ({
        type: 'res', id: 'response-1', ok: true,
        payload: {
          generated: true, title: '手机同步修复', titleSource: 'shennian_generated',
          titleRevision: 2, titleOriginEventId: 'shennian-generated:seed-1',
        },
      })),
    }

    await publishPendingSessionIndexes(client as never)

    expect(client.sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: 'session.title.generate',
      params: expect.objectContaining({ titleSeed: '修复手机同步', requestId: 'seed-1' }),
    }), 15_000)
    expect(JSON.stringify(client.sendBufferedEvent.mock.calls)).not.toContain('修复手机同步')
    expect(applyGeneratedTitle).toHaveBeenCalledWith('session-1', expect.objectContaining({
      titleSource: 'shennian_generated', titleRevision: 2,
    }))
  })

  it('defers a title candidate when the server has not accepted it', async () => {
    claimTitleCandidates.mockReturnValueOnce([{
      sessionId: 'session-1', requestId: 'seed-1', titleSeed: '同步标题',
      baseTitleRevision: 1, eligibility: 'terminal',
    }]).mockReturnValue([])
    const client = {
      sendBufferedEvent: vi.fn(async () => {}),
      sendReq: vi.fn(async () => ({
        type: 'res', id: 'response-1', ok: true,
        payload: { generated: false, reason: 'superseded' },
      })),
    }

    await publishPendingSessionIndexes(client as never)

    expect(deferTitleGeneration).toHaveBeenCalledWith('session-1')
    expect(applyGeneratedTitle).not.toHaveBeenCalled()
  })
})
