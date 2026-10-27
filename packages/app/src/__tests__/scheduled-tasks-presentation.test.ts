// @vitest-environment happy-dom
// @covers packages/app/src/features/schedules/ScheduleTaskCard.tsx
// @covers packages/app/src/features/schedules/ScheduleEditorFields.tsx
// @covers packages/app/src/features/schedules/ScheduleExecutionChoice.tsx
// @covers packages/app/src/features/schedules/schedulePresentation.ts
// @covers packages/app/src/features/schedules/ConversationSchedules.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConversationSchedule } from '@shennian/wire'
const state = vi.hoisted(() => ({ list: vi.fn(), mutate: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Alert: { alert: vi.fn() },
  ActivityIndicator: () => null,
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    React.createElement('textarea', {
      value,
      'aria-label': accessibilityLabel,
      disabled: !editable,
      onInput: (event: any) => onChangeText(event.target.value),
    }),
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
  }: any) =>
    React.createElement(
      'button',
      {
        onClick: onPress,
        disabled,
        'aria-label': accessibilityLabel,
        role: accessibilityRole,
        'aria-checked': accessibilityState?.checked,
      },
      children,
    ),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh' } }),
}))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({
  useAuthStore: (selector: any) => selector({ user: { id: 'unit-owner' } }),
}))
vi.mock('../features/schedules/scheduleClient', () => ({ scheduleClient: state }))
vi.mock('../features/schedules/ScheduleSwipeRow', () => ({
  ScheduleSwipeRow: ({ children }: any) => children,
}))
vi.mock('../components/BottomSheet', () => ({
  default: ({ isOpen, onClose, headerLeft, children }: any) =>
    isOpen
      ? React.createElement(
          'section',
          null,
          headerLeft,
          React.createElement('button', { onClick: onClose, 'aria-label': 'close' }, 'close'),
          children,
        )
      : null,
}))
import { schedulePromptPreview } from '../features/schedules/schedulePresentation'
import { ConversationSchedules } from '../features/schedules/ConversationSchedules'
const prompt = '总结当天并更新日记。保留 AGENTS.md、index.md 和原有记录。\n不编造事实。'
const task = {
  id: 'unit-schedule',
  scope: 'steward',
  machineId: 'unit-machine',
  state: 'active',
  executionMode: 'worker',
  prompt,
  timeDescription: '每天 23:00',
  timezone: 'Asia/Shanghai',
  rule: { kind: 'calendar' },
  last: { state: 'delivered' },
} as ConversationSchedule
const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(async () => {
  await act(async () => root.unmount())
  host.replaceChildren()
  root = createRoot(host)
  vi.clearAllMocks()
})
async function render(tasks = [task]) {
  state.list.mockResolvedValue(tasks)
  state.mutate.mockResolvedValue({})
  await act(async () =>
    root.render(
      React.createElement(ConversationSchedules, {
        stewardAllMachines: true,
        alwaysShow: true,
        showHeading: false,
        personalPresentation: true,
        machineNames: { 'unit-machine': 'Mac' },
      }),
    ),
  )
}
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}
async function open() {
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
}
it('uses a first sentence without treating file extensions as sentence boundaries', () => {
  expect(schedulePromptPreview(prompt)).toEqual({
    title: '总结当天并更新日记',
    excerpt: '保留 AGENTS.md、index.md 和原有记录。\n不编造事实。',
  })
  expect(schedulePromptPreview('Read AGENTS.md first. Keep notes.')).toEqual({
    title: 'Read AGENTS.md first',
    excerpt: 'Keep notes.',
  })
  expect(schedulePromptPreview('  没有标点的任务  ')).toEqual({
    title: '没有标点的任务',
    excerpt: '',
  })
  expect(schedulePromptPreview('Title\nDetails')).toEqual({ title: 'Title', excerpt: 'Details' })
})
it('shows true schedule state, machine, time and delivery, without claiming execution success', async () => {
  await render()
  expect(host.textContent).toContain('schedules_state_active')
  expect(host.textContent).toContain('每天 23:00')
  expect(host.textContent).toContain('Mac')
  expect(host.textContent).toContain('schedules_last_delivered')
  expect(host.textContent).not.toContain('success')
  await open()
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="schedules_work"]')?.value).toBe(
    prompt,
  )
  expect(host.textContent).toContain('Asia/Shanghai')
  expect(host.querySelector('[aria-label="save"]')?.hasAttribute('disabled')).toBe(true)
})
it('changes the selected execution mode and saves the complete untouched instructions', async () => {
  await render()
  await open()
  const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  expect(radios[1].getAttribute('aria-checked')).toBe('true')
  await act(async () => radios[0].click())
  expect(radios[0].getAttribute('aria-checked')).toBe('true')
  await click('save')
  expect(state.mutate).toHaveBeenCalledWith(task, 'update', { prompt, executionMode: 'main' })
})
it('preserves pause/resume and delete actions and handles empty and paused states', async () => {
  await render([{ ...task, state: 'paused' }])
  await open()
  expect(host.textContent).toContain('schedules_state_paused')
  const resume = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === 'schedules_resume',
  )!
  await act(async () => resume.click())
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), 'resume', {})
  await open()
  const del = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === 'delete',
  )!
  await act(async () => del.click())
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), 'delete', {})
  await render([])
  // The existing component reloads on scope changes, not arbitrary fixture changes.
  await act(async () => root.unmount())
  root = createRoot(host)
  await render([])
  expect(host.textContent).toContain('schedules_hint')
  expect(host.querySelector('textarea')).toBeNull()
})
it('protects changed instructions on close and saves the complete edited value', async () => {
  await render()
  await open()
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="schedules_work"]')!
  const edited = `${prompt}\n追加一条完整指令。`
  await act(async () => {
    input.value = edited
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const confirm = vi.fn().mockReturnValue(false)
  vi.stubGlobal('confirm', confirm)
  await click('close')
  expect(confirm).toHaveBeenCalledWith('agents_unsaved_message')
  expect(host.querySelector('textarea')).toBeTruthy()
  await click('save')
  expect(state.mutate).toHaveBeenCalledWith(task, 'update', {
    prompt: edited,
    executionMode: 'worker',
  })
})
it('keeps the editor and draft open after a save failure', async () => {
  await render()
  await open()
  state.mutate.mockRejectedValueOnce(new Error('unit-save-failure'))
  await act(async () => host.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await click('save')
  expect(host.textContent).toContain('schedules_failed')
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="schedules_work"]')?.value).toBe(
    prompt,
  )
  expect(host.querySelector('[role="radio"]')?.getAttribute('aria-checked')).toBe('true')
})
