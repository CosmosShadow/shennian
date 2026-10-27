// @vitest-environment happy-dom
// @covers packages/app/src/features/projects/coordination/ProjectTaskCoordinationNotice.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ status: 'queued', waitingReason: undefined as string | undefined, automatic: false, paused: false, result: 'previous-attempt-result', request: vi.fn(async () => ({})) }))
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, View: ({ children }: any) => React.createElement('div', null, children), Text: ({ children }: any) => React.createElement('span', null, children), Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => React.createElement('button', { disabled, 'aria-label': accessibilityLabel, onClick: onPress }, children) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@shennian/shared', async (importOriginal) => ({ ...await importOriginal<typeof import('@shennian/shared')>(), useMachinesStore: (select: any) => select({ machines: [{ id: 'machine', online: true }] }), useSessionsStore: (select: any) => select({ sessions: [{ id: 'task', machineId: 'machine', userId: 'owner', workDir: '/qa-project' }] }) }))
vi.mock('../config/auth', () => ({ useAuthStore: (select: any) => select({ user: { id: 'owner' } }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../features/projects/coordination/useProjectCoordination', () => ({ useProjectCoordination: () => ({ request: fixture.request, state: { enabled: true, automatic: fixture.automatic, paused: fixture.paused, tasks: [{ id: 'task', status: fixture.status, waitingReason: fixture.waitingReason, result: fixture.result }] } }) }))
import { ProjectTaskCoordinationNotice } from '../features/projects/coordination/ProjectTaskCoordinationNotice'
afterEach(() => { fixture.status = 'queued'; fixture.waitingReason = undefined; fixture.result = 'previous-attempt-result'; fixture.paused = false; fixture.automatic = false; fixture.request.mockClear() })
async function mount() { const host = document.createElement('div'), root = createRoot(host); await act(async () => root.render(React.createElement(ProjectTaskCoordinationNotice, { sessionId: 'task', machineId: 'machine' }))); return { host, root } }
it('shows a queued task and dispatches only after the user permits this exact task', async () => {
  const { host, root } = await mount()
  expect(host.textContent).toContain('coordination_task_queued')
  expect(host.textContent).not.toContain('previous-attempt-result')
  expect(fixture.request).not.toHaveBeenCalled()
  await act(async () => host.querySelector('button')!.click())
  expect(fixture.request).toHaveBeenCalledWith({ command: 'task', taskId: 'task', taskAction: 'run' })
  await act(async () => root.unmount())
})
it('cannot bypass a project pause with a task run button', async () => {
  fixture.paused = true
  const { host, root } = await mount()
  expect(host.textContent).toContain('coordination_project_paused_hint')
  expect(host.querySelector('button')!.disabled).toBe(true)
  await act(async () => host.querySelector('button')!.click())
  expect(fixture.request).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})
it('leaves a normal reviewed result to the coordinator without requesting human confirmation', async () => {
  fixture.status = 'review'
  const { host, root } = await mount()
  expect(host.querySelector('button')).toBeNull()
  expect(fixture.request).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

it('renders a truncated Markdown result as a readable summary', async () => {
  fixture.status = 'review'
  fixture.result = '已创建 [first.txt](</qa-project/first'
  const { host, root } = await mount()
  expect(host.textContent).toContain('已创建 first.txt')
  expect(host.textContent).not.toContain('](')
  expect(host.textContent).not.toContain('/qa-project')
  await act(async () => root.unmount())
})

it('retains an explicitly required human result confirmation without treating it as Provider authorization', async () => {
  fixture.status = 'waiting'; fixture.waitingReason = 'user_confirmation'
  const { host, root } = await mount()
  await act(async () => host.querySelector('button')!.click())
  expect(fixture.request).toHaveBeenCalledWith({ command: 'task', taskId: 'task', taskAction: 'complete' })
  await act(async () => root.unmount())
})
