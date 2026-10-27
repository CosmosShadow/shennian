// @covers open-source/packages/server/src/services/interactive-web/quota.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
const evalScript = vi.hoisted(() => vi.fn())
vi.mock('../lib/redis.js', () => ({ redis: { eval: evalScript } }))
import { consumeContentQuota, CONTENT_QUOTA_SCRIPT, requireContentEnabled } from '../services/interactive-web/quota.js'
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('sponsored content quotas fail closed', () => {
  it('has no in-memory fallback and requires explicit activation', async () => {
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('INTERACTIVE_CONTENT_ENABLED', '')
    await expect(consumeContentQuota('actor', 'image')).rejects.toThrow('quota_store_unavailable')
    expect(requireContentEnabled).toThrow('content_not_enabled')
    expect(evalScript).not.toHaveBeenCalled()
  })
  it('raises only the named test actor job allowance within a fixed ceiling, not image/global limits', async () => {
    vi.stubEnv('REDIS_URL', 'redis://unit.invalid'); vi.stubEnv('INTERACTIVE_CONTENT_TEST_USER_ID', 'qa')
    vi.stubEnv('INTERACTIVE_CONTENT_TEST_JOB_LIMIT', '20'); evalScript.mockResolvedValue(1)
    await consumeContentQuota('qa', 'job')
    expect(evalScript).toHaveBeenLastCalledWith(CONTENT_QUOTA_SCRIPT, 2, expect.any(String), expect.any(String), '20', '150')
    vi.stubEnv('INTERACTIVE_CONTENT_TEST_JOB_LIMIT', '30')
    await consumeContentQuota('qa', 'job')
    expect(evalScript.mock.calls.at(-1)?.slice(-2)).toEqual(['30', '150'])
    await consumeContentQuota('other', 'job')
    expect(evalScript.mock.calls.at(-1)?.slice(-2)).toEqual(['10', '150'])
    await consumeContentQuota('qa', 'image')
    expect(evalScript.mock.calls.at(-1)?.slice(-2)).toEqual(['12', '100'])
    vi.stubEnv('INTERACTIVE_CONTENT_TEST_JOB_LIMIT', '99999')
    await consumeContentQuota('qa', 'job')
    expect(evalScript.mock.calls.at(-1)?.slice(-2)).toEqual(['10', '150'])
  })
  it('checks actor and platform caps in the same atomic script before incrementing', async () => {
    vi.stubEnv('REDIS_URL', 'redis://unit.invalid')
    evalScript.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    await expect(consumeContentQuota('actor', 'image')).rejects.toThrow('content_daily_limit')
    await consumeContentQuota('actor', 'job')
    expect(evalScript).toHaveBeenLastCalledWith(CONTENT_QUOTA_SCRIPT, 2, expect.stringContaining(':job:actor'), expect.stringContaining(':job:global'), '10', '150')
    expect(CONTENT_QUOTA_SCRIPT.indexOf('return 0')).toBeLessThan(CONTENT_QUOTA_SCRIPT.indexOf("redis.call('incr'"))
  })
})
