// @arch docs/features/network-rooms/ui.md#46-结构化附件
// @test src/__tests__/room-conversation-screen.test.ts

import type { RoomMessageView } from '@shennian/wire'

/** Web / Desktop keep the download card; in-app playback is a native-only surface. */
export const canPreviewRoomVideo = false

export function RoomVideoViewer(_props: {
  roomId: string
  attachment: RoomMessageView['attachments'][number]
  onClose: () => void
}) {
  return null
}
