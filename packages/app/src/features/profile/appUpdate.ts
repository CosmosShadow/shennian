// @arch docs/features/mobile-app-update-experience.md
// @arch docs/engineering/build-and-release.md
// @test packages/app/src/__tests__/profile-app-update.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import type { RelayConnectivitySnapshot } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { getServerUrl } from '../../config/server'
import { formatAppVersionLabel } from './version'

export type AppUpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export type AppUpdateState = {
  supported: boolean
  status: AppUpdateStatus
  currentVersionLabel: string
  currentOtaVersionLabel: string | null
  nativeShellVersionLabel: string
  nativeBuildVersion: string | null
  availableVersionLabel: string | null
  progress: number | null
  hasUpdateBadge: boolean
  nativeUpdateAvailable: boolean
  nativeUpdateRequired: boolean
  compatibilityBlocked: boolean
  nativeVersionLabel: string | null
  rowValueLabel: string
  checking: boolean
  downloading: boolean
  message: string
  check: () => Promise<void>
  download: () => Promise<void>
  restart: () => Promise<void>
}

type ExpoUpdatesStateSnapshot = {
  isUpdatePending: boolean
  isDownloading: boolean
  isChecking: boolean
  isUpdateAvailable: boolean
  checkError?: unknown
  downloadError?: unknown
}

type ManifestLike = {
  extra?: Record<string, unknown>
}

type OtaVersionMetadata = {
  shellVersion: string | null
  deliveryVersion: string
  otaVersion: string
  otaSuffix: string
}

type NativeRelease = {
  version: string
  platforms?: Partial<Record<'ios' | 'android', { version?: string }>>
}

export function getNativeReleaseVersionForPlatform(
  release: NativeRelease | null | undefined,
  platform: string,
): string | null {
  if (platform !== 'android') return null
  return release?.platforms?.android?.version ?? release?.version ?? null
}

const AUTO_CHECK_DELAY_MS = 3500

let otaAutoCheckStarted = false
let nativeReleaseRequest: Promise<NativeRelease | null> | null = null
let nativeReleaseCache: NativeRelease | null = null

function getNativeShellVersion(): string | null {
  const value = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version
  return typeof value === 'string' && value.trim() ? value.trim().replace(/^v/, '') : null
}

function parseVersion(value: string | null | undefined): number[] | null {
  const normalized = value?.trim().replace(/^v/, '')
  if (!normalized || !/^\d+(?:\.\d+){0,2}$/.test(normalized)) return null
  return normalized.split('.').map(Number)
}

export function isVersionNewer(
  candidate: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  const length = Math.max(next.length, installed.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (next[index] ?? 0) - (installed[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

export function isNativeBuildUpgradeRequired(
  snapshot: RelayConnectivitySnapshot | null | undefined,
): boolean {
  return snapshot?.phase === 'blocked'
    && snapshot.reason === 'version_unsupported'
    && /app_build_too_old/i.test(snapshot.closeReason ?? '')
}

export function isCompatibilityBlocked(
  snapshot: RelayConnectivitySnapshot | null | undefined,
): boolean {
  return snapshot?.phase === 'blocked' && snapshot.reason === 'version_unsupported'
}

export function shouldShowAppUpdateBadge(input: {
  otaStatus: AppUpdateStatus
  nativeUpdateAvailable: boolean
  compatibilityBlocked: boolean
}): boolean {
  // A routine OTA is checked, downloaded, and applied without asking the user.
  // Reserve the settings badge for an install the user must perform or a
  // compatibility block that needs attention.
  return input.nativeUpdateAvailable || input.compatibilityBlocked
}

async function fetchNativeRelease(force = false): Promise<NativeRelease | null> {
  if (!force && nativeReleaseCache) return nativeReleaseCache
  if (nativeReleaseRequest) return nativeReleaseRequest
  nativeReleaseRequest = fetch(`${getServerUrl().replace(/\/+$/, '')}/download/stable`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Native release check failed: ${response.status}`)
      const value = await response.json() as Partial<NativeRelease>
      if (typeof value.version !== 'string') return null
      nativeReleaseCache = { version: value.version, platforms: value.platforms }
      return nativeReleaseCache
    })
    .finally(() => {
      nativeReleaseRequest = null
    })
  return nativeReleaseRequest
}

function manifestVersionMetadata(manifest: unknown): Partial<OtaVersionMetadata> {
  const extra = (manifest as ManifestLike | null | undefined)?.extra
  if (!extra) return {}
  const expoClient = extra.expoClient
  const nestedExtra = expoClient && typeof expoClient === 'object'
    ? (expoClient as { extra?: unknown }).extra
    : null
  const source = nestedExtra && typeof nestedExtra === 'object'
    ? nestedExtra as Record<string, unknown>
    : extra
  return {
    shellVersion: typeof source.shellVersion === 'string' ? source.shellVersion : null,
    deliveryVersion: typeof source.deliveryVersion === 'string' ? source.deliveryVersion : '',
    otaVersion: typeof source.otaVersion === 'string' ? source.otaVersion : '',
    otaSuffix: typeof source.otaVersionSuffix === 'string' ? source.otaVersionSuffix : '',
  }
}

export function getNativeAppVersionLabel(manifest: unknown = Updates.manifest): string {
  const manifestMetadata = manifestVersionMetadata(manifest)
  return formatAppVersionLabel({
    platform: 'native',
    shellVersion:
      manifestMetadata.shellVersion
      ?? Constants.nativeApplicationVersion
      ?? Constants.expoConfig?.version
      ?? null,
    otaVersion:
      manifestMetadata.otaVersion
      || `${Constants.expoConfig?.extra?.otaVersion ?? ''}`.trim(),
    otaSuffix: manifestMetadata.otaSuffix ?? '',
    deliveryVersion: manifestMetadata.deliveryVersion ?? '',
  })
}

export function getOtaUpdateVersionLabel(manifest: unknown): string | null {
  const metadata = manifestVersionMetadata(manifest)
  const shellVersion = metadata.shellVersion
    ?? Constants.nativeApplicationVersion
    ?? Constants.expoConfig?.version
    ?? null
  const deliveryVersion = metadata.deliveryVersion ?? ''
  const otaVersion = metadata.otaVersion ?? ''
  const otaSuffix = metadata.otaSuffix ?? ''

  if (!otaVersion && !deliveryVersion && !otaSuffix) return null

  return formatAppVersionLabel({
    platform: 'native',
    shellVersion,
    otaVersion,
    deliveryVersion,
    otaSuffix,
  })
}

export function getAppUpdateStatusLabel(
  status: AppUpdateStatus,
  currentVersionLabel: string,
  availableVersionLabel: string | null,
  progress: number | null,
): string {
  if (status === 'checking') return '检查中…'
  if (status === 'available')
    return availableVersionLabel ? `有新版本 ${availableVersionLabel}` : '有新版本'
  if (status === 'downloading') return `下载中 ${Math.round((progress ?? 0) * 100)}%`
  if (status === 'downloaded') return '重启后生效'
  if (status === 'not-available') return '已是最新'
  if (status === 'error') return '检查失败'
  return currentVersionLabel
}

export function getAppUpdateMessage(
  status: AppUpdateStatus,
  currentVersionLabel: string,
  availableVersionLabel: string | null,
  progress: number | null,
): string {
  if (status === 'unsupported') return '此环境不支持应用内更新。'
  if (status === 'checking') return '正在检查更新…'
  if (status === 'available') {
    return availableVersionLabel
      ? `发现新版本 ${availableVersionLabel}，正在后台下载。`
      : '发现新版本，正在后台下载。'
  }
  if (status === 'downloading') return `正在后台下载 ${Math.round((progress ?? 0) * 100)}%。`
  if (status === 'downloaded') return '更新已准备好，下次启动自动生效。'
  if (status === 'not-available') return '已是最新版本。'
  if (status === 'error') return '检查更新失败，将在稍后自动重试。'
  return '应用会在后台自动检查更新。'
}

export function resolveAppUpdateStatus({
  supported,
  updatesState,
  manualStatus,
  lastError,
}: {
  supported: boolean
  updatesState: ExpoUpdatesStateSnapshot
  manualStatus: AppUpdateStatus
  lastError: Error | null
}): AppUpdateStatus {
  if (!supported) return 'unsupported'
  if (updatesState.isUpdatePending || manualStatus === 'downloaded') return 'downloaded'
  if (updatesState.isDownloading || manualStatus === 'downloading') return 'downloading'
  if (updatesState.isChecking || manualStatus === 'checking') return 'checking'
  if (updatesState.isUpdateAvailable || manualStatus === 'available') return 'available'
  if (
    updatesState.checkError ||
    updatesState.downloadError ||
    lastError ||
    manualStatus === 'error'
  )
    return 'error'
  if (manualStatus === 'not-available') return 'not-available'
  return 'idle'
}

export function useAppUpdateState({
  autoCheck = false,
  compatibilitySnapshot = null,
}: {
  autoCheck?: boolean
  compatibilitySnapshot?: RelayConnectivitySnapshot | null
} = {}): AppUpdateState {
  const { t } = useTranslation()
  const updatesState = Updates.useUpdates()
  const supported = Platform.OS !== 'web' && Updates.isEnabled
  const [manualStatus, setManualStatus] = useState<AppUpdateStatus>('idle')
  const [lastAvailableVersionLabel, setLastAvailableVersionLabel] = useState<string | null>(null)
  const [lastError, setLastError] = useState<Error | null>(null)
  const [nativeRelease, setNativeRelease] = useState<NativeRelease | null>(nativeReleaseCache)
  const [nativeCheckError, setNativeCheckError] = useState<Error | null>(null)
  const checkInFlightRef = useRef(false)
  const downloadInFlightRef = useRef(false)
  const currentVersionLabel = useMemo(() => getNativeAppVersionLabel(Updates.manifest), [])
  const currentManifestMetadata = useMemo(() => manifestVersionMetadata(Updates.manifest), [])
  const currentOtaVersionLabel = currentManifestMetadata.otaVersion
    ? formatAppVersionLabel({
        platform: 'native',
        shellVersion: getNativeShellVersion(),
        otaVersion: currentManifestMetadata.otaVersion,
      })
    : null
  const nativeShellVersionLabel = formatAppVersionLabel({
    platform: 'native',
    shellVersion: getNativeShellVersion(),
  })
  const nativeBuildVersion = Constants.nativeBuildVersion?.trim() || null

  const availableVersionLabel = useMemo(
    () =>
      getOtaUpdateVersionLabel(updatesState.downloadedUpdate?.manifest) ??
      getOtaUpdateVersionLabel(updatesState.availableUpdate?.manifest) ??
      lastAvailableVersionLabel,
    [
      lastAvailableVersionLabel,
      updatesState.availableUpdate?.manifest,
      updatesState.downloadedUpdate?.manifest,
    ],
  )

  const progress = updatesState.isDownloading ? (updatesState.downloadProgress ?? 0) : null
  const status = resolveAppUpdateStatus({
    supported,
    updatesState,
    manualStatus,
    lastError,
  })

  const download = useCallback(async () => {
    if (!supported || downloadInFlightRef.current) return
    downloadInFlightRef.current = true
    setLastError(null)
    setManualStatus('downloading')
    try {
      const result = await Updates.fetchUpdateAsync()
      if (result.isNew || result.isRollBackToEmbedded) {
        setLastAvailableVersionLabel(getOtaUpdateVersionLabel(result.manifest))
        setManualStatus('downloaded')
      } else {
        setManualStatus('not-available')
      }
    } catch (error) {
      setLastError(error instanceof Error ? error : new Error('Update download failed'))
      setManualStatus('error')
    } finally {
      downloadInFlightRef.current = false
    }
  }, [supported])

  const checkOta = useCallback(async () => {
    if (!supported || checkInFlightRef.current) return
    checkInFlightRef.current = true
    setLastError(null)
    setManualStatus('checking')
    try {
      const result = await Updates.checkForUpdateAsync()
      if (result.isAvailable) {
        setLastAvailableVersionLabel(getOtaUpdateVersionLabel(result.manifest))
        setManualStatus('available')
        await download()
      } else {
        setManualStatus('not-available')
      }
    } catch (error) {
      setLastError(error instanceof Error ? error : new Error('Update check failed'))
      setManualStatus('error')
    } finally {
      checkInFlightRef.current = false
    }
  }, [download, supported])

  const checkNative = useCallback(async (force = false) => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
    setNativeCheckError(null)
    try {
      setNativeRelease(await fetchNativeRelease(force))
    } catch (error) {
      setNativeCheckError(error instanceof Error ? error : new Error('Native release check failed'))
    }
  }, [])

  const check = useCallback(async () => {
    await Promise.all([checkOta(), checkNative(true)])
  }, [checkNative, checkOta])

  const restart = useCallback(async () => {
    if (!supported) return
    await Updates.reloadAsync()
  }, [supported])

  useEffect(() => {
    if (!autoCheck) return
    const timer = setTimeout(() => {
      void checkNative(false)
      if (supported && !otaAutoCheckStarted) {
        otaAutoCheckStarted = true
        void checkOta()
      }
    }, AUTO_CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [autoCheck, checkNative, checkOta, supported])

  const nativePlatform = Platform.OS === 'android' ? 'android' : null
  const nativeVersion = getNativeReleaseVersionForPlatform(nativeRelease, Platform.OS)
  const nativeUpdateAvailable = Boolean(
    nativePlatform
      && nativeRelease?.platforms?.[nativePlatform]
      && isVersionNewer(nativeVersion, getNativeShellVersion()),
  )
  const nativeUpdateRequired = Boolean(
    nativePlatform && isNativeBuildUpgradeRequired(compatibilitySnapshot),
  )
  const compatibilityBlocked = isCompatibilityBlocked(compatibilitySnapshot)
  const nativeVersionLabel = nativeVersion ? `v${nativeVersion.replace(/^v/, '')}` : null
  const hasUpdateBadge = shouldShowAppUpdateBadge({
    otaStatus: status,
    nativeUpdateAvailable,
    compatibilityBlocked,
  })
  const rowValueLabel = nativeUpdateRequired
    ? t('app_update_required')
    : compatibilityBlocked && status === 'downloaded'
      ? t('app_update_restart_required')
      : compatibilityBlocked
        ? t('app_update_preparing')
        : nativeUpdateAvailable
          ? t('app_update_available')
          : status === 'downloaded'
            ? t('app_update_restart_required')
            : currentVersionLabel

  const updateMessage = nativeUpdateRequired
    ? t('app_update_message_native_required', {
        version: nativeVersionLabel ?? t('app_update_latest_version'),
      })
    : nativeUpdateAvailable
      ? t(
          Platform.OS === 'ios'
            ? 'app_update_message_native_available_ios'
            : 'app_update_message_native_available_android',
          { version: nativeVersionLabel ?? t('app_update_latest_version') },
        )
      : compatibilityBlocked && status === 'downloaded'
        ? t('app_update_message_compatibility_ready')
        : compatibilityBlocked
          ? t('app_update_message_compatibility_preparing')
          : status === 'unsupported'
            ? t('app_update_message_unsupported')
            : status === 'checking'
              ? t('app_update_message_checking')
              : status === 'available'
                ? t('app_update_message_ota_available', { version: availableVersionLabel ?? '' })
                : status === 'downloading'
                  ? t('app_update_message_downloading', { percent: Math.round((progress ?? 0) * 100) })
                  : status === 'downloaded'
                    ? t('app_update_message_downloaded')
                    : status === 'not-available'
                      ? t('app_update_message_latest')
                      : status === 'error'
                        ? t('app_update_message_error')
                        : t('app_update_message_idle')

  return {
    supported,
    status,
    currentVersionLabel,
    currentOtaVersionLabel,
    nativeShellVersionLabel,
    nativeBuildVersion,
    availableVersionLabel,
    progress,
    hasUpdateBadge,
    nativeUpdateAvailable,
    nativeUpdateRequired,
    compatibilityBlocked,
    nativeVersionLabel,
    rowValueLabel,
    checking: status === 'checking',
    downloading: status === 'downloading',
    message: nativeCheckError && !nativeRelease && status === 'not-available'
      ? t('app_update_message_native_check_failed')
      : updateMessage,
    check,
    download,
    restart,
  }
}
