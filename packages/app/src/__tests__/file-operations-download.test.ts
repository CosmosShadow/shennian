// @covers packages/app/src/components/chat/fileOperations.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState } = vi.hoisted(() => ({
  platformState: { os: 'ios' },
}))

const nativeShare = vi.hoisted(() => ({
  share: vi.fn(),
}))

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformState.os
    },
  },
  Share: {
    share: nativeShare.share,
  },
}))

const fileState = vi.hoisted(() => ({
  files: new Map<string, { bytes?: Uint8Array; deleted?: boolean }>(),
}))

vi.mock('expo-file-system', () => ({
  Paths: {
    cache: 'cache://',
  },
  Directory: class Directory {
    uri: string
    constructor(...parts: string[]) {
      this.uri = parts.join('/')
    }
    create = vi.fn()
  },
  File: class File {
    uri: string
    constructor(dir: { uri: string } | string, filename?: string) {
      const base = typeof dir === 'string' ? dir : dir.uri
      this.uri = filename ? `${base}/${filename}` : base
    }
    get exists() {
      return fileState.files.has(this.uri)
    }
    create = vi.fn(() => {
      fileState.files.set(this.uri, {})
    })
    delete = vi.fn(() => {
      fileState.files.delete(this.uri)
    })
    write = vi.fn((bytes: Uint8Array) => {
      fileState.files.set(this.uri, { bytes })
    })
    base64Sync = vi.fn(() => 'AQID')
  },
}))

const legacy = vi.hoisted(() => ({
  writeAsStringAsync: vi.fn(),
  getContentUriAsync: vi.fn(),
}))

const documentSaver = vi.hoisted(() => ({
  saveAndroidDocument: vi.fn(),
}))

vi.mock('expo-file-system/legacy', () => ({
  writeAsStringAsync: legacy.writeAsStringAsync,
  getContentUriAsync: legacy.getContentUriAsync,
  EncodingType: {
    Base64: 'base64',
  },
}))

vi.mock('expo-document-saver', () => ({
  saveAndroidDocument: documentSaver.saveAndroidDocument,
}))

vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: vi.fn(),
  saveToLibraryAsync: vi.fn(),
}))

describe('file operations downloads', () => {
  beforeEach(() => {
    platformState.os = 'ios'
    fileState.files.clear()
    vi.clearAllMocks()
  })

  it('reads remote files in base64 chunks and reports progress', async () => {
    const progress: number[] = []
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        payload: { data: 'AQI=', length: 2, totalSize: 3 },
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: { data: 'Aw==', length: 1, totalSize: 3 },
      })
    const { readRemoteFileBytes } = await import('../components/chat/fileOperations')

    await expect(readRemoteFileBytes(send, '/tmp/deck.pptx', (pct) => progress.push(pct))).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    )

    expect(send).toHaveBeenNthCalledWith(1, {
      type: 'req',
      method: 'fs.read',
      params: { path: '/tmp/deck.pptx', rootPath: '/tmp/deck.pptx', offset: 0, length: 1024 * 1024, encoding: 'base64' },
    })
    expect(send).toHaveBeenNthCalledWith(2, {
      type: 'req',
      method: 'fs.read',
      params: { path: '/tmp/deck.pptx', rootPath: '/tmp/deck.pptx', offset: 2, length: 1024 * 1024, encoding: 'base64' },
    })
    expect(progress).toEqual([67, 100])
  })

  it('writes Android downloads through the system create-document picker', async () => {
    platformState.os = 'android'
    documentSaver.saveAndroidDocument.mockResolvedValue('saved')
    const { saveNativeBytes } = await import('../components/chat/fileOperations')

    await expect(
      saveNativeBytes(
        'deck.pptx',
        new Uint8Array([1, 2, 3]),
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).resolves.toBe('downloads')

    expect(documentSaver.saveAndroidDocument).toHaveBeenCalledWith(
      'deck.pptx',
      new Uint8Array([1, 2, 3]),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    expect(nativeShare.share).not.toHaveBeenCalled()
  })

  it('opens the iOS native share sheet so users can save to Files or open Office apps', async () => {
    const { saveNativeBytes } = await import('../components/chat/fileOperations')

    await expect(saveNativeBytes('archive.zip', new Uint8Array([1, 2, 3]), 'application/zip')).resolves.toBe(
      'share',
    )

    expect(nativeShare.share).toHaveBeenCalledWith({
      title: 'archive.zip',
      url: 'cache:///downloads/archive.zip',
      message: 'archive.zip',
    })
  })

  it('does not require expo-media-library when non-image file operations are imported', async () => {
    const mediaLibrary = await import('expo-media-library')
    vi.mocked(mediaLibrary.requestPermissionsAsync).mockRejectedValue(
      new Error('Native module not installed in this shell'),
    )
    const { saveNativeBytes } = await import('../components/chat/fileOperations')

    await expect(saveNativeBytes('notes.txt', new Uint8Array([1, 2, 3]), 'text/plain')).resolves.toBe(
      'share',
    )

    expect(mediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  it('recognizes office and archive mime types for native sharing', async () => {
    const { guessMimeType } = await import('../components/chat/fileOperations')

    expect(guessMimeType('slides.ppt')).toBe('application/vnd.ms-powerpoint')
    expect(guessMimeType('slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    expect(guessMimeType('report.pdf')).toBe('application/pdf')
    expect(guessMimeType('archive.zip')).toBe('application/zip')
    expect(guessMimeType('sheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(guessMimeType('clip.mp4')).toBe('video/mp4')
    expect(guessMimeType('clip.mov')).toBe('video/quicktime')
  })

  it('requests write access for the matching media type and saves directly to the library', async () => {
    const mediaLibrary = await import('expo-media-library')
    vi.mocked(mediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: true } as never)
    const { saveNativeMediaToLibrary } = await import('../components/chat/fileOperations')

    await expect(
      saveNativeMediaToLibrary('clip.mp4', new Uint8Array([1, 2, 3]), 'video'),
    ).resolves.toBe('library')

    expect(mediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, ['video'])
    expect(mediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('cache:///downloads/clip.mp4')
    expect(nativeShare.share).not.toHaveBeenCalled()
  })

  it('does not open the share sheet when media library permission is denied', async () => {
    const mediaLibrary = await import('expo-media-library')
    vi.mocked(mediaLibrary.requestPermissionsAsync).mockResolvedValue({ granted: false } as never)
    const { saveNativeMediaToLibrary } = await import('../components/chat/fileOperations')

    await expect(
      saveNativeMediaToLibrary('shot.png', new Uint8Array([1, 2, 3]), 'photo'),
    ).resolves.toBe('permission-denied')

    expect(mediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
    expect(nativeShare.share).not.toHaveBeenCalled()
  })

  it('keeps web blob URLs alive briefly after triggering browser downloads', async () => {
    platformState.os = 'web'
    vi.useFakeTimers()
    const click = vi.fn()
    const appendChild = vi.fn()
    const removeChild = vi.fn()
    const originalDocument = globalThis.document
    const originalWindow = globalThis.window
    const originalUrl = globalThis.URL
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: { appendChild, removeChild },
        createElement: vi.fn(() => ({ click, href: '', download: '' })),
      },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { setTimeout },
    })
    Object.defineProperty(globalThis, 'URL', {
      configurable: true,
      value: {
        createObjectURL: vi.fn(() => 'blob://download'),
        revokeObjectURL: vi.fn(),
      },
    })
    const { triggerWebDownloadBlob } = await import('../components/chat/fileOperations')

    expect(triggerWebDownloadBlob('deck.pptx', new Blob(['deck']))).toBe(true)

    expect(click).toHaveBeenCalledTimes(1)
    expect(appendChild).toHaveBeenCalledTimes(1)
    expect(removeChild).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob://download')

    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: originalUrl })
    vi.useRealTimers()
  })

  it('opens the web save picker synchronously and writes the blob after bytes are ready', async () => {
    platformState.os = 'web'
    const write = vi.fn()
    const close = vi.fn()
    const showSaveFilePicker = vi.fn(() => Promise.resolve({
      createWritable: vi.fn(() => Promise.resolve({ write, close })),
    }))
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { showSaveFilePicker },
    })
    const { prepareWebDownload } = await import('../components/chat/fileOperations')

    const target = prepareWebDownload('report.pdf')

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'report.pdf' })
    await expect(target?.saveBlob(new Blob(['pdf']))).resolves.toBe('picker')
    expect(write).toHaveBeenCalledWith(expect.any(Blob))
    expect(close).toHaveBeenCalledTimes(1)

    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  })

  it('normalizes web save picker cancellation', async () => {
    platformState.os = 'web'
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        showSaveFilePicker: vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
      },
    })
    const { isWebDownloadCanceled, prepareWebDownload } = await import('../components/chat/fileOperations')

    const target = prepareWebDownload('report.pdf')
    await expect(target?.saveBlob(new Blob(['pdf']))).rejects.toMatchObject({
      name: 'WebDownloadCanceledError',
    })
    await target?.saveBlob(new Blob(['pdf'])).catch((error) => {
      expect(isWebDownloadCanceled(error)).toBe(true)
    })

    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  })

  it('requests daemon-side ZIP archives for folder downloads', async () => {
    const send = vi.fn().mockResolvedValue({
      ok: true,
      payload: {
        outputPath: '/tmp/shennian-archives/orders.zip',
        entry: { path: '/tmp/shennian-archives/orders.zip', name: 'orders.zip', isDir: false },
      },
    })
    const { archiveRemoteDirectory, isUnsupportedArchiveZipError } = await import('../components/chat/fileOperations')

    await expect(
      archiveRemoteDirectory(send, { path: '/Users/me/project/订单系统', name: '订单系统', isDir: true }),
    ).resolves.toEqual({ path: '/tmp/shennian-archives/orders.zip', name: 'orders.zip', isDir: false })

    expect(send).toHaveBeenCalledWith({
      type: 'req',
      method: 'fs.archive.zip',
      params: { path: '/Users/me/project/订单系统', rootPath: '/Users/me/project/订单系统' },
    })
    expect(isUnsupportedArchiveZipError('Unknown method: fs.archive.zip')).toBe(true)
  })

  it('keeps the original HEIC/HEIF MIME and lets either Desktop entry take it as an ordinary file', async () => {
    const { guessMimeType } = await import('../components/chat/fileOperations')
    const { acceptsDesktopRoomAttachmentKind } = await import('../features/desktop-rooms/desktopRoomComposer')

    // The Desktop picker derives the MIME type from the file name, not from a pre-typed fixture.
    expect(guessMimeType('IMG_9718.HEIC')).toBe('image/heic')
    expect(guessMimeType('photo.heif')).toBe('image/heif')
    for (const kind of ['media', 'file'] as const) {
      expect(acceptsDesktopRoomAttachmentKind(guessMimeType('IMG_9718.HEIC'), kind, 'IMG_9718.HEIC')).toBe(true)
      expect(acceptsDesktopRoomAttachmentKind('application/octet-stream', kind, 'photo.heif')).toBe(true)
    }
    // Other images keep the media/file entry split.
    expect(acceptsDesktopRoomAttachmentKind('image/png', 'file', 'photo.png')).toBe(false)
    expect(acceptsDesktopRoomAttachmentKind('image/png', 'media', 'photo.png')).toBe(true)
  })
})
