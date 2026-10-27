// @arch docs/features/network-rooms/local-first-persistence.md
// @test src/__tests__/room-message-preview.test.ts

import type { RoomMessageView } from '@shennian/wire'
import type { RoomMessagePage } from './roomAccountClient.types'
import { formatRoomSystemMessage, isHiddenRoomSystemMessage } from './roomSystemMessages'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function formatRoomListPreview(message: RoomMessageView | null | undefined, t: Translate): string {
  if (message?.kind === 'system' && !message.deletedAt && !isHiddenRoomSystemMessage(message) && message.text?.trim()) {
    return formatRoomSystemMessage(message, t)
  }
  if (!message || !isRoomPreviewMessage(message)) return t('spaces_latest_message_empty')
  const text =
    message.text?.trim() ||
    (message.attachments.some((attachment) => attachment.mediaKind === 'image')
      ? t('spaces_latest_message_image')
      : message.attachments.some((attachment) => attachment.mediaKind === 'audio')
        ? t('spaces_latest_message_audio')
        : t('spaces_latest_message_file'))
  return t('spaces_latest_message_preview', { sender: message.author.displayName, message: text })
}

export function isRoomPreviewMessage(
  message: RoomMessageView | null | undefined,
): boolean {
  return Boolean(
    message &&
    message.kind !== 'system' &&
    message.source !== 'system' &&
    !message.deletedAt &&
    (message.text?.trim() || message.attachments.length),
  )
}

/** Keep event/sync watermarks intact; only the list's visible preview skips non-body events. */
export async function resolveRoomMessagePreview(
  latest: RoomMessageView | null | undefined,
  readPage: (before: string) => Promise<RoomMessagePage>,
): Promise<RoomMessageView | null> {
  if (!latest) return null
  if (isRoomPreviewMessage(latest)) return latest
  let before = latest.sequence
  for (;;) {
    const page = await readPage(before)
    const messages = page.messages.filter((message) => BigInt(message.sequence) < BigInt(before))
    let oldest = before
    let result: RoomMessageView | null = null
    for (const message of messages) {
      if (BigInt(message.sequence) < BigInt(oldest)) oldest = message.sequence
      if (
        isRoomPreviewMessage(message) &&
        (!result || BigInt(message.sequence) > BigInt(result.sequence))
      ) {
        result = message
      }
    }
    if (result) return result
    if (!page.hasMore || oldest === before) return null
    before = oldest
  }
}
