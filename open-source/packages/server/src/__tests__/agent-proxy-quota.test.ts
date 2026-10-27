// @covers open-source/packages/server/src/services/agent-proxy.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  creditsForNianUsage,
  DASHSCOPE_DEFAULT_MODEL,
  PI_MODELS,
  DESKTOP_SETUP_PROXY_PROVIDER,
  estimateNianInputTokens,
  getNianQuotaConfig,
  isDesktopSetupProxyRequest,
  reserveNianQuota,
  type ProxyRequestBody,
} from '../services/agent-proxy.js'

class MemoryQuotaStore {
  values = new Map<string, number>()
  expiries = new Map<string, number>()

  async get(key: string): Promise<string | null> {
    const value = this.values.get(key)
    return value === undefined ? null : String(value)
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1)
  }

  async incrby(key: string, amount: number): Promise<number> {
    const next = (this.values.get(key) ?? 0) + amount
    this.values.set(key, next)
    return next
  }

  async expire(key: string, ttl: number): Promise<number> {
    this.expiries.set(key, ttl)
    return 1
  }
}

const body = (text = 'hello'): ProxyRequestBody => ({
  model: { id: 'qwen3.6-plus', provider: 'shennian-proxy', api: 'openai-completions' },
  context: { messages: [{ role: 'user', content: text }] },
})

describe('Nian quota guard', () => {
  it('defaults to the unified official model while retaining published explicit model choices', () => {
    expect(DASHSCOPE_DEFAULT_MODEL).toBe('deepseek-v4.1-flash-1017')
    expect(PI_MODELS.map((model) => model.id)).toEqual(['deepseek-v4.1-flash-1017', 'qwen3.6-plus'])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses conservative defaults when env is not configured', () => {
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '')

    expect(getNianQuotaConfig()).toMatchObject({
      dailyRequestLimit: 2000,
      perMinuteRequestLimit: 10,
      maxOutputTokens: 4096,
    })
  })

  it('caps env-configured daily Nian requests at 2000', () => {
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '3000')

    expect(getNianQuotaConfig().dailyRequestLimit).toBe(2000)
  })

  it('allows Nian requests under configured request quota', async () => {
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '2')
    vi.stubEnv('NIAN_PER_MINUTE_REQUEST_LIMIT', '2')
    const store = new MemoryQuotaStore()

    const first = await reserveNianQuota('user-1', body(), store, new Date('2026-05-27T01:00:00.000Z'))
    const second = await reserveNianQuota('user-1', body(), store, new Date('2026-05-27T01:00:10.000Z'))

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
  })

  it('blocks Nian requests after daily request quota is reached', async () => {
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '1')
    vi.stubEnv('NIAN_PER_MINUTE_REQUEST_LIMIT', '10')
    const store = new MemoryQuotaStore()

    await reserveNianQuota('user-1', body(), store, new Date('2026-05-27T01:00:00.000Z'))
    const blocked = await reserveNianQuota('user-1', body(), store, new Date('2026-05-27T01:00:10.000Z'))

    expect(blocked).toMatchObject({
      allowed: false,
      statusCode: 429,
      code: 'nian_quota_exceeded',
      limit: 1,
      used: 1,
    })
  })

  it('does not block long context by estimated daily input tokens', async () => {
    const request = body('x'.repeat(300_000))
    vi.stubEnv('NIAN_DAILY_INPUT_TOKEN_LIMIT', '1')
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '100')
    vi.stubEnv('NIAN_PER_MINUTE_REQUEST_LIMIT', '10')
    const store = new MemoryQuotaStore()

    const decision = await reserveNianQuota('user-1', request, store, new Date('2026-05-27T01:00:00.000Z'))

    expect(decision).toMatchObject({
      allowed: true,
      estimatedInputTokens: estimateNianInputTokens(request),
    })
    expect(await store.get('nian:quota:daily-input-tokens:user-1:2026-05-27')).toBeNull()
  })

  it('does not block requests by daily output token usage', async () => {
    vi.stubEnv('NIAN_DAILY_OUTPUT_TOKEN_LIMIT', '1')
    vi.stubEnv('NIAN_DAILY_REQUEST_LIMIT', '100')
    vi.stubEnv('NIAN_PER_MINUTE_REQUEST_LIMIT', '10')
    const store = new MemoryQuotaStore()
    const now = new Date('2026-05-27T01:00:00.000Z')

    store.values.set('nian:quota:daily-output-tokens:user-1:2026-05-27', 1_000_000)
    const decision = await reserveNianQuota('user-1', body(), store, now)

    expect(decision).toMatchObject({ allowed: true })
  })

  it('does not apply Nian quota to non-Nian agents because only agent-proxy calls reserve it', async () => {
    const store = new MemoryQuotaStore()

    expect(await store.get('nian:quota:daily-requests:user-1:2026-05-27')).toBeNull()
  })

  it('recognizes desktop setup requests so the proxy can bypass setup quota', () => {
    expect(
      isDesktopSetupProxyRequest({
        model: {
          id: 'qwen3.6-plus',
          provider: DESKTOP_SETUP_PROXY_PROVIDER,
          api: 'openai-completions',
        },
        context: {
          systemPrompt: '你是神念桌面端内置安装助手。中文回复，优先用工具完成任务。',
          messages: [{ role: 'user', content: 'install' }],
        },
      }),
    ).toBe(true)

    expect(isDesktopSetupProxyRequest(body())).toBe(false)
  })

  it('converts Nian model usage to at least one credit with margin protection', () => {
    vi.stubEnv('NIAN_PLUS_INPUT_CNY_PER_MILLION', '0.2')
    vi.stubEnv('NIAN_PLUS_OUTPUT_CNY_PER_MILLION', '2')
    vi.stubEnv('BILLING_CREDIT_VALUE_CNY', '0.01')
    vi.stubEnv('BILLING_TARGET_GROSS_MARGIN', '0.5')

    expect(creditsForNianUsage({ modelId: 'qwen3.6-plus', inputTokens: 3600, outputTokens: 1200 })).toBe(1)
    expect(creditsForNianUsage({ modelId: 'qwen3.6-plus', inputTokens: 100_000, outputTokens: 100_000 })).toBe(44)
  })
})
