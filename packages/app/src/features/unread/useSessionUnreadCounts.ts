// @arch docs/features/unread-notification-center.md
// @test src/__tests__/session-unread-count-cache.test.ts

import { useSyncExternalStore } from 'react'
import {
  getSessionUnreadCountSnapshot,
  subscribeSessionUnreadCounts,
} from '../../lib/session-unread-count-cache'

export function useSessionUnreadCounts() {
  return useSyncExternalStore(
    subscribeSessionUnreadCounts,
    getSessionUnreadCountSnapshot,
    getSessionUnreadCountSnapshot,
  )
}

/**
 * Subscribe a single row to its own primitive unread value. The cache publishes
 * one shared snapshot, but an update for session A must not rerender every
 * mounted session row in a long Desktop sidebar.
 */
export function useSessionUnreadCount(sessionId: string): number {
  return useSyncExternalStore(
    subscribeSessionUnreadCounts,
    () => getSessionUnreadCountSnapshot()[sessionId] ?? 0,
    () => getSessionUnreadCountSnapshot()[sessionId] ?? 0,
  )
}
