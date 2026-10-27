// @covers src/services/personal-model-credentials.ts
// @covers src/services/personal-model-gateway.ts
// @covers src/routes/personal-model.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyRequest, FastifyReply } from 'fastify'
const state = vi.hoisted(() => ({ data: new Map<string, { value: string; expiry?: number }>(), machine: vi.fn(), allowed: vi.fn(), quota: vi.fn(), charge: vi.fn(), monthly: vi.fn(), settle: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: {
  get: vi.fn(async (key: string) => { const entry = state.data.get(key); return entry && (!entry.expiry || entry.expiry > Date.now()) ? entry.value : null }),
  set: vi.fn(async (key: string, value: string, _ex: string, seconds: number) => { state.data.set(key, { value, expiry: seconds ? Date.now() + seconds * 1000 : undefined }); return 'OK' }),
  del: vi.fn(async (key: string) => Number(state.data.delete(key))),
  incr: vi.fn(async (key: string) => { const entry = state.data.get(key); const value = Number(entry?.value ?? 0) + 1; state.data.set(key, { value: String(value), expiry: entry?.expiry }); return value }),
  expire: vi.fn(async (key: string, seconds: number) => { const entry = state.data.get(key); if (entry) entry.expiry = Date.now() + seconds * 1000; return 1 }),
} }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findUnique: state.machine } } }))
vi.mock('../services/jwt.js', () => ({ verifyMachineToken: (token: string) => token === 'issuer' ? { machineId: 'machine-a', type: 'machine' } : null }))
vi.mock('../middleware/auth.js', () => ({ registerAuthDecorators: () => {} }))
vi.mock('../services/agent-proxy.js', () => ({
  requireMachineOrUserAuth: async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers.authorization !== 'Bearer issuer') return reply.code(401).send({ error: 'invalid' })
    req.userId = 'account-a'; req.machineId = 'machine-a'
  },
  ensureNianHostedModelAllowed: state.allowed, reserveNianQuota: state.quota, chargeNianHostedModelUsage: state.charge,
  getNianQuotaConfig: () => ({ maxOutputTokens: 4096, requestTimeoutMs: 120000 }),
}))
vi.mock('../services/personal-model-quota.js', () => ({ reservePersonalModelQuota: state.monthly, readPersonalModelQuota: vi.fn(async () => ({ limit: 5000000, remaining: 5000000 })) }))
import { registerPersonalModelRoutes } from '../routes/personal-model.js'
import { OFFICIAL_PERSONAL_MODEL, credentialKey } from '../services/personal-model-credentials.js'
import { CompletionUsage, officialCompletion } from '../services/personal-model-gateway.js'
const priorKey = process.env.DASHSCOPE_API_KEY, priorUrl = process.env.PLATFORM_TEXT_BASE_URL
beforeEach(() => {
  vi.clearAllMocks(); state.data.clear(); vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', 'true')
  state.machine.mockResolvedValue({ userId: 'account-a', machineToken: 'issuer', paired: true, remoteAccessDisabledAt: null })
  state.monthly.mockResolvedValue({ settle: state.settle }); state.settle.mockResolvedValue(undefined)
  state.allowed.mockResolvedValue(null); state.quota.mockResolvedValue({ allowed: true }); state.charge.mockResolvedValue(null)
  process.env.DASHSCOPE_API_KEY = 'unit-model-key'; process.env.PLATFORM_TEXT_BASE_URL = 'https://provider.example/v1'
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); if (priorKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = priorKey; if (priorUrl === undefined) delete process.env.PLATFORM_TEXT_BASE_URL; else process.env.PLATFORM_TEXT_BASE_URL = priorUrl })
async function setup() {
  const app = Fastify(); await registerPersonalModelRoutes(app)
  const issue = await app.inject({ method: 'POST', url: '/api/personal-model/credential', headers: { authorization: 'Bearer issuer' } })
  return { app, token: issue.json().token as string }
}
const payload = () => ({ model: OFFICIAL_PERSONAL_MODEL, stream: true, messages: [{ role: 'user', content: 'hi' }] })
describe('long-lived model credentials', () => {
  it('serves the edge-rewritten path and direct-server alias with the same auth', async () => {
    const app = Fastify(); await registerPersonalModelRoutes(app)
    try {
      for (const prefix of ['/personal-model', '/api/personal-model']) {
        expect((await app.inject({ method: 'POST', url: `${prefix}/credential` })).statusCode).toBe(401)
        const issued = await app.inject({ method: 'POST', url: `${prefix}/credential`, headers: { authorization: 'Bearer issuer' } })
        expect(issued.statusCode).toBe(200)
        const models = await app.inject({ url: `${prefix}/v1/models`, headers: { authorization: `Bearer ${issued.json().token}` } })
        expect(models.statusCode).toBe(200)
        expect(models.json().data[0].id).toBe(OFFICIAL_PERSONAL_MODEL)
      }
    } finally { await app.close() }
  })

  it('does not register any model endpoints when explicitly disabled', async () => {
    for (const value of ['false']) {
      vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', value)
      const app = Fastify(); await registerPersonalModelRoutes(app)
      try {
        for (const [method, suffix] of [['POST', '/credential'], ['DELETE', '/credential'], ['POST', '/v1/chat/completions']] as const) {
          expect((await app.inject({ method, url: `/api/personal-model${suffix}` })).statusCode).toBe(404)
        }
      } finally { await app.close() }
    }
    expect(state.allowed).not.toHaveBeenCalled(); expect(state.machine).not.toHaveBeenCalled()
  })
  it('accepts the paired long-lived Client key directly without any issuance call', async () => {
    vi.stubEnv('SHENNIAN_BUILTIN_PERSONAL_AGENT_ENABLED', undefined)
    const app = Fastify(); await registerPersonalModelRoutes(app)
    try {
      const response = await app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: 'Bearer issuer' }, payload: { ...payload(), model: 'invalid' } })
      expect(response.statusCode).toBe(400)
      expect(state.data.size).toBe(0)
      state.machine.mockResolvedValueOnce({ userId: 'account-a', paired: false, machineToken: 'issuer' })
      const denied = await app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: 'Bearer issuer' }, payload: payload() })
      expect(denied.statusCode).toBe(401)
    } finally { await app.close() }
  })
  it('stores only a token digest, requires issuance auth, and cannot mint another credential', async () => {
    const { app, token } = await setup()
    try {
      expect(token).toMatch(/^snm_/)
      expect(state.data.has(credentialKey(token))).toBe(true)
      expect([...state.data.keys()].join('')).not.toContain(token)
      expect(JSON.stringify([...state.data.values()])).not.toContain('issuer')
      const response = await app.inject({ method: 'POST', url: '/api/personal-model/credential', headers: { authorization: `Bearer ${token}` } })
      expect(response.statusCode).toBe(401)
    } finally { await app.close() }
  })
  it('does not expire with time, explicitly revokes, and invalidates on machine disable, account change or token rotation', async () => {
    const { app, token } = await setup()
    const revoke = () => app.inject({ method: 'DELETE', url: '/api/personal-model/credential', headers: { authorization: `Bearer ${token}` } })
    try {
      expect((await revoke()).statusCode).toBe(200); expect((await revoke()).statusCode).toBe(401)
      for (const machine of [null, { userId: 'account-a', machineToken: 'issuer', paired: false }, { userId: 'another-account', machineToken: 'issuer' }, { userId: 'account-a', machineToken: 'changed' }, { userId: 'account-a', machineToken: 'issuer', remoteAccessDisabledAt: new Date() }]) {
        const issued = await app.inject({ method: 'POST', url: '/api/personal-model/credential', headers: { authorization: 'Bearer issuer' } })
        state.machine.mockResolvedValueOnce(machine)
        expect((await app.inject({ method: 'DELETE', url: '/api/personal-model/credential', headers: { authorization: `Bearer ${issued.json().token}` } })).statusCode).toBe(401)
      }
      const issued = await app.inject({ method: 'POST', url: '/api/personal-model/credential', headers: { authorization: 'Bearer issuer' } })
      vi.useFakeTimers(); vi.advanceTimersByTime(365 * 24 * 3600 * 1000)
      expect((await app.inject({ method: 'DELETE', url: '/api/personal-model/credential', headers: { authorization: `Bearer ${issued.json().token}` } })).statusCode).toBe(200)
    } finally { vi.useRealTimers(); await app.close() }
  })
})
describe('official model gateway', () => {
  it('pins the model and rebuilds requests without caller credentials, URLs or unbounded output', () => {
    const body = officialCompletion({ ...payload(), max_tokens: 9000, baseUrl: 'https://attacker.example', apiKey: 'caller-key', tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] })
    expect(body).toMatchObject({ max_tokens: 4096, model: OFFICIAL_PERSONAL_MODEL, enable_thinking: false })
    expect(body).not.toHaveProperty('baseUrl'); expect(body).not.toHaveProperty('apiKey')
    for (const patch of [{ model: 'other' }, { messages: [] }, { max_tokens: -1 }, { temperature: 20 }]) expect(() => officialCompletion({ ...payload(), ...patch })).toThrow()
  })
  it('preserves SSE tool calls and charges observed usage to the credential owner', async () => {
    const raw = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"t","function":{"name":"read","arguments":"{}"}}]}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":7}}\n\ndata: [DONE]\n\n'
    const upstream = vi.fn(async () => new Response(raw, { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const { app, token } = await setup()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: `Bearer ${token}` }, payload: payload() })
      expect(response.statusCode).toBe(200); expect(response.body).toBe(raw)
      await vi.waitFor(() => expect(state.charge).toHaveBeenCalledWith(expect.objectContaining({ userId: 'account-a', inputTokens: 31, outputTokens: 7 })))
      expect(upstream.mock.calls[0]?.[0]).toBe('https://provider.example/v1/chat/completions')
      expect(response.body).not.toContain('unit-model-key')
    } finally { await app.close() }
  })
  it('supports authenticated OpenAI model discovery and non-stream completions with billing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'completion-test', object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1 } }), { status: 200 })))
    const { app, token } = await setup()
    try {
      const models = await app.inject({ url: '/api/personal-model/v1/models', headers: { authorization: `Bearer ${token}` } })
      expect(models.json().data[0].id).toBe(OFFICIAL_PERSONAL_MODEL)
      const result = await app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: `Bearer ${token}` }, payload: { ...payload(), stream: false } })
      expect(result.statusCode).toBe(200); expect(result.json().choices[0].message.content).toBe('OK')
      expect(state.charge).toHaveBeenCalledOnce()
      expect(state.charge).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 4, outputTokens: 1, userId: 'account-a' }))
    } finally { await app.close() }
  })
  it('applies quota before any provider request and sanitizes upstream errors', async () => {
    const upstream = vi.fn(async () => new Response('secret-diagnostic', { status: 401 })); vi.stubGlobal('fetch', upstream)
    const { app, token } = await setup()
    const invoke = () => app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: `Bearer ${token}` }, payload: payload() })
    try {
      state.quota.mockResolvedValueOnce({ allowed: false, statusCode: 429, code: 'nian_quota_exceeded', retryAfterSeconds: 60 })
      expect((await invoke()).statusCode).toBe(429); expect(upstream).not.toHaveBeenCalled()
      const error = await invoke(); expect(error.statusCode).toBe(502); expect(error.body).not.toContain('secret-diagnostic')
      expect(state.charge).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('observes split usage lines without changing provider bytes', async () => {
    const meter = new CompletionUsage(), chunks: Buffer[] = []
    meter.on('data', chunk => chunks.push(chunk))
    const done = new Promise<void>((resolve, reject) => { meter.on('end', resolve); meter.on('error', reject) })
    const raw = 'data: {"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n'
    for (const byte of Buffer.from(raw)) meter.write(Buffer.from([byte]))
    meter.end(); await done
    expect(Buffer.concat(chunks).toString()).toBe(raw); expect(meter.inputTokens).toBe(12); expect(meter.outputTokens).toBe(3)
  })
})

it('rejects exhausted monthly allowance before upstream and conservatively settles missing usage', async () => {
  const upstream = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', upstream)
  const { app, token } = await setup()
  const invoke = () => app.inject({ method: 'POST', url: '/api/personal-model/v1/chat/completions', headers: { authorization: `Bearer ${token}` }, payload: { ...payload(), stream: false } })
  try {
    state.monthly.mockResolvedValueOnce(null)
    expect((await invoke()).statusCode).toBe(429); expect(upstream).not.toHaveBeenCalled()
    expect((await invoke()).statusCode).toBe(200)
    expect(state.settle).toHaveBeenCalledExactlyOnceWith(null)
  } finally { await app.close() }
})

it('requires authentication for account allowance on both API aliases', async () => {
  const app = Fastify(); await registerPersonalModelRoutes(app)
  try {
    for (const prefix of ['/personal-model', '/api/personal-model']) {
      expect((await app.inject({ url: `${prefix}/quota` })).statusCode).toBe(401)
      const result = await app.inject({ url: `${prefix}/quota`, headers: { authorization: 'Bearer issuer' } })
      expect(result.statusCode).toBe(200)
      expect(result.json()).toMatchObject({ limit: 5000000, remaining: 5000000 })
      expect(result.headers['cache-control']).toBe('no-store')
    }
  } finally { await app.close() }
})
