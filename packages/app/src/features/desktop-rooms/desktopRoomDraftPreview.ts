// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test ../../__tests__/desktop-room-attachments.test.ts

import type { RoomPickedFile } from '../rooms/roomAttachments'
import { isInlineImage } from '../uploads/heicFile'

const MAX_LOCAL_PREVIEW_BYTES = 20 * 1024 * 1024

export type DesktopRoomDraftPreview = { uri: string; release(): void }

export async function createDesktopRoomDraftPreview(
  item: Pick<RoomPickedFile, 'name' | 'mimeType' | 'size' | 'uri' | 'file' | 'readBytes'>,
): Promise<DesktopRoomDraftPreview | null> {
  if (!isInlineImage(item)) return null
  if (item.uri) return { uri: item.uri, release: () => {} }
  if (item.size <= 0 || item.size > MAX_LOCAL_PREVIEW_BYTES) return null
  let blob: Blob
  if (item.file) {
    if (item.file.size !== item.size) return null
    blob = item.file
  } else if (item.readBytes) {
    const bytes = await item.readBytes()
    if (bytes.byteLength !== item.size) return null
    blob = new Blob([new Uint8Array(bytes)], { type: item.mimeType })
  } else {
    return null
  }
  const uri = URL.createObjectURL(blob)
  let released = false
  return { uri, release: () => {
    if (released) return
    released = true
    URL.revokeObjectURL(uri)
  } }
}
