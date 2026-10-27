// @vitest-environment happy-dom
// @arch docs/architecture/mobile-navigation.md
// @covers src/features/mobile-navigation/ShennianHomeScreen.tsx
// @covers src/features/mobile-navigation/HomeSettingsScreen.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ push: vi.fn(), active: false, ownerUnread: 0, query: '', stop: vi.fn(async () => {}), entries: { recording: true, schedules: true, diary: true, folders: true }, save: vi.fn(async () => {}) }))
vi.mock('react-native', () => {
  const box = ({ children, testID }: any) => React.createElement('div', { 'data-testid': testID }, children)
  return { View: box, Text: box, ScrollView: box,
    Pressable: ({ children, testID, onPress }: any) => React.createElement('button', { 'data-testid': testID, onClick: onPress }, children),
    Modal: ({ children, visible }: any) => visible ? children : null,
    Switch: ({ testID, value, disabled, onValueChange }: any) => React.createElement('input', { type: 'checkbox', 'data-testid': testID, checked: value, disabled, onChange: (e: any) => onValueChange(e.target.checked) }),
    Platform: { OS: 'ios' }, Alert: { alert: vi.fn() }, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }
})
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push, back: vi.fn(), canGoBack: () => true }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({ useAuthStore: (select: any) => select({ user: { id: 'unit-account' } }) }))
vi.mock('../components/ConnectedAppPageHeader', () => ({
  AppPageHeader: ({ trailing }: any) => trailing,
  HeaderIconButton: ({ testID, onPress }: any) => React.createElement('button', { 'data-testid': testID, onClick: onPress }),
}))
vi.mock('../components/AppPageHeader', () => ({ AppPageHeader: () => null }))
vi.mock('../features/steward/StewardEntryRow', () => ({ StewardEntryRow: () => React.createElement('div', { 'data-testid': 'steward-conversation-row' }) }))
vi.mock('../../app/(main)/spaces', () => ({ default: ({ directoryHeader }: any) => React.createElement('div', null, directoryHeader(state.query), React.createElement('div', { 'data-testid': 'conversation-list' })) }))
vi.mock('../features/unread/useUnreadNavigation', () => ({ useUnreadNavigation: () => ({ tabs: { rooms: 2, agents: state.ownerUnread } }) }))
vi.mock('../features/unread/UnreadCountBadge', () => ({ UnreadCountBadge: ({ count }: any) => React.createElement('span', { 'data-testid': 'unread' }, count) }))
vi.mock('../features/rooms/components/RoomApprovalDot', () => ({ RoomApprovalDot: () => null }))
vi.mock('../features/personal-modules/recordingState', () => ({ useRecordingState: (select: any) => select({ active: state.active, stopping: false }) }))
vi.mock('../features/personal-modules/runtime', () => ({ stopRecording: state.stop }))
vi.mock('../features/mobile-navigation/homeEntryPreference', () => ({
  HOME_ENTRY_KEYS: ['recording', 'schedules', 'diary', 'folders'],
  DEFAULT_HOME_ENTRIES: { recording: true, schedules: true, diary: true, folders: true },
  useHomeEntries: () => ({ entries: state.entries, hydrated: true }), saveHomeEntry: state.save,
}))
vi.mock('../features/mobile-navigation/useHomePreviews', () => ({ useHomePreviews: () => ({ recording: { text: 'latest transcript' }, schedules: { text: 'next event' }, diary: { text: 'latest diary' }, folders: { text: 'work folder' } }) }))
import Home from '../features/mobile-navigation/ShennianHomeScreen'
import HomeSettings from '../features/mobile-navigation/HomeSettingsScreen'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
const find = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
beforeEach(() => { vi.clearAllMocks(); state.active = false; state.ownerUnread = 0; state.query = ''; state.entries = { recording: true, schedules: true, diary: true, folders: true }; host = document.createElement('div'); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()) })
async function render() { await act(async () => root.render(React.createElement(Home))) }
it('joins personal entries and actual conversations in one list with creation in the header', async () => {
  await render()
  expect(find('steward-conversation-row')).not.toBeNull()
  await act(async () => find('home-entry-schedules')!.click())
  expect(state.push).toHaveBeenCalledWith({ pathname: '/(main)/personal-modules', params: { tab: 'reminders', __mobileEntry: 'push' } })
  expect(find('home-conversations-toggle')).toBeNull()
  expect(find('conversation-list')).not.toBeNull()
  await act(async () => find('home-new-conversation')!.click())
  expect(state.push).toHaveBeenCalledWith('/(main)/contacts/new-conversation')
})
it('keeps recording controls independent of hidden entries and does not put a more button on the home row', async () => {
  state.entries.recording = false; state.entries.diary = false; state.active = true
  await render()
  expect(find('home-entry-recording')).toBeNull()
  expect(find('home-entry-diary')).toBeNull()
  expect(find('home-recording-status')).not.toBeNull()
  expect(find('home-more')).toBeNull()
  await act(async () => find('home-recording-stop')!.click())
  expect(state.stop).toHaveBeenCalledOnce()
})
it('saves homepage visibility under the signed-in account', async () => {
  await act(async () => root.render(React.createElement(HomeSettings)))
  expect(host.querySelectorAll('input')).toHaveLength(4)
  await act(async () => find('home-entry-switch-diary')!.click())
  expect(state.save).toHaveBeenCalledWith('unit-account', 'diary', false)
})

it('exposes owner unread from the root tab without flooding the personal conversation list', async () => {
  state.ownerUnread = 2
  await render()
  expect(find('home-visitor-messages')).not.toBeNull()
  expect(find('home-visitor-messages')!.textContent).toContain('2')
  await act(async () => find('home-visitor-messages')!.click())
  expect(state.push).toHaveBeenCalledWith('/(main)/agents')
  // Rendering the directory must not mark any conversation as read.
  expect(find('conversation-list')).not.toBeNull()
  state.ownerUnread = 1
  await render()
  expect(find('home-visitor-messages')!.textContent).toContain('1')
  state.ownerUnread = 0
  await render()
  expect(find('home-visitor-messages')).toBeNull()
})
it('filters the visitor entry with the same search as the rest of the directory', async () => {
  state.ownerUnread = 2
  state.query = 'missing'
  await render()
  expect(find('home-visitor-messages')).toBeNull()
  state.query = 'MOBILE_VISITOR_MESSAGES'
  await render()
  expect(find('home-visitor-messages')).not.toBeNull()
})
