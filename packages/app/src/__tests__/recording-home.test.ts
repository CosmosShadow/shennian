// @vitest-environment happy-dom
// @covers src/features/personal-modules/PersonalModulesScreen.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const s = vi.hoisted(() => ({
  view: 'home',
  push: vi.fn(),
  recording: {
    active: false,
    revision: 0,
    preferences: { mode: 'assist' },
    syncError: 'sync',
    archiveError: 'archive',
    error: 'storage_failed',
    analysisError: true,
    recognitionPending: true,
    notification: 'technical-notification',
  },
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (x: any) => x },
  Alert: { alert: vi.fn() },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Keyboard: { dismiss: vi.fn() },
  Share: { share: vi.fn() },
  View: ({ children }: any) => React.createElement('div', null, children),
  ScrollView: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, testID }: any) =>
    React.createElement('button', { 'data-testid': testID, onClick: onPress }, children),
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => React.createElement('div', null, children),
}))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => false }))
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tab: 'recording', recordingView: s.view }),
  useRouter: () => ({ push: s.push }),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
}))
vi.mock('@shennian/shared', () => ({ useMachinesStore: (select: any) => select({ machines: [] }) }))
vi.mock('../config/auth', () => ({ useAuthStore: () => undefined }))
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => vi.fn() }))
vi.mock('../components/AppPageHeader', () => ({
  AppPageHeader: () => null,
  HeaderIconButton: () => null,
}))
vi.mock('../features/steward/ContextualStewardContext', () => ({
  useContextualSteward: () => null,
}))
vi.mock('../features/personal-modules/runtime', () => ({ useRecordingState: () => s.recording }))
vi.mock('../features/personal-modules/englishPreference', () => ({
  useEnglishPreference: () => false,
}))
vi.mock('../features/personal-modules/locationStore', () => ({ locationStore: {} }))
vi.mock('../features/personal-modules/PersonalEnglishScreen', () => ({ default: () => null }))
vi.mock('../features/personal-modules/PersonalScheduleScreen', () => ({ default: () => null }))
vi.mock('../features/personal-modules/RecordingTranscript', () => ({
  RecordingTranscript: () => null,
}))
vi.mock('../features/personal-modules/RecordingRoute', () => ({ RecordingRoute: () => null }))
vi.mock('../features/personal-modules/RecordingCaptureControl', () => ({
  RecordingCaptureControl: () => React.createElement('span', null, 'capture'),
}))
vi.mock('../features/personal-modules/ListeningControls', () => ({ ListeningControls: () => null }))
vi.mock('../features/personal-modules/ListeningActions', () => ({ ListeningActions: () => null }))
vi.mock('../features/personal-modules/RecordingSyncNotice', () => ({
  RecordingSyncNotice: () => React.createElement('span', null, 'technical-sync-notice'),
}))
vi.mock('../features/personal-modules/confirmRecordingStart', () => ({
  confirmRecordingStart: vi.fn(),
}))
vi.mock('../features/personal-modules/RecordingDayList', () => ({
  recordingDate: (d: string) => d,
  RecordingDayList: ({ days }: any) =>
    React.createElement(
      'div',
      null,
      days.map((d: string) => React.createElement('span', { key: d, 'data-day': d }, d)),
    ),
}))
import PersonalModulesScreen from '../features/personal-modules/PersonalModulesScreen'
import { localDay } from '../features/personal-modules/types'
it('home has one day, a working More link, and no technical footer; details retain diagnostics', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'),
    root = createRoot(host)
  try {
    await act(async () => root.render(React.createElement(PersonalModulesScreen)))
    expect(Array.from(host.querySelectorAll('[data-day]')).map((x) => x.textContent)).toEqual([
      localDay(),
    ])
    expect(host.textContent).toContain('capture')
    expect(host.textContent).not.toContain('technical-')
    expect(host.textContent).not.toContain('personal_error_storage_failed')
    expect(host.textContent).not.toContain('listening_analysis_error')
    expect(host.textContent).not.toContain('personal_recognition_pending')
    expect(host.textContent).not.toContain('location_title')
    const more = host.querySelector<HTMLButtonElement>('[data-testid="recording-all-days"]')!
    expect(more.textContent).toContain('listening_more_records')
    await act(async () => more.click())
    expect(s.push).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ recordingView: 'days' }) }),
    )
    s.view = 'day'
    await act(async () => root.render(React.createElement(PersonalModulesScreen)))
    expect(host.textContent).toContain('technical-sync-notice')
    expect(host.textContent).toContain('personal_error_storage_failed')
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
