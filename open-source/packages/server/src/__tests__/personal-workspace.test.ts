// @covers open-source/packages/server/src/routes/personal-workspace.ts
// @covers open-source/packages/server/src/services/personal-workspace/primary-machine.ts
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ machine: vi.fn(), machines: vi.fn(), device: vi.fn(), relay: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: mocks.machine, findMany: mocks.machines }, device: { findUnique: mocks.device }, personalModuleRecord: { findUnique: mocks.get, create: mocks.create, updateMany: mocks.update } } }))
vi.mock('../services/review-account-policy.js', () => ({ requireNonReviewMachineAccess: async (r: { userId: string }, reply: { code(n: number): { send(v: unknown): void } }) => { if (r.userId === 'review') return reply.code(403).send({ error: 'review_account_machine_access_forbidden' }) } }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: mocks.relay }))
vi.mock('../middleware/auth.js', () => {
  const authenticate = async (r: { headers: { authorization?: string }; userId: string; deviceId: string; machineId?: string }, reply: { code(n: number): { send(v: object): void } }) => {
    if (!r.headers.authorization) return reply.code(401).send({ error: 'missing_token' })
    r.userId = r.headers.authorization.replace('-cli', ''); r.deviceId = r.userId + '-device'
    if (r.headers.authorization.endsWith('-cli')) r.machineId = 'machine'
  }
  return { registerAuthDecorators: () => {}, requireActivePlan: async () => {}, requireAuth: authenticate, requireUserOrMachineAuth: authenticate }
})
import { personalWorkspaceRoutes } from '../routes/personal-workspace.js'
async function app() { const a = Fastify(); await a.register(personalWorkspaceRoutes, { prefix: '/api/personal-workspace' }); return a }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.machine.mockImplementation(async ({ where }) => where.userId === 'owner' ? { id: where.id, name: 'QA Mac', online: true } : null)
  mocks.machines.mockResolvedValue([])
  mocks.device.mockImplementation(async ({ where }) => ({ userId: where.id.replace(/-device$/, '') }))
  mocks.get.mockResolvedValue({ payload: { machineId: 'machine' }, revision: 1 })
  mocks.relay.mockResolvedValue({ ok: true, payload: { entries: [], readOnly: true } })
  mocks.update.mockResolvedValue({ count: 1 })
})
describe('one confirmed primary computer for personal files', () => {
  it('requires auth, live own device, ownership, pairing and enabled access', async () => {
    const a = await app()
    const invoke = (authorization?: string) => a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: authorization ? { authorization } : {}, payload: { action: 'list', kind: 'memory', expectedPrimaryRevision: 1 } })
    try {
      expect((await invoke()).statusCode).toBe(401)
      expect((await invoke('review')).statusCode).toBe(403)
      expect((await invoke('grantee')).json().error).toBe('personal_primary_unavailable')
      expect(mocks.relay).not.toHaveBeenCalled()
      expect(mocks.machine).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'machine', userId: 'grantee', paired: true, remoteAccessDisabledAt: null } }))
      const ok = await invoke('owner'); expect(ok.statusCode).toBe(200); expect(ok.headers['cache-control']).toBe('no-store')
      expect(mocks.relay).toHaveBeenCalledWith('machine', expect.objectContaining({ method: 'personal.workspace', params: { action: 'list', kind: 'memory' } }), 20000)
      mocks.device.mockResolvedValue(null); expect((await invoke('owner')).statusCode).toBe(401)
    } finally { await a.close() }
  })
  it('rejects writes/root overrides and never silently picks a different or offline computer', async () => {
    const a = await app()
    const invoke = (payload: unknown) => a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload })
    try {
      expect((await invoke({ action: 'write' })).statusCode).toBe(400)
      expect((await invoke({ action: 'read', rootPath: '/' })).statusCode).toBe(400)
      expect(mocks.relay).not.toHaveBeenCalled()
      mocks.relay.mockResolvedValue({ ok: false, error: 'unknown_method' })
      expect((await invoke({ action: 'info', expectedPrimaryRevision: 1 })).json().error).toBe('personal_client_upgrade_required')
      mocks.machine.mockResolvedValue({ id: 'machine', online: false })
      expect((await invoke({ action: 'info', expectedPrimaryRevision: 1 })).json().error).toBe('personal_machine_offline')
      mocks.get.mockResolvedValue(null)
      expect((await invoke({ action: 'info', expectedPrimaryRevision: 0 })).json().error).toBe('personal_primary_not_configured')
    } finally { await a.close() }
  })
  it('requires explicit confirmation, exact revision and a compatible Client; handles concurrent setting updates', async () => {
    const a = await app()
    const invoke = (payload: unknown) => a.inject({ method: 'PUT', url: '/api/personal-workspace/primary-machine', headers: { authorization: 'owner' }, payload })
    try {
      expect((await invoke({ machineId: 'other', expectedRevision: 1 })).statusCode).toBe(400)
      expect((await invoke({ machineId: 'other', expectedRevision: 0, confirmed: true })).statusCode).toBe(409)
      const input = { machineId: 'other', expectedRevision: 1, confirmed: true }
      expect((await invoke(input)).json()).toMatchObject({ machine: { id: 'other' }, revision: 2 })
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revision: 1, userId: 'owner' }) }))
      mocks.update.mockResolvedValue({ count: 0 }); expect((await invoke(input)).statusCode).toBe(409)
      mocks.relay.mockResolvedValue({ ok: false, error: 'unknown_method' }); expect((await invoke(input)).json().error).toBe('personal_client_upgrade_required')
      mocks.get.mockResolvedValue(null); mocks.relay.mockResolvedValue({ ok: true, payload: { readOnly: true } }); mocks.create.mockRejectedValue({ code: 'P2002' })
      expect((await invoke({ ...input, expectedRevision: 0 })).statusCode).toBe(409)
    } finally { await a.close() }
  })
  it('rejects stale read targets and restricts CLI selection to its own paired machine', async () => {
    const a = await app()
    try {
      const stale = await a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'info', expectedPrimaryRevision: 0 } })
      expect(stale.statusCode).toBe(409); expect(mocks.relay).not.toHaveBeenCalled()
      const cli = await a.inject({ method: 'PUT', url: '/api/personal-workspace/primary-machine-cli', headers: { authorization: 'owner-cli' }, payload: { machineId: 'other', expectedRevision: 1, confirmed: true } })
      expect(cli.statusCode).toBe(400)
      const web = await a.inject({ url: '/api/personal-workspace/primary-machine-cli', headers: { authorization: 'owner' } }); expect(web.statusCode).toBe(403)
      mocks.get.mockResolvedValueOnce({ payload: { machineId: 'machine' }, revision: 1 }).mockResolvedValueOnce({ payload: { machineId: 'other' }, revision: 2 })
      const changed = await a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'info', expectedPrimaryRevision: 1 } }); expect(changed.statusCode).toBe(409)
    } finally { await a.close() }
  })
})

it('saves model settings only to the confirmed owned primary and strips all credentials from the reply', async () => {
  const a = await app()
  vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', 'true')
  const settings = { mode: 'custom', model: 'qa-model', baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-client-key' }
  try {
    const invoke = (revision: number) => a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'model_set', settings, expectedPrimaryRevision: revision } })
    expect((await invoke(0)).statusCode).toBe(409)
    expect(mocks.relay).not.toHaveBeenCalled()
    mocks.relay.mockResolvedValue({ ok: true, payload: { ...settings, hasApiKey: true, contextWindow: 65536, accidentalSecret: 'must-not-return' } })
    const response = await invoke(1)
    expect(response.statusCode).toBe(200)
    expect(mocks.relay).toHaveBeenCalledWith('machine', expect.objectContaining({ method: 'personal.workspace', params: { action: 'model_set', settings } }), 20000)
    expect(response.json()).toMatchObject({ mode: 'custom', model: 'qa-model', hasApiKey: true })
    expect(response.body).not.toContain('synthetic-client-key')
    expect(response.body).not.toContain('must-not-return')
  } finally { vi.unstubAllEnvs(); await a.close() }
})

it('leaves existing personal workspace reads available but refuses model settings when disabled', async () => {
  vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', 'false')
  const a = await app()
  try {
    for (const action of ['model_info', 'model_set']) {
      const result = await a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action, expectedPrimaryRevision: 1, ...(action === 'model_set' ? { settings: { mode: 'official' } } : {}) } })
      expect(result.statusCode).toBe(503); expect(result.json().error).toBe('personal_model_unavailable')
    }
    expect(mocks.relay).not.toHaveBeenCalled()
    const result = await a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'info', expectedPrimaryRevision: 1 } })
    expect(result.statusCode).toBe(200); expect(mocks.relay).toHaveBeenCalledOnce()
  } finally { vi.unstubAllEnvs(); await a.close() }
})

it('forwards Worker defaults through the owner primary CAS boundary and rejects stale or extraneous inputs', async () => {
  const a = await app()
  try {
    const settings = { agentType: 'codex', modelId: null, workDir: '/project-default' }
    const invoke = (expectedPrimaryRevision: number, extra = {}) => a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'worker_set', settings, expectedPrimaryRevision, ...extra } })
    expect((await invoke(0)).statusCode).toBe(409)
    expect(mocks.relay).not.toHaveBeenCalled()
    mocks.relay.mockResolvedValue({ ok: true, payload: settings })
    const result = await invoke(1)
    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject(settings)
    expect(mocks.relay).toHaveBeenCalledWith('machine', expect.objectContaining({ method: 'personal.workspace', params: { action: 'worker_set', settings } }), 20000)
    expect((await invoke(1, { machineId: 'other' })).statusCode).toBe(400)
    mocks.relay.mockResolvedValue({ ok: true, payload: { ...settings, defaultWorkDir: '/agent', agents: [{ type: 'shennian', models: [] }] } })
    const info = await a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload: { action: 'worker_info', expectedPrimaryRevision: 1 } })
    expect(info.json()).toMatchObject({ workDir: '/project-default', defaultWorkDir: '/agent', agents: [{ type: 'shennian', models: [] }] })
  } finally { await a.close() }
})

it('routes bounded diary edits through owner-only primary CAS and returns file conflicts without retrying', async () => {
  const a = await app()
  const input = { action: 'diary_write', kind: 'diary', path: '2026/2026-10-23.md', content: '# Edited', expectedRevision: 'a'.repeat(64), expectedPrimaryRevision: 1 }
  const invoke = (payload: unknown) => a.inject({ method: 'POST', url: '/api/personal-workspace/primary', headers: { authorization: 'owner' }, payload })
  try {
    expect((await invoke({ ...input, kind: 'memory' })).statusCode).toBe(400)
    expect((await invoke({ ...input, content: 'x'.repeat(512 * 1024 + 1) })).statusCode).toBe(400)
    expect((await invoke({ ...input, expectedRevision: '' })).statusCode).toBe(400)
    expect((await invoke({ ...input, expectedPrimaryRevision: 0 })).statusCode).toBe(409)
    expect(mocks.relay).not.toHaveBeenCalled()
    mocks.relay.mockResolvedValue({ ok: false, error: 'personal_file_changed' })
    expect((await invoke(input)).statusCode).toBe(409)
    expect(mocks.relay).toHaveBeenCalledTimes(1)
    expect(mocks.relay).toHaveBeenCalledWith('machine', expect.objectContaining({ params: { action: 'diary_write', kind: 'diary', path: input.path, content: input.content, expectedRevision: input.expectedRevision } }), 20000)
    mocks.relay.mockClear(); mocks.relay.mockResolvedValue({ ok: true, payload: { content: input.content, revision: 'b'.repeat(64) } })
    const large = await invoke({ ...input, content: '文'.repeat(170000) })
    expect(large.statusCode).toBe(200); expect(large.headers['cache-control']).toBe('no-store')
  } finally { await a.close() }
})


it('persists the only eligible owned computer, including offline, and keeps it when another is added', async () => {
  const a = await app()
  const stored = { payload: { machineId: 'only' }, revision: 1 }
  mocks.get.mockResolvedValue(null)
  mocks.machines.mockResolvedValue([{ id: 'only' }])
  mocks.machine.mockResolvedValue({ id: 'only', name: 'Only', online: false })
  mocks.create.mockImplementation(async () => { mocks.get.mockResolvedValue(stored); return stored })
  try {
    const get = () => a.inject({ url: '/api/personal-workspace/primary-machine', headers: { authorization: 'owner' } })
    expect((await get()).json()).toMatchObject({ machine: { id: 'only', online: false }, revision: 1 })
    expect(mocks.machines).toHaveBeenCalledWith({ where: { userId: 'owner', paired: true, remoteAccessDisabledAt: null }, select: { id: true }, take: 2 })
    mocks.machines.mockResolvedValue([{ id: 'only' }, { id: 'new' }])
    expect((await get()).json()).toMatchObject({ machine: { id: 'only' }, revision: 1 })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.machines).toHaveBeenCalledTimes(1)
    expect(mocks.relay).not.toHaveBeenCalled()
    mocks.machine.mockResolvedValue(null)
    expect((await get()).json()).toEqual({ machine: null, revision: 1, unavailable: true })
    expect(mocks.machines).toHaveBeenCalledTimes(1)
  } finally { await a.close() }
})

it('leaves zero or multiple eligible computers unselected and preserves a concurrent saved choice', async () => {
  const a = await app()
  mocks.get.mockResolvedValue(null)
  const get = () => a.inject({ url: '/api/personal-workspace/primary-machine', headers: { authorization: 'owner' } })
  try {
    for (const machines of [[], [{ id: 'one' }, { id: 'two' }]]) {
      mocks.machines.mockResolvedValue(machines)
      expect((await get()).json()).toEqual({ machine: null, revision: 0 })
    }
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.machines.mockResolvedValue([{ id: 'only' }])
    mocks.create.mockImplementation(async () => {
      mocks.get.mockResolvedValue({ payload: { machineId: 'chosen' }, revision: 1 })
      throw { code: 'P2002' }
    })
    expect((await get()).json()).toMatchObject({ machine: { id: 'chosen' }, revision: 1 })
    expect(mocks.update).not.toHaveBeenCalled()
  } finally { await a.close() }
})
