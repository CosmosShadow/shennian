// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @test src/__tests__/room-attachments.test.ts

import type { PendingRoomAttachment } from './useRoomDraftPersistence'
import type { GalleryImageResource } from '../../components/MessageImageGallery'
import { isInlineImage } from '../uploads/heicFile'

export function canPreviewRoomDraftImage(item: PendingRoomAttachment): boolean {
  return isInlineImage(item) && Boolean(item.uri || item.attachmentId)
}

export function buildRoomDraftImageGallery(items: PendingRoomAttachment[], selectedId: string) {
  // Snapshot the draft, so background upload updates never reset the open pager.
  const images = items.filter(canPreviewRoomDraftImage).map((item) => ({ ...item, key: item.id }))
  const initialIndex = images.findIndex((item) => item.id === selectedId)
  return initialIndex < 0 ? null : { images, initialIndex }
}

export async function loadRoomDraftImage(
  roomId: string,
  item: PendingRoomAttachment,
  loadRemote: (roomId: string, attachmentId: string, signal?: AbortSignal) => Promise<GalleryImageResource>,
  signal?: AbortSignal,
): Promise<GalleryImageResource> {
  if (signal?.aborted) throw new Error('room_draft_preview_aborted')
  if (item.uri) return item.uri
  if (item.attachmentId) return loadRemote(roomId, item.attachmentId, signal)
  throw new Error('room_draft_preview_unavailable')
}
