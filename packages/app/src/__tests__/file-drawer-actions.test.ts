// @vitest-environment happy-dom
// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/fileDrawerActions.ts

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  getFileDrawerActionIds,
  getFilePreviewActionIds,
} from '../components/chat/fileDrawerActions'

describe('file drawer actions', () => {
  it('keeps directory controls in a compact header with a more menu', () => {
    expect(getFileDrawerActionIds(false)).toEqual([
      'upload',
      'upload-folder',
      'tree',
      'more',
      'close',
    ])
    expect(getFileDrawerActionIds(true)).toEqual(['upload', 'upload-folder', 'more'])
  })

  it('exposes @ current file directly from preview', () => {
    expect(getFilePreviewActionIds(false)).toEqual(['insert-ref', 'close'])
    expect(getFilePreviewActionIds(true)).toEqual(['insert-ref'])
  })

  it('adds edit when a preview supports direct editing', () => {
    expect(getFilePreviewActionIds(false, true)).toEqual(['edit', 'insert-ref', 'close'])
    expect(getFilePreviewActionIds(true, true)).toEqual(['edit', 'insert-ref'])
  })
})

// @vitest-environment happy-dom
// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/FileDrawer.tsx
// @covers packages/app/src/components/chat/useFilePreviewController.ts
// @covers packages/app/src/components/chat/FileBrowserMenu.tsx
// @covers packages/app/src/components/chat/useFileTransfers.ts
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
const mocks = vi.hoisted(() => ({
  picker: vi.fn(),
  upload: vi.fn(),
  close: vi.fn(),
  read: vi.fn(() => new Uint8Array([97, 98, 99])),
}))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.picker }))
vi.mock('expo-file-system', () => ({
  File: class {
    size = 3
    open() {
      return { offset: 0, readBytes: mocks.read, close: mocks.close }
    }
  },
}))
vi.mock('../features/desktop-control/desktopFileOperations', () => ({
  getDesktopFilesBridge: () => null,
}))
vi.mock('../features/desktop-control/useDesktopFileDrop', () => ({ useDesktopFileDrop: vi.fn() }))

const transfers = vi.hoisted(() => ({
  handleDownload: vi.fn(),
  handleUpload: vi.fn(),
  downloadFileFromList: vi.fn(),
}))
vi.mock('react-native', async () => {
  const { createElement: el, forwardRef } = await import('react')
  const view = (tag: string) =>
    forwardRef(
      (
        {
          children,
          onPress,
          testID,
          accessibilityLabel,
          numberOfLines,
          ellipsizeMode,
          ...props
        }: any,
        ref: any,
      ) =>
        el(
          tag,
          {
            ref,
            onClick: onPress,
            'data-testid': testID,
            'aria-label': accessibilityLabel,
            'data-lines': numberOfLines,
            'data-ellipsis': ellipsizeMode,
            style: Object.assign({}, ...[props.style].flat().filter(Boolean)),
          },
          children,
        ),
    )
  return {
    Platform: { OS: 'ios' },
    StyleSheet: { create: (value: any) => value, hairlineWidth: 1, absoluteFill: {} },
    View: view('div'),
    Text: view('span'),
    Pressable: view('button'),
    ActivityIndicator: view('i'),
    Switch: ({ value, onValueChange, testID }: any) =>
      el('input', {
        type: 'checkbox',
        checked: value,
        'data-testid': testID,
        onChange: (e: any) => onValueChange(e.target.checked),
      }),
    Modal: ({ visible, children }: any) => (visible ? el('section', {}, children) : null),
    FlatList: forwardRef(({ data, renderItem, ListEmptyComponent }: any, ref: any) =>
      el(
        'div',
        { ref },
        data.length
          ? data.map((item: any, index: number) =>
              el('div', { key: index }, renderItem({ item, index })),
            )
          : ListEmptyComponent,
      ),
    ),
  }
})
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: ({ name }: any) => h('i', { 'data-icon': name }) }))
vi.mock('../components/ActionIcon', () => ({ ActionIcon: ({ name }: any) => h('i', { 'data-icon': name }) }))
vi.mock('@expo/vector-icons/Feather', () => ({
  default: ({ name }: any) => h('i', { 'data-icon': name }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: { brand: '#65f', bg: '#fff', surface: '#fff', border: '#eee', text: '#111' },
    isDark: false,
  }),
}))
vi.mock('../hooks/useKeyboardShortcut', () => ({ useKeyboardShortcut: vi.fn() }))
vi.mock('../components/AppPageHeader', () => ({
  AppPageHeader: ({ title, onBack, trailing }: any) => h('header', {}, h('button', { onClick: onBack }, 'back'), h('h1', {}, title), trailing),
  HeaderIconButton: ({ onPress, testID, label }: any) => h('button', { onClick: onPress, 'data-testid': testID, 'aria-label': label }, label),
  HeaderBackButton: ({ onPress }: any) => h('button', { onClick: onPress }, 'back'),
}))
vi.mock('../components/DownloadFeedback', () => ({ DownloadFeedback: () => null }))
vi.mock('../components/chat/MarkdownWysiwygEditor', () => ({ MarkdownWysiwygEditor: () => null }))
vi.mock('../components/chat/useFileTransfers', () => ({
  useFileTransfers: () => ({ ...transfers, setDownloadNotice: vi.fn() }),
}))
vi.mock('../components/chat/fileOperations', () => ({
  chunkedUpload: mocks.upload,
  isPreviewable: (name: string) => name.endsWith('.txt'),
  formatSize: (size: number) => `${size} B`,
  sanitizeTestIdPart: (value: string) => value,
  isImageFile: () => false,
}))
vi.mock('../components/chat/readFilePanelPreview', () => ({ readFilePanelBinaryPreview: vi.fn() }))
vi.mock('../components/chat/FilePreview', () => ({
  FilePreview: ({ content }: any) => h('article', {}, content),
}))
import { FilePanel } from '../components/chat/FileDrawer'
let root: Root
let container: HTMLDivElement
const entries = [
  { name: 'reports', path: '/unit/reports', isDir: true },
  { name: 'notes.txt', path: '/unit/notes.txt', isDir: false, size: 12 },
  { name: 'archive.zip', path: '/unit/archive.zip', isDir: false, size: 48 },
  { name: '.hidden', path: '/unit/.hidden', isDir: false, size: 2 },
]
const send = vi.fn(async (frame: any) => ({
  type: 'res' as const,
  id: 'test',
  ok: true,
  payload: frame.method === 'fs.ls' ? { path: '/unit', entries } : { content: 'hello preview' },
}))
beforeEach(async () => {
  vi.clearAllMocks()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      h(FilePanel, {
        send,
        workDir: '/unit',
        presentation: 'fullscreen',
        readOnly: true,
        allowUpload: true,
        onInsertRef: vi.fn(),
        onClose: vi.fn(),
      }),
    )
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const click = async (id: string) => {
  await act(async () => (container.querySelector(`[data-testid="${id}"]`) as HTMLElement).click())
}
it('shows the directory name above its path without refresh or an initial selection', () => {
  expect(container.querySelector('h1')?.textContent).toBe('unit')
  const title = container.querySelector('[aria-label="/unit"]')
  expect(title?.textContent).toBe('unit')
  expect(container.querySelector('[data-icon="refresh-cw"]')).toBeNull()
  expect(
    container
      .querySelector('[data-testid="file-entry-reports"]')
      ?.parentElement?.getAttribute('style') ?? '',
  ).not.toContain('background-color')
  expect(container.querySelector('[data-testid="file-browser-toggle-hidden"]')).toBeNull()
})
it('reveals hidden files only through the more-menu switch', async () => {
  expect(container.textContent).not.toContain('.hidden')
  await click('file-browser-more')
  await click('file-browser-toggle-hidden')
  expect(container.textContent).toContain('.hidden')
})
it('opens unsupported files as details without reading or downloading and downloads only on request', async () => {
  send.mockClear()
  await click('file-entry-archive.zip')
  expect(container.textContent).toContain('archive.zip')
  expect(container.textContent).toContain('48 B')
  expect(send).not.toHaveBeenCalled()
  expect(transfers.downloadFileFromList).not.toHaveBeenCalled()
  await click('file-preview-download')
  expect(transfers.handleDownload).toHaveBeenCalledOnce()
})
it('opens supported text and keeps upload in the more menu without a footer', async () => {
  expect(container.querySelector('[data-testid="file-browser-upload"]')).toBeNull()
  await click('file-browser-more')
  const upload = container.querySelector('[aria-label="remote_folder_upload_current"]') as HTMLElement
  await act(async () => upload.click())
  expect(transfers.handleUpload).toHaveBeenCalledOnce()
  expect(container.querySelector('header [aria-label="attach_file"]')).toBeNull()
  expect(container.querySelector('[data-testid="file-browser-upload"]')).toBeNull()
  await click('file-entry-notes.txt')
  expect(container.querySelector('article')?.textContent).toBe('hello preview')
  expect(transfers.downloadFileFromList).not.toHaveBeenCalled()
})

const { useFileTransfers } = await vi.importActual<
  typeof import('../components/chat/useFileTransfers')
>('../components/chat/useFileTransfers')
it('reads mobile picker files by chunk, closes the handle, refreshes the directory and reports failures', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  const loadDir = vi.fn(async () => {})
  let transfer: ReturnType<typeof useFileTransfers>
  function Harness() {
    transfer = useFileTransfers({
      currentPath: '/unit',
      readOnly: true,
      allowUpload: true,
      dropTarget: null,
      loadDir,
      previewContent: null,
      previewData: null,
      previewFile: null,
      send: vi.fn(),
      t: ((key: string) => key) as any,
      workDir: '/unit',
    })
    return null
  }
  mocks.picker.mockResolvedValue({
    canceled: false,
    assets: [{ name: 'a.txt', uri: 'file:///unit/picker' }],
  })
  mocks.upload.mockImplementation(async (_send, file, path, direct) => {
    expect(path).toBe('/unit')
    expect(direct).toBe(true)
    expect(file.size).toBe(3)
    expect(await file.readChunk(0, 3)).toEqual(new Uint8Array([97, 98, 99]))
  })
  try {
    await act(async () => root.render(h(Harness)))
    await act(async () => transfer!.handleUpload())
    expect(mocks.read).toHaveBeenCalledWith(3)
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(loadDir).toHaveBeenCalledWith('/unit')
    mocks.upload.mockRejectedValueOnce(new Error('offline'))
    await act(async () => transfer!.handleUpload())
    expect(mocks.close).toHaveBeenCalledTimes(2)
    expect(transfer!.downloadNotice).toEqual({ type: 'error', message: 'offline' })
    expect(transfer!.uploadPct).toBeNull()
    mocks.picker.mockResolvedValueOnce({ canceled: true })
    await act(async () => transfer!.handleUpload())
    expect(mocks.upload).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
  }
})

it('updates the title in subfolders and returns one level before closing', async () => {
  const close = vi.fn()
  await act(async () => root.render(h(FilePanel, {
    send, workDir: '/unit', rootPath: '/unit', presentation: 'fullscreen',
    onClose: close, onInsertRef: vi.fn(), readOnly: true,
  })))
  send.mockResolvedValueOnce({ type: 'res', id: 'test', ok: true,
    payload: { path: '/unit/reports', entries: [] } } as any)
  await click('file-entry-reports')
  expect(container.querySelector('h1')?.textContent).toBe('reports')
  expect(container.querySelector('[aria-label="/unit"]')?.textContent).toBe('unit')
  await act(async () => (container.querySelector('header button') as HTMLElement).click())
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'fs.ls', params: { path: '/unit' } }))
  expect(container.querySelector('h1')?.textContent).toBe('unit')
  expect(close).not.toHaveBeenCalled()
  await act(async () => (container.querySelector('header button') as HTMLElement).click())
  expect(close).toHaveBeenCalledOnce()
})

import { ContextualStewardContext, useContextualStewardDraft } from '../features/steward/ContextualStewardContext'
import { useDirectoryUploadMenu } from '../features/steward/useDirectoryUploadMenu'
import { ComposerActionMenu } from '../features/chat/components/ComposerActionMenu'
it('puts a destination-labelled upload in the contextual plus menu and distinguishes AI attachments', async () => {
  let label = ''
  function Menu() {
    const menu = useDirectoryUploadMenu(key => key, () => {})
    label = menu.fileLabel
    return h(ComposerActionMenu, { colors: {} as any, items: menu.items, vertical: true })
  }
  function Page() {
    const context = useContextualStewardDraft('folder')
    return h(ContextualStewardContext.Provider, { value: context },
      h(FilePanel, { send, workDir: '/unit', rootPath: '/unit', presentation: 'fullscreen',
        allowUpload: true, readOnly: true, onClose: vi.fn(), onInsertRef: vi.fn() }), h(Menu))
  }
  await act(async () => root.render(h(Page)))
  expect(label).toBe('remote_folder_attach_ai')
  expect(container.querySelector('[data-testid="composer-directory-upload"]')?.textContent).toContain('/unit')
  expect(container.querySelector('[data-testid="file-browser-upload"]')).toBeNull()
  send.mockResolvedValueOnce({ type: 'res', id: 'test', ok: true,
    payload: { path: '/unit/reports', entries: [] } } as any)
  await click('file-entry-reports')
  expect(container.querySelector('[data-testid="composer-directory-upload"]')?.textContent).toContain('/unit/reports')
  await click('composer-directory-upload')
  expect(transfers.handleUpload).toHaveBeenCalledOnce()
  await act(async () => root.render(h(Menu)))
  expect(container.querySelector('[data-testid="composer-directory-upload"]')).toBeNull()
  expect(label).toBe('composer_menu_files')
})

it('captures the upload destination before picking and does not navigate back after a later directory change', async () => {
  const loadDir = vi.fn(async () => {})
  let transfer: ReturnType<typeof useFileTransfers>
  let resolvePicker!: (value: any) => void
  mocks.picker.mockImplementationOnce(() => new Promise(resolve => { resolvePicker = resolve }))
  mocks.upload.mockResolvedValue(undefined)
  function Harness({ path }: { path: string }) {
    transfer = useFileTransfers({ currentPath: path, workDir: '/unit', readOnly: true,
      allowUpload: true, dropTarget: null, loadDir, previewContent: null, previewData: null,
      previewFile: null, send: vi.fn(), t: ((key: string) => key) as any })
    return null
  }
  await act(async () => root.render(h(Harness, { path: '/unit/reports' })))
  await act(async () => transfer!.handleUpload())
  await act(async () => transfer!.handleUpload())
  expect(mocks.picker).toHaveBeenCalledOnce()
  await act(async () => root.render(h(Harness, { path: '/unit/other' })))
  await act(async () => resolvePicker({ canceled: false, assets: [{ name: 'a.txt', uri: 'file:///unit/picker' }] }))
  expect(mocks.upload).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ name: 'a.txt' }),
    '/unit/reports', true, expect.any(Function))
  expect(loadDir).not.toHaveBeenCalled()
  expect(transfer!.downloadNotice?.type).toBe('success')
  expect(transfer!.uploadPct).toBeNull()
})
