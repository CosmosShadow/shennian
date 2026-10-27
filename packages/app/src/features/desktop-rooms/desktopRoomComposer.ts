// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-public-conversation.test.ts

import type { RoomMessageView } from '@shennian/wire'
import type { RoomPickedFile } from '../rooms/roomAttachments'
import { isHiddenRoomSystemMessage } from '../rooms/roomSystemMessages'
import { isHeicFile } from '../uploads/heicFile'

export type DesktopRoomSendMutex = { locked: boolean }
export type DesktopRoomAttachmentKind = 'media' | 'file'

function clipboardImageMimeType(file: File, itemType: string): string | null {
  if (file.type.startsWith('image/')) return file.type
  if (itemType.startsWith('image/')) return itemType
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  switch (extension) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    case 'svg': return 'image/svg+xml'
    default: return null
  }
}

export function extractDesktopRoomClipboardImages(
  clipboardData: Pick<DataTransfer, 'items'> | null | undefined,
  now = Date.now(),
): RoomPickedFile[] {
  if (!clipboardData) return []
  const images: RoomPickedFile[] = []
  Array.from(clipboardData.items).forEach((item, index) => {
    if (item.kind !== 'file') return
    const file = item.getAsFile()
    if (!file) return
    const mimeType = clipboardImageMimeType(file, item.type)
    if (!mimeType) return
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]?.replace('+xml', '') || 'png'
    images.push({ file, name: file.name || `pasted_image_${now}_${index + 1}.${extension}`, mimeType, size: file.size })
  })
  return images
}
export function desktopRoomSendBlockReason(input: { offline: boolean; sending: boolean; uploading: boolean; hasContent: boolean }): 'offline' | 'sending' | 'uploading' | 'empty' | null {
  if (input.offline) return 'offline'
  if (input.sending) return 'sending'
  if (input.uploading) return 'uploading'
  return input.hasContent ? null : 'empty'
}
export type DesktopRoomUnavailableKind = 'forbidden' | 'offline' | 'failed'
export type DesktopRoomComposerState = {
  active: boolean
  readOnlyKey: 'spaces_archived_readonly' | 'spaces_unavailable_body' | 'spaces_public_readonly' |
    'spaces_removed_readonly' | 'spaces_left_readonly'
}

export function getDesktopRoomComposerState(
  roomStatus: 'active' | 'archived' | 'deleted',
  hasMembership: boolean,
  readActive: boolean,
  membershipStatus?: 'active' | 'left' | 'removed' | null,
): DesktopRoomComposerState {
  return {
    active: roomStatus === 'active' && hasMembership && readActive,
    readOnlyKey: membershipStatus === 'removed'
      ? 'spaces_removed_readonly'
      : membershipStatus === 'left'
        ? 'spaces_left_readonly'
        : roomStatus === 'archived'
          ? 'spaces_archived_readonly'
          : roomStatus === 'deleted'
            ? 'spaces_unavailable_body'
            : 'spaces_public_readonly',
  }
}

export function isDesktopRoomFollowingLatest(offsetY: number): boolean {
  return Number.isFinite(offsetY) && offsetY < 120
}

export function getDesktopRoomUnavailableKind(
  state: 'forbidden' | 'failed',
  offline: boolean,
): DesktopRoomUnavailableKind {
  if (state === 'forbidden') return 'forbidden'
  return offline ? 'offline' : 'failed'
}

export function shouldSubmitDesktopRoomMessage(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
}): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing
}

export function acquireDesktopRoomSend(mutex: DesktopRoomSendMutex): boolean {
  if (mutex.locked) return false
  mutex.locked = true
  return true
}

export function releaseDesktopRoomSend(mutex: DesktopRoomSendMutex): void {
  mutex.locked = false
}

export function visibleDesktopRoomMessages(messages: RoomMessageView[]): RoomMessageView[] {
  return messages.filter((message) => !isHiddenRoomSystemMessage(message))
}

export function acceptsDesktopRoomAttachmentKind(
  mimeType: string,
  kind: DesktopRoomAttachmentKind,
  name?: string,
): boolean {
  // HEIC / HEIF is an ordinary file that no entry may reject as an image or non-image.
  if (isHeicFile({ name, mimeType })) return true
  const normalized = mimeType.toLowerCase()
  const media = normalized.startsWith('image/') || normalized.startsWith('video/')
  return kind === 'media' ? media : !media
}
