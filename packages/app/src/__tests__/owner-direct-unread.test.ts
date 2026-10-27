// @covers packages/app/src/features/published-agents/useOwnerDirectUnread.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, api: vi.fn() }))
vi.mock('react', () => ({ useEffect: vi.fn(), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }))
vi.mock('react-native', () => ({ AppState: {} }))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: (value: unknown) => unknown) => select(state), { getState: () => state }) }))
import { refreshOwnerDirectUnread, useOwnerDirectUnread } from '../features/published-agents/useOwnerDirectUnread'
describe('owner unread account and request fences', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('shares in-flight requests and exposes the server counts', async () => {
    state.user = { id: 'owner' }
    let resolve!: (value: unknown) => void
    state.api.mockReturnValue(new Promise((done) => { resolve = done }))
    const first = refreshOwnerDirectUnread()
    const second = refreshOwnerDirectUnread()
    expect(first).toBe(second)
    expect(state.api).toHaveBeenCalledTimes(1)
    resolve({ agents: { agent: 3 } })
    await first
    expect(useOwnerDirectUnread()).toEqual({ agent: 3 })
  })
  it('hides old-account data immediately and rejects stale results after switching accounts', async () => {
    state.user = { id: 'old' }
    let resolve!: (value: unknown) => void
    state.api.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const stale = refreshOwnerDirectUnread()
    state.user = { id: 'new' }
    expect(useOwnerDirectUnread()).toEqual({})
    state.api.mockResolvedValueOnce({ agents: { newAgent: 1 } })
    await refreshOwnerDirectUnread()
    resolve({ agents: { oldAgent: 9 } })
    await stale
    expect(useOwnerDirectUnread()).toEqual({ newAgent: 1 })
    state.user = null
    await refreshOwnerDirectUnread()
    expect(useOwnerDirectUnread()).toEqual({})
  })
})
