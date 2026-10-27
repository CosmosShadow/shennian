// @covers packages/app/src/features/chat/utils/attachmentPreview.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getRelayManagerMock, platform, loadNativePdf } = vi.hoisted(() => ({
  getRelayManagerMock: vi.fn(),
  platform: { OS: 'web' },
  loadNativePdf: vi.fn(),
}))

vi.mock('../config/sync', () => ({
  getRelayManager: getRelayManagerMock,
}))

vi.mock('react-native', () => ({
  Platform: platform,
}))

vi.mock('../features/chat/utils/nativeImagePreviewCache', () => ({
  loadNativePdfPreview: loadNativePdf,
}))

type TestAttachment = {
  path: string
  name: string
  kind: 'file' | 'image' | 'folder'
  mimeType?: string
  previewData?: string
}

const fileAttachment: TestAttachment = {
  path: '/Users/test/project/docs/readme.md',
  name: 'readme.md',
  kind: 'file',
  previewData: undefined,
}

const imageAttachment: TestAttachment = {
  path: '/Users/test/project/docs/shot.png',
  name: 'shot.png',
  kind: 'image',
  previewData: undefined,
}

const folderAttachment: TestAttachment = {
  path: '/Users/test/project/docs',
  name: 'docs',
  kind: 'folder',
  mimeType: 'inode/directory',
  previewData: undefined,
}

describe('attachment preview cache', () => {
  beforeEach(() => {
    vi.resetModules()
    getRelayManagerMock.mockReset()
    platform.OS = 'web'
    loadNativePdf.mockReset()
  })

  it('loads mobile PDFs through disk chunks and returns only a file URI', async () => {
    platform.OS = 'ios'
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: 'JVBERg==', length: 4, totalSize: 4 },
    })
    getRelayManagerMock.mockReturnValue({ send })
    loadNativePdf.mockImplementation(async (options) => {
      expect(options.maxSize).toBe(20 * 1024 * 1024)
      expect(options.refresh).toBe(true)
      await options.readChunk(0)
      return 'file:///cache/report.pdf'
    })
    const { loadAttachmentPreview } = await import('../features/chat/utils/attachmentPreview')
    const result = await loadAttachmentPreview(
      'machine-1',
      {
        path: '/work/report.pdf',
        name: 'report.pdf',
        kind: 'file',
      },
      { refresh: true },
    )
    expect(result).toEqual({ content: null, data: 'file:///cache/report.pdf', error: '' })
    expect(send).toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({
        method: 'fs.read',
        params: expect.objectContaining({ encoding: 'base64', offset: 0, length: 768 * 1024 }),
      }),
    )
  })

  it('reuses cached file preview results for the same machine/path', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { content: '# hello' },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    const first = await previewModule.loadAttachmentPreview('machine-1', fileAttachment)
    const second = await previewModule.loadAttachmentPreview('machine-1', fileAttachment)

    expect(first).toEqual({ content: '# hello', data: null, error: '' })
    expect(second).toEqual(first)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps a second-phone preview unavailable without a live origin relay', async () => {
    getRelayManagerMock.mockReturnValue(null)
    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview(
      'machine-offline',
      fileAttachment,
    )).resolves.toEqual({
      content: null,
      data: null,
      error: 'Machine is offline',
    })
  })

  it('requests text file previews with automatic encoding detection', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { content: '中文字段：行情', encoding: 'gb18030', encodingFallback: true },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', fileAttachment)).resolves.toEqual({
      content: '中文字段：行情',
      data: null,
      error: '',
    })

    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: fileAttachment.path,
        rootPath: fileAttachment.path,
        encoding: 'auto',
      },
    })
  })

  it('loads folder attachment previews through fs.ls instead of fs.read', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        path: folderAttachment.path,
        entries: [
          { name: 'readme.md', path: `${folderAttachment.path}/readme.md`, isDir: false },
          { name: 'assets', path: `${folderAttachment.path}/assets`, isDir: true },
        ],
      },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(
      previewModule.loadAttachmentPreview('machine-1', folderAttachment),
    ).resolves.toEqual({
      content: null,
      data: null,
      error: '',
      directory: {
        path: folderAttachment.path,
        entries: [
          { name: 'readme.md', path: `${folderAttachment.path}/readme.md`, isDir: false },
          { name: 'assets', path: `${folderAttachment.path}/assets`, isDir: true },
        ],
      },
    })

    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.ls',
      params: {
        path: folderAttachment.path,
        rootPath: folderAttachment.path,
      },
    })
    expect(send).not.toHaveBeenCalledWith(
      'machine-1',
      expect.objectContaining({ method: 'fs.read' }),
    )
  })

  it('falls back to fs.ls when a local resource preview is actually a directory', async () => {
    const directoryPath = '/home/zb-工作包'
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'Not a file',
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: {
          path: directoryPath,
          entries: [{ name: '0-脚本', path: `${directoryPath}/0-脚本`, isDir: true }],
        },
      })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(
      previewModule.loadAttachmentPreview('machine-1', {
        path: directoryPath,
        name: 'zb-工作包',
        kind: 'file',
      }),
    ).resolves.toEqual({
      content: null,
      data: null,
      error: '',
      directory: {
        path: directoryPath,
        entries: [{ name: '0-脚本', path: `${directoryPath}/0-脚本`, isDir: true }],
      },
    })

    expect(send).toHaveBeenNthCalledWith(1, 'machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: directoryPath,
        rootPath: directoryPath,
        encoding: 'auto',
      },
    })
    expect(send).toHaveBeenNthCalledWith(2, 'machine-1', {
      type: 'req',
      method: 'fs.ls',
      params: {
        path: directoryPath,
        rootPath: directoryPath,
      },
    })
  })

  it('falls back to fs.ls when a binary preview throws Not a file', async () => {
    const directoryPath = '/home/zb-工作包'
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'Not a file',
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: {
          path: directoryPath,
          entries: [{ name: '方案.pdf', path: `${directoryPath}/方案.pdf`, isDir: false }],
        },
      })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(
      previewModule.loadAttachmentPreview('machine-1', {
        path: directoryPath,
        name: 'zb-工作包.pdf',
        kind: 'file',
        mimeType: 'application/pdf',
      }),
    ).resolves.toEqual({
      content: null,
      data: null,
      error: '',
      directory: {
        path: directoryPath,
        entries: [{ name: '方案.pdf', path: `${directoryPath}/方案.pdf`, isDir: false }],
      },
    })

    expect(send).toHaveBeenNthCalledWith(2, 'machine-1', {
      type: 'req',
      method: 'fs.ls',
      params: {
        path: directoryPath,
        rootPath: directoryPath,
      },
    })
  })

  it('falls back to fs.ls when an image-shaped link is actually a directory', async () => {
    const directoryPath = '/home/zb-工作包.png'
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'EISDIR: illegal operation on a directory',
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: {
          path: directoryPath,
          entries: [{ name: '素材', path: `${directoryPath}/素材`, isDir: true }],
        },
      })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(
      previewModule.loadAttachmentPreview('machine-1', {
        path: directoryPath,
        name: 'zb-工作包.png',
        kind: 'image',
        mimeType: 'image/png',
      }),
    ).resolves.toEqual({
      content: null,
      data: null,
      error: '',
      directory: {
        path: directoryPath,
        entries: [{ name: '素材', path: `${directoryPath}/素材`, isDir: true }],
      },
    })

    expect(send).toHaveBeenNthCalledWith(2, 'machine-1', {
      type: 'req',
      method: 'fs.ls',
      params: {
        path: directoryPath,
        rootPath: directoryPath,
      },
    })
  })

  it('refreshes file preview results when requested for the same machine/path', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        payload: { content: '<h1>old</h1>' },
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: { content: '<h1>new</h1>' },
      })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    const first = await previewModule.loadAttachmentPreview('machine-1', {
      ...fileAttachment,
      path: '/Users/test/project/email-preview.html',
      name: 'email-preview.html',
    })
    const second = await previewModule.loadAttachmentPreview(
      'machine-1',
      {
        ...fileAttachment,
        path: '/Users/test/project/email-preview.html',
        name: 'email-preview.html',
      },
      { refresh: true },
    )
    const third = await previewModule.loadAttachmentPreview('machine-1', {
      ...fileAttachment,
      path: '/Users/test/project/email-preview.html',
      name: 'email-preview.html',
    })

    expect(first).toEqual({ content: '<h1>old</h1>', data: null, error: '' })
    expect(second).toEqual({ content: '<h1>new</h1>', data: null, error: '' })
    expect(third).toEqual(second)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent preview reads for the same machine/path', async () => {
    let resolveSend: (value: unknown) => void = () => {}
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve
        }),
    )
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    const firstPromise = previewModule.loadAttachmentPreview('machine-1', fileAttachment)
    const secondPromise = previewModule.loadAttachmentPreview('machine-1', fileAttachment)

    expect(send).toHaveBeenCalledTimes(1)

    resolveSend({
      ok: true,
      payload: { content: '# deduped' },
    })

    await expect(firstPromise).resolves.toEqual({ content: '# deduped', data: null, error: '' })
    await expect(secondPromise).resolves.toEqual({ content: '# deduped', data: null, error: '' })
  })

  it('requests image previews up to 20 MB', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: 'abc123', length: 6, totalSize: 6 },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', imageAttachment)).resolves.toEqual({
      content: null,
      data: 'data:image/png;base64,abc123',
      error: '',
    })

    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: imageAttachment.path,
        rootPath: imageAttachment.path,
        offset: 0,
        length: 768 * 1024,
        encoding: 'base64',
      },
    })
  })


  it('loads PDF previews as base64 data instead of utf8 text', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: 'JVBERi0x', length: 8, totalSize: 8 },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', {
      path: '/Users/test/project/docs/report.pdf',
      name: 'report.pdf',
      kind: 'file',
      mimeType: 'application/pdf',
    })).resolves.toEqual({
      content: null,
      data: 'data:application/pdf;base64,JVBERi0x',
      error: '',
    })

    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: '/Users/test/project/docs/report.pdf',
        rootPath: '/Users/test/project/docs/report.pdf',
        offset: 0,
        length: 768 * 1024,
        encoding: 'base64',
      },
    })
  })

  it('loads audio previews as base64 data instead of tripping the binary text error', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: 'SUQz', length: 4, totalSize: 4 },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', {
      path: '/Users/test/project/.uploads/hangup.mp3',
      name: 'hangup.mp3',
      kind: 'file',
    })).resolves.toEqual({
      content: null,
      data: 'data:audio/mpeg;base64,SUQz',
      error: '',
    })

    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: '/Users/test/project/.uploads/hangup.mp3',
        rootPath: '/Users/test/project/.uploads/hangup.mp3',
        offset: 0,
        length: 768 * 1024,
        encoding: 'base64',
      },
    })
  })

  it('loads video previews as base64 data from mime type even when the extension is generic', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: { data: 'AAAA', length: 4, totalSize: 4 },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', {
      path: '/Users/test/project/.uploads/render.bin',
      name: 'render.bin',
      kind: 'file',
      mimeType: 'video/mp4',
    })).resolves.toEqual({
      content: null,
      data: 'data:video/mp4;base64,AAAA',
      error: '',
    })
  })

  it('reuses locally cached image upload previews without relay reads', async () => {
    const send = vi.fn()
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    previewModule.cacheImageAttachmentPreview('machine-1', imageAttachment, 'local-upload')

    await expect(previewModule.loadAttachmentPreview('machine-1', imageAttachment)).resolves.toEqual({
      content: null,
      data: 'local-upload',
      error: '',
    })
    expect(previewModule.getCachedAttachmentPreview('machine-1', imageAttachment)).toBe(
      'local-upload',
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('expires in-memory preview bytes instead of becoming a device authority', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
      const previewModule = await import('../features/chat/utils/attachmentPreview')
      previewModule.cacheImageAttachmentPreview('machine-1', imageAttachment, 'temporary-preview')
      expect(previewModule.getCachedAttachmentPreview('machine-1', imageAttachment)).toBe(
        'temporary-preview',
      )
      vi.setSystemTime(new Date('2026-09-01T00:31:00.000Z'))
      expect(previewModule.getCachedAttachmentPreview('machine-1', imageAttachment)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a concrete image preview error when the daemon rejects an oversized file', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        data: 'abc123',
        length: 6,
        totalSize: 24 * 1024 * 1024,
      },
    })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', imageAttachment)).resolves.toEqual({
      content: null,
      data: null,
      error: 'File too large to preview (24.0 MB; max 20.0 MB)',
    })
  })

  it('loads image previews in chunks instead of one large websocket response', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        payload: { data: 'first', length: 768 * 1024, totalSize: 768 * 1024 + 3 },
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: { data: 'end', length: 3, totalSize: 768 * 1024 + 3 },
      })
    getRelayManagerMock.mockReturnValue({
      send,
    })

    const previewModule = await import('../features/chat/utils/attachmentPreview')

    await expect(previewModule.loadAttachmentPreview('machine-1', imageAttachment)).resolves.toEqual({
      content: null,
      data: 'data:image/png;base64,firstend',
      error: '',
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(2, 'machine-1', {
      type: 'req',
      method: 'fs.read',
      params: {
        path: imageAttachment.path,
        rootPath: imageAttachment.path,
        offset: 768 * 1024,
        length: 768 * 1024,
        encoding: 'base64',
      },
    })
  })

  it('does not repopulate the cache from a response that completes after an epoch reset', async () => {
    let resolveOld: ((value: { ok: boolean; payload: { content: string } }) => void) | undefined
    const oldSend = vi.fn(() => new Promise((resolve) => {
      resolveOld = resolve
    }))
    getRelayManagerMock.mockReturnValue({ send: oldSend })
    const previewModule = await import('../features/chat/utils/attachmentPreview')

    const oldRequest = previewModule.loadAttachmentPreview('machine-1', fileAttachment)
    await vi.waitFor(() => expect(oldSend).toHaveBeenCalledOnce())
    await previewModule.clearAllAttachmentPreviewCaches()
    resolveOld?.({ ok: true, payload: { content: 'old epoch' } })
    await oldRequest

    const newSend = vi.fn().mockResolvedValue({ ok: true, payload: { content: 'new epoch' } })
    getRelayManagerMock.mockReturnValue({ send: newSend })
    await expect(previewModule.loadAttachmentPreview('machine-1', fileAttachment)).resolves.toEqual({
      content: 'new epoch', data: null, error: '',
    })
    expect(newSend).toHaveBeenCalledOnce()
  })
})

// @covers packages/app/src/features/chat/utils/attachmentDownloadTasks.ts
import { downloadFeedback } from '../components/downloadFeedbackPolicy'

const mocks = vi.hoisted(() => ({ download: vi.fn(), notify: vi.fn() }))
vi.mock('../features/chat/utils/attachmentDownload', () => ({ downloadChatAttachment: mocks.download }))
vi.mock('../components/DownloadFeedback', () => ({ downloadFeedback, showDownloadFeedback: mocks.notify }))

const input = { machineId: 'test-machine', attachment: { path: '/test/photo.png', name: 'photo.png', mimeType: 'image/png', kind: 'image' as const } }
const t = (key: string, options: { name: string }) => `${key}:${options.name}`

async function setup() {
  vi.resetModules()
  mocks.download.mockReset()
  mocks.notify.mockReset()
  let resolve!: (result: string) => void
  let reject!: (error: Error) => void
  const pending = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  mocks.download.mockReturnValue(pending)
  const tasks = await import('../features/chat/utils/attachmentDownloadTasks')
  return { ...tasks, resolve, reject, key: tasks.attachmentDownloadKey(input) }
}

describe('route-independent attachment downloads', () => {
  it('keeps downloading without subscribers, restores progress on re-entry and notifies once', async () => {
    const tasks = await setup()
    const changed = vi.fn()
    const leavePage = tasks.subscribeAttachmentDownloads(changed)
    const first = tasks.startAttachmentDownload(input, t)
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBe(0)
    expect(mocks.download).toHaveBeenCalledTimes(1) // starts synchronously in the click
    const onProgress = mocks.download.mock.calls[0][0].onProgress
    onProgress(22)
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBe(22)
    leavePage()
    changed.mockClear()
    onProgress(67)
    expect(changed).not.toHaveBeenCalled()
    const reenter = tasks.subscribeAttachmentDownloads(changed)
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBe(67)
    expect(tasks.startAttachmentDownload(input, t)).toBe(first)
    tasks.resolve('library')
    expect(await first).toBe('library')
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ message: 'media_saved_to_library:photo.png', type: 'success' })
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBeNull()
    expect(changed).toHaveBeenCalled()
    reenter()
  })

  it('delivers success globally even when the preview has no subscriber left', async () => {
    const tasks = await setup()
    const leave = tasks.subscribeAttachmentDownloads(vi.fn())
    const promise = tasks.startAttachmentDownload(input, t)
    leave()
    tasks.resolve('library')
    await promise
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ message: 'media_saved_to_library:photo.png', type: 'success' })
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBeNull()
  })

  it('reports failure after leaving, releases the task, and allows retry', async () => {
    const tasks = await setup()
    const first = tasks.startAttachmentDownload(input, t)
    tasks.reject(new Error('offline'))
    expect(await first).toBeNull()
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ message: 'download_failed:photo.png', type: 'error' })
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBeNull()
    mocks.download.mockResolvedValue('library')
    expect(await tasks.startAttachmentDownload(input, t)).toBe('library')
    expect(mocks.download).toHaveBeenCalledTimes(2)
  })

  it('does not report success at 100% until saving finishes', async () => {
    const tasks = await setup()
    const promise = tasks.startAttachmentDownload(input, t)
    mocks.download.mock.calls[0][0].onProgress(100)
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBe(100)
    expect(mocks.notify).not.toHaveBeenCalled()
    tasks.resolve('library')
    await promise
    expect(mocks.notify).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['share', 'download_opened_save_sheet', 'info'],
    ['permission-denied', 'media_save_permission_denied', 'error'],
    ['downloads', 'download_saved_to_downloads', 'success'],
  ])('keeps %s feedback truthful rather than claiming everything was saved', async (result, message, type) => {
    const tasks = await setup()
    const promise = tasks.startAttachmentDownload(input, t)
    tasks.resolve(result)
    await promise
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith({ message: `${message}:photo.png`, type })
  })

  it('isolates machines, paths and folder archives, including their progress', async () => {
    const tasks = await setup()
    const other = { ...input, machineId: 'other-machine' }
    const otherPath = { ...input, attachment: { ...input.attachment, path: '/else/photo.png' } }
    const folder = { ...input, attachment: { ...input.attachment, kind: 'folder' as const } }
    const promises = [input, other, otherPath, folder].map((item) => tasks.startAttachmentDownload(item, t))
    expect(mocks.download).toHaveBeenCalledTimes(4)
    mocks.download.mock.calls[0][0].onProgress(55)
    expect(tasks.getAttachmentDownloadProgress(tasks.key)).toBe(55)
    expect(tasks.getAttachmentDownloadProgress(tasks.attachmentDownloadKey(other))).toBe(0)
    tasks.resolve('library')
    await Promise.all(promises)
    for (const item of [input, other, otherPath, folder]) {
      expect(tasks.getAttachmentDownloadProgress(tasks.attachmentDownloadKey(item))).toBeNull()
    }
  })

})
