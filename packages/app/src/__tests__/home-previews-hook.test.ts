// @vitest-environment happy-dom
// @arch docs/architecture/mobile-navigation.md
// @covers src/features/mobile-navigation/useHomePreviews.ts
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'a', focused: true, store: vi.fn(), api: vi.fn(), diary: { busy: false }, diaryDocuments: vi.fn(async () => []), enabled: { recording: true, schedules: true, diary: true, folders: true } }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => state.focused }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@shennian/shared', () => ({ useMachinesStore: (select: any) => select({ machines: [] }) }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: any) => select({ user: { id: state.account } }), { getState: () => ({ user: { id: state.account } }) }) }))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../features/personal-modules/runtime', () => ({ moduleStore: state.store }))
vi.mock('../features/personal-modules/recordingState', () => ({ useRecordingState: (select: any) => select({ active: false, partial: '', finalText: '', revision: 0 }) }))
vi.mock('../features/personal-workspace/diaryRuntime', () => ({ subscribeDiary: () => () => {}, diaryStatus: () => state.diary, diaryDocuments: state.diaryDocuments }))
vi.mock('../features/remote-folders/useRemoteFolders', () => ({ useRemoteFolders: () => ({ folders: [] }) }))
import { useHomePreviews } from '../features/mobile-navigation/useHomePreviews'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>, observed: ReturnType<typeof useHomePreviews>
function Observer() { observed = useHomePreviews(state.enabled); return null }
async function render() { await act(async () => root.render(React.createElement(Observer))) }
beforeEach(() => {
  state.account = 'a'; state.focused = true
  state.enabled = { recording: true, schedules: true, diary: true, folders: true }
  state.api.mockReset(); state.store.mockReset(); state.diaryDocuments.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()) })
it('ignores a previous account’s delayed recording and schedule previews', async () => {
  let resolveRecording!: (value: any) => void, resolveSchedule!: (value: any) => void
  const oldRecording = new Promise(resolve => { resolveRecording = resolve })
  const oldSchedule = new Promise(resolve => { resolveSchedule = resolve })
  state.store.mockImplementation(async () => ({ userId: state.account, latestTranscript: () => state.account === 'a' ? oldRecording : Promise.resolve({ text: 'B recording', startAt: '2026-10-25T10:00:00Z' }), cached: async () => null, cache: vi.fn() }))
  state.api.mockImplementation(() => state.account === 'a' ? oldSchedule : Promise.resolve({ items: [{ key: 'b', revision: 1, state: 'active', dueAt: '2026-10-26T10:00:00Z', payload: { content: 'B schedule', when: '', timezone: 'UTC' } }] }))
  await render()
  state.account = 'b'; await render()
  expect(observed.recording.text).toBe('B recording')
  expect(observed.schedules.text).toBe('B schedule')
  await act(async () => {
    resolveRecording({ text: 'A private recording', startAt: '2026-10-25T10:00:00Z' })
    resolveSchedule({ items: [{ key: 'a', state: 'active', payload: { content: 'A private schedule', when: '' } }] })
  })
  expect(observed.recording.text).toBe('B recording')
  expect(observed.schedules.text).toBe('B schedule')
})
it('does not load disabled module previews or request them while the home tab is inactive', async () => {
  state.enabled = { recording: false, schedules: false, diary: false, folders: false }
  await render()
  expect(state.store).not.toHaveBeenCalled()
  expect(state.api).not.toHaveBeenCalled()
  state.enabled = { recording: true, schedules: true, diary: true, folders: true }; state.focused = false
  await render()
  expect(state.store).not.toHaveBeenCalled()
  expect(state.api).not.toHaveBeenCalled()
})
