// @covers src/hooks/nativeNetInfo.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeModules = vi.hoisted(() => ({ RNCNetInfo: undefined as unknown }))
const turboModuleGet = vi.hoisted(() => vi.fn(() => null as unknown))
vi.mock('react-native', () => ({
  NativeModules: nativeModules,
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: turboModuleGet },
}))

describe('native NetInfo compatibility', () => {
  beforeEach(() => {
    nativeModules.RNCNetInfo = undefined
    turboModuleGet.mockReturnValue(null)
  })

  it('does not evaluate NetInfo when an older native shell lacks the module', async () => {
    const { getNativeNetInfoAdapter } = await import('../hooks/nativeNetInfo')
    const load = vi.fn()

    expect(getNativeNetInfoAdapter(load)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('loads NetInfo when the native shell provides the module', async () => {
    turboModuleGet.mockReturnValue({})
    const { getNativeNetInfoAdapter } = await import('../hooks/nativeNetInfo')
    const adapter = { addEventListener: vi.fn(), fetch: vi.fn() }
    const load = vi.fn(() => ({ default: adapter }))

    expect(getNativeNetInfoAdapter(load)).toBe(adapter)
    expect(load).toHaveBeenCalledOnce()
  })
})
