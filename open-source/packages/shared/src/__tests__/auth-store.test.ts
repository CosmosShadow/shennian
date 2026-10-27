// @covers open-source/packages/shared/src/stores/auth.ts

import { describe, expect, it } from 'vitest'
import { createAuthStore, type User } from '../stores/auth'

const user: User = {
  id: 'u-1',
  name: 'Alice',
  phone: '+8613800000000',
}

describe('auth store', () => {
  it('does not block startup or logout when persisted auth storage is unavailable', async () => {
    const store = createAuthStore({
      getItem: () => {
        throw new Error('localStorage unavailable')
      },
      setItem: () => {
        throw new Error('localStorage unavailable')
      },
      removeItem: () => {
        throw new Error('localStorage unavailable')
      },
    })

    await expect(store.getState().loadFromStorage()).resolves.toBeUndefined()
    expect(store.getState().isAuthenticated).toBe(false)

    await expect(store.getState().login('token', 'refresh', user)).rejects.toThrow(
      'localStorage unavailable',
    )
    expect(store.getState().isAuthenticated).toBe(false)

    await expect(store.getState().logout()).resolves.toBeUndefined()
    expect(store.getState().isAuthenticated).toBe(false)
  })

  it('lets login callers wait until the session is durable', async () => {
    let finishWrite: (() => void) | undefined
    const persisted = new Map<string, string>()
    const store = createAuthStore({
      getItem: (key) => persisted.get(key) ?? null,
      setItem: (key, value) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            persisted.set(key, value)
            resolve()
          }
        }),
      removeItem: (key) => persisted.delete(key),
    })

    let finished = false
    const login = store.getState().login('token', 'refresh', user).then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(store.getState().isAuthenticated).toBe(true)
    expect(finished).toBe(false)
    expect(persisted.has('shennian_auth')).toBe(false)

    finishWrite?.()
    await login
    expect(finished).toBe(true)
    expect(persisted.has('shennian_auth')).toBe(true)
  })

  it('serializes login and logout writes so stale login data cannot win', async () => {
    const calls: string[] = []
    let finishLogin: (() => void) | undefined
    const store = createAuthStore({
      getItem: () => null,
      setItem: () =>
        new Promise<void>((resolve) => {
          calls.push('login:start')
          finishLogin = () => {
            calls.push('login:end')
            resolve()
          }
        }),
      removeItem: async () => {
        calls.push('logout')
      },
    })

    const login = store.getState().login('token', 'refresh', user)
    const logout = store.getState().logout()
    await Promise.resolve()
    expect(calls).toEqual(['login:start'])
    expect(store.getState().isAuthenticated).toBe(false)

    finishLogin?.()
    await Promise.all([login, logout, store.getState().flushStorage()])
    expect(calls).toEqual(['login:start', 'login:end', 'logout'])
  })

  it('retries a failed login write and resolves after persistence succeeds', async () => {
    let attempts = 0
    const persisted = new Map<string, string>()
    const store = createAuthStore({
      getItem: (key) => persisted.get(key) ?? null,
      setItem: (key, value) => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary storage failure')
        persisted.set(key, value)
      },
      removeItem: (key) => persisted.delete(key),
    })

    await expect(store.getState().login('token', 'refresh', user)).resolves.toBeUndefined()
    expect(attempts).toBe(2)
    expect(store.getState().isAuthenticated).toBe(true)
    expect(persisted.has('shennian_auth')).toBe(true)
  })

  it('rejects a persistently failing login write without poisoning later operations', async () => {
    let shouldFail = true
    const persisted = new Map<string, string>()
    const store = createAuthStore({
      getItem: (key) => persisted.get(key) ?? null,
      setItem: (key, value) => {
        if (shouldFail) throw new Error('persistent storage failure')
        persisted.set(key, value)
      },
      removeItem: (key) => persisted.delete(key),
    })

    await expect(store.getState().login('failed-token', 'failed-refresh', user)).rejects.toThrow(
      'persistent storage failure',
    )
    expect(store.getState().isAuthenticated).toBe(false)

    await expect(store.getState().logout()).resolves.toBeUndefined()
    shouldFail = false
    await expect(
      store.getState().login('recovered-token', 'recovered-refresh', user),
    ).resolves.toBeUndefined()

    expect(store.getState().isAuthenticated).toBe(true)
    expect(store.getState().token).toBe('recovered-token')
    expect(persisted.has('shennian_auth')).toBe(true)
  })

  it('can delegate refresh-token persistence without retaining it in renderer memory', async () => {
    let persisted = ''
    const store = createAuthStore({
      getItem: () => null,
      setItem: (_key, value) => { persisted = value },
      removeItem: () => undefined,
    }, { retainRefreshTokenInMemory: false })
    await store.getState().login('access', 'system-secret', user)
    expect(JSON.parse(persisted)).toMatchObject({ refreshToken: 'system-secret' })
    expect(store.getState().refreshToken).toBe('__main_process_managed__')
    expect(JSON.stringify(store.getState())).not.toContain('system-secret')
  })
})
