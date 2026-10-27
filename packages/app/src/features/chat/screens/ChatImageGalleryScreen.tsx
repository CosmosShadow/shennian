// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/image-gallery.test.ts

import { useCallback, useMemo } from 'react'
import { Stack } from 'expo-router'
import { useSessionsStore } from '@shennian/shared'
import type { ChatAttachmentMeta } from '@shennian/wire'
import { MessageImageGallery } from '../../../components/MessageImageGallery'
import { useGoBack } from '../../../hooks/useGoBack'
import { loadAttachmentPreview } from '../utils/attachmentPreview'
import { downloadChatAttachment } from '../utils/attachmentDownload'

export function ChatImageGalleryScreen({
  sessionId,
  images,
  selectedPath,
}: {
  sessionId?: string
  images: ChatAttachmentMeta[]
  selectedPath: string
}) {
  const goBack = useGoBack()
  const machineId = useSessionsStore(
    (store) => store.sessions.find((session) => session.id === sessionId)?.machineId ?? null,
  )
  const items = useMemo(() => images.map((image) => ({ ...image, key: image.path })), [images])
  const loadImage = useCallback(
    async (image: ChatAttachmentMeta) => {
      const result = await loadAttachmentPreview(machineId, image, { refresh: true })
      if (!result.data || result.error) throw new Error(result.error || 'No image')
      return result.data
    },
    [machineId],
  )
  const download = useCallback(
    (image: ChatAttachmentMeta) =>
      downloadChatAttachment({
        machineId,
        attachment: image,
        rootPath: image.path,
      }),
    [machineId],
  )
  return (
    <>
      {/* Keep iOS edge-back; a swipe across the image pages the gallery, not the route. */}
      <Stack.Screen options={{ fullScreenGestureEnabled: false }} />
      <MessageImageGallery
        images={items}
        initialIndex={images.findIndex((image) => image.path === selectedPath)}
        loadImage={loadImage}
        onDownload={download}
        onClose={goBack}
      />
    </>
  )
}
