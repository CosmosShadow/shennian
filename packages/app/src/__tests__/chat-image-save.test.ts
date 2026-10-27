// @covers packages/app/src/features/chat/utils/imageSave.ts

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
}))

const fileOps = vi.hoisted(() => ({
  readRemoteFileBytes: vi.fn(),
  saveNativeBytes: vi.fn(),
  saveNativeImageToLibrary: vi.fn(),
  prepareWebDownload: vi.fn(),
  saveBlob: vi.fn(),
}))

vi.mock('../components/chat/fileOperations', () => ({
  guessMimeType: (name: string) => (name.endsWith('.png') ? 'image/png' : 'application/octet-stream'),
  readRemoteFileBytes: fileOps.readRemoteFileBytes,
  saveNativeBytes: fileOps.saveNativeBytes,
  saveNativeImageToLibrary: fileOps.saveNativeImageToLibrary,
  prepareWebDownload: fileOps.prepareWebDownload,
}))

const attachment = {
  path: '/Users/test/project/.uploads/shot.png',
  name: 'shot.png',
  mimeType: 'image/png',
  kind: 'image' as const,
}

describe('chat image save', () => {
  beforeEach(() => {
    platformState.os = 'web'
    vi.clearAllMocks()
    fileOps.prepareWebDownload.mockReturnValue({ mode: 'browser', saveBlob: fileOps.saveBlob })
  })

  it('uses cached preview data for web downloads when available', async () => {
    const { saveChatImage } = await import('../features/chat/utils/imageSave')

    await expect(
      saveChatImage({
        attachment: { ...attachment, previewData: 'abc123' },
        send: vi.fn(),
        machineId: 'machine-1',
      }),
    ).resolves.toBe('download')

    expect(fileOps.prepareWebDownload).toHaveBeenCalledWith('shot.png')
    expect(fileOps.saveBlob).toHaveBeenCalledWith(expect.any(Blob))
    expect(fileOps.readRemoteFileBytes).not.toHaveBeenCalled()
  })

  it('reads the remote image before downloading on web when no preview data exists', async () => {
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const { saveChatImage } = await import('../features/chat/utils/imageSave')

    await expect(
      saveChatImage({
        attachment,
        send: vi.fn(),
        machineId: 'machine-1',
      }),
    ).resolves.toBe('download')

    expect(fileOps.readRemoteFileBytes).toHaveBeenCalledWith(expect.any(Function), attachment.path, expect.any(Function), attachment.path)
    expect(fileOps.saveBlob).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('saves native images to the media library', async () => {
    platformState.os = 'ios'
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fileOps.saveNativeImageToLibrary.mockResolvedValue('library')
    const { saveChatImage } = await import('../features/chat/utils/imageSave')

    await expect(
      saveChatImage({
        attachment,
        send: vi.fn(),
        machineId: 'machine-1',
      }),
    ).resolves.toBe('library')

    expect(fileOps.saveNativeImageToLibrary).toHaveBeenCalledWith('shot.png', expect.any(Uint8Array))
    expect(fileOps.saveNativeBytes).not.toHaveBeenCalled()
  })

  it('does not open the native share sheet when photo permission is denied', async () => {
    platformState.os = 'android'
    fileOps.readRemoteFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]))
    fileOps.saveNativeImageToLibrary.mockResolvedValue('permission-denied')
    fileOps.saveNativeBytes.mockResolvedValue('share')
    const { saveChatImage } = await import('../features/chat/utils/imageSave')

    await expect(
      saveChatImage({
        attachment,
        send: vi.fn(),
        machineId: 'machine-1',
      }),
    ).resolves.toBe('permission-denied')

    expect(fileOps.saveNativeBytes).not.toHaveBeenCalled()
  })

  it('resolves relative image paths against the session workdir', async () => {
    const { findChatImageAttachment } = await import('../features/chat/utils/imageSave')

    expect(
      findChatImageAttachment({
        rawPath: '.uploads/shot.png',
        workDir: '/Users/test/project',
        messages: [{ attachments: [attachment] }],
      }),
    ).toEqual(attachment)
  })
})
