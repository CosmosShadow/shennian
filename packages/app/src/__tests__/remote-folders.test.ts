vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Path: 'Path' }))
import { ActionIconButton } from '../components/ActionIconButton'
// @arch docs/architecture/remote-folders.md
// @covers packages/app/src/features/remote-folders/model.ts
// @covers packages/app/src/components/chat/fileDrawerActions.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../open-source/packages/shared/src/i18n/en'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import { enRemoteFolders } from '../../../../open-source/packages/shared/src/i18n/en-remote-folders'
import { zhRemoteFolders } from '../../../../open-source/packages/shared/src/i18n/zh-remote-folders'
import type { Machine } from '@shennian/wire'
import { canBrowseFolders, createFolderRepository, createFolderSend, folderKey, folderName, isFolderPath, parseFolders } from '../features/remote-folders/model'
import { getFileDrawerActionIds, getFilePreviewActionIds } from '../components/chat/fileDrawerActions'

const folder = { machineId: 'test-machine', path: '/unit/docs' }
const machine = { paired: true, role: 'owner' } as Machine
const request = (path: string, method: 'fs.ls' | 'fs.read' | 'fs.write' = 'fs.ls') => ({ type: 'req' as const, method, params: { path, rootPath: '/malicious' } })
function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: vi.fn(async (key: string) => data.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { data.set(key, value) }) }
}

describe('remote folder bookmarks', () => {
  it('persists additions, deduplicates, removes only an entry, and allows re-adding', async () => {
    const storage = memoryStorage()
    const repo = createFolderRepository(storage)
    await repo.change('alice', folder)
    await repo.change('alice', folder)
    expect(await repo.read('alice')).toEqual([folder])
    expect(await repo.change('alice', folder, true)).toEqual([])
    expect(await repo.change('alice', folder)).toEqual([folder])
    expect(await createFolderRepository(storage).read('alice')).toEqual([folder])
    expect(storage.setItem).toHaveBeenCalledTimes(4)
  })
  it('persists and clears a feature shortcut without removing the saved folder', async () => {
    const storage = memoryStorage()
    const repo = createFolderRepository(storage)
    await repo.change('alice', { ...folder, showInFeatures: true })
    expect(await createFolderRepository(storage).read('alice')).toEqual([{ ...folder, showInFeatures: true }])
    await repo.change('alice', { ...folder, showInFeatures: false })
    expect(await repo.read('alice')).toEqual([folder])
    expect(await repo.read('bob')).toEqual([])
  })
  it('keeps users and machines separate', async () => {
    const repo = createFolderRepository(memoryStorage())
    await repo.change('alice', folder)
    expect(await repo.read('bob')).toEqual([])
    const second = { ...folder, machineId: 'other-machine' }
    await repo.change('alice', second)
    expect(await repo.change('alice', folder, true)).toEqual([second])
  })
  it('serializes overlapping writes without dropping other folders', async () => {
    const repo = createFolderRepository(memoryStorage())
    const second = { ...folder, path: '/unit/other' }
    await Promise.all([repo.change('alice', folder), repo.change('alice', second)])
    expect(await repo.read('alice')).toEqual([folder, second])
  })
  it('reports persistence failures, and a failed write does not poison the next operation', async () => {
    const storage = memoryStorage()
    storage.setItem.mockRejectedValueOnce(new Error('disk failure'))
    const repo = createFolderRepository(storage)
    await expect(repo.change('alice', folder)).rejects.toThrow('disk failure')
    expect(await repo.read('alice')).toEqual([])
    expect(await repo.change('alice', folder)).toEqual([folder])
  })
  it('rejects anonymous, relative or traversal bookmarks', async () => {
    const repo = createFolderRepository(memoryStorage())
    await expect(repo.change('', folder)).rejects.toThrow()
    await expect(repo.change('alice', { ...folder, path: '~/docs' })).rejects.toThrow()
    await expect(repo.change('alice', { ...folder, path: '/unit/../secret' })).rejects.toThrow()
  })
  it('ignores malformed persisted records and matches Windows spelling without conflating POSIX case', () => {
    expect(parseFolders('{')).toEqual([])
    expect(parseFolders(JSON.stringify([null, { path: '/' }, folder, folder, { ...folder, path: '../bad' }]))).toEqual([folder])
    expect(folderKey({ ...folder, path: 'C:\\Docs\\' })).toBe(folderKey({ ...folder, path: 'c:/docs' }))
    expect(folderKey({ ...folder, path: '/Docs' })).not.toBe(folderKey({ ...folder, path: '/docs' }))
    expect(folderName('/unit/docs/')).toBe('docs')
    expect(folderName('/')).toBe('/')
  })
})

describe('read-only remote folder requests', () => {
  it('reuses machine reads, fixing rootPath to the chosen root even when a caller overrides it', async () => {
    const target = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true }))
    const send = createFolderSend(folder, target, () => true, 'unavailable')
    await send(request('/unit/docs'))
    await send(request('/unit/docs/image.png', 'fs.read'))
    expect(target).toHaveBeenNthCalledWith(2, { type: 'req', method: 'fs.read', params: { path: '/unit/docs/image.png', rootPath: folder.path } })
  })
  it.each(['/unit/docs-other', '/unit/secret', '/unit/docs/../secret', '/unit/docs/./file', '__roots__', '~', 'relative'])('rejects out-of-root request %s', async path => {
    const target = vi.fn()
    await expect(createFolderSend(folder, target, () => true, 'unavailable')(request(path))).rejects.toThrow('unavailable')
    expect(target).not.toHaveBeenCalled()
  })
  it('never forwards writes or requests after access changes', async () => {
    const target = vi.fn()
    const send = createFolderSend(folder, target, () => true, 'unavailable')
    await expect(send(request('/unit/docs/file', 'fs.write'))).rejects.toThrow()
    await expect(createFolderSend(folder, target, () => false, 'unavailable')(request('/unit/docs'))).rejects.toThrow()
    expect(target).not.toHaveBeenCalled()
  })
  it('accepts Windows drive and UNC roots and rejects a neighboring share', async () => {
    const target = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true }))
    await createFolderSend({ ...folder, path: 'C:\\Docs' }, target, () => true, 'no')(request('c:/docs/file'))
    const send = createFolderSend({ ...folder, path: '\\\\host\\share' }, target, () => true, 'no')
    await send(request('\\\\host\\share\\file'))
    await expect(send(request('\\\\host\\share2\\file'))).rejects.toThrow()
    expect(isFolderPath('C:\\Docs')).toBe(true)
  })
  it('permits a POSIX root bookmark without widening a non-root bookmark', async () => {
    const target = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true }))
    await createFolderSend({ ...folder, path: '/' }, target, () => true, 'no')(request('/unit/file'))
    expect(target).toHaveBeenCalledOnce()
  })
  it('limits eligibility to paired, enabled machines owned by this user, preserving offline eligibility', () => {
    expect(canBrowseFolders(machine)).toBe(true)
    expect(canBrowseFolders({ ...machine, online: false })).toBe(true)
    expect(canBrowseFolders(undefined)).toBe(false)
    expect(canBrowseFolders({ ...machine, role: 'granted' })).toBe(false)
    expect(canBrowseFolders({ ...machine, paired: false })).toBe(false)
    expect(canBrowseFolders({ ...machine, remoteAccessDisabledAt: 'now' })).toBe(false)
  })
  it('does not expose uploads, editing or conversation reference actions in read-only panels', () => {
    expect(getFileDrawerActionIds(true, true)).toEqual(['more'])
    expect(getFilePreviewActionIds(true, true, true)).toEqual([])
    expect(getFilePreviewActionIds(false, true, true)).toEqual(['close'])
  })
})

it('bundles matching English and Chinese folder labels in the active dictionaries', () => {
  expect(Object.keys(enRemoteFolders).sort()).toEqual(Object.keys(zhRemoteFolders).sort())
  expect(en).toMatchObject(enRemoteFolders)
  expect(zh).toMatchObject(zhRemoteFolders)
})

// @arch docs/architecture/remote-folders.md
// @covers packages/app/src/features/remote-folders/RemoteFolderEntries.tsx
import { isValidElement, type ReactNode, type ReactElement } from 'react'
const state = vi.hoisted(() => ({
  details: vi.fn(),
  machines: [{ id: 'own', name: 'Test Mac', paired: true, online: true, role: 'owner' }] as Machine[],
  folders: [{ machineId: 'own', path: '/unit/reports' }, { machineId: 'own', path: '/unit/photos' }],
  change: vi.fn(async () => {}), close: vi.fn(), account: 'qa',
  values: [] as unknown[], index: 0, alert: vi.fn(), push: vi.fn(), navigate: vi.fn(),
}))
vi.mock('../features/steward/ContextualStewardContext', () => ({ useContextualSteward: () => ({ setDetails: state.details }) }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: vi.fn(), useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => {
    const index = state.index++
    return [index in state.values ? state.values[index] : initial, (value: unknown) => { state.values[index] = value }]
  },
}))
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, ActivityIndicator: 'ActivityIndicator', Alert: { alert: state.alert }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push, navigate: state.navigate }), useLocalSearchParams: () => ({ machineId: 'own' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@shennian/shared', () => ({ useMachinesStore: Object.assign((selector: (value: unknown) => unknown) => selector({ machines: state.machines }), { getState: () => ({ machines: state.machines }) }) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }))
vi.mock('../components/DirBrowser', () => ({ DirBrowser: 'DirBrowser' }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { text: '#111', brand: '#07f' } }) }))
import { RemoteFolderEntries } from '../features/remote-folders/RemoteFolderEntries'
function nodes(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (node.type === ActionIconButton) return nodes(ActionIconButton(node.props as Parameters<typeof ActionIconButton>[0]))
  return [node, ...nodes(node.props.children as ReactNode)]
}
function press(elements: ReturnType<typeof nodes>, label: string) {
  const element = elements.find(node => node.props.accessibilityLabel === label)!
  expect(element).toBeDefined()
  ;(element.props.onPress as () => void)()
}
beforeEach(() => {
  state.index = 0; state.values = []; vi.clearAllMocks()
  state.machines = [{ id: 'own', name: 'Test Mac', paired: true, online: true, role: 'owner' }] as Machine[]
  state.account = 'qa'; state.change.mockResolvedValue(undefined)
})
const uiFolder = { machineId: 'own', path: '/unit/docs' }
describe('remote folder UI callbacks', () => {
  it('opens an actual selected folder route, not an Agent or a new conversation', () => {
    const elements = nodes(RemoteFolderEntries({ folders: [uiFolder], onRemove: vi.fn() }))
    press(elements, 'remote_folder docs')
    expect(state.navigate).toHaveBeenCalledWith({ pathname: '/(main)/remote-folder', params: uiFolder })
  })
  it('keeps the row readable and exposes management without a long press', () => {
    const elements = nodes(RemoteFolderEntries({ folders: [uiFolder], onRemove: vi.fn() }))
    const row = elements.find(node => node.props.testID === 'remote-folder-entry')!
    const style = (row.props.style as (value: { pressed: boolean }) => Record<string, unknown>)({ pressed: false })
    expect(style).toMatchObject({ minHeight: 76, paddingHorizontal: 18, gap: 12 })
    expect(elements.filter(node => node.type === 'Pressable')).toHaveLength(2)
    expect(elements.some(node => node.props.testID === 'remote-folder-manage')).toBe(true)
    expect(elements.some(node => (node.props.style as Record<string, unknown> | undefined)?.width === 46)).toBe(true)
    const title = elements.find(node => node.type === 'Text' && node.props.children === 'docs')!
    expect(title.props.style).toMatchObject({ fontSize: 16, fontWeight: '600' })
    expect(row.props.onLongPress).toBeTypeOf('function')
  })
  it('exposes pinning and removal from the visible management button', async () => {
    const change = vi.fn(async () => {}), remove = vi.fn(async () => {})
    const elements = nodes(RemoteFolderEntries({ folders: [uiFolder], onRemove: remove, onChange: change }))
    press(elements, 'more · docs')
    const buttons = state.alert.mock.calls[0]![2]
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(['remote_folder_pin', 'remote_folder_remove', 'cancel'])
    buttons[0].onPress()
    await Promise.resolve()
    expect(change).toHaveBeenCalledWith({ ...uiFolder, showInFeatures: true })
    expect(remove).not.toHaveBeenCalled()
    buttons[1].onPress()
    expect(state.alert.mock.calls[1]![0]).toBe('remote_folder_remove')
  })
  it('requires confirmation before removing the bookmark, and cancel does nothing', async () => {
    const remove = vi.fn(async () => {})
    const row = nodes(RemoteFolderEntries({ folders: [uiFolder], onRemove: remove })).find(node => node.props.testID === 'remote-folder-entry')!
    ;(row.props.onLongPress as () => void)()
    expect(remove).not.toHaveBeenCalled()
    const [title, hint, buttons] = state.alert.mock.calls[0]!
    expect([title, hint]).toEqual(['remote_folder_remove', 'remote_folder_remove_hint'])
    expect(buttons[0].style).toBe('cancel')
    buttons[1].onPress()
    await Promise.resolve()
    expect(remove).toHaveBeenCalledWith(uiFolder)
    expect(state.push).not.toHaveBeenCalled()
  })

})

// @covers packages/app/src/features/personal-workspace/client.ts
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
import { authApi } from '../config/api'
import { personalWorkspaceClient, personalErrorKey } from '../features/personal-workspace/client'
describe('personal file client', () => {
  it('uses only the authenticated read endpoint, and keeps filesystem roots out of requests', async () => {
    await personalWorkspaceClient({ action: 'read', kind: 'diary', path: '2026/2026-01-01.md' })
    expect(authApi).toHaveBeenCalledWith('/personal-workspace/primary', { method: 'POST', body: JSON.stringify({ action: 'read', kind: 'diary', path: '2026/2026-01-01.md' }) }, { timeoutMs: 25000 })
  })
  it('maps known errors without displaying private backend messages', () => {
    expect(personalErrorKey(new Error('personal_directory_not_configured'))).toBe('personal_directory_not_configured')
    expect(personalErrorKey(new Error('personal_client_upgrade_required'))).toBe('personal_upgrade_required')
    expect(personalErrorKey(new Error('/private/not/to/display'))).toBe('personal_unavailable')
    expect(personalErrorKey(new Error('personal_file_too_large'))).toBe('personal_file_too_large')
  })
})

// @covers packages/app/src/features/personal-workspace/PersonalWorkspaceEntries.tsx
import { PersonalWorkspaceEntries } from '../features/personal-workspace/PersonalWorkspaceEntries'
it('opens the diary and memory routes without creating a session', () => {
  press(nodes(PersonalWorkspaceEntries()), 'personal_diary')
  expect(state.navigate).toHaveBeenCalledWith({ pathname: '/(main)/personal-workspace', params: { kind: 'diary' } })
  press(nodes(PersonalWorkspaceEntries()), 'personal_memory')
  expect(state.navigate).toHaveBeenCalledWith({ pathname: '/(main)/personal-workspace', params: { kind: 'memory' } })
})

// @covers packages/app/src/features/personal-workspace/usePrimaryComputerSelection.ts
vi.mock('../features/machines/machineAccountClient', () => ({ machineAccountClient: { listMachines: vi.fn(async () => []) } }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('../components/ConnectedAppPageHeader', () => ({ AppPageHeader: 'Header' }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((selector: (value: unknown) => unknown) => selector({ user: { id: state.account } }), { getState: () => ({ user: { id: state.account } }) }) }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { machine: { id: 'old' }, revision: 5 }, loading: false, refresh: vi.fn() }) }))
import { usePrimaryComputerSelection } from '../features/personal-workspace/usePrimaryComputerSelection'
it('shows a confirmation before changing primary and sends the displayed revision only after confirmation', async () => {
  vi.mocked(authApi).mockResolvedValue({ machine: { id: 'own' }, revision: 6 })
  const selection = usePrimaryComputerSelection()
  expect(selection.canChoose(state.machines[0]!)).toBe(true)
  selection.choose(state.machines[0]!)
  expect(authApi).not.toHaveBeenCalled()
  const [title, body, buttons] = state.alert.mock.calls[0]!
  expect(title).toBe('personal_primary_confirm_title'); expect(body).toBe('personal_primary_confirm_body')
  expect(buttons[0].style).toBe('cancel')
  buttons[1].onPress()
  expect(authApi).toHaveBeenCalledWith('/personal-workspace/primary-machine', { method: 'PUT', body: JSON.stringify({ machineId: 'own', expectedRevision: 5, confirmed: true }) }, { timeoutMs: 25000 })
  await Promise.resolve()
})

// @covers packages/app/src/features/remote-folders/SavedFolderList.tsx
// @covers packages/app/src/features/remote-folders/MachineFolderEntry.tsx
// @covers packages/app/src/features/remote-folders/MachineFolderScreen.tsx
vi.mock('../hooks/useGoBack', () => ({ useGoBack: () => state.close }))
vi.mock('../features/remote-folders/useRemoteFolders', () => ({ useRemoteFolders: () => ({ accountId: 'qa', folders: state.folders, change: state.change }) }))
import { SavedFolderList } from '../features/remote-folders/SavedFolderList'
import { MachineFolderEntry } from '../features/remote-folders/MachineFolderEntry'
import MachineFolderScreen from '../features/remote-folders/MachineFolderScreen'
describe('folder entry placement', () => {
  it('shows individual folder rows without a section heading or add action on the folder list', () => {
    const elements = nodes(SavedFolderList({}))
    const rows = elements.find(node => node.type === RemoteFolderEntries)!
    expect(rows.props.folders).toEqual(state.folders)
    expect(elements.some(node => node.props.testID === 'conversation-add-folder')).toBe(false)
    expect(elements.filter(node => node.type === 'Text')).toHaveLength(0)
  })
  it('filters saved folder rows by folder name', () => {
    const rows = nodes(SavedFolderList({ query: 'reports' })).find(node => node.type === RemoteFolderEntries)!
    expect(rows.props.folders).toEqual([state.folders[0]])
  })
  it('opens the add-directory page for the specific machine from machine details', () => {
    const row = nodes(MachineFolderEntry({ machine: state.machines[0]! }))[0]!
    expect(row.props.testID).toBe('machine-add-folder')
    expect(row.props.disabled).toBe(false)
    ;(row.props.onPress as () => void)()
    expect(state.navigate).toHaveBeenCalledWith({ pathname: '/(main)/machine-folder', params: { machineId: 'own' } })
  })
  it('does not expose adding on a shared machine and disables it while offline or paused', () => {
    expect(MachineFolderEntry({ machine: { ...state.machines[0]!, role: 'granted' } })).toBeNull()
    for (const machine of [{ ...state.machines[0]!, online: false }, { ...state.machines[0]!, remoteAccessDisabledAt: 'unit-paused' }]) {
      expect(nodes(MachineFolderEntry({ machine }))[0]!.props.disabled).toBe(true)
    }
  })
  it('uses a normal directory page, saves first, then shows the folder list', async () => {
    const browser = nodes(MachineFolderScreen()).find(node => node.type === 'DirBrowser')!
    expect(browser.props).toMatchObject({ machineId: 'own', inline: true, closeOnSelect: false })
    ;(browser.props.onDirectoryChange as (path: string) => void)('/unit/selected-subfolder')
    expect(state.details).toHaveBeenCalledWith({ path: '/unit/selected-subfolder' })
    ;(browser.props.onSelect as (path: string) => void)('/unit/reports')
    expect(state.change).toHaveBeenCalledWith(state.folders[0])
    expect(state.navigate).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(state.navigate).toHaveBeenCalledWith('/(main)/folders')
  })
  it('keeps the directory page open on save failure and never writes under a switched account', async () => {
    state.change.mockRejectedValueOnce(new Error('unit storage failure'))
    let browser = nodes(MachineFolderScreen()).find(node => node.type === 'DirBrowser')!
    ;(browser.props.onSelect as (path: string) => void)('/unit/reports')
    await Promise.resolve()
    expect(state.alert).toHaveBeenCalledWith('remote_folder_save_failed')
    expect(state.navigate).not.toHaveBeenCalled()
    state.change.mockClear(); state.account = 'other-account'
    browser = nodes(MachineFolderScreen()).find(node => node.type === 'DirBrowser')!
    ;(browser.props.onSelect as (path: string) => void)('/unit/reports')
    expect(state.change).not.toHaveBeenCalled()
  })
})
it('notifies both mounted entry lists only after successful persistence, and unsubscribes', async () => {
  const data = new Map<string, string>()
  const storage = { getItem: vi.fn(async (key: string) => data.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { data.set(key, value) }) }
  const repo = createFolderRepository(storage), first = vi.fn(), second = vi.fn()
  repo.subscribe(first); const unsubscribe = repo.subscribe(second)
  await repo.change('qa', state.folders[0]!)
  expect(first).toHaveBeenCalledWith('qa'); expect(second).toHaveBeenCalledWith('qa')
  unsubscribe()
  await repo.change('qa', state.folders[0]!, true)
  expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledOnce()
  storage.setItem.mockRejectedValueOnce(new Error('unit storage failure'))
  await expect(repo.change('qa', state.folders[0]!)).rejects.toThrow()
  expect(first).toHaveBeenCalledTimes(2)
})

// @covers packages/app/src/features/remote-folders/model.ts
const start = (targetPath = '/unit/docs', name = 'note.txt') => ({ type: 'req' as const, method: 'fs.transfer.start' as const, params: { targetPath, name, totalSize: 3 } })
it('scopes uploads to the chosen root and tracks only transfers started through this browser', async () => {
  const target = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true, payload: { transferId: 'owned' } }))
  const send = createFolderSend(folder, target, () => true, 'denied', true)
  await send(start('/unit/docs/sub'))
  expect(target).toHaveBeenLastCalledWith({ ...start('/unit/docs/sub'), params: { ...start('/unit/docs/sub').params, rootPath: folder.path, direct: true } })
  await send({ type: 'req', method: 'fs.transfer.chunk', params: { transferId: 'owned', data: 'YWJj', offset: 0 } })
  await expect(send({ type: 'req', method: 'fs.transfer.finish', params: { transferId: 'other' } })).rejects.toThrow('denied')
  await expect(send({ type: 'req', method: 'fs.transfer.chunk', params: { transferId: 'owned', relativePath: '../escape', data: '' } })).rejects.toThrow('denied')
  await send({ type: 'req', method: 'fs.transfer.finish', params: { transferId: 'owned' } })
  await expect(send({ type: 'req', method: 'fs.transfer.chunk', params: { transferId: 'owned', data: '' } })).rejects.toThrow('denied')
  expect(target).toHaveBeenCalledTimes(3)
})
it.each([['/unit/other', 'a'], ['/unit/docs/../other', 'a'], ['/unit/docs', '../escape'], ['/unit/docs', 'a/b'], ['/unit/docs', 'a\\b'], ['/unit/docs', '..']])('rejects unsafe upload target %s %s', async (path, name) => {
  const target = vi.fn()
  await expect(createFolderSend(folder, target, () => true, 'denied', true)(start(path, name))).rejects.toThrow('denied')
  expect(target).not.toHaveBeenCalled()
})
it('requires explicit upload capability and rechecks machine access on each chunk', async () => {
  const target = vi.fn(async () => ({ type: 'res' as const, id: 'unit', ok: true, payload: { transferId: 'owned' } }))
  await expect(createFolderSend(folder, target, () => true, 'denied')(start())).rejects.toThrow('denied')
  let available = true
  const send = createFolderSend(folder, target, () => available, 'denied', true)
  await send(start())
  available = false
  await expect(send({ type: 'req', method: 'fs.transfer.chunk', params: { transferId: 'owned', data: '' } })).rejects.toThrow('denied')
  expect(target).toHaveBeenCalledOnce()
})

it('prevents choosing shared, unpaired, paused, offline or already primary computers', () => {
  const selection = usePrimaryComputerSelection()
  for (const change of [{ role: 'granted' }, { paired: false }, { remoteAccessDisabledAt: 'now' }, { online: false }, { id: 'old' }]) {
    const machine = { ...state.machines[0]!, ...change } as Machine
    expect(selection.canChoose(machine)).toBe(false)
    selection.choose(machine)
  }
  expect(state.alert).not.toHaveBeenCalled()
  expect(authApi).not.toHaveBeenCalled()
})
