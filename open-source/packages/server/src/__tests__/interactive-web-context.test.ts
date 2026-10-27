// @covers open-source/packages/server/src/services/interactive-web/context.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), eval: vi.fn(), version: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: { get: mocks.get, eval: mocks.eval } }))
vi.mock('../services/interactive-web/repository.js', () => ({ readableVersion: mocks.version,
  ContentError: class extends Error { constructor(readonly code: string) { super(code) } } }))
import { issueContentContext, resolveContentContext } from '../services/interactive-web/context.js'
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('REDIS_URL', 'redis://unit.invalid') })
afterEach(() => vi.unstubAllEnvs())
const context = { actorId: 'a', mountId: 'mount', viewEpoch: 1, workId: 'w', versionId: 'v', followCurrent: true }
describe('opaque mounted content context', () => {
  it('verifies reader access before registering a context and atomically rejects old epochs', async () => {
    mocks.eval.mockResolvedValue('STALE')
    await expect(issueContentContext(context)).rejects.toThrow('context_changed')
    expect(mocks.version).toHaveBeenCalledWith('a', 'w', 'v')
    expect(mocks.eval.mock.calls[0]?.[0]).toContain('p.epoch)==tonumber')
  })
  it('reuses the same epoch reference, so refresh cannot invalidate its own foreground turn', async () => {
    mocks.eval.mockResolvedValue('existing-context')
    expect(await issueContentContext(context)).toBe('existing-context')
  })
  it('rejects another actor and obsolete mount references before tools dispatch', async () => {
    mocks.get.mockResolvedValueOnce(JSON.stringify(context))
    await expect(resolveContentContext('b', 'ref')).rejects.toThrow('context_forbidden')
    mocks.get.mockResolvedValueOnce(JSON.stringify(context)).mockResolvedValueOnce(JSON.stringify({ ref: 'newer' }))
    await expect(resolveContentContext('a', 'ref')).rejects.toThrow('context_changed')
    mocks.get.mockResolvedValueOnce(null)
    await expect(resolveContentContext('a', 'ref')).rejects.toThrow('context_expired')
  })
})
