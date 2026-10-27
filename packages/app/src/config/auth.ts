// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../__tests__/desktop-auth-session-events.test.ts
import { createAuthStore, type AuthStorage, type User } from '@shennian/shared/auth'
import { Platform } from 'react-native'
import { getAuthStorageKey, loadServerConfig, lockServerBinding } from './server'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'
import {
  beginDesktopFreshLogin,
  setDesktopAuthRecoveryStatus,
} from '../features/auth/desktopAuthRecovery'

/**
 * Renderer-only authentication state marker. This is deliberately not a bearer
 * credential and must never be used for a network request.
 */
export const DESKTOP_RENDERER_AUTH_SENTINEL = '__desktop_main_authenticated__'
const DESKTOP_REFRESH_PLACEHOLDER = DESKTOP_RENDERER_AUTH_SENTINEL
type DesktopBridgeError = {
  status?: number
  code: string
  message: string
  retryable: boolean
}
type DesktopBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopBridgeError }
type DesktopCredentialBridge = {
  commitLogin(value: {
    phone: string
    code: string
    name?: string
    deviceName?: string
    installationId?: string
  }): Promise<DesktopBridgeResult<{ status: 'online'; accountId: string; user: User }>>
  requestPhoneCode(value: {
    phone: string
    ticket?: string
    randstr?: string
  }): Promise<DesktopBridgeResult<void>>
  createQrLogin(value: {
    installationId?: string
  }): Promise<DesktopBridgeResult<{ qrId: string; qrUrl: string }>>
  pollQrLogin(value: { qrId: string }): Promise<
    | {
        ok: true
        value:
          | { status: 'pending' | 'scanned' | 'expired' }
          | {
              status: 'confirmed'
              accountId: string
              user: User
              credential: 'stored'
            }
      }
    | { ok: false; error: DesktopBridgeError }
  >
  restore(): Promise<DesktopBridgeResult<
    | { status: 'online' | 'offline'; accountId: string; user: User }
    | { status: 'missing' | 'revoked' | 'unavailable' | 'corrupt' }
  >>
  logout(input: { accountId: string }): Promise<DesktopBridgeResult<void>>
  subscribe(callback: (event: DesktopAuthSessionEvent) => void): () => void
}

type DesktopAuthSessionEvent =
  | { type: 'refreshed'; accountId: string; user: User }
  | { type: 'profile-updated'; accountId: string; user: User }
  | { type: 'expired'; accountId: string; reason: 'access-token-expired' }
  | { type: 'revoked'; accountId: string; reason: 'device-revoked' }
  | { type: 'account-switched'; previousAccountId: string; accountId: string }
  | { type: 'credential-error'; status: 'unavailable' | 'corrupt' }
  | { type: 'signed-out'; accountId: string }

export function getDesktopCredentialBridge(): DesktopCredentialBridge | null {
  if (!isDesktopControlSurfaceEnabled()) return null
  const value = (
    globalThis as typeof globalThis & {
      shennianDesktop?: { auth?: DesktopCredentialBridge }
    }
  ).shennianDesktop?.auth
  return value && typeof value.restore === 'function' ? value : null
}

let storage: AuthStorage
let desktopAccountId: string | null = null
let clearingDesktopRendererSession = false

const isDesktopSurface = Platform.OS === 'web' && isDesktopControlSurfaceEnabled()
const desktopCredentialBridge = isDesktopSurface ? getDesktopCredentialBridge() : null
if (isDesktopSurface && desktopCredentialBridge) {
  storage = {
    async getItem() {
      const result = await desktopCredentialBridge.restore()
      if (!result.ok) throwDesktopAuthError(result.error)
      const session = result.value
      setDesktopAuthRecoveryStatus(session.status)
      if (session.status !== 'online' && session.status !== 'offline') return null
      desktopAccountId = session.accountId
      return JSON.stringify({
        token: session.status === 'online' ? DESKTOP_RENDERER_AUTH_SENTINEL : null,
        refreshToken: DESKTOP_REFRESH_PLACEHOLDER,
        user: session.user,
      })
    },
    async setItem(_key, value) {
      const parsed = JSON.parse(value) as {
        token?: unknown
        refreshToken?: unknown
        user?: { id?: unknown }
      }
      if (
        parsed.refreshToken !== DESKTOP_REFRESH_PLACEHOLDER ||
        parsed.token !== DESKTOP_RENDERER_AUTH_SENTINEL
      ) {
        throw new Error('Desktop login must use the main-process authentication broker')
      }
      desktopAccountId = typeof parsed.user?.id === 'string' ? parsed.user.id : null
    },
    async removeItem() {
      if (clearingDesktopRendererSession) {
        desktopAccountId = null
        return
      }
      if (desktopAccountId) {
        const result = await desktopCredentialBridge.logout({ accountId: desktopAccountId })
        if (!result.ok) throwDesktopAuthError(result.error)
      }
      desktopAccountId = null
    },
  }
} else if (isDesktopSurface) {
  const unavailable = (): never => {
    throw new Error('Desktop credential bridge is unavailable')
  }
  storage = {
    getItem: unavailable,
    setItem: unavailable,
    removeItem: unavailable,
  }
} else if (Platform.OS === 'web') {
  storage = {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  }
} else {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
  storage = {
    getItem: async (key: string) => {
      await loadServerConfig()
      const value = await AsyncStorage.getItem(getAuthStorageKey(key))
      if (value) await lockServerBinding()
      return value
    },
    setItem: async (key: string, value: string) => {
      await lockServerBinding()
      await AsyncStorage.setItem(getAuthStorageKey(key), value)
    },
    removeItem: (key: string) => AsyncStorage.removeItem(getAuthStorageKey(key)),
  }
}

export const useAuthStore = createAuthStore(
  storage,
  desktopCredentialBridge
    ? { retainRefreshTokenInMemory: false, refreshTokenPlaceholder: DESKTOP_REFRESH_PLACEHOLDER }
    : {},
)

if (desktopCredentialBridge) {
  desktopCredentialBridge.subscribe((event) => {
    const currentAccountId = useAuthStore.getState().user?.id ?? null
    if (event.type === 'profile-updated') {
      // Main already committed the profile. This event only replaces the view
      // projection; it must not authenticate, persist credentials, or reconnect.
      if (currentAccountId === event.accountId && event.user.id === event.accountId) {
        useAuthStore.setState({ user: event.user })
      }
      return
    }
    if ('accountId' in event && currentAccountId && event.accountId !== currentAccountId) {
      return
    }
    if (event.type === 'refreshed') {
      setDesktopAuthRecoveryStatus('online')
      desktopAccountId = event.accountId
      void useAuthStore
        .getState()
        .login(DESKTOP_RENDERER_AUTH_SENTINEL, DESKTOP_REFRESH_PLACEHOLDER, event.user)
        .catch(() => clearRendererAuthSession())
      return
    }
    if (event.type === 'account-switched') return
    if (event.type === 'credential-error') setDesktopAuthRecoveryStatus(event.status)
    else setDesktopAuthRecoveryStatus(
      event.type === 'revoked' ? 'revoked' : event.type === 'expired' ? 'expired' : 'missing',
    )
    void clearRendererAuthSession()
  })
}

async function clearRendererAuthSession(): Promise<void> {
  // Clear the renderer token without recursively deleting the main-process
  // refresh credential. Revocation/logout already owns durable deletion.
  clearingDesktopRendererSession = true
  try {
    desktopAccountId = null
    await useAuthStore.getState().logout()
  } finally {
    clearingDesktopRendererSession = false
  }
}

export async function loginWithDesktopPhone(input: {
  phone: string
  code: string
  name?: string
  deviceName?: string
  installationId?: string
}): Promise<{ token: string; refreshToken: string; user: User }> {
  if (!desktopCredentialBridge) throw new Error('Desktop credential bridge is unavailable')
  const result = await desktopCredentialBridge.commitLogin(input)
  if (!result.ok) {
    const error = Object.assign(new Error(result.error.message), {
      status: result.error.status,
      code: result.error.code,
    })
    throw error
  }
  setDesktopAuthRecoveryStatus('online')
  desktopAccountId = result.value.accountId
  return {
    token: DESKTOP_RENDERER_AUTH_SENTINEL,
    refreshToken: DESKTOP_REFRESH_PLACEHOLDER,
    user: result.value.user,
  }
}

function throwDesktopAuthError(error: {
  status?: number
  code: string
  message: string
}): never {
  throw Object.assign(new Error(error.message), {
    status: error.status,
    code: error.code,
  })
}

export async function requestDesktopPhoneCode(input: {
  phone: string
  ticket?: string
  randstr?: string
}): Promise<void> {
  if (!desktopCredentialBridge) throw new Error('Desktop credential bridge is unavailable')
  const result = await desktopCredentialBridge.requestPhoneCode(input)
  if (!result.ok) throwDesktopAuthError(result.error)
}

export async function createDesktopQrLogin(input: {
  installationId?: string
}): Promise<{ qrId: string; qrUrl: string }> {
  if (!desktopCredentialBridge) throw new Error('Desktop credential bridge is unavailable')
  const result = await desktopCredentialBridge.createQrLogin(input)
  if (!result.ok) return throwDesktopAuthError(result.error)
  return result.value
}

export async function pollDesktopQrLogin(qrId: string): Promise<
  | { status: 'pending' | 'scanned' | 'expired' }
  | {
      status: 'confirmed'
      token: string
      refreshToken: string
      user: User
    }
> {
  if (!desktopCredentialBridge) throw new Error('Desktop credential bridge is unavailable')
  const result = await desktopCredentialBridge.pollQrLogin({ qrId })
  if (!result.ok) return throwDesktopAuthError(result.error)
  if (result.value.status !== 'confirmed') return result.value
  setDesktopAuthRecoveryStatus('online')
  desktopAccountId = result.value.accountId
  return {
    status: 'confirmed',
    token: DESKTOP_RENDERER_AUTH_SENTINEL,
    refreshToken: DESKTOP_REFRESH_PLACEHOLDER,
    user: result.value.user,
  }
}

export async function retryDesktopAccountRecovery(): Promise<void> {
  await useAuthStore.getState().loadFromStorage()
}

export function startDesktopFreshLogin(): void {
  beginDesktopFreshLogin()
}
