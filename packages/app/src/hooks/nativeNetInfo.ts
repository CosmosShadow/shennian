// @arch docs/engineering/build-and-release.md
// @test src/__tests__/native-net-info.test.ts
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native'

type NativeNetInfoState = { isConnected: boolean | null }

export type NativeNetInfoAdapter = {
  addEventListener: (listener: (state: NativeNetInfoState) => void) => () => void
  fetch: () => Promise<NativeNetInfoState>
}

type NativeNetInfoModule = { default?: NativeNetInfoAdapter } & Partial<NativeNetInfoAdapter>

function loadNativeNetInfo(): NativeNetInfoModule {
  return require('@react-native-community/netinfo') as NativeNetInfoModule
}

function hasNativeNetInfoModule(): boolean {
  if (Platform.OS === 'web') return false
  return Boolean(TurboModuleRegistry.get('RNCNetInfo') ?? NativeModules.RNCNetInfo)
}

/**
 * NetInfo was added after the iOS 0.3.2 shell shipped. Keep the import lazy so
 * an OTA bundle can still start on that older shell instead of crashing while
 * React Native evaluates the module.
 */
export function getNativeNetInfoAdapter(
  load: () => NativeNetInfoModule = loadNativeNetInfo,
): NativeNetInfoAdapter | null {
  if (!hasNativeNetInfoModule()) return null

  try {
    const netInfo = load()
    const adapter = netInfo.default ?? netInfo
    return typeof adapter.addEventListener === 'function' && typeof adapter.fetch === 'function'
      ? adapter as NativeNetInfoAdapter
      : null
  } catch {
    return null
  }
}
