// @arch docs/features/app-relay-connectivity.md#七、可观测性与隐私
// @test ../__tests__/relay-url.test.ts

import { getServerUrl } from '../config/server'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
} from '@shennian/wire'

export function buildRelayUrl(machineId: string): string {
  return `${getRelayWsBase()}/relay/${machineId}${buildSessionSyncQuery()}`
}

export function buildRelayClientUrl(): string {
  return `${getRelayWsBase()}/relay/client${buildSessionSyncQuery()}`
}

function nativeBuildNumber(): number {
  const build = Number(Application.nativeBuildVersion ?? 0)
  return Number.isSafeInteger(build) && build > 0 ? build : 0
}

function buildSessionSyncQuery(): string {
  const platform = runtimePlatform()
  const params = new URLSearchParams({
    syncProtocol: String(SESSION_SYNC_PROTOCOL_VERSION),
    dataEpoch: String(SESSION_SYNC_DATA_EPOCH),
    syncCapabilities: SESSION_SYNC_REQUIRED_CAPABILITIES.join(','),
    appBuild: String(nativeBuildNumber()),
    platform,
    deliveryVersion: `${Constants.expoConfig?.extra?.deliveryVersion ?? Constants.expoConfig?.version ?? ''}`,
  })
  if (platform === 'desktop') {
    params.set('desktopVersion', `${Constants.expoConfig?.extra?.desktopVersion ?? ''}`)
  }
  return `?${params.toString()}`
}

function runtimePlatform(): string {
  if (Constants.expoConfig?.extra?.controlSurface === 'desktop') return 'desktop'
  if (Constants.platform?.ios) return 'ios'
  if (Constants.platform?.android) return 'android'
  return 'web'
}

function getRelayWsBase(): string {
  const relayOverride = process.env.EXPO_PUBLIC_SHENNIAN_RELAY_URL?.trim()
  const relayBaseUrl = relayOverride || getServerUrl()
  const url = new URL(relayBaseUrl)
  const protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  return `${protocol}//${url.host}`
}
