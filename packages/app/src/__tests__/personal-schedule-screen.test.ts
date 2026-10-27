// @vitest-environment happy-dom
// @covers packages/app/src/features/personal-modules/PersonalScheduleScreen.tsx
// @covers packages/app/src/features/steward/useComposerDraft.ts
// @covers packages/app/src/features/personal-modules/ScheduleDisplayScreen.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  cache: vi.fn(),
  cached: vi.fn(),
  focused: true,
  storage: new Map<string, string>(),
  accountId: 'test-owner',
  edges: [] as string[],
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  KeyboardAvoidingView: ({ children }: any) => React.createElement('div', null, children),
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  ActivityIndicator: () => null,
  RefreshControl: ({ refreshing, onRefresh }: any) =>
    React.createElement('button', { 'data-refreshing': refreshing, onClick: onRefresh }, 'refresh'),
  Switch: () => null,
  View: ({ children, accessibilityElementsHidden }: any) =>
    React.createElement('div', { 'aria-hidden': accessibilityElementsHidden }, children),
  ScrollView: ({ children, refreshControl }: any) =>
    React.createElement('div', null, refreshControl, children),
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
  Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityRole }: any) =>
    React.createElement(
      'button',
      {
        disabled: disabled,
        onClick: onPress,
        'aria-label': accessibilityLabel,
        'data-role': accessibilityRole,
      },
      children,
    ),
  TextInput: ({ value, onChangeText, onBlur, accessibilityLabel }: any) =>
    React.createElement('input', {
      'aria-label': accessibilityLabel,
      value: value,
      onChange: (e) => onChangeText(e.target.value),
      onBlur: onBlur,
    }),
}))
vi.mock('react-native-gesture-handler', () => ({
  Swipeable: ({ children, enabled, onSwipeableOpen, renderLeftActions, renderRightActions }: any) =>
    React.createElement(
      'section',
      null,
      React.createElement('button', {
        'aria-label': 'swipe-right',
        disabled: !enabled,
        onClick: () => onSwipeableOpen('left'),
      }),
      React.createElement('button', {
        'aria-label': 'swipe-left',
        disabled: !enabled,
        onClick: () => onSwipeableOpen('right'),
      }),
      renderLeftActions?.(),
      renderRightActions?.(),
      children,
    ),
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push, back: vi.fn() }) }))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, edges }: any) => {
    state.edges = edges
    return React.createElement('div', null, children)
  },
}))
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (effect: React.EffectCallback) =>
    React.useEffect(() => (state.focused ? effect() : undefined), [effect, state.focused]),
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      state.storage.set(key, value)
    },
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@shennian/shared', () => ({
  useMachinesStore: (selector: any) => selector({ machines: [] }),
}))
vi.mock('../features/schedules/ConversationSchedules', () => ({
  ConversationSchedules: ({ stewardAllMachines, alwaysShow }: any) =>
    React.createElement(
      'div',
      { 'data-scheduled-tasks': stewardAllMachines && alwaysShow },
      'scheduled tasks',
    ),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('../components/AppPageHeader', () => ({
  AppPageHeader: ({ title, trailing, leading }: any) =>
    React.createElement('header', null, leading, title, trailing),
  HeaderIconButton: ({ icon, onPress }: any) =>
    React.createElement('button', { 'data-icon': icon, onClick: onPress }, icon),
}))
vi.mock('../components/BottomSheet', () => ({
  default: ({ isOpen, children }: any) =>
    isOpen ? React.createElement('section', null, children) : null,
}))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => undefined }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((selector: any) => selector({ user: { id: state.accountId } }), {
    getState: () => ({ user: { id: state.accountId } }),
  }),
}))
vi.mock('../config/api', () => ({ authApi: state.api }))
vi.mock('../features/personal-modules/runtime', () => ({
  moduleStore: async () => ({ cached: state.cached, cache: state.cache }),
}))
vi.mock('../features/personal-modules/ScheduleComposer', () => ({
  ScheduleComposer: () => React.createElement('aside', null, 'cloud-composer'),
}))
import PersonalScheduleScreen from '../features/personal-modules/PersonalScheduleScreen'
import ScheduleDisplayScreen from '../features/personal-modules/ScheduleDisplayScreen'
import { useComposerDraft, type ComposerDraft } from '../features/steward/useComposerDraft'
let root: Root, host: HTMLDivElement
const reminder = {
  key: 'test-row',
  revision: 7,
  state: 'active',
  dueAt: '2099-01-01T09:00:00+08:00',
  payload: { content: 'Meeting', when: '2099-01-01T09:00:00+08:00', timezone: 'Asia/Shanghai' },
}
beforeEach(() => {
  vi.clearAllMocks()
  state.storage.clear()
  state.accountId = 'test-owner'
  state.focused = true
  state.cached.mockResolvedValue(null)
  state.api.mockImplementation(async (_path: string, options?: any) =>
    options ? {} : { items: [reminder] },
  )
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render(element = React.createElement(PersonalScheduleScreen, null)) {
  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
}
async function clickLabel(label: string) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label || button.textContent === label,
  )!
  expect(button).toBeTruthy()
  await act(async () => {
    button.click()
  })
}
async function edit(value: string) {
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await Promise.resolve()
  })
}
describe('personal calendar screen', () => {
  function dailyRows() {
    return [9, 12, 18].map((hour, i) => ({
      ...reminder, key: `medicine-${i}`, revision: i + 1,
      dueAt: `2099-01-01T${hour.toString().padStart(2, '0')}:00:00+08:00`,
      payload: { content: '吃药', timezone: 'Asia/Shanghai', when: `每天${hour.toString().padStart(2, '0')}:00`, rule: { kind: 'calendar', hour, minute: 0 } },
    }))
  }
  it('renders daily slots as one item, then expands precise legacy edit choices', async () => {
    state.api.mockResolvedValue({ items: dailyRows() })
    await render()
    expect(host.querySelectorAll('section')).toHaveLength(1)
    expect(host.textContent).toContain('Daily 09:00、12:00、18:00')
    const row = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b => b.getAttribute('aria-label')?.startsWith('吃药,'))!
    await act(async () => row.click())
    await clickLabel('每天12:00')
    expect(host.querySelector('input')!.value).toBe('每天12:00 吃药')
  })
  it('applies completion to every grouped time using each original revision', async () => {
    state.api.mockImplementation(async (_path, options) => options ? {} : { items: dailyRows() })
    await render()
    await clickLabel('swipe-right')
    const calls = state.api.mock.calls.filter(c => c[1]?.method === 'PATCH')
    expect(calls.map(c => [c[0], JSON.parse(c[1].body)])).toEqual([0, 1, 2].map(i => [
      `/personal-modules/reminders/medicine-${i}`, { state: 'completed', revision: i + 1 },
    ]))
  })
  it('refreshes actual group state after partial failure rather than claiming atomic success', async () => {
    let writes = 0
    state.api.mockImplementation(async (_path, options) => {
      if (!options) return { items: dailyRows().map((row, i) => i === 0 && writes ? { ...row, state: 'completed', revision: 2, dueAt: null } : row) }
      if (++writes === 2) throw new Error('revision_conflict')
      return {}
    })
    await render()
    await clickLabel('swipe-right')
    expect(writes).toBe(2)
    expect(host.textContent).toContain('personal_action_failed')
    expect(host.querySelectorAll('section')).toHaveLength(2)
  })

  it('shows persisted rows before the network returns without automatic refresh animation', async () => {
    state.cached.mockResolvedValue([reminder])
    let finish!: (value: unknown) => void
    state.api.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await render()
    expect(host.textContent).toContain('Meeting')
    expect(host.querySelector('[data-refreshing="true"]')).toBeNull()
    await act(async () =>
      finish({ items: [{ ...reminder, payload: { ...reminder.payload, content: 'Synced' } }] }),
    )
    expect(host.textContent).toContain('Synced')
    expect(state.cache).toHaveBeenCalledWith('schedule:list', expect.any(Array))
  })
  it('keeps current rows on refocus without reapplying old disk cache or showing a spinner', async () => {
    state.cached.mockResolvedValue([
      { ...reminder, payload: { ...reminder.payload, content: 'Old cache' } },
    ])
    await render()
    expect(host.textContent).toContain('Meeting')
    state.focused = false
    await render()
    state.api.mockImplementation(() => new Promise(() => {}))
    state.focused = true
    await render()
    expect(host.textContent).toContain('Meeting')
    expect(host.textContent).not.toContain('Old cache')
    expect(state.cached).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-refreshing="true"]')).toBeNull()
  })
  it('keeps cached rows available offline and only animates an explicit pull refresh', async () => {
    state.cached.mockResolvedValue([reminder])
    state.api.mockRejectedValue(new Error('offline'))
    await render()
    expect(host.textContent).toContain('Meeting')
    expect(host.textContent).toContain('personal_schedule_offline')
    expect(host.querySelector('[data-refreshing="true"]')).toBeNull()
    state.api.mockImplementation(() => new Promise(() => {}))
    await act(async () => host.querySelector<HTMLButtonElement>('[data-refreshing]')!.click())
    expect(host.querySelector('[data-refreshing="true"]')).not.toBeNull()
    expect(host.textContent).toContain('Meeting')
  })
  it('never restores another account or an obsolete request after switching accounts', async () => {
    await render()
    state.focused = false
    await render()
    let finish!: (value: unknown) => void
    state.api.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    state.focused = true
    await render()
    state.accountId = 'other-owner'
    state.api.mockResolvedValue({ items: [] })
    await render()
    expect(host.textContent).not.toContain('Meeting')
    await act(async () => finish({ items: [reminder] }))
    expect(host.textContent).not.toContain('Meeting')
  })
  it('preserves loaded pages on refocus instead of shrinking back to the first page', async () => {
    const first = Array.from({ length: 201 }, (_, i) => ({ ...reminder, key: `row-${i}` }))
    state.api.mockImplementation(async (path: string) => ({
      items: path.includes('?before=')
        ? [{ ...reminder, key: 'last', payload: { ...reminder.payload, content: 'Second page' } }]
        : first,
    }))
    await render()
    await clickLabel('personal_more')
    expect(host.textContent).toContain('Second page')
    state.focused = false
    await render()
    state.focused = true
    await render()
    expect(host.textContent).toContain('Second page')
    expect(state.api.mock.calls.at(-1)![0]).toContain('?before=row-199')
  })
  it('does not flash default display preferences while rereading them on refocus', async () => {
    state.storage.set(
      'shennian:schedule:display:v1:test-owner',
      JSON.stringify({ mode: 'calendar', range: 'today' }),
    )
    await render()
    expect(host.textContent).toContain('personal_schedule_today')
    state.focused = false
    await render()
    const storage = (await import('@react-native-async-storage/async-storage')).default
    const read = vi.spyOn(storage, 'getItem').mockImplementation(() => new Promise(() => {}))
    state.focused = true
    await render()
    expect(host.textContent).toContain('personal_schedule_today')
    read.mockRestore()
  })

  it('leaves bottom safe-area spacing to the composer instead of adding a second inset above Tabs', async () => {
    await render()
    expect(state.edges).toEqual(['top'])
    expect(host.querySelector('aside')?.textContent).toBe('cloud-composer')
  })
  it('uses only a trailing ellipsis, plain rows and the shared composer by default', async () => {
    await render()
    expect(host.querySelector('[aria-label="schedules_title"]')).toBeNull()
    expect(host.querySelector('header [data-icon="ellipsis-horizontal"]')).not.toBeNull()
    expect(host.querySelector('header [data-icon="add"]')).toBeNull()
    expect(host.querySelector('header [data-icon="settings-outline"]')).toBeNull()
    expect(host.textContent).toContain('Meeting')
    expect(host.textContent).toContain('cloud-composer')
    expect(host.textContent).not.toContain('personal_empty')
    expect(host.querySelector('input')).toBeNull()
  })
  it('completes by right swipe and confirms deletion by left swipe, without a checkbox', async () => {
    const { Alert } = await import('react-native')
    await render()
    expect(host.querySelector('[data-role="checkbox"]')).toBeNull()
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
    await clickLabel('swipe-right')
    expect(
      JSON.parse(state.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].body),
    ).toEqual({ state: 'completed', revision: 7 })
    state.api.mockClear()
    await clickLabel('swipe-left')
    expect(state.api).not.toHaveBeenCalled()
    const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!
    await act(async () => buttons.find((button) => button.style === 'destructive')!.onPress!())
    expect(
      JSON.parse(state.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].body),
    ).toEqual({ state: 'deleted', revision: 7 })
  })
  it('keeps a completed row visible after refresh and removes it only after confirmed deletion', async () => {
    const { Alert } = await import('react-native')
    let current = { ...reminder }
    state.api.mockImplementation(async (_path: string, options?: any) => {
      if (options?.method === 'PATCH') {
        current = { ...current, state: JSON.parse(options.body).state }
        return current
      }
      return { items: [current] }
    })
    await render()
    await clickLabel('swipe-right')
    expect(current.state).toBe('completed')
    expect(host.textContent).toContain('Meeting')
    await clickLabel('swipe-left')
    expect(host.textContent).toContain('Meeting')
    const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!
    await act(async () => buttons.find((button) => button.style === 'destructive')!.onPress!())
    expect(current.state).toBe('deleted')
    expect(host.textContent).not.toContain('Meeting')
  })
  it('restores completed items by right swipe and disables swiping during editing', async () => {
    state.storage.set(
      'shennian:schedule:display:v1:test-owner',
      JSON.stringify({ completed: false }),
    )
    state.api.mockResolvedValue({ items: [{ ...reminder, state: 'completed' }] })
    await render()
    await clickLabel('swipe-right')
    expect(
      JSON.parse(state.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].body).state,
    ).toBe('active')
    await act(async () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.startsWith('Meeting'))!
        .click(),
    )
    expect(host.querySelector<HTMLButtonElement>('[aria-label="swipe-left"]')!.disabled).toBe(true)
  })
  it('shows and edits an unscheduled memo without a blank time line or leading whitespace', async () => {
    state.api.mockImplementation(async (path: string, options?: any) =>
      path.endsWith('/preview')
        ? { content: '充值阿里云余额', when: '' }
        : options
          ? {}
          : {
              items: [
                {
                  ...reminder,
                  dueAt: null,
                  payload: { ...reminder.payload, when: '', content: '充值阿里云', rule: null },
                },
              ],
            },
    )
    await render()
    const row = host.querySelector<HTMLButtonElement>('[aria-label="充值阿里云"]')!
    expect(row.textContent).toBe('充值阿里云')
    expect(row.querySelectorAll('span')).toHaveLength(1)
    await act(async () => row.click())
    expect(host.querySelector('input')?.value).toBe('充值阿里云')
    await edit('充值阿里云余额')
    expect(
      JSON.parse(state.api.mock.calls.find((call) => call[1]?.method === 'PATCH')![1].body),
    ).toMatchObject({ content: '充值阿里云余额', when: '', revision: 7 })
  })
  it('opens a separate display page without an add action or Agent connection prompt', async () => {
    await render()
    await clickLabel('ellipsis-horizontal')
    expect(state.push).toHaveBeenCalledWith('/(main)/schedule-display')
    expect(host.textContent).not.toContain('personal_add_reminder')
    expect(host.textContent).not.toContain('personal_schedule_agent_unavailable')
    expect(state.api.mock.calls.filter((call) => call[1])).toHaveLength(0)
  })
  it('saves grouped display choices per account on a separate page with no add action', async () => {
    await render(React.createElement(ScheduleDisplayScreen))
    expect(host.textContent).toContain('personal_schedule_view')
    expect(host.textContent).toContain('personal_schedule_range')
    expect(host.textContent).not.toContain('personal_schedule_show_completed')
    expect(host.textContent).not.toContain('personal_add_reminder')
    await clickLabel('personal_schedule_calendar')
    await clickLabel('personal_schedule_today')
    expect(JSON.parse(state.storage.get('shennian:schedule:display:v1:test-owner')!)).toEqual({
      mode: 'calendar',
      range: 'today',
    })
    state.accountId = 'other-owner'
    await render(React.createElement(ScheduleDisplayScreen))
    expect(state.storage.has('shennian:schedule:display:v1:other-owner')).toBe(false)
    await clickLabel('personal_schedule_calendar')
    expect(JSON.parse(state.storage.get('shennian:schedule:display:v1:other-owner')!).range).toBe(
      'all',
    )
  })
  it('automatically parses edited text before saving with the original revision and timezone', async () => {
    state.api.mockImplementation(async (path: string, options?: any) =>
      path.endsWith('/preview')
        ? { content: 'Updated', when: '2099-01-02T09:00:00+08:00' }
        : options
          ? {}
          : { items: [reminder] },
    )
    await render()
    const row = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.startsWith('Meeting'),
    )!
    await act(async () => row.click())
    expect(host.querySelector('input')?.value).toContain('Meeting')
    await edit('2099年1月2日上午9点 Updated')
    const writes = state.api.mock.calls.filter((call) => call[1])
    expect(writes.map((call) => call[0])).toEqual([
      '/personal-modules/reminders/preview',
      '/personal-modules/reminders/test-row',
    ])
    expect(JSON.parse(writes[1]![1].body)).toMatchObject({
      revision: 7,
      timezone: 'Asia/Shanghai',
      content: 'Updated',
    })
    expect(host.querySelector('input')).toBeNull()
  })
  it('retains the row draft and never patches after parse failure', async () => {
    state.api.mockImplementation(async (path: string) => {
      if (path.endsWith('/preview')) throw new Error('missing time')
      return { items: [reminder] }
    })
    await render()
    await act(async () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.startsWith('Meeting'))!
        .click(),
    )
    await edit('unscheduled text')
    expect(host.querySelector('input')?.value).toBe('unscheduled text')
    expect(host.textContent).toContain('personal_action_failed')
    expect(state.api.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0)
  })
})
function DraftHarness({ request, initialText }: { request?: ComposerDraft; initialText?: string }) {
  const [value, setValue] = useComposerDraft(request, initialText)
  return React.createElement('textarea', {
    value: value,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value),
  })
}
describe('shared composer draft requests', () => {
  it('consumes each request once and appends instead of replacing an existing draft', async () => {
    const first = { id: 1, text: 'Add a calendar item:' }
    await render(
      React.createElement(DraftHarness, { request: first, initialText: 'Existing draft' }),
    )
    expect(host.querySelector('textarea')?.value).toBe('Existing draft')
    const next = { id: 2, text: 'New request' }
    await render(
      React.createElement(DraftHarness, { request: next, initialText: 'Existing draft' }),
    )
    expect(host.querySelector('textarea')?.value).toBe('Existing draft\nNew request')
    await render(
      React.createElement(DraftHarness, { request: next, initialText: 'Existing draft' }),
    )
    expect(host.querySelector('textarea')?.value).toBe('Existing draft\nNew request')
  })
})
