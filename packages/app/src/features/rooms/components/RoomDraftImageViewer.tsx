// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @test src/__tests__/room-attachments.test.ts

import { useCallback } from 'react'
import { Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MessageImageGallery } from '../../../components/MessageImageGallery'
import { loadRoomAttachmentPreview } from '../roomAccountAttachments'
import { buildRoomDraftImageGallery, loadRoomDraftImage } from '../roomDraftImagePreview'
import type { PendingRoomAttachment } from '../useRoomDraftPersistence'

export function RoomDraftImageViewer({ roomId, preview, onClose }: {
  roomId: string
  preview: NonNullable<ReturnType<typeof buildRoomDraftImageGallery>>
  onClose: () => void
}) {
  const safeAreaInsets = useSafeAreaInsets()
  const loadImage = useCallback(
    (image: PendingRoomAttachment, signal?: AbortSignal) =>
      loadRoomDraftImage(roomId, image, loadRoomAttachmentPreview, signal),
    [roomId],
  )
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <MessageImageGallery
        images={preview.images}
        initialIndex={preview.initialIndex}
        loadImage={loadImage}
        onClose={onClose}
        closeIcon="close"
        safeAreaInsets={safeAreaInsets}
      />
    </Modal>
  )
}
