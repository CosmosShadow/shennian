// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/desktop-room-data-port.test.ts

import type { RoomMessageView } from '@shennian/wire'
import { resolveRoomMessagePreview } from '../rooms/roomMessagePreview'
import type { RoomListPreviewResolver } from '../rooms/components/RoomListPanel'
import { desktopRoomDataPort } from './desktopRoomDataPort'

/** Resolve list previews only through the Desktop-owned committed projection. */
export const resolveDesktopRoomListPreview: RoomListPreviewResolver = (
  accountId: string,
  roomId: string,
  latest: RoomMessageView,
) => resolveRoomMessagePreview(
  latest,
  (before) => desktopRoomDataPort.readMessages(accountId, roomId, { before, limit: 50 }),
)
