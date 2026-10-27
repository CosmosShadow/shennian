// @covers src/routes/personal-recordings.ts
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ machine: vi.fn(), device: vi.fn(), primary: vi.fn(), relay: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: mocks.machine }, device: { findUnique: mocks.device }, personalModuleRecord: { findUnique: mocks.primary } } }))
vi.mock('../services/review-account-policy.js', () => ({ requireNonReviewMachineAccess: async (r: { userId: string }, reply: { code(n: number): { send(v: unknown): void } }) => { if (r.userId === 'review') return reply.code(403).send({ error: 'review_account_machine_access_forbidden' }) } }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: mocks.relay }))
vi.mock('../middleware/auth.js', () => ({ registerAuthDecorators: () => {}, requireActivePlan: async () => {}, requireAuth: async (r: { headers: { authorization?: string }; userId: string; deviceId: string }, reply: { code(n: number): { send(v: object): void } }) => {
  if (!r.headers.authorization) return reply.code(401).send({ error: 'missing_token' })
  r.userId = r.headers.authorization; r.deviceId = r.userId + '-device'
} }))
import { personalRecordingRoutes } from '../routes/personal-recordings.js'
const app = async () => { const a = Fastify(); await a.register(personalRecordingRoutes, { prefix: '/api/personal-recordings' }); return a }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.device.mockImplementation(async ({ where }) => ({ userId: where.id.replace(/-device$/, '') }))
  mocks.machine.mockImplementation(async ({ where }) => where.userId === 'alice' ? { id: where.id, online: true } : null)
  mocks.primary.mockResolvedValue({ payload: { machineId: 'main' }, revision: 3 })
  mocks.relay.mockResolvedValue({ ok: true, payload: { persisted: true, complete: false } })
})
describe('recording owner-device relay', () => {
  it('reads the authoritative primary setting and never trusts a shared machine', async () => {
    const a = await app()
    try {
      const body = { action: 'chunk', sessionKey: 's', batchKey: 'b', initialMachineId: 'main', initialPrimaryRevision: 3, confirmedPrimaryRevision: null, index: 0, base64: 'YQ==', size: 1, sha256: '0'.repeat(64) }
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'review' }, payload: body })).statusCode).toBe(403)
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'bob' }, payload: body })).statusCode).toBe(409)
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'alice' }, payload: body })).json()).toEqual({ persisted: true, complete: false })
      expect(mocks.primary).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_kind_key: { userId: 'alice', kind: 'personal-agent', key: 'primary-machine' } } }))
      expect(mocks.relay).toHaveBeenCalledWith('main', expect.objectContaining({ method: 'personal.recording', params: expect.objectContaining({ userId: 'alice' }) }), 20000)
      mocks.device.mockResolvedValue(null)
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'alice' }, payload: body })).statusCode).toBe(401)
    } finally { await a.close() }
  })
  it('keeps chunks pending until receiver acknowledges persistence and reports full storage', async () => {
    const a = await app()
    const body = { action: 'chunk', sessionKey: 's', batchKey: 'b', initialMachineId: 'main', initialPrimaryRevision: 3, confirmedPrimaryRevision: null, index: 0, base64: 'YQ==', size: 1, sha256: '0'.repeat(64) }
    try {
      mocks.relay.mockResolvedValue({ ok: false, error: 'recording_storage_full' })
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'alice' }, payload: body })).statusCode).toBe(507)
      mocks.relay.mockResolvedValue({ ok: true, payload: { persisted: false } })
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'alice' }, payload: body })).statusCode).toBe(503)
    } finally { await a.close() }
  })
  it('binds the first machine and revision; only a current explicit confirmation can keep the old target', async () => {
    const a = await app()
    const body = { action: 'chunk', sessionKey: 's', batchKey: 'b', initialMachineId: 'main', initialPrimaryRevision: 3, confirmedPrimaryRevision: null, index: 0, base64: 'YQ==', size: 1, sha256: '0'.repeat(64) }
    const post = (payload: object, machineId = 'main') => a.inject({ method: 'POST', url: `/api/personal-recordings/machines/${machineId}`, headers: { authorization: 'alice' }, payload })
    try {
      expect((await post({ ...body, initialMachineId: 'other' })).statusCode).toBe(400)
      mocks.primary.mockResolvedValue({ payload: { machineId: 'new-main' }, revision: 4 })
      expect((await post(body)).statusCode).toBe(409)
      expect(mocks.relay).not.toHaveBeenCalled()
      expect((await post({ ...body, confirmedPrimaryRevision: 4 })).statusCode).toBe(200)
      expect(mocks.relay).toHaveBeenCalledWith('main', expect.anything(), 20000)
      mocks.primary.mockResolvedValue({ payload: { machineId: 'third-main' }, revision: 5 })
      expect((await post({ ...body, confirmedPrimaryRevision: 4 })).statusCode).toBe(409)
      expect(mocks.relay).toHaveBeenCalledTimes(1)
    } finally { await a.close() }
  })
  it('does not acknowledge persistence when the primary changes during relay', async () => {
    const a = await app()
    const body = { action: 'chunk', sessionKey: 's', batchKey: 'b', initialMachineId: 'main', initialPrimaryRevision: 3, confirmedPrimaryRevision: null, index: 0, base64: 'YQ==', size: 1, sha256: '0'.repeat(64) }
    try {
      mocks.relay.mockImplementationOnce(async () => { mocks.primary.mockResolvedValue({ payload: { machineId: 'new-main' }, revision: 4 }); return { ok: true, payload: { persisted: true } } })
      expect((await a.inject({ method: 'POST', url: '/api/personal-recordings/machines/main', headers: { authorization: 'alice' }, payload: body })).statusCode).toBe(409)
    } finally { await a.close() }
  })
})
