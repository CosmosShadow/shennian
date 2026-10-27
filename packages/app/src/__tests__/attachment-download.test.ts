// @covers packages/app/src/features/chat/utils/attachmentDownload.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState } = vi.hoisted(() => ({
  platformState: { os: 'web' },
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformState.os
    },
  },
  Share: {
    share: vi.fn(),
  },
}))

const relay = vi.hoisted(() => ({
  getRelayManager: vi.fn(),
}))

vi.mock('../config/sync', () => ({
  getRelayManager: relay.getRelayManager,
}))

const fileOps = vi.hoisted(() => ({
  archiveRemoteDirectory: vi.fn(),
  readRemoteFileBytes: vi.fn(),
  saveNativeBytes: vi.fn(),
  saveNativeMediaToLibrary: vi.fn(),
  prepareWebDownload: vi.fn(),
  saveBlob: vi.fn(),
}))

const desktopFiles = vi.hoisted(() => ({
  getDesktopFilesBridge: vi.fn(),
}))

vi.mock('../features/desktop-control/desktopFileOperations', () => ({
  getDesktopFilesBridge: desktopFiles.getDesktopFilesBridge,
}))

vi.mock('../components/chat/fileOperations', () => ({
  archiveRemoteDirectory: fileOps.archiveRemoteDirectory,
  guessMimeType: (name: string) => {
    if (name.endsWith('.pptx')) {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    if (name.endsWith('.md')) return 'text/markdown'
    return 'application/octet-stream'
  },
  readRemoteFileBytes: fileOps.readRemoteFileBytes,
  saveNativeBytes: fileOps.saveNativeBytes,
  saveNativeMediaToLibrary: fileOps.saveNativeMediaToLibrary,
  prepareWebDownload: fileOps.prepareWebDownload,
}))

const attachment = {
  path: '/Users/test/project/deck.pptx',
  name: 'deck.pptx',
  mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

describe('attachment downloads', () => {
  beforeEach(() => {
    platformState.os = 'web'
    vi.clearAllMocks()
    desktopFiles.getDesktopFilesBridge.mockReturnValue(null)
    fileOps.prepareWebDownload.mockReturnValue({ mode: 'browser', saveBlob: fileOps.saveBlob })
  })

  it('uses cached preview content for web downloads when available', async () => {
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment: { ...attachment, name: 'notes.md', mimeType: 'text/markdown' },
        previewContent: '# notes',
      }),
    ).resolves.toBe('download')

    expect(fileOps.prepareWebDownload).toHaveBeenCalledWith('notes.md')
    expect(fileOps.saveBlob).toHaveBeenCalledWith(expect.any(Blob))
    expect(fileOps.readRemoteFileBytes).not.toHaveBeenCalled()
  })

  it('downloads binary web attachments through fs.read chunks', async () => {
    const send = vi.fn()
    relay.getRelayManager.mockReturnValue({ send })
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment,
      }),
    ).resolves.toBe('download')

    expect(fileOps.readRemoteFileBytes).toHaveBeenCalledWith(expect.any(Function), attachment.path, expect.any(Function), attachment.path)
    const readSend = fileOps.readRemoteFileBytes.mock.calls[0][0]
    await readSend({ type: 'req', method: 'fs.read', params: { path: attachment.path } })
    expect(send).toHaveBeenCalledWith('machine-1', {
      type: 'req',
      method: 'fs.read',
      params: { path: attachment.path },
    })
    expect(fileOps.saveBlob).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('opens the native save/share path for pptx attachments', async () => {
    platformState.os = 'ios'
    relay.getRelayManager.mockReturnValue({ send: vi.fn() })
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fileOps.saveNativeBytes.mockResolvedValue('share')
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment,
      }),
    ).resolves.toBe('share')

    expect(fileOps.saveNativeBytes).toHaveBeenCalledWith(
      'deck.pptx',
      expect.any(Uint8Array),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
  })

  it('saves native videos directly to the media library without opening the share sheet', async () => {
    platformState.os = 'ios'
    relay.getRelayManager.mockReturnValue({ send: vi.fn() })
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fileOps.saveNativeMediaToLibrary.mockResolvedValue('library')
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment: {
          ...attachment,
          name: 'clip.mp4',
          mimeType: 'video/mp4',
        },
      }),
    ).resolves.toBe('library')

    expect(fileOps.saveNativeMediaToLibrary).toHaveBeenCalledWith(
      'clip.mp4',
      expect.any(Uint8Array),
      'video',
    )
    expect(fileOps.saveNativeBytes).not.toHaveBeenCalled()
  })

  it('saves a native HEIC as an ordinary file, not through the photo library', async () => {
    platformState.os = 'ios'
    relay.getRelayManager.mockReturnValue({ send: vi.fn() })
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fileOps.saveNativeBytes.mockResolvedValue('share')
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment: { ...attachment, name: 'IMG_9718.HEIC', mimeType: 'image/heic' },
      }),
    ).resolves.toBe('share')

    expect(fileOps.saveNativeBytes).toHaveBeenCalledWith('IMG_9718.HEIC', expect.any(Uint8Array), 'image/heic')
    expect(fileOps.saveNativeMediaToLibrary).not.toHaveBeenCalled()
  })

  it('archives folder attachments before downloading them', async () => {
    const send = vi.fn()
    relay.getRelayManager.mockReturnValue({ send })
    fileOps.archiveRemoteDirectory.mockResolvedValue({
      path: '/tmp/shennian-archives/zb-work.zip',
      name: 'zb-work.zip',
      isDir: false,
    })
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([80, 75]))
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(
      downloadChatAttachment({
        machineId: 'machine-1',
        attachment: {
          path: '/home/zb-工作包',
          name: 'zb-工作包',
          mimeType: 'inode/directory',
          kind: 'folder',
        },
      }),
    ).resolves.toBe('download')

    expect(fileOps.archiveRemoteDirectory).toHaveBeenCalledWith(expect.any(Function), {
      path: '/home/zb-工作包',
      name: 'zb-工作包',
      isDir: true,
    })
    expect(fileOps.readRemoteFileBytes).toHaveBeenCalledWith(
      expect.any(Function),
      '/tmp/shennian-archives/zb-work.zip',
      expect.any(Function),
      '/tmp/shennian-archives/zb-work.zip',
    )
    expect(fileOps.prepareWebDownload).toHaveBeenCalledWith('zb-工作包.zip')
    expect(fileOps.saveBlob).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('saves Desktop downloads through the native prepared target without browser fallback', async () => {
    desktopFiles.getDesktopFilesBridge.mockReturnValue({ opaque: true })
    fileOps.prepareWebDownload.mockReturnValue({ mode: 'picker', saveBlob: fileOps.saveBlob })
    const { downloadChatAttachment } = await import('../features/chat/utils/attachmentDownload')

    await expect(downloadChatAttachment({
      machineId: 'machine-1',
      attachment: { ...attachment, name: 'notes.md', mimeType: 'text/markdown' },
      previewContent: '# notes',
    })).resolves.toBe('desktop')

    expect(fileOps.prepareWebDownload).toHaveBeenCalledWith('notes.md')
    expect(fileOps.saveBlob).toHaveBeenCalledTimes(1)
  })
})

// @covers packages/app/src/components/downloadFeedbackPolicy.ts
// @covers packages/app/src/features/chat/utils/imageCloseSwipe.ts
import type { TFunction } from 'i18next'
import { DOWNLOAD_FEEDBACK_MS, downloadFeedback } from '../components/downloadFeedbackPolicy'
import { shouldCloseImageSwipe } from '../features/chat/utils/imageCloseSwipe'
const t = ((key: string, options?: { name: string }) => `${key}:${options?.name}`) as TFunction

describe('download result feedback', () => {
  it.each([
    ['library', 'media_saved_to_library', 'success'],
    ['downloads', 'download_saved_to_downloads', 'success'],
    ['picker', 'download_saved_to_selected_location', 'success'],
    ['desktop', 'download_saved_to_selected_location', 'success'],
    ['browser', 'download_started_browser', 'info'],
    ['download', 'download_started_browser', 'info'],
    ['share', 'download_opened_save_sheet', 'info'],
    ['permission-denied', 'media_save_permission_denied', 'error'],
  ] as const)('reports %s accurately', (result, key, type) => {
    expect(downloadFeedback(t, result, 'photo.jpg')).toEqual({ message: `${key}:photo.jpg`, type })
    expect(DOWNLOAD_FEEDBACK_MS).toBe(4000)
  })
})
describe('image preview right swipe', () => {
  const swipe = { dx: 100, dy: 10, x0: 180, numberActiveTouches: 1 }
  it('closes a single image but preserves gallery paging', () => {
    expect(shouldCloseImageSwipe(swipe, 1)).toBe(true)
    expect(shouldCloseImageSwipe(swipe, 3)).toBe(false)
    expect(shouldCloseImageSwipe({ ...swipe, x0: 20 }, 3)).toBe(true)
  })
  it('ignores left, short, vertical and multi-touch drags', () => {
    for (const change of [{ dx: -100 }, { dx: 20 }, { dy: 70 }, { numberActiveTouches: 2 }]) {
      expect(shouldCloseImageSwipe({ ...swipe, ...change }, 1)).toBe(false)
    }
  })
})
