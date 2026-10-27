import { create } from 'zustand'
import type { AccountTier, UserEntitlements } from '../lib/entitlements'

export type User = {
  id: string
  name: string
  nameSetupRequired?: boolean
  avatar?: {
    version: string
    smallUrl: string
    mediumUrl: string
    updatedAt: string
  } | null
  phone?: string | null
  email?: string | null
  /** @deprecated Compatibility field for clients released before notification previews became fixed. */
  pushPreviewEnabled?: boolean
  accountTier?: AccountTier
  entitlements?: UserEntitlements
}

type AuthState = {
  token: string | null
  refreshToken: string | null
  user: User | null
  isAuthenticated: boolean
  login(token: string, refreshToken: string, user: User): Promise<void>
  logout(): Promise<void>
  flushStorage(): Promise<void>
  loadFromStorage(): Promise<void>
}

type Persisted = {
  token: string | null
  refreshToken: string
  user: User
}

export type AuthStorage = {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

const STORAGE_KEY = 'shennian_auth'
const LOGIN_STORAGE_RETRY_DELAYS_MS = [10, 30] as const

async function readStorage(storage: AuthStorage, key: string): Promise<string | null> {
  try {
    return await Promise.resolve(storage.getItem(key))
  } catch {
    return null
  }
}

export function createAuthStore(
  storage: AuthStorage,
  options: { retainRefreshTokenInMemory?: boolean; refreshTokenPlaceholder?: string } = {},
) {
  let storageQueue = Promise.resolve()
  const inMemoryRefreshToken = (value: string) => options.retainRefreshTokenInMemory === false
    ? (options.refreshTokenPlaceholder ?? '__main_process_managed__')
    : value

  const enqueueStorage = (
    op: () => void | Promise<void>,
    options: { retryDelaysMs?: readonly number[]; rejectOnFailure?: boolean } = {},
  ): Promise<void> => {
    const operation = storageQueue.then(async () => {
      const retryDelays = options.retryDelaysMs ?? []
      for (let attempt = 0; ; attempt += 1) {
        try {
          await Promise.resolve(op())
          return
        } catch (error) {
          const delayMs = retryDelays[attempt]
          if (delayMs === undefined) throw error
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    })

    // Keep the ordering chain usable after a failed operation. Callers that
    // need durability can still observe the original rejection.
    storageQueue = operation.catch(() => {})
    return options.rejectOnFailure ? operation : storageQueue
  }

  return create<AuthState>((set, get) => ({
    token: null,
    refreshToken: null,
    user: null,
    isAuthenticated: false,
    login(token, refreshToken, user) {
      const previous = get()
      const stateRefreshToken = inMemoryRefreshToken(refreshToken)
      set({ token, refreshToken: stateRefreshToken, user, isAuthenticated: true })
      return enqueueStorage(
        () => storage.setItem(STORAGE_KEY, JSON.stringify({ token, refreshToken, user })),
        { retryDelaysMs: LOGIN_STORAGE_RETRY_DELAYS_MS, rejectOnFailure: true },
      ).catch((error) => {
        const current = get()
        if (current.token === token && current.refreshToken === stateRefreshToken) {
          set({
            token: previous.token,
            refreshToken: previous.refreshToken,
            user: previous.user,
            isAuthenticated: previous.isAuthenticated,
          })
        }
        throw error
      })
    },
    logout() {
      set({ token: null, refreshToken: null, user: null, isAuthenticated: false })
      return enqueueStorage(() => storage.removeItem(STORAGE_KEY))
    },
    flushStorage() {
      return storageQueue
    },
    async loadFromStorage() {
      await storageQueue
      const raw = await readStorage(storage, STORAGE_KEY)
      if (!raw) return
      try {
        const data = JSON.parse(raw) as Persisted
        set({ token: data.token, refreshToken: inMemoryRefreshToken(data.refreshToken), user: data.user, isAuthenticated: true })
      } catch { /* ignore */ }
    },
  }))
}
