import type { NianSession } from '@shennian/wire'
import { hasSessionUnread } from '@shennian/shared'

export function countSessionUnreadVisibleMessages(params: { session: NianSession }): number {
  if (!hasSessionUnread(params.session)) return 0

  const attentionCount = params.session.attentionCount ?? 0
  const readCount = params.session.userState?.lastReadAttentionCount ?? 0
  return Math.max(1, attentionCount - readCount)
}

export function countUnreadVisibleMessages(params: { sessions: NianSession[] }): number {
  return params.sessions.reduce(
    (total, session) => total + countSessionUnreadVisibleMessages({ session }),
    0,
  )
}
