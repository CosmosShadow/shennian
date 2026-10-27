// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test src/__tests__/room-attachments.test.ts
// Account-only operations stay outside the scoped browser attachment dependency graph.

import { Platform } from 'react-native'
import {
  prepareWebDownload,
  saveNativeBytes,
  saveNativeMediaToLibrary,
} from '../../components/chat/fileOperations'
import { roomAccountClient } from './roomAccountClient'
import { isInlineImage } from '../uploads/heicFile'
import {
  uploadRoomAttachmentWith,
  isFutureTimestamp,
  type RoomPickedFile,
  type RoomDownloadableAttachment,
} from './roomAttachments'

export { pickDesktopRoomAttachment } from './roomAttachments'

export async function loadRoomAttachmentPreview(roomId: string, attachmentId: string, _signal?: AbortSignal): Promise<string> {
  return getRoomAttachmentDownloadUrl(roomId, attachmentId)
}

export async function uploadRoomAttachment(roomId: string, file: RoomPickedFile, _signal?: AbortSignal): Promise<string> {
  return uploadRoomAttachmentWith(roomId, file, {
    initialize: (attachment) => roomAccountClient.initializeAttachment(roomId, attachment),
    complete: (attachmentId) => roomAccountClient.completeAttachment(roomId, attachmentId),
  })
}

export async function getRoomAttachmentDownloadUrl(roomId: string, attachmentId: string): Promise<string> {
  const result = await roomAccountClient.getAttachmentDownload(roomId, attachmentId)
  const url = new URL(result.downloadUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !isFutureTimestamp(result.expiresAt)
  ) {
    throw new Error('invalid_room_attachment_download')
  }
  return url.toString()
}

export async function downloadRoomAttachment(
  roomId: string,
  attachment: RoomDownloadableAttachment,
): Promise<'browser' | 'picker' | 'downloads' | 'share' | 'library' | 'permission-denied'> {
  // Chromium requires the file picker to be created synchronously in the
  // user's click task, before waiting for the signed URL or object download.
  const webDownload = prepareWebDownload(attachment.name)
  const url = await getRoomAttachmentDownloadUrl(roomId, attachment.attachmentId)
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error('room_attachment_download_failed')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength !== Number(attachment.byteSize)) {
    throw new Error('room_attachment_download_size_changed')
  }
  const mimeType = attachment.mimeType || 'application/octet-stream'
  if (Platform.OS === 'web') {
    if (!webDownload) throw new Error('room_attachment_download_unavailable')
    return webDownload.saveBlob(new Blob([buffer], { type: mimeType }))
  }
  if (isInlineImage({ name: attachment.name, mimeType }) && mimeType !== 'image/svg+xml') {
    return saveNativeMediaToLibrary(attachment.name, new Uint8Array(buffer), 'photo')
  }
  if (mimeType.startsWith('video/')) {
    return saveNativeMediaToLibrary(attachment.name, new Uint8Array(buffer), 'video')
  }
  return saveNativeBytes(attachment.name, new Uint8Array(buffer), mimeType)
}
