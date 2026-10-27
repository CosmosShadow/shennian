// @vitest-environment happy-dom
// @arch docs/features/personal-agent-workspace.md
// @covers packages/app/src/features/personal-workspace/memoryFolderTransport.ts
// @covers packages/app/src/features/personal-workspace/MemoryFolderScreen.tsx
// @covers packages/app/src/features/personal-workspace/PersonalWorkspaceScreen.tsx
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SendFn } from '../components/chat/fileOperations'
import { createMemoryFolderSend } from '../features/personal-workspace/memoryFolderTransport'

const state = vi.hoisted(() => ({
  accountId: 'test-account', kind: 'memory', online: true,
  request: vi.fn(), details: vi.fn(), back: vi.fn(), panel: null as any,
}))
vi.mock('react-native', () => ({ View: 'div', Text: 'span', Pressable: 'button', ActivityIndicator: 'i' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'section' }))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ kind: state.kind }), useRouter: () => ({ navigate: vi.fn(), replace: vi.fn() }) }))
const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: any) => select({ user: { id: state.accountId } }), { getState: () => ({ user: { id: state.accountId } }) }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => state.back }))
vi.mock('../features/steward/ContextualStewardContext', () => ({ useContextualSteward: () => ({ setDetails: state.details }) }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { revision: 4, machine: { id: 'test-primary', online: state.online } }, loading: false, refresh: vi.fn() }) }))
vi.mock('../features/personal-workspace/client', () => ({ personalWorkspaceClient: (...args: any[]) => state.request(...args), personalErrorKey: () => 'personal_unavailable' }))
vi.mock('../components/ConnectedAppPageHeader', () => ({ AppPageHeader: ({ title }: any) => h('h1', {}, title) }))
vi.mock('../components/chat/FileDrawer', () => ({ FilePanel: (props: any) => { state.panel = props; return h('article', { 'data-testid': 'shared-file-panel' }, props.workDir) } }))
vi.mock('../features/personal-workspace/DiaryScreen', () => ({ default: () => h('article', {}, 'unchanged diary') }))
import PersonalWorkspaceScreen from '../features/personal-workspace/PersonalWorkspaceScreen'

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  state.accountId = 'test-account'; state.kind = 'memory'; state.online = true; state.panel = null
  state.request.mockResolvedValue({ workspace: '/test/memory' })
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
it('opens memory in the shared directory browser, without the old cards or persistent metadata header', async () => {
  await act(async () => root.render(h(PersonalWorkspaceScreen)))
  expect(state.request).toHaveBeenCalledExactlyOnceWith({ action: 'info', expectedPrimaryRevision: 4 })
  expect(container.querySelector('[data-testid="shared-file-panel"]')?.textContent).toBe('/test/memory')
  expect(state.panel).toMatchObject({ rootPath: '/test/memory', workDir: '/test/memory', presentation: 'fullscreen', readOnly: true, allowUpload: false })
  state.panel.onDirectoryChange('/test/memory/notes')
  expect(state.details).toHaveBeenLastCalledWith({ kind: 'memory', path: '/test/memory/notes', machineId: 'test-primary' })
  state.panel.onClose(); expect(state.back).toHaveBeenCalledOnce()
})
it('keeps diary on its own existing screen', async () => {
  state.kind = 'diary'
  await act(async () => root.render(h(PersonalWorkspaceScreen)))
  expect(container.textContent).toBe('unchanged diary')
  expect(state.request).not.toHaveBeenCalled()
})
it('does not browse another machine or show stale memory when the primary is offline', async () => {
  state.online = false
  await act(async () => root.render(h(PersonalWorkspaceScreen)))
  expect(container.textContent).toContain('personal_machine_offline')
  expect(state.panel).toBeNull(); expect(state.request).not.toHaveBeenCalled()
})
const frame = (method: Parameters<SendFn>[0]['method'], path: string, extra = {}) => ({ type: 'req' as const, method, params: { path, ...extra } })
it('adapts paged listings and text previews to the shared browser without changing the backend safety boundary', async () => {
  const request = vi.fn().mockResolvedValueOnce({ entries: [{ path: 'notes', name: 'notes', isDir: true }], nextOffset: 100 })
    .mockResolvedValueOnce({ entries: [{ path: 'index.md', name: 'index.md' }] })
    .mockResolvedValueOnce({ content: '# memory' })
  const send = createMemoryFolderSend({ rootPath: '/test/memory', revision: 4, request, available: () => true })
  const listing = await send(frame('fs.ls', '/test/memory'))
  expect(listing.payload).toEqual({ path: '/test/memory', entries: [
    { path: '/test/memory/notes', name: 'notes', isDir: true }, { path: '/test/memory/index.md', name: 'index.md', isDir: false },
  ] })
  expect(request).toHaveBeenNthCalledWith(2, { action: 'list', kind: 'memory', path: '', offset: 100, expectedPrimaryRevision: 4 })
  expect((await send(frame('fs.read', '/test/memory/index.md'))).payload).toEqual({ content: '# memory' })
})
it('rejects writes, out-of-root paths, traversal and late results from an old account', async () => {
  const request = vi.fn(async () => ({ content: 'test' }))
  let available = true
  const send = createMemoryFolderSend({ rootPath: '/test/memory', revision: 4, request, available: () => available })
  for (const path of ['/test/memory-other/a', '/test/memory/../secret', '/elsewhere'])
    await expect(send(frame('fs.read', path))).rejects.toThrow('personal_path_forbidden')
  await expect(send(frame('fs.write', '/test/memory/a'))).rejects.toThrow('personal_path_forbidden')
  expect(request).not.toHaveBeenCalled()
  request.mockImplementationOnce(async () => { available = false; return { content: 'stale' } })
  await expect(send(frame('fs.read', '/test/memory/a.md'))).rejects.toThrow('personal_primary_unavailable')
})
it('preserves backend failures and supports bounded text downloads without bypassing read restrictions', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('personal_path_forbidden')).mockResolvedValue({ content: 'abc' })
  const send = createMemoryFolderSend({ rootPath: 'C:\\memory', revision: 4, request, available: () => true })
  await expect(send(frame('fs.read', 'C:/memory/secrets.txt'))).rejects.toThrow('personal_path_forbidden')
  expect((await send(frame('fs.read', 'C:/memory/a.md', { encoding: 'base64', offset: 1, length: 1 }))).payload)
    .toEqual({ data: btoa('b'), length: 1, totalSize: 3 })
})
it('surfaces a failed directory request and resets the browser instead of hiding the underlying error', async () => {
  await act(async () => root.render(h(PersonalWorkspaceScreen)))
  const send = state.panel.send
  state.request.mockRejectedValueOnce(new Error('personal_primary_conflict'))
  await act(async () => { await expect(send(frame('fs.ls', '/test/memory'))).rejects.toThrow('personal_primary_conflict') })
  expect(container.querySelector('[data-testid="shared-file-panel"]')).toBeNull()
  expect(container.textContent).toContain('personal_unavailable')
  expect(container.textContent).toContain('personal_error_code')
})
