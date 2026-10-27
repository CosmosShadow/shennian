// @covers src/features/personal-modules/locationTracking.native.ts
// @covers src/features/personal-modules/locationNativeModules.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({
  runtime: '0.6.0',
  configured: true,
  account: 'alice',
  foreground: 'granted',
  background: 'granted',
  app: 'active',
  enabled: true,
  services: true,
  native: true,
  handler: null as any,
  clear: vi.fn(),
  bind: vi.fn(),
  preference: vi.fn(),
  append: vi.fn(),
  heartbeat: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  requestFront: vi.fn(),
  requestBack: vi.fn(),
  locationLoads: vi.fn(),
  taskLoads: vi.fn(),
}))
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return s.app
    },
  },
}))
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => (s.native ? {} : null) }))
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        get recordingLocationNative() {
          return s.configured
        },
      },
    },
  },
}))
vi.mock('expo-updates', () => ({
  get runtimeVersion() {
    return s.runtime
  },
  isEnabled: true,
}))
vi.mock('../config/auth', () => ({
  useAuthStore: { getState: () => ({ user: { id: s.account } }) },
}))
vi.mock('../config/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../features/personal-modules/locationStore', () => ({
  locationStore: {
    clear: s.clear,
    bind: s.bind,
    preference: s.preference,
    append: s.append,
    heartbeat: s.heartbeat,
    enabled: async () => s.enabled,
  },
}))
vi.mock('../features/personal-modules/locationNativeModules', () => ({
  locationApi: () => {
    s.locationLoads()
    return {
      Accuracy: { High: 4 },
      hasStartedLocationUpdatesAsync: async () => true,
      startLocationUpdatesAsync: s.start,
      stopLocationUpdatesAsync: s.stop,
      getForegroundPermissionsAsync: async () => ({ status: s.foreground }),
      getBackgroundPermissionsAsync: async () => ({ status: s.background }),
      requestForegroundPermissionsAsync: s.requestFront,
      requestBackgroundPermissionsAsync: s.requestBack,
      hasServicesEnabledAsync: async () => s.services,
    }
  },
  taskApi: () => {
    s.taskLoads()
    return {
      isTaskDefined: () => false,
      defineTask: (_: string, handler: any) => {
        s.handler = handler
      },
    }
  },
}))
import {
  initializeLocation,
  locationAvailable,
  startLocation,
  stopLocation,
  setLocationEnabled,
} from '../features/personal-modules/locationTracking.native'
import { useLocationTracking } from '../features/personal-modules/locationTrackingState'
beforeEach(async () => {
  s.runtime = '0.6.0'
  s.native = true
  s.account = 'alice'
  s.enabled = true
  s.foreground = s.background = 'granted'
  s.app = 'active'
  s.services = true
  s.requestFront.mockResolvedValue({ status: 'granted' })
  s.requestBack.mockResolvedValue({ status: 'granted' })
  s.clear.mockResolvedValue(undefined)
  s.bind.mockResolvedValue(undefined)
  s.preference.mockResolvedValue(undefined)
  s.start.mockResolvedValue(undefined)
  s.append.mockResolvedValue(false)
  await initializeLocation('alice')
  vi.clearAllMocks()
})
describe('native session and permission boundaries', () => {
  it('never loads location APIs in runtime 0.5.0 even if OTA metadata claims support', async () => {
    s.runtime = '0.5.0'
    expect(locationAvailable()).toBe(false)
    await startLocation('alice', 'a')
    expect(s.locationLoads).not.toHaveBeenCalled()
    expect(s.start).not.toHaveBeenCalled()
    expect(useLocationTracking.getState().error).toBe('location_upgrade')
  })
  it('requires both actual modules and foreground start', async () => {
    s.native = false
    expect(locationAvailable()).toBe(false)
    s.native = true
    s.app = 'background'
    await startLocation('alice', 'a')
    expect(s.start).not.toHaveBeenCalled()
    expect(useLocationTracking.getState().error).toBe('location_foreground')
  })
  it('denied background permission leaves tracking stopped without changing preference', async () => {
    s.requestBack.mockResolvedValue({ status: 'denied' })
    await expect(setLocationEnabled('alice', true)).rejects.toThrow('location_permission')
    expect(s.preference).not.toHaveBeenCalled()
    expect(s.start).not.toHaveBeenCalled()
  })
  it('starts native background collection and invalidates storage before stopping', async () => {
    await startLocation('alice', 'a')
    expect(s.bind).toHaveBeenCalledWith('alice', 'a')
    expect(s.start).toHaveBeenCalledWith(
      'shennian-recording-location-v1',
      expect.objectContaining({ distanceInterval: 20, foregroundService: expect.any(Object) }),
    )
    expect(useLocationTracking.getState().active).toBe(true)
    await stopLocation()
    expect(s.clear.mock.invocationCallOrder[0]).toBeLessThan(s.stop.mock.invocationCallOrder[0]!)
    expect(useLocationTracking.getState().active).toBe(false)
  })
  it('does not start after account changes during permission prompt', async () => {
    s.requestBack.mockImplementation(async () => {
      s.account = 'bob'
      return { status: 'granted' }
    })
    await setLocationEnabled('alice', true, 'a')
    expect(s.preference).not.toHaveBeenCalled()
    expect(s.start).not.toHaveBeenCalled()
  })
  it('does not restart stopped audio when an outstanding permission request returns', async () => {
    await startLocation('alice', 'a')
    s.start.mockClear()
    s.requestBack.mockImplementation(async () => {
      void stopLocation()
      return { status: 'granted' }
    })
    await setLocationEnabled('alice', true, 'a')
    await stopLocation()
    expect(s.start).not.toHaveBeenCalled()
  })
  it('native failure clears the collection binding and surfaces the error', async () => {
    s.start.mockRejectedValue(new Error('OS service failed'))
    await startLocation('alice', 'a')
    expect(s.clear).toHaveBeenCalled()
    expect(useLocationTracking.getState().error).toBe('location_failed')
  })
  it('still stops the OS service when local storage invalidation fails', async () => {
    s.clear.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(initializeLocation('alice')).rejects.toThrow('location_failed')
    expect(s.stop).toHaveBeenCalled()
    expect(useLocationTracking.getState().active).toBe(false)
  })
  it('task expiration stops native collection; errors do not escape the background task', async () => {
    s.append.mockResolvedValue(true)
    await s.handler({ data: { locations: [] } })
    expect(s.stop).toHaveBeenCalled()
    expect(useLocationTracking.getState().error).toBe('location_interrupted')
    await s.handler({ error: new Error('permission revoked') })
    expect(useLocationTracking.getState().active).toBe(false)
  })
})

it('does not ask for background access after foreground permission is denied', async () => {
  s.requestFront.mockResolvedValue({ status: 'denied' })
  await expect(setLocationEnabled('alice', true)).rejects.toThrow('location_permission')
  expect(s.requestBack).not.toHaveBeenCalled()
  expect(s.preference).not.toHaveBeenCalled()
})

it('automatically records with granted permissions even when the old switch was off', async () => {
  s.enabled = false
  await startLocation('alice', 'auto')
  expect(s.requestFront).not.toHaveBeenCalled()
  expect(s.requestBack).not.toHaveBeenCalled()
  expect(s.preference).toHaveBeenCalledWith('alice', true)
  expect(s.bind).toHaveBeenCalledWith('alice', 'auto')
  expect(useLocationTracking.getState().active).toBe(true)
})
it('requests undetermined system permissions only at recording start', async () => {
  s.foreground = s.background = 'undetermined'
  await startLocation('alice', 'auto')
  expect(s.requestFront).toHaveBeenCalledOnce()
  expect(s.requestBack).toHaveBeenCalledOnce()
  expect(s.start).toHaveBeenCalledOnce()
})
it('does not repeatedly request denied permissions or block audio with an exception', async () => {
  s.background = 'denied'
  await expect(startLocation('alice', 'auto')).resolves.toBeUndefined()
  await startLocation('alice', 'next')
  expect(s.requestBack).not.toHaveBeenCalled()
  expect(s.start).not.toHaveBeenCalled()
})
it('does not capture if recording stops while automatic permission is pending', async () => {
  s.background = 'undetermined'
  s.requestBack.mockImplementationOnce(async () => {
    void stopLocation()
    return { status: 'granted' }
  })
  await startLocation('alice', 'auto')
  await stopLocation()
  expect(s.bind).not.toHaveBeenCalled()
  expect(s.start).not.toHaveBeenCalled()
})
