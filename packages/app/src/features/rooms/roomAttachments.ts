// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test src/__tests__/room-attachments.test.ts

import * as Crypto from 'expo-crypto'
import { File as ExpoFile } from 'expo-file-system'
import { guessMimeType } from '../../components/chat/fileOperations'
import {
  getDesktopFilesBridge,
  pickDesktopFile,
} from '../desktop-control/desktopFileOperations'
import { scopedRoomApi } from './scopedRoomApi'
import { uploadMediaKind } from '../uploads/heicFile'
import type {
  RoomAttachmentInitializeInput,
  RoomInitializedUpload,
} from './roomAccountClient.types'

export type RoomPickedFile = {
  handle?: string
  uri?: string
  name: string
  mimeType: string
  size: number
  file?: Blob
  readBytes?: () => Promise<Uint8Array>
}

export function buildNativeRoomPickedMedia(
  asset: {
    uri: string
    fileName?: string | null
    mimeType?: string | null
    fileSize?: number | null
  },
  stamp: number,
  index: number,
): RoomPickedFile {
  return {
    uri: asset.uri,
    name: asset.fileName ?? `media_${stamp}_${index + 1}`,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    // Android's photo picker may transcode or copy media after reporting
    // fileSize. The upload hashes and validates the bytes actually read.
    size: 0,
  }
}

export type RoomDownloadableAttachment = {
  attachmentId: string
  name: string
  mimeType: string
  byteSize: string
}

type RoomAttachmentRequests = {
  initialize(attachment: RoomAttachmentInitializeInput): Promise<RoomInitializedUpload>
  complete(attachmentId: string): Promise<{
    attachment: { attachmentId: string; status: 'ready' }
  }>
}

export async function uploadScopedRoomAttachment(
  roomId: string,
  file: RoomPickedFile,
): Promise<string> {
  return uploadRoomAttachmentWith(roomId, file, {
    initialize: (attachment) => scopedRoomApi(roomId, '/attachments/init', {
      method: 'POST',
      body: JSON.stringify(attachment),
    }),
    complete: (attachmentId) => scopedRoomApi(
      roomId,
      `/attachments/${encodeURIComponent(attachmentId)}/complete`,
      { method: 'POST' },
    ),
  })
}

export async function uploadRoomAttachmentWith(
  roomId: string,
  file: RoomPickedFile,
  requests: RoomAttachmentRequests,
): Promise<string> {
  const bytes = await runUploadStage('read', () => readRoomAttachmentBytes(file))
  if (bytes.byteLength < 1 || bytes.byteLength > 100 * 1024 * 1024) throw new Error('invalid_attachment_size')
  if (file.size > 0 && file.size !== bytes.byteLength) throw new Error('attachment_size_changed')
  // The native Expo bridge accepts typed byte views reliably; passing the
  // backing ArrayBuffer directly fails on iOS even though BufferSource permits it.
  const digest = await runUploadStage('digest', () => (
    Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))
  ))
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  const mimeType = (file.mimeType || 'application/octet-stream').split(';', 1)[0]!.toLowerCase()
  const mediaKind = uploadMediaKind({ name: file.name, mimeType })
  const initialized = await runUploadStage('init', () => requests.initialize({
    clientUploadId: createUploadId(), name: file.name, mediaKind, mimeType,
    byteSize: bytes.byteLength, sha256,
  }))
  validateUpload(initialized, roomId, bytes.byteLength, sha256, mimeType)
  const uploaded = await runUploadStage('put', () => fetch(initialized.upload.url, {
    method: 'PUT',
    headers: initialized.upload.headers,
    body: bytes,
    redirect: 'error',
  }))
  if (!uploaded.ok) throw new Error('room_attachment_upload_failed')
  const completed = await runUploadStage('complete', () => (
    requests.complete(initialized.attachment.id)
  ))
  if (completed.attachment.attachmentId !== initialized.attachment.id || completed.attachment.status !== 'ready') {
    throw new Error('invalid_room_attachment_complete')
  }
  return completed.attachment.attachmentId
}

async function runUploadStage<T>(stage: 'read' | 'digest' | 'init' | 'put' | 'complete', operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    // Keep diagnostics useful without logging local paths, signed URLs, response bodies or credentials.
    console.warn(`[rooms] attachment upload failed at ${stage}`, {
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw error
  }
}

async function readRoomAttachmentBytes(file: RoomPickedFile): Promise<ArrayBuffer> {
  if (file.readBytes) {
    const bytes = await file.readBytes()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  if (file.file) return file.file.arrayBuffer()
  // React Native's fetch cannot reliably read local file:// picker results. The
  // Expo file handle reads the bytes through the native filesystem on iOS and Android.
  if (!file.uri) throw new Error('missing_attachment_data')
  if (file.uri.startsWith('file:')) return new ExpoFile(file.uri).arrayBuffer()
  return fetch(file.uri).then((response) => response.arrayBuffer())
}

/** Returns undefined outside Desktop, null when the user cancels. */
export async function pickDesktopRoomAttachment(): Promise<RoomPickedFile | null | undefined> {
  const bridge = getDesktopFilesBridge()
  if (!bridge) return undefined
  const file = await pickDesktopFile(bridge)
  if (!file) return null
  return {
    name: file.name,
    mimeType: guessMimeType(file.name),
    size: file.size,
    readBytes: file.readBytes,
  }
}

function validateUpload(
  result: RoomInitializedUpload,
  roomId: string,
  byteSize: number,
  sha256: string,
  mimeType: string,
) {
  const url = new URL(result.upload.url)
  if (
    result.attachment.roomId !== roomId ||
    result.attachment.byteSize !== String(byteSize) ||
    result.attachment.sha256 !== sha256 ||
    result.attachment.mimeType !== mimeType ||
    result.upload.method !== 'PUT' ||
    url.protocol !== 'https:' ||
    url.username || url.password || url.hash ||
    result.upload.headers['content-type'] !== mimeType ||
    result.upload.headers['x-oss-meta-sha256'] !== sha256 ||
    !isFutureTimestamp(result.upload.expiresAt)
  ) throw new Error('invalid_room_attachment_upload')
}

export function isFutureTimestamp(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function createUploadId(): string {
  return `room-upload-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
