// @covers src/services/personal-model-quota.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ eval: vi.fn(), hget: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: store }))
import { personalModelQuotaPeriod, personalModelMonthlyLimit, personalModelReservationAmount, readPersonalModelQuota, reservePersonalModelQuota } from '../services/personal-model-quota.js'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('account monthly free allowance', () => {
  it('uses natural months in Shanghai, including UTC day/year boundaries', () => {
    expect(personalModelQuotaPeriod(new Date('2026-10-31T15:59:59Z'))).toMatchObject({ month: '2026-10', resetsAt: '2026-10-31T16:00:00.000Z' })
    expect(personalModelQuotaPeriod(new Date('2026-10-31T16:00:00Z'))).toMatchObject({ month: '2026-11', resetsAt: '2026-11-30T16:00:00.000Z' })
    expect(personalModelQuotaPeriod(new Date('2026-12-31T16:00:00Z')).month).toBe('2027-01')
  })
  it('defaults to the approved 10 CNY equivalent and accepts positive integer overrides only', () => {
    vi.stubEnv('PERSONAL_MODEL_MONTHLY_ALLOWANCE', undefined); expect(personalModelMonthlyLimit()).toBe(5000000)
    vi.stubEnv('PERSONAL_MODEL_MONTHLY_ALLOWANCE', '2500000'); expect(personalModelMonthlyLimit()).toBe(2500000)
    for (const value of ['0', '-1', 'Infinity', '5000000oops', '1.5']) { vi.stubEnv('PERSONAL_MODEL_MONTHLY_ALLOWANCE', value); expect(personalModelMonthlyLimit()).toBe(5000000) }
  })
  it('reserves schemas/tool results and image context, with weighted output and no prompt in Redis', async () => {
    const simple = { messages: [{ role: 'user', content: 'synthetic prompt' }], max_tokens: 100 }
    expect(personalModelReservationAmount({ ...simple, tools: [{ function: { description: 'x'.repeat(1000) } }] })).toBeGreaterThan(personalModelReservationAmount(simple) + 999)
    expect(personalModelReservationAmount({ messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,synthetic' } }] }], max_tokens: 100 })).toBe(1024400)
    expect(() => personalModelReservationAmount({ ...simple, max_tokens: NaN })).toThrow('model_request_invalid')
    store.eval.mockResolvedValueOnce(-1)
    expect(await reservePersonalModelQuota('account-a', simple, new Date('2026-10-23Z'))).toBeNull()
    expect(store.eval.mock.calls[0]?.[2]).toBe('personal-model:quota:account-a:2026-10')
    expect(JSON.stringify(store.eval.mock.calls)).not.toContain('synthetic prompt')
  })
  it('settles actual weighted usage, keeps a conservative charge without usage and fails closed on storage errors', async () => {
    store.eval.mockResolvedValue(1000)
    const reservation = await reservePersonalModelQuota('account-a', { messages: [], max_tokens: 100 })
    await reservation!.settle({ inputTokens: 20, outputTokens: 5 })
    expect(store.eval.mock.lastCall?.at(-1)).toBe(40)
    await reservation!.settle(null)
    expect(store.eval.mock.lastCall?.at(-1)).toBeGreaterThanOrEqual(400)
    store.eval.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(reservePersonalModelQuota('account-a', { messages: [], max_tokens: 100 })).rejects.toThrow('storage unavailable')
  })
  it('reports account usage including pending reservations and clamps the remaining amount', async () => {
    store.hget.mockResolvedValue('5000010')
    expect(await readPersonalModelQuota('account-a', new Date('2026-10-23Z'))).toMatchObject({ limit: 5000000, used: 5000010, remaining: 0, outputWeight: 4 })
    expect(store.hget).toHaveBeenCalledWith('personal-model:quota:account-a:2026-10', 'used')
  })
})
