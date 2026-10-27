// @covers src/features/rooms/roomDraftImagePreview.ts
// @covers src/features/rooms/roomAttachments.ts
// @covers src/features/rooms/roomAccountAttachments.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRoomDraftImageGallery, canPreviewRoomDraftImage, loadRoomDraftImage } from '../features/rooms/roomDraftImagePreview'

const {
  roomAccountClient,
  scopedRoomApi,
  digest,
  fileArrayBuffer,
  platformState,
  prepareWebDownload,
  saveBlob,
  saveNativeBytes,
  saveNativeMediaToLibrary,
} = vi.hoisted(() => ({
  roomAccountClient: {
    initializeAttachment: vi.fn(),
    completeAttachment: vi.fn(),
    getAttachmentDownload: vi.fn(),
  },
  scopedRoomApi: vi.fn(),
  digest: vi.fn(),
  fileArrayBuffer: vi.fn(),
  platformState: { os: 'web' },
  prepareWebDownload: vi.fn(),
  saveBlob: vi.fn(),
  saveNativeBytes: vi.fn(),
  saveNativeMediaToLibrary: vi.fn(),
}))

vi.mock('../features/rooms/roomAccountClient', () => ({ roomAccountClient }))
vi.mock('../features/rooms/scopedRoomApi', () => ({ scopedRoomApi }))
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformState.os
    },
  },
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest,
}))
vi.mock('expo-file-system', () => ({
  File: class {
    arrayBuffer = fileArrayBuffer
  },
}))
vi.mock('../components/chat/fileOperations', () => ({
  prepareWebDownload,
  saveNativeBytes,
  saveNativeMediaToLibrary,
}))

import {
  downloadRoomAttachment,
  getRoomAttachmentDownloadUrl,
  uploadRoomAttachment,
} from '../features/rooms/roomAccountAttachments'
import {
  buildNativeRoomPickedMedia,
  uploadScopedRoomAttachment,
} from '../features/rooms/roomAttachments'

describe('Room Web/App attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const bytes = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index)).buffer
    digest.mockResolvedValue(bytes)
    fileArrayBuffer.mockResolvedValue(new TextEncoder().encode('hello').buffer)
    platformState.os = 'web'
    saveBlob.mockResolvedValue('browser')
    saveNativeBytes.mockResolvedValue('share')
    prepareWebDownload.mockReturnValue({ mode: 'browser', saveBlob })
  })

  it('uses the bytes actually read when the native photo picker reports a stale size', () => {
    expect(buildNativeRoomPickedMedia({
      uri: 'file:///cache/photo.jpg',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 123_456,
    }, 42, 0)).toEqual({
      uri: 'file:///cache/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 0,
    })
  })

  it('uses init, private PUT and complete without putting auth in the OSS request', async () => {
    const sha256 = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
    roomAccountClient.initializeAttachment.mockResolvedValueOnce({
        attachment: { id: 'attachment_1', roomId: 'room_1', name: 'note.txt',
          mimeType: 'text/plain', byteSize: '5', sha256 },
        upload: { method: 'PUT', url: 'https://private-oss.example/object?signature=short',
          headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': sha256 },
          expiresAt: '2099-01-01T00:00:00.000Z' },
      })
    roomAccountClient.completeAttachment.mockResolvedValueOnce({
      attachment: { attachmentId: 'attachment_1', status: 'ready' },
    })
    const originalFetch = globalThis.fetch
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    globalThis.fetch = put as never
    try {
      await expect(uploadRoomAttachment('room_1', {
        uri: 'blob:unused', name: 'note.txt', mimeType: 'text/plain', size: 5,
        file: new Blob(['hello']),
      })).resolves.toBe('attachment_1')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(roomAccountClient.initializeAttachment).toHaveBeenCalledWith(
      'room_1',
      expect.objectContaining({ name: 'note.txt', mediaKind: 'file', byteSize: 5, sha256 }),
    )
    expect(put).toHaveBeenCalledWith(expect.stringContaining('private-oss.example'), expect.objectContaining({
      method: 'PUT', redirect: 'error',
    }))
    expect(JSON.stringify(put.mock.calls)).not.toContain('authorization')
    expect(roomAccountClient.completeAttachment).toHaveBeenCalledWith('room_1', 'attachment_1')
  })

  it('uploads through the cookie-scoped Room API without using account auth', async () => {
    const sha256 = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
    scopedRoomApi
      .mockResolvedValueOnce({
        attachment: { id: 'attachment_1', roomId: 'room_1', name: 'photo.png',
          mimeType: 'image/png', byteSize: '5', sha256 },
        upload: { method: 'PUT', url: 'https://private-oss.example/object?signature=short',
          headers: { 'content-type': 'image/png', 'x-oss-meta-sha256': sha256 },
          expiresAt: '2099-01-01T00:00:00.000Z' },
      })
      .mockResolvedValueOnce({ attachment: { attachmentId: 'attachment_1', status: 'ready' } })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as never
    try {
      await expect(uploadScopedRoomAttachment('room_1', {
        uri: 'blob:unused', name: 'photo.png', mimeType: 'image/png', size: 5,
        file: new Blob(['hello']),
      })).resolves.toBe('attachment_1')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(scopedRoomApi).toHaveBeenNthCalledWith(
      1,
      'room_1',
      '/attachments/init',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(scopedRoomApi).toHaveBeenNthCalledWith(
      2,
      'room_1',
      '/attachments/attachment_1/complete',
      { method: 'POST' },
    )
    expect(roomAccountClient.initializeAttachment).not.toHaveBeenCalled()
    expect(roomAccountClient.completeAttachment).not.toHaveBeenCalled()
  })

  it.each([
    ['photo.heic', 'image/heic'],
    ['PHOTO.HEIF', 'application/octet-stream'],
  ])('uploads %s untouched as an ordinary file with its original name, MIME and bytes', async (name, mimeType) => {
    const sha256 = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
    roomAccountClient.initializeAttachment.mockResolvedValueOnce({
      attachment: { id: 'attachment_1', roomId: 'room_1', name, mimeType, byteSize: '5', sha256 },
      upload: { method: 'PUT', url: 'https://private-oss.example/object?signature=short',
        headers: { 'content-type': mimeType, 'x-oss-meta-sha256': sha256 },
        expiresAt: '2099-01-01T00:00:00.000Z' },
    })
    roomAccountClient.completeAttachment.mockResolvedValueOnce({
      attachment: { attachmentId: 'attachment_1', status: 'ready' },
    })
    const originalFetch = globalThis.fetch
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    globalThis.fetch = put as never
    try {
      await expect(uploadRoomAttachment('room_1', {
        uri: 'file:///picker/photo.heic', name, mimeType, size: 5,
        file: new Blob(['hello']),
      })).resolves.toBe('attachment_1')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(roomAccountClient.initializeAttachment).toHaveBeenCalledWith('room_1', expect.objectContaining({
      name, mimeType, mediaKind: 'file', byteSize: 5,
    }))
    expect(put).toHaveBeenCalledOnce()
  })

  it('reads native picker file URIs through expo-file-system instead of fetch', async () => {
    const sha256 = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
    roomAccountClient.initializeAttachment.mockResolvedValueOnce({
        attachment: { id: 'attachment_1', roomId: 'room_1', name: 'photo.jpg',
          mimeType: 'image/jpeg', byteSize: '5', sha256 },
        upload: { method: 'PUT', url: 'https://private-oss.example/object?signature=short',
          headers: { 'content-type': 'image/jpeg', 'x-oss-meta-sha256': sha256 },
          expiresAt: '2099-01-01T00:00:00.000Z' },
      })
    roomAccountClient.completeAttachment.mockResolvedValueOnce({
      attachment: { attachmentId: 'attachment_1', status: 'ready' },
    })
    const originalFetch = globalThis.fetch
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    globalThis.fetch = put as never
    try {
      await expect(uploadRoomAttachment('room_1', {
        uri: 'file:///picker/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 5,
      })).resolves.toBe('attachment_1')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(fileArrayBuffer).toHaveBeenCalledOnce()
    expect(digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array))
    expect(put).toHaveBeenCalledOnce()
  })

  it('requests a fresh authorized download URL only when the user opens an attachment', async () => {
    roomAccountClient.getAttachmentDownload.mockResolvedValue({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    await expect(getRoomAttachmentDownloadUrl('room_1', 'attachment_1'))
      .resolves.toContain('signature=short')
    expect(roomAccountClient.getAttachmentDownload).toHaveBeenCalledWith('room_1', 'attachment_1')
  })

  it('downloads Room files as bytes instead of opening the signed URL', async () => {
    roomAccountClient.getAttachmentDownload.mockResolvedValue({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as never
    try {
      await expect(downloadRoomAttachment('room_1', {
        attachmentId: 'attachment_1',
        name: 'notes.bin',
        mimeType: 'application/octet-stream',
        byteSize: '3',
      })).resolves.toBe('browser')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(prepareWebDownload).toHaveBeenCalledWith('notes.bin')
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('uses the native save sheet for Room file downloads', async () => {
    platformState.os = 'ios'
    prepareWebDownload.mockReturnValue(null)
    roomAccountClient.getAttachmentDownload.mockResolvedValue({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as never
    try {
      await expect(downloadRoomAttachment('room_1', {
        attachmentId: 'attachment_1',
        name: 'notes.bin',
        mimeType: 'application/octet-stream',
        byteSize: '3',
      })).resolves.toBe('share')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(saveNativeBytes).toHaveBeenCalledWith(
      'notes.bin',
      new Uint8Array([1, 2, 3]),
      'application/octet-stream',
    )
  })

  it('saves Room images directly to the native media library', async () => {
    platformState.os = 'ios'
    prepareWebDownload.mockReturnValue(null)
    saveNativeMediaToLibrary.mockResolvedValue('library')
    roomAccountClient.getAttachmentDownload.mockResolvedValue({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as never
    try {
      await expect(downloadRoomAttachment('room_1', {
        attachmentId: 'attachment_1',
        name: 'photo.png',
        mimeType: 'image/png',
        byteSize: '3',
      })).resolves.toBe('library')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(saveNativeMediaToLibrary).toHaveBeenCalledWith(
      'photo.png',
      new Uint8Array([1, 2, 3]),
      'photo',
    )
    expect(saveNativeBytes).not.toHaveBeenCalled()
  })

  it('downloads a native HEIC as an ordinary file instead of saving it to the photo library', async () => {
    platformState.os = 'ios'
    prepareWebDownload.mockReturnValue(null)
    roomAccountClient.getAttachmentDownload.mockResolvedValue({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as never
    try {
      await expect(downloadRoomAttachment('room_1', {
        attachmentId: 'attachment_1', name: 'IMG_9718.HEIC', mimeType: 'image/heic', byteSize: '3',
      })).resolves.toBe('share')
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(saveNativeBytes).toHaveBeenCalledWith('IMG_9718.HEIC', new Uint8Array([1, 2, 3]), 'image/heic')
    expect(saveNativeMediaToLibrary).not.toHaveBeenCalled()
  })

  it('rejects malformed expiry timestamps for upload and download capabilities', async () => {
    const sha256 = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
    roomAccountClient.initializeAttachment.mockResolvedValueOnce({
      attachment: {
        id: 'attachment_1', roomId: 'room_1', name: 'note.txt',
        mimeType: 'text/plain', byteSize: '5', sha256,
      },
      upload: {
        method: 'PUT',
        url: 'https://private-oss.example/object?signature=short',
        headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': sha256 },
        expiresAt: 'not-a-timestamp',
      },
    })

    await expect(uploadRoomAttachment('room_1', {
      uri: 'blob:unused', name: 'note.txt', mimeType: 'text/plain', size: 5,
      file: new Blob(['hello']),
    })).rejects.toThrow('invalid_room_attachment_upload')

    roomAccountClient.getAttachmentDownload.mockResolvedValueOnce({
      downloadUrl: 'https://private-oss.example/object?signature=short',
      expiresAt: 'not-a-timestamp',
    })
    await expect(getRoomAttachmentDownloadUrl('room_1', 'attachment_1'))
      .rejects.toThrow('invalid_room_attachment_download')
  })
})

describe('Room draft image preview', () => {
  const image = {
    id: 'local', name: 'photo.png', mimeType: 'image/png', size: 123,
    uri: 'file:///picked/photo.png', attachmentId: null, status: 'uploading' as const,
  }

  it('opens the selected image among images only and snapshots upload state', () => {
    const restored = { ...image, id: 'restored', uri: '', attachmentId: 'remote' }
    const items = [image, { ...image, id: 'file', mimeType: 'text/plain' }, restored]
    const result = buildRoomDraftImageGallery(items, 'restored')!
    expect(result.initialIndex).toBe(1)
    expect(result.images.map((item) => item.key)).toEqual(['local', 'restored'])
    restored.attachmentId = 'changed'
    expect(result.images[1].attachmentId).toBe('remote')
    expect(buildRoomDraftImageGallery(items, 'file')).toBeNull()
    expect(buildRoomDraftImageGallery([], 'missing')).toBeNull()
  })

  it.each(['uploading', 'failed', 'ready'] as const)('previews local images while %s without network', async (status) => {
    const remote = vi.fn()
    expect(await loadRoomDraftImage('room', { ...image, status }, remote)).toBe(image.uri)
    expect(remote).not.toHaveBeenCalled()
  })

  it('loads restored drafts with Room authorization and propagates expiry for retry UI', async () => {
    const signal = new AbortController().signal
    const remote = vi.fn().mockResolvedValue('https://example.com/temporary')
    const restored = { ...image, uri: '', attachmentId: 'attachment' }
    await expect(loadRoomDraftImage('room', restored, remote, signal)).resolves.toContain('temporary')
    expect(remote).toHaveBeenCalledWith('room', 'attachment', signal)
    remote.mockRejectedValue(new Error('expired'))
    await expect(loadRoomDraftImage('room', restored, remote)).rejects.toThrow('expired')
  })

  it('never offers a HEIC/HEIF draft for image preview, local or remote', () => {
    const heic = { ...image, name: 'IMG_9718.HEIC', mimeType: 'image/heic' }
    expect(canPreviewRoomDraftImage(heic)).toBe(false)
    expect(canPreviewRoomDraftImage({ ...heic, uri: '', attachmentId: 'remote' })).toBe(false)
    expect(canPreviewRoomDraftImage({ ...image, name: 'photo.heif', mimeType: 'application/octet-stream' })).toBe(false)
    expect(canPreviewRoomDraftImage(image)).toBe(true)
  })

  it('rejects missing resources and cancelled requests', async () => {
    const remote = vi.fn()
    expect(canPreviewRoomDraftImage({ ...image, uri: '' })).toBe(false)
    await expect(loadRoomDraftImage('room', { ...image, uri: '' }, remote)).rejects.toThrow('unavailable')
    const controller = new AbortController()
    controller.abort()
    await expect(loadRoomDraftImage('room', image, remote, controller.signal)).rejects.toThrow('aborted')
    expect(remote).not.toHaveBeenCalled()
  })
})
