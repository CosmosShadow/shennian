// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-sync-gate.test.ts

import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_RELEASE_GATE,
  getMissingSessionSyncCapabilities,
  type SessionSyncCapability,
} from '@shennian/wire'

export type SessionSyncHandshake = {
  protocolVersion: number | null
  dataEpoch: number | null
  capabilities: string[]
  appBuild: number | null
  desktopVersion: string | null
  daemonInstallationId: string | null
}

export type SessionSyncGateDecision =
  | { allowed: true; handshake: SessionSyncHandshake }
  | { allowed: false; code: 'upgrade_required' | 'epoch_mismatch'; reason: string }

export function parseSessionSyncHandshake(url: URL): SessionSyncHandshake {
  const protocolRaw = url.searchParams.get('syncProtocol')
  const appBuildRaw = url.searchParams.get('appBuild')
  const dataEpochRaw = url.searchParams.get('dataEpoch')
  return {
    protocolVersion: protocolRaw && /^\d+$/.test(protocolRaw) ? Number(protocolRaw) : null,
    dataEpoch: dataEpochRaw && /^\d+$/.test(dataEpochRaw) ? Number(dataEpochRaw) : null,
    capabilities: (url.searchParams.get('syncCapabilities') ?? '')
      .split(',').map((value) => value.trim()).filter(Boolean),
    appBuild: appBuildRaw && /^\d+$/.test(appBuildRaw) ? Number(appBuildRaw) : null,
    desktopVersion: normalizeSemver(url.searchParams.get('desktopVersion')),
    daemonInstallationId: url.searchParams.get('daemonInstallationId')?.trim() || null,
  }
}

function parseSemver(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function normalizeSemver(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length <= 128 && parseSemver(trimmed) ? trimmed : null
}

function isSemverAtLeast(value: string | null, minimum: string): boolean {
  const parsed = parseSemver(value)
  const parsedMinimum = parseSemver(minimum)
  if (!parsed || !parsedMinimum) return false
  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index] !== parsedMinimum[index]) return parsed[index] > parsedMinimum[index]
  }
  return true
}

function checkProtocol(handshake: SessionSyncHandshake): SessionSyncGateDecision | null {
  if (handshake.protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION) {
    return { allowed: false, code: 'upgrade_required', reason: 'session_sync_protocol_mismatch' }
  }
  if (handshake.dataEpoch !== SESSION_SYNC_DATA_EPOCH) {
    return { allowed: false, code: 'epoch_mismatch', reason: `data_epoch_mismatch:required=${SESSION_SYNC_DATA_EPOCH}` }
  }
  const missing = getMissingSessionSyncCapabilities(handshake.capabilities)
  if (missing.length > 0) {
    return { allowed: false, code: 'upgrade_required', reason: `missing_capabilities:${missing.join(',')}` }
  }
  return null
}

export function checkDaemonSessionSyncHandshake(url: URL): SessionSyncGateDecision {
  const handshake = parseSessionSyncHandshake(url)
  const protocolError = checkProtocol(handshake)
  if (protocolError) return protocolError
  if (!handshake.daemonInstallationId || handshake.daemonInstallationId.length > 191) {
    return { allowed: false, code: 'upgrade_required', reason: 'daemon_installation_identity_required' }
  }
  return { allowed: true, handshake }
}

export function checkAppSessionSyncHandshake(
  url: URL,
  platform: string,
): SessionSyncGateDecision {
  const handshake = parseSessionSyncHandshake(url)
  const protocolError = checkProtocol(handshake)
  if (protocolError) return protocolError
  if (platform === 'desktop') {
    const minimum = SESSION_SYNC_RELEASE_GATE.minDesktopVersion
    if (!isSemverAtLeast(handshake.desktopVersion, minimum)) {
      return { allowed: false, code: 'upgrade_required', reason: `desktop_version_too_old:min=${minimum}` }
    }
    return { allowed: true, handshake }
  }
  const minBuild = platform === 'ios'
    ? SESSION_SYNC_RELEASE_GATE.minAppBuild.ios
    : platform === 'android'
      ? SESSION_SYNC_RELEASE_GATE.minAppBuild.android
      : null
  if (minBuild === null || handshake.appBuild === null || handshake.appBuild < minBuild) {
    return { allowed: false, code: 'upgrade_required', reason: `app_build_too_old:min=${minBuild ?? 'native-only'}` }
  }
  return { allowed: true, handshake }
}

export function asSessionSyncCapabilities(values: string[]): SessionSyncCapability[] {
  return values as SessionSyncCapability[]
}
