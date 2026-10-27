// @arch docs/tasks/20260929-1455_神念管家本机入口.md
import type { ChatMessage } from '@shennian/shared'

const TIME_SEPARATOR_GAP_MS = 5 * 60_000

export type StewardMessageRowItem = { key: string; message: ChatMessage; showTimeSeparator: boolean }

/** One row per kept message, oldest first; a time separator opens the list and any 5+ minute gap. */
export function buildStewardMessageRows(messages: ChatMessage[]): StewardMessageRowItem[] {
  let previousTs: number | undefined
  return messages.map((message) => {
    const showTimeSeparator = previousTs === undefined || message.ts - previousTs > TIME_SEPARATOR_GAP_MS
    previousTs = message.ts
    return { key: message.id, message, showTimeSeparator }
  })
}

/** FlatList's inverted origin is the visual bottom; keep each separator with its message. */
export function buildInvertedStewardMessageRows(messages: ChatMessage[]): StewardMessageRowItem[] {
  return buildStewardMessageRows(messages).reverse()
}
