// @covers open-source/packages/shared/src/lib/api.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../lib/api'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('enforces protocol headers over per-request overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { api } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      getHeaders: () => ({
        'x-shennian-sync-protocol-version': '2',
        'x-shennian-data-epoch': '2',
      }),
    })

    await api('/sessions', { headers: { 'x-shennian-data-epoch': '1' } })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-shennian-sync-protocol-version': '2',
          'x-shennian-data-epoch': '2',
        }),
      }),
    )
  })

  it('aborts requests that exceed the configured timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts?: RequestInit) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () => {
              reject(opts.signal?.reason ?? new Error('aborted'))
            })
          }),
      ),
    )

    const { api } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      timeoutMs: 50,
    })

    const assertion = expect(api('/slow')).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(50)

    await assertion
  })

  it('allows a scoped longer timeout without weakening normal API deadlines', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => new Promise((_resolve, reject) => {
      signals.push(opts!.signal!)
      opts!.signal!.addEventListener('abort', () => reject(opts!.signal!.reason))
    })))
    const { api, authApi } = createApiClient({ getBaseUrl: () => 'https://example.test/api', timeoutMs: 50,
      auth: { getToken: () => 'unit-token', getRefreshToken: () => null, getUser: () => null, login: vi.fn(), logout: vi.fn() } })
    const normal = expect(api('/normal')).rejects.toThrow(/timeout/i)
    const long = expect(authApi('/interactive-content/turn', undefined, { timeoutMs: 200 })).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(50)
    await normal
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(150)
    await long
    expect(signals[1]!.aborted).toBe(true)
  })

  it('logs out when an authenticated request gets 401 without a refresh token', async () => {
    const logout = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })),
    )

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => null,
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toThrow('Session expired')
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('keeps the local session when an authenticated request fails for network reasons', async () => {
    const logout = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network request failed')
      }),
    )

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'access-token',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toThrow('Network request failed')
    expect(logout).not.toHaveBeenCalled()
  })

  it('keeps the local session when token refresh fails for network reasons', async () => {
    const logout = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 }))
      .mockRejectedValueOnce(new Error('Network request failed'))
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toThrow('Network request failed')
    expect(logout).not.toHaveBeenCalled()
  })

  it.each([500, 502, 503, 504])('keeps the local session when token refresh returns %s', async (status) => {
    const logout = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporarily unavailable' }), { status }))
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toMatchObject({ status })
    expect(logout).not.toHaveBeenCalled()
  })

  it.each([401, 403])('logs out when token refresh explicitly rejects the session with %s', async (status) => {
    const logout = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Refresh token expired' }), { status }))
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toThrow('Session expired')
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent token refreshes and retries every original request', async () => {
    const login = vi.fn()
    const logout = vi.fn()
    let machineAttempts = 0
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ token: 'fresh-access', refreshToken: 'refresh-token' }))
      }
      machineAttempts += 1
      const authorization = (opts?.headers as Record<string, string>).Authorization
      return authorization === 'Bearer fresh-access'
        ? new Response(JSON.stringify({ ok: true }))
        : new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login,
        logout,
      },
    })

    await expect(Promise.all([authApi('/machines'), authApi('/machines')])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'))).toHaveLength(1)
    expect(machineAttempts).toBe(4)
    expect(login).toHaveBeenCalledTimes(2)
    expect(logout).not.toHaveBeenCalled()
  })

  it('waits for refreshed auth persistence before retrying the request', async () => {
    let finishPersist: (() => void) | undefined
    let machineAttempts = 0
    const login = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPersist = resolve
        }),
    )
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ token: 'fresh-access', refreshToken: 'fresh-refresh' }))
      }
      machineAttempts += 1
      return machineAttempts === 1
        ? new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 })
        : new Response(JSON.stringify({ ok: true }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login,
        logout: vi.fn(),
      },
    })

    const request = authApi('/machines')
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    expect(machineAttempts).toBe(1)

    finishPersist?.()
    await expect(request).resolves.toEqual({ ok: true })
    expect(machineAttempts).toBe(2)
  })

  it('logs out when refresh succeeds but the retried request is still unauthorized', async () => {
    const logout = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh-access', refreshToken: 'fresh-refresh' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const { authApi } = createApiClient({
      getBaseUrl: () => 'https://example.test/api',
      auth: {
        getToken: () => 'expired-access',
        getRefreshToken: () => 'refresh-token',
        getUser: () => ({ id: 'user-1', name: '' }),
        login: vi.fn(),
        logout,
      },
    })

    await expect(authApi('/machines')).rejects.toThrow('{"error":"Invalid token"}')
    expect(logout).toHaveBeenCalledTimes(1)
  })
})
