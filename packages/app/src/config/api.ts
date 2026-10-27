import { createApiClient } from '@shennian/shared/api'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
} from '@shennian/wire'
import { Platform } from 'react-native'
import { DESKTOP_RENDERER_AUTH_SENTINEL, useAuthStore } from './auth'
import { getServerUrl, isSelfHostedSelection } from './server'
import { getHydratedInstallationId } from '../features/auth/utils/installation'
import { deviceNameLabel } from '../features/auth/utils/device'

function isLocalDevServerUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    )
  } catch {
    return false
  }
}

export function getApiBaseUrl(): string {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.hostname === 'app.shennian.net'
  ) {
    return `${window.location.origin}/api`
  }
  const base = getServerUrl()
  if (isSelfHostedSelection()) return `${base}/api`
  // Local dev server has no /api prefix (routes are at /machines, /sessions, etc.)
  if (isLocalDevServerUrl(base)) {
    return base
  }
  // Use Metro's existing production proxy so scoped HttpOnly cookies stay first-party.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && isLocalDevServerUrl(window.location.origin)) {
    return `${window.location.origin}/api`
  }
  return `${base}/api`
}

const { api, authApi } = createApiClient({
  getBaseUrl: getApiBaseUrl,
  getHeaders: () => ({
    'x-shennian-sync-protocol-version': String(SESSION_SYNC_PROTOCOL_VERSION),
    'x-shennian-data-epoch': String(SESSION_SYNC_DATA_EPOCH),
  }),
  auth: {
    getToken: () => {
      const token = useAuthStore.getState().token
      return token === DESKTOP_RENDERER_AUTH_SENTINEL ? null : token
    },
    getRefreshToken: () => {
      const token = useAuthStore.getState().refreshToken
      return token === DESKTOP_RENDERER_AUTH_SENTINEL ? null : token
    },
    getUser: () => useAuthStore.getState().user,
    login: useAuthStore.getState().login,
    logout: useAuthStore.getState().logout,
  },
  getRefreshBody: () => {
    const installationId = getHydratedInstallationId()
    if (Platform.OS === 'web') {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
      return {
        platform: 'web',
        deviceName: ua.includes('Mobile')
          ? 'Mobile Browser'
          : 'Desktop Browser',
        ...(installationId ? { installationId } : {}),
      }
    }
    return {
      platform: Platform.OS,
      deviceName: deviceNameLabel(),
      ...(installationId ? { installationId } : {}),
    }
  },
})

export { api, authApi }
