// @covers packages/app/src/features/personal-workspace/diaryRuntime.ts
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ user: 'alice', primary: vi.fn(), client: vi.fn(), open: vi.fn(), appState: 'active', onState: (_: string) => {}, remove: vi.fn() }))
vi.mock('react-native', () => ({ AppState: { get currentState() { return h.appState }, addEventListener: (_: string, fn: (state: string) => void) => { h.onState = fn; return { remove: h.remove } } } }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: h.user } }) } }))
vi.mock('../config/server', () => ({ getServerUrl: () => 'https://unit.invalid' }))
vi.mock('../features/personal-workspace/diaryStore', () => ({ openDiaryStore: h.open }))
vi.mock('../features/personal-workspace/client', () => ({ primaryMachineClient: { get: h.primary }, personalWorkspaceClient: h.client, personalErrorKey: (e: Error) => e.message }))
import { diaryStatus, refreshDiary, mountDiarySync, diaryDocuments, saveDiary, subscribeDiary } from '../features/personal-workspace/diaryRuntime'
const target = { machine: { id: 'mac', name: 'Test Mac', online: true }, revision: 1 }
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); h.user = 'alice'; h.appState = 'active'
  let storedTarget: unknown = target
  const documents = new Map<string, unknown>()
  h.open.mockResolvedValue({ getTarget: async () => storedTarget, setTarget: async (value: unknown) => { storedTarget = value }, list: async () => [...documents.values()], put: async (_: string, doc: { path: string }) => { documents.set(doc.path, doc) }, retain: vi.fn() })
  h.primary.mockResolvedValue(target)
  h.client.mockImplementation(async ({ action }) => action === 'info' ? { diarySync: 1, diaryEdit: 1 } : { snapshot: 's1', entries: [], nextOffset: null })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers() })
it('single-flights reconciliation, runs across screens, pauses in background and resumes on foreground', async () => {
  stop = mountDiarySync()
  const a = refreshDiary(), b = refreshDiary(); expect(a).toBe(b)
  await a; expect(diaryStatus()).toMatchObject({ target, busy: false, editable: true })
  expect(h.primary).toHaveBeenCalledTimes(1)
  h.appState = 'background'; await vi.advanceTimersByTimeAsync(40000); expect(h.primary).toHaveBeenCalledTimes(1)
  h.appState = 'active'; h.onState('active'); await refreshDiary(); expect(h.primary).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(20000); expect(h.primary).toHaveBeenCalledTimes(3)
})
it('restores the last confirmed target offline, but forgets it after an explicit authorization denial', async () => {
  h.primary.mockRejectedValue(new Error('network_down'))
  stop = mountDiarySync(); await refreshDiary()
  expect(diaryStatus()).toMatchObject({ target, error: 'network_down', busy: false })
  h.primary.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }))
  await refreshDiary(); expect(diaryStatus().target).toBeUndefined()
  h.primary.mockRejectedValue(new Error('network_down'))
  await refreshDiary(); expect(diaryStatus().target).toBeUndefined()
})
it('discards stale account work and never exposes the previous account replica', async () => {
  let resolve!: (value: unknown) => void
  h.primary.mockReturnValueOnce(new Promise(done => { resolve = done }))
  stop = mountDiarySync(); const running = refreshDiary()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  h.user = 'bob'; resolve(target); await running
  expect(diaryStatus()).toEqual({ busy: false }); expect(await diaryDocuments(target)).toEqual([])
  expect(h.client).not.toHaveBeenCalled()
})
it('keeps a failed write uncommitted, and persists a verified write before reporting completion', async () => {
  stop = mountDiarySync(); await refreshDiary()
  h.client.mockImplementation(async ({ action, content }) => {
    if (action === 'diary_write') { if (content === 'conflict') throw new Error('personal_file_changed'); return { content, revision: 'v2' } }
    return action === 'info' ? { diarySync: 1, diaryEdit: 1 } : { snapshot: 's1', entries: [], nextOffset: null }
  })
  await expect(saveDiary(target, '2026/2026-10-23.md', 'conflict', 'v1')).rejects.toThrow('personal_file_changed')
  expect(await diaryDocuments(target)).toEqual([])
  await refreshDiary()
  await saveDiary(target, '2026/2026-10-23.md', 'edited', 'v1')
  expect(h.client).toHaveBeenCalledWith(expect.objectContaining({ action: 'diary_write', expectedRevision: 'v1', expectedPrimaryRevision: 1 }))
  expect(await diaryDocuments(target)).toEqual([{ path: '2026/2026-10-23.md', date: '2026-10-23', title: '', summary: '', content: 'edited', revision: 'v2' }])
})

it('invalidates requests from a previous mount even when the same account remounts', async () => {
  let resolve!: (value: unknown) => void
  h.primary.mockReturnValueOnce(new Promise(done => { resolve = done }))
  stop = mountDiarySync(); const previous = refreshDiary()
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  stop(); stop = mountDiarySync(); await refreshDiary()
  resolve({ machine: { id: 'old-mac', name: 'Old', online: true }, revision: 99 }); await previous
  expect(diaryStatus().target).toEqual(target)
})

it('retains source and error through a quiet offline retry and clears the old directory on computer changes', async () => {
  h.client.mockImplementation(async ({ action }) => action === 'info' ? { diarySync: 1, diaryEdit: 1, diary: '/diary' } : { snapshot: 's1', entries: [], nextOffset: null })
  stop = mountDiarySync(); await refreshDiary()
  expect(diaryStatus().directory).toBe('/diary')
  h.primary.mockResolvedValue({ ...target, machine: { ...target.machine, online: false } })
  await refreshDiary()
  const errors: (string | undefined)[] = []
  const unsubscribe = subscribeDiary(() => errors.push(diaryStatus().error))
  await refreshDiary(); unsubscribe()
  expect(errors.length).toBeGreaterThan(0)
  expect(errors.every(error => error === 'personal_diary_offline')).toBe(true)
  expect(diaryStatus().directory).toBe('/diary')
  h.primary.mockResolvedValue({ machine: { id: 'pc', name: 'PC', online: false }, revision: 2 })
  await refreshDiary()
  expect(diaryStatus().directory).toBeUndefined()
})
