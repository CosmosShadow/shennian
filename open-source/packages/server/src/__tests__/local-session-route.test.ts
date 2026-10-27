// @covers open-source/packages/server/src/routes/sessions.ts
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../services/sessions.js', () => ({
  createSessionForUser: create, deleteSessionForUser: vi.fn(), getUserSessionIndex: vi.fn(),
  listMachineSessions: vi.fn(), listUserSessionActivities: vi.fn(), listUserSessions: vi.fn(),
  renameSessionForUser: vi.fn(), updateSessionUserState: vi.fn(),
}))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: () => {}, requireActivePlan: async () => {},
  requireAuth: async (request: { userId: string }) => { request.userId = 'owner' },
}))
vi.mock('../middleware/personal-sync-http.js', () => ({ requirePersonalSyncHttpEpoch: async () => {} }))
vi.mock('../services/review-account-policy.js', () => ({ requireNonReviewMachineAccess: async () => {} }))
import { sessionRoutes } from '../routes/sessions.js'
const app = Fastify()
await app.register(sessionRoutes, { prefix: '/sessions' })
const payload = { machineId: 'machine', workDir: '/project', agentType: 'codex', modelId: 'gpt-6-astra' }
afterEach(() => vi.clearAllMocks())
describe('local creation route boundary', () => {
  it('rejects arbitrary IDs without creating a record', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions/local/existing-session-id', payload })
    expect(res.statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
  it('scopes the stable creation key to the authenticated user', async () => {
    const id = 'sess_35b29532-bc66-4e20-8dca-f8bf73b8f898'
    const now = new Date()
    create.mockResolvedValue({ ...payload, id, userId: 'owner', lastActivityAt: now, createdAt: now, updatedAt: now })
    const res = await app.inject({ method: 'POST', url: `/sessions/local/${id}`, payload })
    expect(res.statusCode).toBe(200)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ ...payload, id, userId: 'owner', creationKey: `local:owner:${id}` }))
    expect(res.json().session).toMatchObject({ id, agentType: 'codex', modelId: 'gpt-6-astra' })
  })
  it('keeps the existing create route available without requiring a local ID', async () => {
    const now = new Date()
    create.mockResolvedValue({ ...payload, id: 'legacy', lastActivityAt: now, createdAt: now, updatedAt: now })
    expect((await app.inject({ method: 'POST', url: '/sessions', payload })).statusCode).toBe(200)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, creationKey: undefined }))
  })
})
