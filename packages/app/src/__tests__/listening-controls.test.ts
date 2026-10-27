// @vitest-environment happy-dom
// @covers src/features/personal-modules/ListeningControls.tsx
// @covers src/features/personal-modules/ListeningActions.tsx
// @covers src/features/personal-modules/RecordingCaptureControl.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  alert: vi.fn(),
  sheet: vi.fn(),
  api: vi.fn(),
  draft: vi.fn(),
  account: 'alice',
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: any) => value, hairlineWidth: 0.5 },
  ActionSheetIOS: { showActionSheetWithOptions: state.sheet },
  ActivityIndicator: () => null,
  AppState: { currentState: 'active' },
  Alert: { alert: state.alert },
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children, testID }: any) =>
    React.createElement('span', { 'data-testid': testID }, children),
  Pressable: ({ children, onPress, disabled, testID, accessibilityLabel }: any) =>
    React.createElement(
      'button',
      { onClick: onPress, disabled, 'data-testid': testID, 'aria-label': accessibilityLabel },
      children,
    ),
  Switch: ({ value, onValueChange, disabled, accessibilityLabel }: any) =>
    React.createElement('input', {
      type: 'checkbox',
      checked: value,
      disabled,
      'aria-label': accessibilityLabel,
      onChange: () => onValueChange(!value),
    }),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((select: any) => select({ user: { id: state.account } }), {
    getState: () => ({ user: { id: state.account } }),
  }),
}))
vi.mock('../features/steward/ContextualStewardContext', () => ({
  useContextualSteward: () => ({ draft: state.draft }),
}))
import { RecordingSyncNotice } from '../features/personal-modules/RecordingSyncNotice'
import { RecordingCaptureControl } from '../features/personal-modules/RecordingCaptureControl'
// @covers src/features/personal-modules/englishPreference.ts
import { rememberEnglishPreference, useEnglishPreference } from '../features/personal-modules/englishPreference'
import { ListeningControls } from '../features/personal-modules/ListeningControls'
import { ListeningActions } from '../features/personal-modules/ListeningActions'
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  state.account = 'alice'
  useEnglishPreference.setState({ accountId: null, enabled: null })
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
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node)
    await Promise.resolve()
  })
}
const click = async (text: string) => {
  await act(async () => {
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent?.includes(text))!
      .click()
    await Promise.resolve()
  })
}
describe('dedicated listening controls', () => {
  it('offers an explicit retry for the failed channel and removes the notice after recovery', async () => {
    const retry = vi.fn()
    const props = { syncError: null, archiveError: 'recording_machine_offline', assistanceAvailable: true, assist: true, retry }
    await render(React.createElement(RecordingSyncNotice, props))
    expect(host.textContent).toContain('personal_error_recording_machine_offline')
    await click('personal_error_recording_machine_offline')
    await act(async () => state.alert.mock.calls.at(-1)![2][1].onPress())
    expect(retry).toHaveBeenCalledOnce()
    await render(React.createElement(RecordingSyncNotice, { ...props, archiveError: null }))
    expect(host.textContent).toBe('')
    await render(React.createElement(RecordingSyncNotice, { ...props, archiveError: null, assistanceAvailable: false }))
    expect(host.textContent).toContain('personal_error_assistance_unavailable')
  })

  it('keeps frequent choices on home and gates context behind explicit consent', async () => {
    const save = vi.fn(),
      english = vi.fn()
    const props = {
      preferences: { mode: 'transcribe', feedback: 'silent', agentContext: false },
      busy: false,
      englishEnabled: false,
      save,
      setEnglish: english,
    } as React.ComponentProps<typeof ListeningControls>
    await render(React.createElement(ListeningControls, props))
    expect(host.textContent).not.toContain('listening_off')
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="listening_mode_assist"]')!.click(),
    )
    expect(save).toHaveBeenCalledWith({ mode: 'assist', feedback: 'silent', agentContext: false })
    expect(host.textContent).not.toContain('listening_feedback')
    expect(host.querySelector('[aria-label="listening_context"]')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('[aria-label="listening_english"]')!.disabled).toBe(
      true,
    )
    await render(
      React.createElement(ListeningControls, {
        ...props,
        preferences: { mode: 'assist', feedback: 'silent', agentContext: false },
      }),
    )
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="listening_english"]')!.click(),
    )
    expect(english).toHaveBeenCalledWith(true)
    await click('listening_feedback')
    await act(async () => state.sheet.mock.calls.at(-1)![1](1))
    expect(save).toHaveBeenCalledWith({ mode: 'assist', feedback: 'balanced', agentContext: false })
    const countBeforeCancel = save.mock.calls.length
    await act(async () => state.sheet.mock.calls.at(-1)![1](3))
    expect(save.mock.calls.length).toBe(countBeforeCancel)
    await click('listening_trigger')
    await act(async () => state.sheet.mock.calls.at(-1)![1](1))
    expect(save).toHaveBeenCalledWith({
      mode: 'assist',
      feedback: 'silent',
      agentContext: false,
      trigger: 'name',
    })

    await render(
      React.createElement(ListeningControls, {
        ...props,
        section: 'advanced',
        preferences: { mode: 'assist', feedback: 'silent', agentContext: false },
      }),
    )
    expect(host.querySelector('[aria-label="listening_mode_assist"]')).toBeNull()
    await act(async () =>
      host.querySelector<HTMLInputElement>('[aria-label="listening_context"]')!.click(),
    )
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ agentContext: true }))
    await act(async () => state.alert.mock.calls.at(-1)![2][1].onPress())
    expect(save).toHaveBeenCalledWith({ mode: 'assist', feedback: 'silent', agentContext: true })
  })
  it('keeps start and stop icon-only with accessible labels', async () => {
    const toggle = vi.fn()
    const props = { active: false, busy: false, toggle }
    await render(React.createElement(RecordingCaptureControl, props))
    expect(host.textContent).toBe('')
    expect(host.querySelector('[data-testid="listening-toggle"]')!.getAttribute('aria-label')).toBe('personal_start')
    expect(host.querySelector('[data-testid="listening-partial"]')).toBeNull()
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="listening-toggle"]')!.click(),
    )
    expect(toggle).toHaveBeenCalledOnce()
    await render(
      React.createElement(RecordingCaptureControl, {
        ...props,
        active: true,
      }),
    )
    expect(host.textContent).not.toContain('personal_stop')
    expect(host.querySelector('[data-testid="listening-partial"]')).toBeNull()
    expect(host.querySelector('[data-testid="listening-toggle"]')!.getAttribute('aria-label')).toBe('personal_stop')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="listening-toggle"]')!.click())
    expect(toggle).toHaveBeenCalledTimes(2)
    await render(React.createElement(RecordingCaptureControl, { ...props, busy: true }))
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="listening-toggle"]')!.disabled,
    ).toBe(true)
  })
  it('shows only a real confirmation entry on the capture page and filters details to their source day', async () => {
    const openDay = vi.fn()
    const item = (key: string, day: string, content: string) => ({
      key,
      day,
      payload: {
        type: 'agent_task',
        content,
        sourceText: content,
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        eventTime: null,
      },
    })
    state.api.mockResolvedValueOnce({
      items: [item('new', '2026-10-23', '今天的任务'), item('old', '2026-10-22', '昨天的任务')],
    })
    await render(
      React.createElement(ListeningActions, { active: false, revision: 0, preview: true, openDay }),
    )
    expect(host.textContent).not.toContain('listening_confirm_action')
    await click('listening_actions')
    expect(openDay).toHaveBeenCalledWith('2026-10-23')
    await render(
      React.createElement(ListeningActions, { active: false, revision: 0, day: '2026-10-22' }),
    )
    expect(host.textContent).toContain('昨天的任务')
    expect(host.textContent).not.toContain('今天的任务')
  })
  it('shows no invented action and prepares an Agent draft only after a click, without claiming dispatch', async () => {
    state.api
      .mockResolvedValueOnce({
        items: [
          {
            key: 'task',
            payload: {
              type: 'agent_task',
              content: '整理报告',
              sourceText: '帮我整理报告',
              eventTime: null,
              expiresAt: new Date(Date.now() + 10000).toISOString(),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ draft: '整理报告' })
    await render(React.createElement(ListeningActions, { revision: 0, active: false }))
    expect(state.draft).not.toHaveBeenCalled()
    expect(host.textContent).toContain('帮我整理报告')
    await click('listening_prepare_task')
    expect(state.api).toHaveBeenLastCalledWith('/personal-modules/recording/actions/task/confirm', {
      method: 'POST',
      body: '{}',
    })
    expect(state.draft).toHaveBeenCalledExactlyOnceWith('整理报告')
    expect(host.textContent).toContain('listening_draft_ready')
  })
  it('does not apply a late response to another account or hide a failed action', async () => {
    state.api
      .mockResolvedValueOnce({
        items: [
          {
            key: 'cancel',
            payload: {
              type: 'reminder_cancel',
              content: '取消',
              targetContent: '真实会议',
              sourceText: '取消会议',
              expiresAt: new Date(Date.now() + 10000).toISOString(),
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('stale'))
    await render(React.createElement(ListeningActions, { revision: 0, active: false }))
    expect(host.textContent).toContain('真实会议')
    await click('listening_confirm_action')
    expect(host.textContent).toContain('listening_actions_error')
    expect(host.textContent).toContain('取消会议')
    state.api.mockImplementationOnce(async () => {
      state.account = 'bob'
      return { draft: 'should not appear' }
    })
    await click('listening_confirm_action')
    expect(state.draft).not.toHaveBeenCalled()
  })
})

function RememberedEnglishControls() {
  const enabled = useEnglishPreference(s => s.accountId === state.account ? s.enabled : null)
  return React.createElement(ListeningControls, {
    preferences: { mode: 'assist', feedback: 'balanced', agentContext: false },
    busy: false, englishEnabled: enabled, save: () => {}, setEnglish: () => {},
  })
}
it('never renders a false off switch while unknown and preserves enabled on page remount', async () => {
  await render(React.createElement(RememberedEnglishControls))
  expect(host.querySelector('input[aria-label="listening_english"]')).toBeNull()
  await act(async () => rememberEnglishPreference('alice', true))
  expect(host.querySelector<HTMLInputElement>('input[aria-label="listening_english"]')!.checked).toBe(true)
  await render(null)
  await render(React.createElement(RememberedEnglishControls))
  expect(host.querySelector<HTMLInputElement>('input[aria-label="listening_english"]')!.checked).toBe(true)
  await act(async () => rememberEnglishPreference('alice', false, true))
  expect(host.querySelector<HTMLInputElement>('input[aria-label="listening_english"]')!.checked).toBe(true)
  await act(async () => rememberEnglishPreference('alice', false))
  expect(host.querySelector<HTMLInputElement>('input[aria-label="listening_english"]')!.checked).toBe(false)
})
it("does not render another account's English setting after account change", async () => {
  rememberEnglishPreference('alice', true)
  await render(React.createElement(RememberedEnglishControls))
  state.account = 'bob'
  await render(React.createElement(RememberedEnglishControls))
  expect(host.querySelector('input[aria-label="listening_english"]')).toBeNull()
  await act(async () => rememberEnglishPreference('bob', false, true))
  expect(host.querySelector<HTMLInputElement>('input[aria-label="listening_english"]')!.checked).toBe(false)
})

it('does not expose a speaker separation switch', async () => {
  const save = vi.fn()
  await render(React.createElement(ListeningControls, { preferences: { mode: 'transcribe', feedback: 'silent', agentContext: false }, busy: false, englishEnabled: false, save, setEnglish: vi.fn() }))
  expect(host.querySelector('[aria-label="listening_speakers"]')).toBeNull()
  expect(state.alert).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})
