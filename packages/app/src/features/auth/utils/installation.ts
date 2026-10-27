// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-installation.test.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { deviceNameLabel } from './device'

const INSTALLATION_ID_KEY = 'shennian:installationId'
const INSTALLATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let installationId: string | null = null
let pendingInstallationId: string | null = null
let hydration: Promise<string> | null = null

function validInstallationId(value: string | null): value is string {
  return Boolean(value && INSTALLATION_ID_RE.test(value))
}

async function retryStorage<T>(operation: () => T | Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  }
  throw lastError
}

async function readInstallationId(): Promise<string | null> {
  return retryStorage(() => {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') throw new Error('Installation storage unavailable')
      return localStorage.getItem(INSTALLATION_ID_KEY)
    }
    return AsyncStorage.getItem(INSTALLATION_ID_KEY)
  })
}

async function persistInstallationId(value: string): Promise<void> {
  await retryStorage(() => {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') throw new Error('Installation storage unavailable')
      localStorage.setItem(INSTALLATION_ID_KEY, value)
      return
    }
    return AsyncStorage.setItem(INSTALLATION_ID_KEY, value)
  })
}

/** Returns one opaque identifier per app installation, stable across launches and OTA updates. */
export async function hydrateInstallationId(): Promise<string> {
  if (installationId) return installationId
  if (hydration) return hydration

  hydration = (async () => {
    const persisted = await readInstallationId()

    const nextId = validInstallationId(persisted)
      ? persisted
      : (pendingInstallationId ?? (await import('expo-crypto')).randomUUID())
    if (nextId !== persisted) {
      pendingInstallationId = nextId
      await persistInstallationId(nextId)
    }
    installationId = nextId
    pendingInstallationId = null
    return installationId
  })().finally(() => {
    hydration = null
  })

  return hydration
}

/** Synchronous access for refresh requests after root startup hydration. */
export function getHydratedInstallationId(): string | null {
  return installationId
}

export async function getAuthDeviceMetadata(): Promise<{
  platform: string
  deviceName: string
  installationId: string
}> {
  return {
    platform: Platform.OS,
    deviceName: deviceNameLabel(),
    installationId: await hydrateInstallationId(),
  }
}
