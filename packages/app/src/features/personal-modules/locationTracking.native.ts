// @arch docs/features/recording-location.md
// @test src/__tests__/recording-location-native.test.ts
import { locationApi as location, taskApi as tasks } from './locationNativeModules'
import { AppState } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import i18n from '../../config/i18n'
import { useAuthStore } from '../../config/auth'
import { locationStore } from './locationStore'
import { useLocationTracking } from './locationTrackingState'
const task = 'shennian-recording-location-v1'
export function locationAvailable() {
  const configured =
    Updates.runtimeVersion === '0.6.0' ||
    (!Updates.isEnabled && Constants.expoConfig?.extra?.recordingLocationNative === true)
  return (
    configured &&
    !!requireOptionalNativeModule('ExpoLocation') &&
    !!requireOptionalNativeModule('ExpoTaskManager')
  )
}
// Never evaluate expo-location's native imports in the released 0.5.x shells.
function fail(error = 'location_failed') {
  useLocationTracking.setState({ active: false, error })
}
let desired: { account: string; session: string } | null = null
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = chain.then(action, action)
  chain = result.catch(() => {})
  return result
}
async function stopNative() {
  // Storage invalidation and native shutdown are independent: a disk error must
  // never prevent the attempt to stop the OS location service.
  let failed = false
  try {
    await locationStore.clear()
  } catch {
    failed = true
  }
  try {
    if (locationAvailable() && (await location().hasStartedLocationUpdatesAsync(task)))
      await location().stopLocationUpdatesAsync(task)
  } catch {
    failed = true
  }
  useLocationTracking.setState({ active: false, ...(failed ? { error: 'location_failed' } : {}) })
  if (failed) throw new Error('location_failed')
}

if (locationAvailable() && !tasks().isTaskDefined(task)) {
  tasks().defineTask<{ locations: import('expo-location').LocationObject[] }>(
    task,
    async ({ data, error }) => {
      try {
        if (error) {
          fail('location_interrupted')
          await stopNative()
          return
        }
        const expired = await locationStore.append(
          (data?.locations ?? []).map((p) => ({
            timestamp: p.timestamp,
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy ?? Infinity,
            speed: p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed : null,
          })),
        )
        if (expired) {
          await stopNative()
          fail('location_interrupted')
          return
        }
        useLocationTracking.setState((s) => ({ revision: s.revision + 1 }))
      } catch {
        fail('location_failed')
        await stopNative().catch(() => {})
      }
    },
  )
}
function current(account: string) {
  return useAuthStore.getState().user?.id === account
}
export function initializeLocation(account: string) {
  return serial(async () => {
    desired = null
    await stopNative()
    const enabled = await locationStore.enabled(account)
    if (current(account))
      useLocationTracking.setState({ account, enabled, active: false, error: null })
  })
}
async function start(account: string, session: string) {
  const wanted = () =>
    current(account) && desired?.account === account && desired?.session === session
  if (!wanted()) return
  if (!locationAvailable()) {
    fail('location_upgrade')
    return
  }
  const api = location()
  if (AppState.currentState !== 'active') {
    fail('location_foreground')
    return
  }
  // Location follows an explicit recording start, not a separate app switch.
  // Respect system denial: never repeatedly prompt on later recordings.
  let foreground = await api.getForegroundPermissionsAsync()
  if (foreground.status === 'undetermined')
    foreground = await api.requestForegroundPermissionsAsync()
  if (!wanted()) return
  if (foreground.status !== 'granted') {
    fail('location_permission')
    return
  }
  let background = await api.getBackgroundPermissionsAsync()
  if (background.status === 'undetermined')
    background = await api.requestBackgroundPermissionsAsync()
  if (!wanted()) return
  if (background.status !== 'granted') {
    fail('location_permission')
    return
  }
  if (!(await api.hasServicesEnabledAsync())) {
    fail('location_services')
    return
  }
  if (!wanted()) return
  await locationStore.preference(account, true)
  if (!wanted()) return
  await locationStore.bind(account, session)
  try {
    await api.startLocationUpdatesAsync(task, {
      accuracy: api.Accuracy.High,
      distanceInterval: 20,
      timeInterval: 30000,
      deferredUpdatesInterval: 60000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: i18n.t('location_title'),
        notificationBody: i18n.t('location_notification'),
        killServiceOnDestroy: true,
      },
    })
    if (!wanted()) {
      await stopNative()
      return
    }
    useLocationTracking.setState({ account, enabled: true, active: true, error: null })
  } catch {
    await stopNative()
    fail('location_failed')
  }
}
export function startLocation(account: string, session: string) {
  desired = { account, session }
  return serial(async () => {
    try {
      await start(account, session)
    } catch {
      fail()
      await stopNative().catch(() => {})
    }
  })
}
export function stopLocation() {
  desired = null
  // Do not wait behind an OS permission prompt to invalidate persisted capture.
  const invalidated = locationStore.clear().catch(() => fail())
  return serial(async () => {
    await invalidated
    await stopNative()
  })
}
export function setLocationEnabled(account: string, enabled: boolean, session?: string) {
  return serial(async () => {
    if (!current(account)) return
    if (!enabled) {
      await locationStore.preference(account, false)
      useLocationTracking.setState({ account, enabled: false })
      await stopNative()
      return
    }
    if (!locationAvailable()) throw new Error('location_upgrade')
    if (AppState.currentState !== 'active') throw new Error('location_foreground')
    const api = location()
    if ((await api.requestForegroundPermissionsAsync()).status !== 'granted')
      throw new Error('location_permission')
    if (!current(account)) return
    // On Android this can open Settings. The UI consent explains this first.
    if ((await api.requestBackgroundPermissionsAsync()).status !== 'granted')
      throw new Error('location_permission')
    if (!current(account)) return
    await locationStore.preference(account, true)
    useLocationTracking.setState({ account, enabled: true, error: null })
    if (session) await start(account, session)
  })
}
let heartbeatAt = 0
export async function locationHeartbeat(account: string, session: string) {
  if (!useLocationTracking.getState().active || Date.now() - heartbeatAt < 30000) return
  heartbeatAt = Date.now()
  try {
    await locationStore.heartbeat(account, session)
  } catch {
    fail()
    await stopLocation().catch(() => {})
  }
}
