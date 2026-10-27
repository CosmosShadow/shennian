// @arch docs/engineering/build-and-release.md
// @covers packages/app/src/features/profile/appUpdate.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      version: '0.2.0',
      extra: {
        otaVersion: '',
        otaVersionSuffix: '13',
        deliveryVersion: '0.2.13',
      },
    },
    nativeApplicationVersion: '0.2.0',
  },
}))

vi.mock('expo-updates', () => ({
  isEnabled: true,
  manifest: null,
  useUpdates: () => ({
    isUpdateAvailable: false,
    isUpdatePending: false,
    isChecking: false,
    isDownloading: false,
  }),
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}))

import {
  getAppUpdateMessage,
  getAppUpdateStatusLabel,
  getNativeAppVersionLabel,
  getNativeReleaseVersionForPlatform,
  getOtaUpdateVersionLabel,
  isCompatibilityBlocked,
  isNativeBuildUpgradeRequired,
  isVersionNewer,
  resolveAppUpdateStatus,
  shouldShowAppUpdateBadge,
} from '../features/profile/appUpdate'

describe('profile app update helpers', () => {
  it('shows the base app version when no OTA manifest is active', () => {
    expect(getNativeAppVersionLabel()).toBe('v0.2.0')
  })

  it('extracts OTA version from update manifest extra', () => {
    expect(
      getOtaUpdateVersionLabel({
        extra: {
          shellVersion: '0.2.0',
          deliveryVersion: '0.2.14',
          otaVersionSuffix: '14',
        },
      }),
    ).toBe('v0.2.14')
  })

  it('reads the current self-hosted OTA version from nested Expo client metadata', () => {
    const manifest = {
      extra: {
        expoClient: {
          extra: {
            shellVersion: '0.5.0',
            deliveryVersion: '0.5.9',
            otaVersion: '0.5.12',
          },
        },
      },
    }
    expect(getNativeAppVersionLabel(manifest)).toBe('v0.5.12')
    expect(getOtaUpdateVersionLabel(manifest)).toBe('v0.5.12')
  })

  it('shows available and downloaded states clearly', () => {
    expect(getAppUpdateStatusLabel('available', 'v0.2.13', 'v0.2.14', null)).toBe(
      '有新版本 v0.2.14',
    )
    expect(getAppUpdateStatusLabel('downloaded', 'v0.2.13', null, null)).toBe('重启后生效')
  })

  it('shows progress and latest-version messages', () => {
    expect(getAppUpdateStatusLabel('downloading', 'v0.2.13', null, 0.42)).toBe('下载中 42%')
    expect(getAppUpdateMessage('not-available', 'v0.2.13', null, null)).toBe(
      '已是最新版本。',
    )
  })

  it('does not expose OTA terminology in user-facing update messages', () => {
    expect(getAppUpdateMessage('available', 'v0.2.13', null, null)).toBe(
      '发现新版本，正在后台下载。',
    )
    expect(getAppUpdateMessage('unsupported', 'v0.2.13', null, null)).toBe(
      '此环境不支持应用内更新。',
    )
  })

  it('compares native releases without treating equal or malformed versions as updates', () => {
    expect(isVersionNewer('0.4.1', '0.4.0')).toBe(true)
    expect(isVersionNewer('0.4.0', '0.4.0')).toBe(false)
    expect(isVersionNewer('0.3.99', '0.4.0')).toBe(false)
    expect(isVersionNewer('preview', '0.4.0')).toBe(false)
  })

  it('uses the Android artifact version and leaves iOS updates to the system', () => {
    const release = {
      version: '0.4.0',
      platforms: {
        android: { version: '0.5.0' },
        ios: { version: '0.6.0' },
      },
    }
    expect(getNativeReleaseVersionForPlatform(release, 'android')).toBe('0.5.0')
    expect(getNativeReleaseVersionForPlatform(release, 'ios')).toBeNull()
  })

  it('distinguishes a native-build hard gate from other compatibility blocks', () => {
    const nativeBlock = {
      phase: 'blocked',
      reason: 'version_unsupported',
      closeReason: 'upgrade_required:app_build_too_old:min=54',
    } as never
    const protocolBlock = {
      phase: 'blocked',
      reason: 'version_unsupported',
      closeReason: 'upgrade_required:session_sync_protocol_mismatch',
    } as never

    expect(isCompatibilityBlocked(nativeBlock)).toBe(true)
    expect(isNativeBuildUpgradeRequired(nativeBlock)).toBe(true)
    expect(isCompatibilityBlocked(protocolBlock)).toBe(true)
    expect(isNativeBuildUpgradeRequired(protocolBlock)).toBe(false)
  })

  it('keeps routine OTA updates quiet and badges only user-actionable updates', () => {
    expect(shouldShowAppUpdateBadge({
      otaStatus: 'available',
      nativeUpdateAvailable: false,
      compatibilityBlocked: false,
    })).toBe(false)
    expect(shouldShowAppUpdateBadge({
      otaStatus: 'downloaded',
      nativeUpdateAvailable: false,
      compatibilityBlocked: false,
    })).toBe(false)
    expect(shouldShowAppUpdateBadge({
      otaStatus: 'not-available',
      nativeUpdateAvailable: true,
      compatibilityBlocked: false,
    })).toBe(true)
    expect(shouldShowAppUpdateBadge({
      otaStatus: 'downloading',
      nativeUpdateAvailable: false,
      compatibilityBlocked: true,
    })).toBe(true)
  })

  it('keeps the downloaded UI state when native download progress lags at 100%', () => {
    expect(
      resolveAppUpdateStatus({
        supported: true,
        updatesState: {
          isUpdatePending: false,
          isDownloading: true,
          isChecking: false,
          isUpdateAvailable: true,
        },
        manualStatus: 'downloaded',
        lastError: null,
      }),
    ).toBe('downloaded')
  })
})
