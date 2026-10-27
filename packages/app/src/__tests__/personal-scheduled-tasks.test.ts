// @vitest-environment happy-dom
// @covers packages/app/src/features/schedules/PersonalScheduledTasksScreen.tsx
// @covers packages/app/src/features/personal-modules/PersonalModuleEntries.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  machines: [
    { id: 'a', name: 'Computer A' },
    { id: 'b', name: 'Computer B' },
  ],
  navigate: vi.fn(),
  draft: vi.fn(),
  contextual: true,
  list: vi.fn(),
  create: vi.fn(),
  ensure: vi.fn().mockResolvedValue({}),
}))
vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: ({ children }: any) => React.createElement('div', null, children),
  ScrollView: ({ children }: any) => React.createElement('div', null, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
    React.createElement('input', {
      value,
      'aria-label': accessibilityLabel,
      onChange: (event: any) => onChangeText(event.target.value),
    }),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: any) =>
    React.createElement(
      'button',
      { onClick: onPress, 'aria-label': accessibilityLabel, disabled },
      children,
    ),
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => React.createElement('div', null, children),
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'stable-operation' }))
vi.mock('../features/schedules/scheduleClient', () => ({
  scheduleClient: { create: state.create, ensureDefaultDiary: state.ensure },
}))
vi.mock('../components/BottomSheet', () => ({
  default: ({ children, headerLeft }: any) =>
    React.createElement('section', null, headerLeft, children),
}))
vi.mock('expo-router', () => ({
  useRouter: () => ({ navigate: state.navigate, back: vi.fn() }),
  useFocusEffect: (callback: any) => React.useEffect(callback, [callback]),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('@shennian/shared', () => ({
  useMachinesStore: Object.assign((selector: any) => selector(state), {
    getState: () => ({
      setMachines: (value: typeof state.machines) => {
        state.machines = value
      },
    }),
  }),
}))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({
  useAuthStore: Object.assign((selector: any) => selector({ user: { id: 'owner' } }), {
    getState: () => ({ user: { id: 'owner' } }),
  }),
}))
vi.mock('../features/steward/ContextualStewardContext', async original => ({ ...await original<any>(), useContextualSteward: () => state.contextual ? { draft: state.draft } : null }))
vi.mock('../features/steward/StewardScreen', () => ({ StewardScreen: ({ moduleHeader, moduleContent, composerDraft }: any) => React.createElement('div', null, moduleHeader, moduleContent, React.createElement('aside', null, composerDraft?.text)) }))
vi.mock('../features/schedules/ScheduleCreateForm', () => ({
  ScheduleCreateForm: () => React.createElement('div', null, 'create-form'),
}))
vi.mock('../components/AppPageHeader', () => ({
  HeaderIconButton: ({ label, onPress }: any) =>
    React.createElement('button', { onClick: onPress, 'aria-label': label }, label),
  AppPageHeader: ({ title, onBack, trailing }: any) =>
    React.createElement(
      'header',
      null,
      React.createElement('button', { onClick: onBack, 'aria-label': 'back' }, title),
      trailing,
    ),
}))
vi.mock('../features/machines/machineAccountClient', () => ({
  machineAccountClient: { listMachines: state.list },
}))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({
  usePrimaryMachine: () => ({ record: { machine: { id: 'a' } } }),
}))
vi.mock('../features/schedules/ConversationSchedules', () => ({
  ConversationSchedules: (props: any) =>
    React.createElement('div', {
      'data-machine': props.stewardMachineId,
      'data-all': String(!!props.stewardAllMachines),
    }),
}))
import PersonalScheduledTasksScreen from '../features/schedules/PersonalScheduledTasksScreen'
import { PersonalModuleEntries } from '../features/personal-modules/PersonalModuleEntries'
const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(async () => {
  await act(async () => root.unmount())
  host.replaceChildren()
  root = createRoot(host)
  vi.clearAllMocks()
  state.contextual = true
})
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
it('offers scheduled tasks as a separate searchable feature', async () => {
  await act(async () =>
    root.render(React.createElement(PersonalModuleEntries, { query: 'schedules_title' })),
  )
  expect(host.textContent).toContain('schedules_title')
  expect(host.textContent).not.toContain('personal_entry_reminders')
  await act(async () => host.querySelector('button')!.click())
  expect(state.navigate).toHaveBeenCalledWith('/(main)/scheduled-tasks')
})
it('shows tasks directly without a machine selection step and ensures the default', async () => {
  state.list.mockResolvedValue(state.machines)
  await act(async () => root.render(React.createElement(PersonalScheduledTasksScreen)))
  expect(host.querySelector('[data-all="true"]')).toBeTruthy()
  expect(host.querySelector('[aria-label="Computer A"]')).toBeNull()
  expect(host.querySelector('[aria-label="Computer B"]')).toBeNull()
  expect(state.ensure).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone)
})

it('drafts a creation request in the existing bottom input instead of opening a form', async () => {
  state.list.mockResolvedValue(state.machines)
  await act(async () => root.render(React.createElement(PersonalScheduledTasksScreen)))
  await click('schedules_add')
  expect(state.draft).toHaveBeenCalledWith('inspiration_ai_schedule_prompt')
  expect(host.textContent).not.toContain('create-form')
  expect(state.create).not.toHaveBeenCalled()
  expect(state.navigate).not.toHaveBeenCalled()
})

it('provides the same conversational draft when opened without a shared dock host', async () => {
  state.contextual = false
  state.list.mockResolvedValue(state.machines)
  await act(async () => root.render(React.createElement(PersonalScheduledTasksScreen)))
  await click('schedules_add')
  expect(host.querySelector('aside')?.textContent).toBe('inspiration_ai_schedule_prompt')
  expect(host.textContent).not.toContain('create-form')
  expect(state.create).not.toHaveBeenCalled()
})

it('saves an explicit machine, time and prompt, retaining the form and operation on retry', async () => {
  const { ScheduleCreateForm } = await vi.importActual<
    typeof import('../features/schedules/ScheduleCreateForm')
  >('../features/schedules/ScheduleCreateForm')
  const created = vi.fn()
  state.create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
  await act(async () =>
    root.render(
      React.createElement(ScheduleCreateForm, {
        machines: state.machines,
        initialMachineId: 'b',
        onClose: vi.fn(),
        onCreated: created,
      }),
    ),
  )
  async function fill(label: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  expect(host.querySelector<HTMLButtonElement>('[aria-label="save"]')!.disabled).toBe(true)
  await fill('schedules_time', '每天23:00')
  await fill('schedules_work', 'Update diary')
  await fill('schedules_timezone', 'Asia/Shanghai')
  await click('save')
  expect(created).not.toHaveBeenCalled()
  expect(host.textContent).toContain('schedules_failed')
  expect(host.querySelector<HTMLInputElement>('[aria-label="schedules_work"]')!.value).toBe(
    'Update diary',
  )
  await click('save')
  expect(state.create).toHaveBeenCalledTimes(2)
  expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1])
  expect(state.create).toHaveBeenLastCalledWith('b', {
    operationId: 'stable-operation',
    executionMode: 'worker',
    timeDescription: '每天23:00',
    prompt: 'Update diary',
    timezone: 'Asia/Shanghai',
  })
  expect(created).toHaveBeenCalledWith('b')
})
