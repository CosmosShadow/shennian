// @covers src/services/personal-cloud-history.ts
// @covers src/routes/personal-cloud-history.ts
// @covers src/jobs/personal-cloud-history.ts
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION, type SessionHistorySyncParams } from '@shennian/wire'
const mocks = vi.hoisted(() => ({
  sessions: vi.fn(), claim: vi.fn(), current: vi.fn(), advance: vi.fn(), insert: vi.fn(), rows: vi.fn(), relay: vi.fn(), transaction: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  nianSession: { findMany: mocks.sessions, updateMany: mocks.claim, fields: { cloudBodyRevision: 'cloudBodyRevision' } },
  $transaction: mocks.transaction,
} }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: mocks.relay }))
import { readPersonalCloudHistory, syncPersonalCloudHistoryBatch, validateCloudHistoryPage } from '../services/personal-cloud-history.js'
import { registerPersonalCloudHistoryRoute } from '../routes/personal-cloud-history.js'
import { startPersonalCloudHistoryJob, stopPersonalCloudHistoryJob } from '../jobs/personal-cloud-history.js'
const params: SessionHistorySyncParams = { protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
  daemonInstallationId: 'daemon', sessionId: 'session', syncId: 'sync', afterRevision: 0, limit: 200 }
function page(request = params) {
  return { ...request, fromRevision: request.afterRevision, toRevision: request.afterRevision + 1,
    targetRevision: request.afterRevision + 1, hasMore: false,
    mutations: [{ ...request, subscriptionId: request.syncId, revision: request.afterRevision + 1,
      mutation: 'append', messageId: 'm1', sequence: 1,
      message: { id: 'm1', sessionId: request.sessionId, role: 'agent', ts: 1, payload: 'hello' } }],
  }
}
const selected = () => ({ id: 'session', userId: 'owner', machineId: 'machine', daemonInstallationId: 'daemon',
  cloudBodyRevision: 0, cloudBodyNextAttemptAt: new Date(0), machine: { userId: 'owner', daemonInstallationId: 'daemon' } })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SHENNIAN_CLOUD_PERSONAL_HISTORY_ENABLED', 'true')
  mocks.sessions.mockResolvedValue([selected()])
  mocks.claim.mockResolvedValue({ count: 1 }); mocks.advance.mockResolvedValue({ count: 1 })
  mocks.current.mockResolvedValue({ cloudBodyRevision: 1, bodyRevision: 1 })
  mocks.rows.mockResolvedValue([{ payload: page().mutations[0] }])
  mocks.relay.mockImplementation(async (_machine, frame) => ({ ok: true, payload: page(frame.params) }))
  mocks.transaction.mockImplementation(async run => run({
    nianSession: { findFirst: mocks.current, updateMany: mocks.advance },
    personalSessionCloudMutation: { findMany: mocks.rows, createMany: mocks.insert },
  }))
})
afterEach(async () => { await stopPersonalCloudHistoryJob(); vi.useRealTimers(); vi.unstubAllEnvs() })

describe('durable personal cloud replica', () => {
  it('does not touch new tables or contact a daemon before explicit enablement', async () => {
    vi.stubEnv('SHENNIAN_CLOUD_PERSONAL_HISTORY_ENABLED', 'false')
    await syncPersonalCloudHistoryBatch()
    await expect(readPersonalCloudHistory('owner', params)).rejects.toThrow('cloud_history_disabled')
    expect(mocks.sessions).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('backfills without any phone connected, using the persisted cloud cursor', async () => {
    await syncPersonalCloudHistoryBatch(new Date(1000))
    expect(mocks.relay).toHaveBeenCalledWith('machine', expect.objectContaining({ method: 'session.history.sync',
      params: expect.objectContaining({ afterRevision: 0, daemonInstallationId: 'daemon' }) }), 30000)
    expect(mocks.sessions).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      bodyRevision: { gt: 'cloudBodyRevision' }, roomBinding: { is: null },
      OR: expect.arrayContaining([expect.objectContaining({ sessionScope: 'steward' })]),
      machine: expect.objectContaining({ online: true, paired: true, remoteAccessDisabledAt: null }),
    }) }))
    expect(mocks.insert).toHaveBeenCalledWith({ data: [expect.objectContaining({ sessionId: 'session', revision: 1,
      payload: expect.objectContaining({ subscriptionId: '', message: expect.objectContaining({ payload: 'hello' }) }) })] })
    expect(mocks.advance).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: 'owner', cloudBodyRevision: 0, machine: expect.objectContaining({ paired: true, remoteAccessDisabledAt: null, userId: 'owner' }),
    }), data: { cloudBodyRevision: 1, cloudBodyNextAttemptAt: new Date(1000) } }))
  })
  it('stores the visible contract only, dropping private ledger fields and attachment preview bytes', async () => {
    mocks.relay.mockImplementation(async (_machine, frame) => {
      const value = page(frame.params)
      const message = value.mutations[0].message
      message.role = 'user'
      message.payload = JSON.stringify({ v: 1, type: 'user', content: 'file', attachments: [{
        path: '/work/file.png', name: 'file.png', kind: 'image', mimeType: 'image/png',
        previewData: 'data:image/png;base64,PRIVATE_BYTES',
      }] })
      return { ok: true, payload: { ...value, mutations: [{ ...value.mutations[0], contentHash: 'private-hash', sourceEvent: 'raw-log' }] } }
    })
    await syncPersonalCloudHistoryBatch()
    const persisted = mocks.insert.mock.calls[0][0].data[0].payload
    expect(persisted).not.toHaveProperty('contentHash'); expect(persisted).not.toHaveProperty('sourceEvent')
    expect(JSON.parse(persisted.message.payload)).toEqual({ v: 1, type: 'user', content: 'file', attachments: [{
      path: '/work/file.png', name: 'file.png', kind: 'image', mimeType: 'image/png',
    }] })
  })
  it('uses a durable claim and does not duplicate requests when another Worker wins', async () => {
    mocks.claim.mockResolvedValue({ count: 0 })
    await syncPersonalCloudHistoryBatch()
    expect(mocks.relay).not.toHaveBeenCalled()
  })
  it('does not insert or resurrect history when deletion/transfer wins during the request', async () => {
    mocks.advance.mockResolvedValue({ count: 0 })
    await syncPersonalCloudHistoryBatch()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it.each(['owner', 'installation'])('rejects a mismatched %s before contacting the daemon', async kind => {
    const row = selected()
    if (kind === 'owner') row.machine.userId = 'other'
    else row.machine.daemonInstallationId = 'other'
    mocks.sessions.mockResolvedValue([row])
    await syncPersonalCloudHistoryBatch()
    expect(mocks.relay).not.toHaveBeenCalled()
  })
  it('leaves a retry deadline and never commits a failed or invalid source response', async () => {
    mocks.relay.mockResolvedValue({ ok: false, error: 'offline' })
    await syncPersonalCloudHistoryBatch(new Date(1000))
    expect(mocks.claim.mock.calls[0][0].data.cloudBodyNextAttemptAt).toEqual(new Date(61000))
    expect(mocks.transaction).not.toHaveBeenCalled()
    mocks.relay.mockResolvedValue({ ok: true, payload: { ...page(), fromRevision: 8 } })
    await syncPersonalCloudHistoryBatch()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('writes cursor and mutations in one transaction without skipDuplicates hiding corruption', async () => {
    mocks.insert.mockRejectedValue(new Error('duplicate_or_disk_failure'))
    await syncPersonalCloudHistoryBatch()
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('skipDuplicates')
    // The real database transaction rolls back the preceding cursor CAS on insert failure.
    expect(mocks.advance).toHaveBeenCalledOnce()
  })
  it('serves an offline machine from SQL without sending a Relay request', async () => {
    const result = await readPersonalCloudHistory('owner', params)
    expect(result.toRevision).toBe(1); expect(result.mutations[0].subscriptionId).toBe('sync')
    expect(mocks.relay).not.toHaveBeenCalled()
    const where = mocks.current.mock.calls[0][0].where
    expect(where).toMatchObject({ userId: 'owner', daemonInstallationId: 'daemon',
      machine: { userId: 'owner', paired: true, remoteAccessDisabledAt: null, daemonInstallationId: 'daemon' } })
    expect(where.machine).not.toHaveProperty('online')
  })
  it('does not expose history after deletion, unpairing, pause, or to another account/grantee', async () => {
    mocks.current.mockResolvedValue(null)
    await expect(readPersonalCloudHistory('other', params)).rejects.toThrow('cloud_history_not_found')
    expect(mocks.rows).not.toHaveBeenCalled()
    expect(mocks.current.mock.calls[0][0].where.machine.userId).toBe('other')
  })
  it('never substitutes an empty history for cloud lag or a phone already ahead', async () => {
    mocks.current.mockResolvedValue({ cloudBodyRevision: 0, bodyRevision: 5 })
    await expect(readPersonalCloudHistory('owner', params)).rejects.toThrow('cloud_history_pending')
    await expect(readPersonalCloudHistory('owner', { ...params, afterRevision: 2 })).rejects.toThrow('cloud_history_behind')
    expect(mocks.rows).not.toHaveBeenCalled()
  })
  it('detects missing persisted revisions instead of certifying an incomplete replica', async () => {
    mocks.current.mockResolvedValue({ cloudBodyRevision: 3, bodyRevision: 3 })
    mocks.rows.mockResolvedValue([{ payload: { ...page().mutations[0], revision: 2 } }])
    await expect(readPersonalCloudHistory('owner', params)).rejects.toThrow('invalid_cloud_history_page')
  })
  it('can resume from a newly instantiated Worker without an in-memory checkpoint', async () => {
    const row = { ...selected(), cloudBodyRevision: 40 }
    mocks.sessions.mockResolvedValue([row])
    await syncPersonalCloudHistoryBatch()
    expect(mocks.relay.mock.calls[0][1].params.afterRevision).toBe(40)
    expect(mocks.advance.mock.calls[0][0].data.cloudBodyRevision).toBe(41)
  })
  it('commits bounded pages and resumes exactly from the committed revision on the next batch', async () => {
    mocks.relay.mockImplementation(async (_machine, frame) => {
      const value = page(frame.params)
      return { ok: true, payload: { ...value, targetRevision: 2, hasMore: value.toRevision < 2 } }
    })
    await syncPersonalCloudHistoryBatch()
    mocks.sessions.mockResolvedValue([{ ...selected(), cloudBodyRevision: 1 }])
    await syncPersonalCloudHistoryBatch()
    expect(mocks.relay.mock.calls.map(call => call[1].params.afterRevision)).toEqual([0, 1])
    expect(mocks.advance.mock.calls.map(call => call[0].data.cloudBodyRevision)).toEqual([1, 2])
  })
  it('rebinds tombstone/upsert subscription identity when replaying a cloud page', async () => {
    const mutation = { ...page().mutations[0], mutation: 'tombstone', message: undefined }
    mocks.rows.mockResolvedValue([{ payload: mutation }])
    const result = await readPersonalCloudHistory('owner', params)
    expect(result.mutations[0]).toMatchObject({ mutation: 'tombstone', subscriptionId: 'sync' })
  })
  it('does not overlap job ticks and drains the in-flight request on stop', async () => {
    vi.useFakeTimers()
    let release!: () => void
    mocks.sessions.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]) }))
    startPersonalCloudHistoryJob()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.sessions).toHaveBeenCalledOnce()
    release(); await stopPersonalCloudHistoryJob()
    await vi.advanceTimersByTimeAsync(6000)
    expect(mocks.sessions).toHaveBeenCalledOnce()
  })
})

describe('strict cloud page validation', () => {
  it.each([
    { daemonInstallationId: 'other' }, { dataEpoch: 999 }, { sessionId: 'other' },
    { syncId: 'other' }, { fromRevision: 2 }, { toRevision: 2 }, { targetRevision: -1 }, { hasMore: true },
  ])('rejects cross-identity, gaps and inconsistent watermarks: %j', patch => {
    expect(() => validateCloudHistoryPage({ ...page(), ...patch }, params)).toThrow()
  })
  it.each([{ sequence: 0 }, { revision: 9 }, { sessionId: 'other' }, { subscriptionId: 'wrong' },
    { message: { ...page().mutations[0].message, sessionId: 'wrong' } }, { deliveryState: 'forged-state' }])('rejects malformed mutation: %j', patch => {
    expect(() => validateCloudHistoryPage({ ...page(), mutations: [{ ...page().mutations[0], ...patch }] }, params)).toThrow()
  })
})

describe('authenticated no-store cloud history HTTP', () => {
  async function app() {
    const server = Fastify()
    registerPersonalCloudHistoryRoute(server, [async (request, reply) => {
      if (!request.headers.authorization) return reply.code(401).send({ error: 'unauthorized' })
      request.userId = request.headers.authorization
    }])
    return server
  }
  const body = () => { const { sessionId: _id, ...input } = params; return input }
  it('requires authentication, validates input and never logs/returns private database errors', async () => {
    const a = await app()
    try {
      expect((await a.inject({ method: 'POST', url: '/session/cloud-history/sync', payload: body() })).statusCode).toBe(401)
      for (const patch of [{ afterRevision: -1 }, { limit: 0 }, { dataEpoch: 999 }]) {
        expect((await a.inject({ method: 'POST', url: '/session/cloud-history/sync', headers: { authorization: 'owner' }, payload: { ...body(), ...patch } })).statusCode).toBe(400)
      }
      const ok = await a.inject({ method: 'POST', url: '/session/cloud-history/sync', headers: { authorization: 'owner' }, payload: body() })
      expect(ok.statusCode).toBe(200); expect(ok.headers['cache-control']).toBe('no-store')
      mocks.current.mockRejectedValue(new Error('private SQL detail'))
      const failed = await a.inject({ method: 'POST', url: '/session/cloud-history/sync', headers: { authorization: 'owner' }, payload: body() })
      expect(failed.statusCode).toBe(503); expect(failed.json()).toEqual({ error: 'cloud_history_unavailable' })
    } finally { await a.close() }
  })
})
