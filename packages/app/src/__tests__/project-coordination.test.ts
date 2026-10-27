// @vitest-environment happy-dom
// @covers packages/app/src/features/projects/coordination/client.ts
// @covers packages/app/src/features/projects/coordination/ProjectCoordinationEntry.tsx
// @covers packages/app/src/features/projects/coordination/ProjectCoordinationSettings.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  ActivityIndicator: ({ testID }: any) => React.createElement('span', { 'data-testid': testID }),
  Switch: ({ value, disabled, onValueChange, accessibilityLabel }: any) => React.createElement('input', { type: 'checkbox', checked: value, disabled, 'aria-label': accessibilityLabel, onChange: () => onValueChange(!value) }),
  StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
  View: ({ children }: any) => React.createElement('div', null, children), ScrollView: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, disabled }: any) => React.createElement('button', { onClick: onPress, role: accessibilityRole, 'aria-label': accessibilityLabel, disabled }, children),
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
import { coordinationCounts, coordinationRows, coordinationErrorMessageKey, taskMatchesFilter } from '../features/projects/coordination/client'
import { ProjectCoordinationSettings } from '../features/projects/coordination/ProjectCoordinationSettings'
import { ProjectCoordinationEntry } from '../features/projects/coordination/ProjectCoordinationEntry'
it('separates running, queued and attention states, including genuine provider input', () => {
  expect(taskMatchesFilter({ status: 'running' }, 'running')).toBe(true)
  expect(taskMatchesFilter({ status: 'queued' }, 'running')).toBe(false)
  expect(taskMatchesFilter({ status: 'queued' }, 'queued')).toBe(true)
  expect(taskMatchesFilter(undefined, 'attention', 'waiting_user_input')).toBe(true)
  expect(taskMatchesFilter({ status: 'review' }, 'attention')).toBe(false)
  expect(taskMatchesFilter({ status: 'memo' }, 'attention')).toBe(false)
  expect(taskMatchesFilter({ status: 'completed' }, 'all')).toBe(true)
})
it('provides an explicit running tab and a fixed coordinator entry', async () => {
  const host = document.createElement('div'), root = createRoot(host), filter = vi.fn(), open = vi.fn()
  await act(async () => root.render(React.createElement(ProjectCoordinationEntry, { state: { enabled: true, tasks: [] } as any, filter: 'all', onFilter: filter, onOpen: open })))
  const tabs = Array.from(host.querySelectorAll('[role=tab]'))
  expect(tabs.map(t => t.textContent)).toEqual(['coordination_all', 'coordination_running', 'coordination_queued', 'coordination_attention'])
  await act(async () => (tabs[1] as HTMLButtonElement).click())
  expect(filter).toHaveBeenCalledWith('running')
  await act(async () => (host.querySelector('[aria-label=coordination_open]') as HTMLButtonElement).click())
  expect(open).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
})

it('keeps the original project list clear until coordination is enabled', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(React.createElement(ProjectCoordinationEntry, { state: null, unavailable: true, filter: 'all', onFilter: vi.fn(), onOpen: vi.fn() })))
  expect(host.querySelectorAll('[role=tab]')).toHaveLength(0)
  expect(host.textContent).toBe('')
  await act(async () => root.render(React.createElement(ProjectCoordinationEntry, { state: { enabled: false, tasks: [] } as any, filter: 'all', onFilter: vi.fn(), onOpen: vi.fn() })))
  expect(host.textContent).toBe('')
  await act(async () => root.unmount())
})
it('does not present connection failure as a disabled project or allow unavailable mutations', async () => {
  const host = document.createElement('div'), root = createRoot(host), configure = vi.fn()
  await act(async () => root.render(React.createElement(ProjectCoordinationSettings, { state: null, unavailable: true, status: 'offline-test', onConfigure: configure, onInstructions: vi.fn(), onRecent: vi.fn() })))
  expect(host.textContent).toContain('offline-test')
  expect(host.textContent).not.toContain('coordination_disabled')
  expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true)
  await act(async () => Array.from(host.querySelectorAll('button')).forEach(button => button.click()))
  expect(configure).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

it('does not paint an unknown local record as a disabled switch', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  await act(async () => root.render(React.createElement(ProjectCoordinationSettings, { state: null, unavailable: true, loading: true, status: 'connecting-test', onConfigure: vi.fn(), onInstructions: vi.fn(), onRecent: vi.fn() })))
  expect(host.querySelector('input')).toBeNull()
  expect(host.querySelector('[data-testid=coordination-enabled-loading]')).not.toBeNull()
  expect(host.textContent).not.toContain('coordination_disabled')
  await act(async () => root.unmount())
})

it('explains active-task rejection instead of blaming the Client version', () => {
  expect(coordinationErrorMessageKey(new Error(JSON.stringify({ error: 'coordination_wait_for_active_tasks' })))).toBe('coordination_enable_busy')
  expect(coordinationErrorMessageKey(new Error('coordination_running_tasks_remain'))).toBe('coordination_disable_busy')
  expect(coordinationErrorMessageKey(new Error('coordination_machine_offline'))).toBe('coordination_offline')
  expect(coordinationErrorMessageKey(new Error('{malformed private response'))).toBe('coordination_error')
  expect(coordinationErrorMessageKey(new Error(JSON.stringify({ error: 'unknown_private_error' })))).toBe('coordination_error')
})

it('uses the same actionable rows for badges, including missing session pages and manager questions', () => {
  const state = { tasks: [{ id: 'failure', status: 'failed' }, { id: 'review', status: 'review' }, { id: 'missing-page', status: 'waiting', waitingReason: 'waiting_user_input' }], questions: [{ id: 'decision', question: 'Which requirement?', options: [] }] } as any
  const sessions = [{ id: 'local-task', activity: { runPhase: 'waiting_approval' } }]
  expect(coordinationCounts(state, sessions).attention).toBe(3)
  expect(coordinationRows(state, sessions).filter(row => taskMatchesFilter(row.task, 'attention', row.phase)).map(row => row.id)).toEqual(['missing-page', 'local-task'])
  state.questions[0].answeredAt = 1
  expect(coordinationCounts(state, sessions).attention).toBe(2)
})
