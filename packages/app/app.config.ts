// @arch docs/engineering/build-and-release.md#preview-壳与-runtime
// @test src/__tests__/ota-channel-config.test.ts
import type { ExpoConfig } from 'expo/config'
import path from 'node:path'
import rootPackage from '../../package.json'
import appJson from './app.json'
import {
  resolveAppBuildProfile,
  resolveAppDistribution,
} from '../../open-source/config/app-profile.cjs'
export { resolveOtaChannel, resolveOtaBackend } from '../../open-source/config/app-profile.cjs'
import cliPackageJson from '../../open-source/packages/cli/package.json'

/** Opt-in new binary only. Default exports remain compatible with released runtimes. */
export function locationNativeConfig(config: ExpoConfig, enabled: boolean): ExpoConfig {
  if (!enabled) return config
  const purpose =
    'Record your route, approximate distance and stops while you explicitly enable location recording during a voice recording.'
  return {
    ...config,
    runtimeVersion: '0.6.0',
    ios: { ...config.ios, runtimeVersion: '0.6.0' },
    android: {
      ...config.android,
      runtimeVersion: '0.6.0',
      blockedPermissions: config.android?.blockedPermissions?.filter(
        (p) =>
          ![
            'android.permission.ACCESS_COARSE_LOCATION',
            'android.permission.ACCESS_FINE_LOCATION',
            'android.permission.ACCESS_BACKGROUND_LOCATION',
          ].includes(p),
      ),
    },
    extra: { ...config.extra, recordingLocationNative: true },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-location',
        {
          locationWhenInUsePermission: purpose,
          locationAlwaysPermission: purpose,
          locationAlwaysAndWhenInUsePermission: purpose,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      './plugins/with-recording-location.js',
    ],
  }
}

const baseConfig = appJson.expo as ExpoConfig

function routerConfig(): Record<string, unknown> {
  const current = (baseConfig.extra?.router ?? {}) as Record<string, unknown>
  if (process.env.SHENNIAN_WEB_ROUTE_ROOT === 'app-web') {
    return { ...current, root: 'app-web' }
  }
  if (process.env.SHENNIAN_DESKTOP_BUILD === '1') {
    return { ...current, root: 'app' }
  }
  return current
}

// The project explicitly declares its build overlay. Community snapshots omit it.
const compositionModule =
  process.env.SHENNIAN_APP_COMPOSITION_MODULE ||
  (rootPackage as { shennianAppComposition?: string }).shennianAppComposition
// Resolve only the declared module, never search for a private directory.
function officialComposition(): {
  desktopVersion?: string
  officialProductLinks: Record<string, unknown>
  applyOfficialNativeIdentity: (base: ExpoConfig) => ExpoConfig
  officialAppIdentity: { owner: string; eas: { projectId: string } }
  officialOtaConfig: (
    env: Record<string, string | undefined>,
    channel: string,
    backend: string,
  ) => NonNullable<ExpoConfig['updates']>
} {
  if (!compositionModule) throw new Error('official_app_composition_required')
  return require(path.resolve(__dirname, '../..', compositionModule))
}
// One App; distribution controls build identity and update trust, not server selection.
export default (): ExpoConfig => {
  const fallback = compositionModule ? 'official' : 'self-hosted'
  const distribution = resolveAppDistribution(process.env, fallback)
  const official = distribution === 'official' ? officialComposition() : undefined
  const profile = resolveAppBuildProfile(process.env, official, fallback)
  const native = official ? official.applyOfficialNativeIdentity(baseConfig) : baseConfig
  return locationNativeConfig(
    {
      ...native,
      updates: profile.updates,
      ...(profile.owner ? { owner: profile.owner } : {}),
      extra: {
        ...(baseConfig.extra ?? {}),
        ...(profile.eas ? { eas: profile.eas } : {}),
        ...(official ? { productLinks: official.officialProductLinks } : {}),
        router: routerConfig(),
        controlSurface: process.env.SHENNIAN_DESKTOP_BUILD === '1' ? 'desktop' : 'mobile',
        deliveryVersion: cliPackageJson.version,
        ...(process.env.SHENNIAN_DESKTOP_BUILD === '1' && official?.desktopVersion
          ? { desktopVersion: official.desktopVersion }
          : {}),
        otaVersion: process.env.EXPO_PUBLIC_OTA_VERSION?.trim() || '',
        otaVersionSuffix: process.env.EXPO_PUBLIC_OTA_VERSION_SUFFIX?.trim() || '',
      },
    },
    process.env.SHENNIAN_LOCATION_NATIVE_BUILD === '1',
  )
}
