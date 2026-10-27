// @vitest-environment happy-dom
// @covers src/features/projects/utils/projectListProjection.ts
// @covers src/features/projects/components/ProjectSessionListItem.tsx
// @covers src/features/unread/useSessionUnreadCounts.ts
// @covers src/features/projects/hooks/useProjectSessions.ts
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { groupSessionsIntoProjects, useSessionsStore } from '@shennian/shared'
import type { NianSession, NianProject } from '@shennian/wire'
import { createProjectListProjection, createSessionMachineNameProjection } from '../features/projects/utils/projectListProjection'
import { createProjectSessionSelector, useProjectSessions } from '../features/projects/hooks/useProjectSessions'
import { ProjectSessionListItem } from '../features/projects/components/ProjectSessionListItem'
import { useSessionUnreadCount } from '../features/unread/useSessionUnreadCounts'
import { refreshSessionUnreadCounts } from '../lib/session-unread-count-cache'

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), row: vi.fn((_props: Record<string, unknown>) => null) }))
vi.mock('expo-router', () => { const router = { navigate: mocks.navigate }; return { useRouter: () => router } })
vi.mock('../features/account-runtime/accountRuntime', () => ({ accountRuntime: {} }))
vi.mock('../features/session-list/components/MobileHomeSessionItem', () => ({ MobileHomeSessionItem: React.memo(mocks.row) }))

function session(id: string, workDir = `/${id}`): NianSession {
  return { id, workDir, machineId: 'machine', userId: 'user', agentType: 'codex',
    agentSessionId: id, title: id, status: 'active', modelId: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    lastActivityAt: '2026-10-01T00:00:00Z', activity: null,
  } as NianSession
}
afterEach(() => { useSessionsStore.setState({ sessions: [], previews: {}, previewTimestamps: {} }); vi.clearAllMocks() })

it('reuses unaffected project aggregates and matches authoritative grouping on updates and removal', () => {
  const project = createProjectListProjection()
  const a = session('a'), b = session('b')
  const records = [{ id: 'empty', machineId: 'machine', workDir: '/empty', displayName: 'Empty' }] as NianProject[]
  const before = project([a, b], records)
  expect(before).toEqual(groupSessionsIntoProjects([a, b], records))
  const changed = { ...a, title: 'updated', activity: { sessionId: 'a', runId: 'run-a', runPhase: 'thinking', startedAt: a.createdAt, updatedAt: a.updatedAt } } as NianSession
  const after = project([changed, b], records)
  expect(after).toEqual(groupSessionsIntoProjects([changed, b], records))
  expect(after[0]).toBe(before[0])
  expect(after[1]).not.toBe(before[1])
  expect(after[2]).toBe(before[2])
  expect(project([changed], [])).toEqual(groupSessionsIntoProjects([changed], []))
  expect(project([], [])).toEqual([])
})

it('keeps cross-project internal-session filtering and normalized Windows identities', () => {
  const ordinary = session('ordinary', 'C:\\repo')
  const worker = session('sess_worker_child', 'C:/repo')
  const substrate = { ...session('substrate', '/other'), agentIdentityId: 'managed', agentSessionId: ordinary.agentSessionId }
  const sessions = [ordinary, worker, substrate]
  const project = createProjectListProjection()
  expect(project(sessions, [])).toEqual(groupSessionsIntoProjects(sessions))
  expect(project([ordinary, worker], [])).toEqual(groupSessionsIntoProjects([ordinary, worker]))
})

it('does not repaint session rows for unrelated previews or parent rerenders', async () => {
  const root = createRoot(document.createElement('div'))
  const a = session('a')
  const onDelete = vi.fn()
  const render = () => React.createElement(ProjectSessionListItem, { session: a, onDelete })
  try {
    await act(async () => root.render(render()))
    expect(mocks.row).toHaveBeenCalledTimes(1)
    await act(async () => useSessionsStore.getState().setPreview('b', 'other', '2026-10-01T00:00:00Z'))
    await act(async () => root.render(render()))
    expect(mocks.row).toHaveBeenCalledTimes(1)
    await act(async () => useSessionsStore.getState().setPreview('a', 'updated', '2026-10-01T00:00:01Z'))
    expect(mocks.row).toHaveBeenCalledTimes(2)
    const props = mocks.row.mock.calls.at(-1)![0] as unknown as { onPress: () => void; preview: string }
    expect(props.preview).toBe('updated')
    props.onPress()
    expect(mocks.navigate).toHaveBeenCalledWith('/(main)/chat/a')
  } finally { await act(async () => root.unmount()) }
})

it('only rerenders a primitive unread subscriber when its own count changes', async () => {
  const root = createRoot(document.createElement('div'))
  const a = { ...session('a'), attentionCount: 1, userState: { manualUnread: true } } as NianSession
  const b = { ...session('b'), attentionCount: 1, userState: { manualUnread: true } } as NianSession
  let renders = 0
  function Probe() { const count = useSessionUnreadCount('a'); renders++; return String(count) }
  await refreshSessionUnreadCounts([a, b])
  try {
    await act(async () => root.render(React.createElement(Probe)))
    await act(async () => { await refreshSessionUnreadCounts([a, { ...b, attentionCount: 3 }]) })
    expect(renders).toBe(1)
    await act(async () => { await refreshSessionUnreadCounts([{ ...a, attentionCount: 2 }, b]) })
    expect(renders).toBe(2)
  } finally { await act(async () => root.unmount()) }
})


it('keeps 199 out of 200 project aggregates stable when one of 5000 sessions changes', () => {
  const project = createProjectListProjection()
  const sessions = Array.from({ length: 5000 }, (_, index) => session(`s-${index}`, `/project-${index % 200}`))
  const before = project(sessions, [])
  const next = [{ ...sessions[0], title: 'New title' }, ...sessions.slice(1)]
  const after = project(next, [])
  expect(after).toEqual(groupSessionsIntoProjects(next))
  expect(after.filter((entry, index) => entry === before[index])).toHaveLength(199)
})

it('ignores sibling project updates but accepts current project updates and route changes', async () => {
  const root = createRoot(document.createElement('div'))
  const a = session('a'), b = session('b')
  useSessionsStore.setState({ sessions: [a, b] })
  let renders = 0
  let visible: NianSession[] = []
  function Probe({ path }: { path: string }) {
    visible = useProjectSessions('machine', path); renders++; return null
  }
  try {
    await act(async () => root.render(React.createElement(Probe, { path: '/a' })))
    await act(async () => useSessionsStore.setState({ sessions: [a, { ...b, title: 'Other update' }] }))
    expect(renders).toBe(1)
    expect(visible).toEqual([a])
    const updated = { ...a, title: 'Current update' }
    await act(async () => useSessionsStore.setState({ sessions: [updated, b] }))
    expect(renders).toBe(2)
    expect(visible).toEqual([updated])
    await act(async () => root.render(React.createElement(Probe, { path: '/b' })))
    expect(visible).toEqual([b])
    await act(async () => useSessionsStore.setState({ sessions: [updated] }))
    expect(visible).toEqual([])
  } finally { await act(async () => root.unmount()) }
})


it('retains row identity when decorating missing machine names across live updates', () => {
  const decorate = createSessionMachineNameProjection()
  const project = createProjectListProjection()
  const a = session('a'), b = session('b')
  const namedA = decorate(a, 'Mac'), namedB = decorate(b, 'Mac')
  const before = project([namedA, namedB], [])
  const nextA = decorate({ ...a, title: 'updated' }, 'Mac')
  expect(decorate(b, 'Mac')).toBe(namedB)
  const after = project([nextA, decorate(b, 'Mac')], [])
  expect(after[1]).toBe(before[1])
  expect(decorate(b, 'Renamed Mac').machineName).toBe('Renamed Mac')
  expect(decorate(b, '')).toBe(b)
})


it('does not rescan the session index for preview/loading writes or repeated snapshots', () => {
  const a = session('a')
  let reads = 0
  Object.defineProperty(a, 'machineId', { get: () => { reads++; return 'machine' } })
  const sessions = [a, session('b')]
  const select = createProjectSessionSelector('machine', '/a')
  const first = select({ sessions })
  const initialReads = reads
  expect(first).toEqual([a])
  for (let i = 0; i < 100; i++) expect(select({ sessions })).toBe(first)
  expect(reads).toBe(initialReads)
  expect(select({ sessions: [...sessions, session('c', '/a')] })).toHaveLength(2)
  expect(reads).toBeGreaterThan(initialReads)
  expect(select({ sessions: [] })).toEqual([])
})
