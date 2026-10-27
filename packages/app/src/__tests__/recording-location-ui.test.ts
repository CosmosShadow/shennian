// @vitest-environment happy-dom
// @covers src/features/personal-modules/RecordingRoute.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({
  account: 'alice',
  available: false,
  alert: vi.fn(),
  set: vi.fn(),
  share: vi.fn(),
  points: vi.fn(),
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Alert: { alert: s.alert },
  Linking: { openSettings: vi.fn() },
  Share: { share: s.share },
  AppState: { addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (v: any) => v },
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress }: any) =>
    React.createElement('button', { onClick: onPress }, children),
  Switch: ({ value, onValueChange, disabled }: any) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: value,
      disabled,
      onChange: () => onValueChange(!value),
    }),
}))
vi.mock('react-native-svg', () => ({
  default: ({ children }: any) => React.createElement('svg', null, children),
  Polyline: () => React.createElement('polyline'),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((select: any) => select({ user: { id: s.account } }), {
    getState: () => ({ user: { id: s.account } }),
  }),
}))
vi.mock('../features/personal-modules/locationTracking', () => ({
  locationAvailable: () => s.available,
}))
vi.mock('../features/personal-modules/runtime', () => ({
  moduleStore: async () => ({}),
  setRecordingLocation: s.set,
}))
vi.mock('../features/personal-modules/locationStore', () => ({
  locationStore: { points: s.points },
}))
import { RecordingRoute, routeLines } from '../features/personal-modules/RecordingRoute'
import { useLocationTracking } from '../features/personal-modules/locationTrackingState'
import { locationDay, type RoutePoint } from '../features/personal-modules/locationModel'
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  s.account = 'alice'
  s.available = false
  s.set.mockResolvedValue(undefined)
  s.points.mockResolvedValue([])
  s.share.mockResolvedValue({})
  useLocationTracking.setState({
    account: 'alice',
    enabled: false,
    active: false,
    error: null,
    revision: 0,
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
    await Promise.resolve()
  })
}
it('renders only real route data and hides it immediately on account change', async () => {
  const timestamp = Date.now() - 60000,
    day = locationDay(timestamp)
  s.points.mockResolvedValue([
    { session: 'a', timestamp, day, latitude: 30, longitude: 120, speed: null, accuracy: 5 },
  ])
  await render(React.createElement(RecordingRoute, { day }))
  expect(host.textContent).toContain('location_route')
  expect(host.textContent).toContain('location_schematic')
  s.account = 'bob'
  s.points.mockResolvedValue([])
  await render(React.createElement(RecordingRoute, { day }))
  expect(host.textContent).not.toContain('location_route')
})
it('never connects a missing segment in the visual trace', () => {
  const timestamp = Date.now() - 3600000,
    day = locationDay(timestamp)
  const point: RoutePoint = {
    session: 'a',
    timestamp,
    day,
    latitude: 30,
    longitude: 120,
    speed: null,
    accuracy: 5,
  }
  expect(
    routeLines([
      point,
      { ...point, timestamp: timestamp + 30000, longitude: 120.001 },
      { ...point, timestamp: timestamp + 600000 },
      { ...point, session: 'b', timestamp: timestamp + 630000 },
    ]).map((line) => line.length),
  ).toEqual([2, 1, 1])
})

it('exports an isolated position as GeoJSON instead of silently dropping it', async () => {
  const timestamp = Date.now() - 60000,
    day = locationDay(timestamp)
  s.points.mockResolvedValue([
    { session: 'a', timestamp, day, latitude: 30, longitude: 120, speed: null, accuracy: 5 },
  ])
  await render(React.createElement(RecordingRoute, { day }))
  await act(async () => host.querySelector('button')!.click())
  const exported = JSON.parse(s.share.mock.calls[0]![0].message)
  expect(exported.features).toHaveLength(1)
  expect(exported.features[0].geometry).toEqual({ type: 'Point', coordinates: [120, 30] })
  expect(exported.features[0].properties.timestamps).toEqual([new Date(timestamp).toISOString()])
})
