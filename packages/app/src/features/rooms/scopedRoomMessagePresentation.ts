// @test src/__tests__/scoped-room-message-presentation.test.ts

import type { RoomMessageView } from '@shennian/wire'

type SourceLabelKey =
  | 'spaces_message_human_reply'
  | 'spaces_message_ai_generated'
  | 'spaces_message_ai_sent'

export function scopedRoomSourceLabelKey(
  principalType: RoomMessageView['author']['principalType'],
  source: RoomMessageView['source'],
): SourceLabelKey | null {
  if (principalType === 'agent') {
    return source === 'app' || source === 'cli'
      ? 'spaces_message_human_reply'
      : 'spaces_message_ai_generated'
  }
  if (source === 'managed_agent') return 'spaces_message_ai_generated'
  if (source === 'cli') return 'spaces_message_ai_sent'
  return null
}
