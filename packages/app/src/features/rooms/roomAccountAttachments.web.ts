// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test ../../__tests__/desktop-room-attachments.test.ts
import { useAuthStore } from '../../config/auth'
import { guessMimeType } from '../../components/chat/fileOperations'
import { pickDesktopFile, getDesktopFilesBridge } from '../desktop-control/desktopFileOperations'
import { requireDesktopRoomAttachmentBridge, unwrapAttachmentResult as unwrap } from '../desktop-control/desktopRoomAttachmentBridge'
import type { RoomPickedFile, RoomDownloadableAttachment } from './roomAttachments'
import { uploadMediaKind } from '../uploads/heicFile'

const CHUNK_BYTES = 256 * 1024
const MAX_BYTES = 100 * 1024 * 1024
let serial = 0

/** A single account-bound operation. Cancellation also owns pending main work. */
function operation(signal?: AbortSignal) {
  const bridge = requireDesktopRoomAttachmentBridge()
  const accountId = useAuthStore.getState().user?.id
  if (!accountId) throw new Error('desktop_account_unavailable')
  const id = `room-attachment-${Date.now()}-${++serial}`
  let canceled = false
  const cleanups = new Set<() => void>()
  const cancel = () => {
    if (canceled) return
    canceled = true
    void Promise.resolve().then(() => bridge.cancel({ id })).catch(() => undefined)
    for (const cleanup of cleanups) cleanup()
  }
  const unsubscribe = useAuthStore.subscribe((state) => {
    if (state.user?.id !== accountId) cancel()
  })
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  return {
    id, bridge, cancel, cleanups,
    check() {
      if (canceled || useAuthStore.getState().user?.id !== accountId) {
        throw new Error('desktop_room_attachment_canceled')
      }
    },
    dispose() { unsubscribe(); signal?.removeEventListener('abort', cancel); cleanups.clear() },
  }
}

export async function pickDesktopRoomAttachment(): Promise<RoomPickedFile | null> {
  const bridge = getDesktopFilesBridge()
  if (!bridge) throw new Error('desktop_file_bridge_unavailable')
  const file = await pickDesktopFile(bridge)
  return file ? { handle: file.handle, name: file.name, size: file.size, mimeType: guessMimeType(file.name), readBytes: file.readBytes } : null
}

export async function uploadRoomAttachment(roomId: string, file: RoomPickedFile, signal?: AbortSignal): Promise<string> {
  const op = operation(signal)
  try {
    op.check()
    assertSize(file.size)
    if (!file.handle && !file.file) throw new Error('desktop_room_attachment_source_unavailable')
    if (file.file && file.file.size !== file.size) throw new Error('desktop_room_attachment_size_changed')
    unwrap(await op.bridge.uploadStart({ id: op.id, roomId, name: file.name,
      mimeType: file.mimeType, mediaKind: uploadMediaKind(file), byteSize: file.size,
      source: file.handle ? { kind: 'file', handle: file.handle } : { kind: 'bytes' } }))
    op.check()
    if (!file.handle) {
      for (let offset = 0; offset < file.size;) {
        const bytes = new Uint8Array(await file.file!.slice(offset, offset + CHUNK_BYTES).arrayBuffer())
        op.check()
        const next = unwrap(await op.bridge.uploadChunk({ id: op.id, offset, bytes }))
        op.check()
        if (!bytes.byteLength || next.nextOffset !== offset + bytes.byteLength) throw new Error('desktop_room_attachment_invalid_page')
        offset = next.nextOffset
      }
    }
    const result = unwrap(await op.bridge.uploadFinish({ id: op.id }))
    op.check()
    if (!result.attachmentId) throw new Error('desktop_room_attachment_invalid_result')
    return result.attachmentId
  } catch (error) { op.cancel(); throw error } finally { op.dispose() }
}

export async function downloadRoomAttachment(roomId: string, attachment: RoomDownloadableAttachment, signal?: AbortSignal) {
  const op = operation(signal)
  try {
    op.check()
    const result = unwrap(await op.bridge.download({ id: op.id, roomId, attachmentId: attachment.attachmentId }))
    op.check()
    return result
  } catch (error) { op.cancel(); throw error } finally { op.dispose() }
}

/** Same contract as mobile: a short-lived signed URL the browser loads directly. */
export async function loadRoomAttachmentPreview(roomId: string, attachmentId: string, signal?: AbortSignal): Promise<string> {
  const bridge = requireDesktopRoomAttachmentBridge()
  const accountId = useAuthStore.getState().user?.id
  if (!accountId) throw new Error('desktop_account_unavailable')
  if (signal?.aborted) throw new Error('desktop_room_attachment_canceled')
  const preview = unwrap(await bridge.previewUrl({ roomId, attachmentId }))
  if (signal?.aborted || useAuthStore.getState().user?.id !== accountId) throw new Error('desktop_room_attachment_canceled')
  return preview.url
}

function assertSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) throw new Error('desktop_room_attachment_invalid_size')
}
