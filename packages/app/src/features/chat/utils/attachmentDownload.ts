// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/attachment-download.test.ts

import { Platform } from 'react-native'
import type { ChatAttachment } from '@shennian/shared'
import { accountRuntime, type AccountMachineRequestMethod } from '../../account-runtime/accountRuntime'
import {
  archiveRemoteDirectory,
  guessMimeType,
  readRemoteFileBytes,
  saveNativeBytes,
  saveNativeMediaToLibrary,
  prepareWebDownload,
  type SendFn,
} from '../../../components/chat/fileOperations'
import { getDesktopFilesBridge } from '../../desktop-control/desktopFileOperations'
import { isInlineImage } from '../../uploads/heicFile'

type DownloadChatAttachmentInput = {
  machineId: string | null
  attachment: Pick<ChatAttachment, 'path' | 'name' | 'mimeType'> & { kind?: ChatAttachment['kind'] }
  rootPath?: string
  previewContent?: string | null
  previewData?: string | null
  onProgress?: (pct: number) => void
}

export type DownloadChatAttachmentResult =
  | 'desktop'
  | 'download'
  | 'downloads'
  | 'share'
  | 'library'
  | 'permission-denied'

function getNativeMediaType(mimeType: string, name: string): 'photo' | 'video' | null {
  // HEIC / HEIF is saved as an ordinary file, not through the photo library.
  if (isInlineImage({ name, mimeType }) && mimeType !== 'image/svg+xml') return 'photo'
  if (mimeType.startsWith('video/')) return 'video'
  return null
}

export async function downloadChatAttachment({
  machineId,
  attachment,
  rootPath,
  previewContent = null,
  previewData = null,
  onProgress = () => {},
}: DownloadChatAttachmentInput): Promise<DownloadChatAttachmentResult> {
  const mimeType = attachment.mimeType || guessMimeType(attachment.name)
  const targetName = attachment.kind === 'folder'
    ? `${attachment.name.replace(/\.zip$/i, '')}.zip`
    : attachment.name
  const webDownload = Platform.OS === 'web' ? prepareWebDownload(targetName) : null
  const desktopDownload = Platform.OS === 'web' && Boolean(getDesktopFilesBridge())

  if (attachment.kind !== 'folder' && Platform.OS === 'web' && (previewContent != null || previewData != null)) {
    if (!webDownload) throw new Error('File download is not available')
    const bytes = previewData
      ? Uint8Array.from(atob(previewData), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(previewContent ?? '')
    await webDownload.saveBlob(new Blob([bytes as unknown as BlobPart], { type: mimeType }))
    return desktopDownload ? 'desktop' : 'download'
  }

  if (!machineId) throw new Error('Machine is offline')
  const send: SendFn = (frame) => accountRuntime.requestMachine(
    machineId,
    frame.method as AccountMachineRequestMethod,
    frame.params,
    { waitUntilReady: false },
  )

  if (attachment.kind === 'folder') {
    const archiveEntry = await archiveRemoteDirectory(send, {
      path: attachment.path,
      name: attachment.name,
      isDir: true,
    })
    const bytes = await readRemoteFileBytes(send, archiveEntry.path, onProgress, archiveEntry.path)

    if (Platform.OS === 'web') {
      if (!webDownload) throw new Error('File download is not available')
      await webDownload.saveBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/zip' }))
      return desktopDownload ? 'desktop' : 'download'
    }

    return saveNativeBytes(targetName, bytes, 'application/zip')
  }

  const bytes = await readRemoteFileBytes(
    send,
    attachment.path,
    onProgress,
    rootPath ?? attachment.path,
  )

  if (Platform.OS === 'web') {
    if (!webDownload) throw new Error('File download is not available')
    await webDownload.saveBlob(new Blob([bytes as unknown as BlobPart], { type: mimeType }))
    return desktopDownload ? 'desktop' : 'download'
  }

  const mediaType = getNativeMediaType(mimeType, attachment.name)
  if (mediaType) {
    return saveNativeMediaToLibrary(attachment.name, bytes, mediaType)
  }

  return saveNativeBytes(attachment.name, bytes, mimeType)
}
